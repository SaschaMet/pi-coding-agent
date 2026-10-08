// Claude Code hook adapter for guard-core.ts, and the scan behind the global
// git pre-commit hook (`guard-cli.ts pre-commit`). Exit 2 is the only result
// Claude treats as a block on its own (JSON that fails schema validation lets
// the call through), so every deny and every error exits 2 with a reason on
// stderr. Installed as: node "$HOME/.pi/agent/security/guard-cli.ts" || exit 2
import { execFileSync } from "node:child_process";
import os from "node:os";
import type * as GuardCore from "./guard-core.ts";
import type * as PolicyModule from "./policy.ts";

const BLOCK = 2;
// Bounds memory before JSON.parse; the core caps every text it runs a regex on.
const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const MAX_STAGED_BYTES = 5 * 1024 * 1024;
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json", "bun.lock", "bun.lockb"];

type Core = typeof GuardCore;
type Policy = PolicyModule.Policy;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function fail(message: string): number {
	process.stderr.write(`${message}\n`);
	return BLOCK;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		size += chunk.length;
		if (size > MAX_STDIN_BYTES) throw new Error("hook input is too large to check");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function currentBranch(cwd: string): string | undefined {
	try {
		const out = execFileSync("git", ["-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

function claudeHook(payload: Record<string, unknown>, core: Core, policy: Policy): number {
	const event = payload.hook_event_name;
	if (event === "PreToolUse") {
		if (typeof payload.tool_name !== "string") return fail("Security guard: hook input has no tool_name.");
		const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
		const result = core.evaluateToolCall(
			{
				tool: payload.tool_name,
				input: isRecord(payload.tool_input) ? payload.tool_input : {},
				cwd,
				home: os.homedir(),
				getCurrentBranch: () => currentBranch(cwd),
			},
			policy,
		);
		return result.decision === "deny" ? fail(result.reason) : 0;
	}
	if (event === "UserPromptSubmit") {
		const scan = core.scanText(typeof payload.prompt === "string" ? payload.prompt : "", policy);
		if (core.isScanBlocked(scan)) return fail(core.scanBlockMessage(scan, policy));
		if (scan.warned.length) process.stderr.write(`${core.scanWarnMessage(scan)}\n`);
	}
	return 0;
}

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 4 * MAX_STAGED_BYTES });
}

function stagedAddedLines(): string[] {
	const diff = git([
		"diff",
		"--cached",
		"-U0",
		"--no-color",
		"--no-ext-diff",
		"--diff-filter=ACMR",
		"--",
		".",
		...LOCKFILES.map((name) => `:(exclude,glob)**/${name}`),
	]);
	const added: string[] = [];
	let inHunk = false;
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) inHunk = false;
		else if (line.startsWith("@@")) inHunk = true;
		else if (inHunk && line.startsWith("+")) added.push(line.slice(1));
	}
	return added;
}

// The core caps each scanned text, so long diffs are scanned in line-aligned chunks.
function scanChunks(lines: string[], core: Core, policy: Policy): GuardCore.ScanResult {
	const total: GuardCore.ScanResult = { blocked: [], warned: [], tooLarge: false };
	const merge = (text: string) => {
		const scan = core.scanText(text, policy);
		total.tooLarge ||= scan.tooLarge;
		for (const name of scan.blocked) if (!total.blocked.includes(name)) total.blocked.push(name);
		for (const name of scan.warned) if (!total.warned.includes(name)) total.warned.push(name);
	};
	let chunk: string[] = [];
	let size = 0;
	for (const line of lines) {
		if (size + line.length + 1 > policy.maxScanChars && chunk.length) {
			merge(chunk.join("\n"));
			chunk = [];
			size = 0;
		}
		chunk.push(line);
		size += line.length + 1;
	}
	if (chunk.length) merge(chunk.join("\n"));
	return total;
}

function preCommit(core: Core, policy: Policy): number {
	const staged = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]).split("\0").filter(Boolean);
	const envFiles = staged.filter((file) => core.mentionsBlockedEnvFile(file, policy));
	if (envFiles.length) {
		return fail(`Commit blocked: .env files are staged (${envFiles.join(", ")}). Unstage them with git restore --staged.`);
	}

	const lines = stagedAddedLines();
	if (Buffer.byteLength(lines.join("\n")) > MAX_STAGED_BYTES) {
		return fail("Commit blocked: more than 5 MB of staged text to scan. Split the commit.");
	}
	const scan = scanChunks(lines, core, policy);
	if (core.isScanBlocked(scan)) return fail(`Commit blocked. ${core.scanBlockMessage(scan, policy)}`);
	if (scan.warned.length) process.stderr.write(`${core.scanWarnMessage(scan)}\n`);
	return 0;
}

async function main(): Promise<number> {
	let core: Core;
	let policy: Policy;
	try {
		const [coreModule, policyModule] = await Promise.all([
			import(new URL("./guard-core.ts", import.meta.url).href) as Promise<Core>,
			import(new URL("./policy.ts", import.meta.url).href) as Promise<typeof PolicyModule>,
		]);
		core = coreModule;
		policy = policyModule.policy;
	} catch (error) {
		return fail(`Security guard failed to load (${errorMessage(error)}). Run npm run pi:sync-global in pi-coding-agent.`);
	}

	if (process.argv[2] === "pre-commit") return preCommit(core, policy);

	let payload: unknown;
	try {
		payload = JSON.parse(await readStdin());
	} catch (error) {
		return fail(`Security guard: unreadable hook input (${errorMessage(error)}).`);
	}
	if (!isRecord(payload)) return fail("Security guard: hook input is not a JSON object.");
	return claudeHook(payload, core, policy);
}

main().then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		process.exitCode = fail(`Security guard error: ${errorMessage(error)}`);
	},
);
