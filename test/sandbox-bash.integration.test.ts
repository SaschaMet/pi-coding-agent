import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sandboxBashExtension from "../.pi/extensions/sandbox-bash.ts";
import { SRT_VERSION } from "../.pi/extensions/lib/sandbox-bash.ts";
import { asExtensionAPI, createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function srtVersion(): string | undefined {
	try {
		return execFileSync("srt", ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
	} catch {
		return undefined;
	}
}

// A skip is not a pass: the reason is printed so a skipped run is visible in the gate output.
const skipReason =
	process.platform !== "darwin"
		? "not macOS"
		: process.env.SANDBOX_RUNTIME === "1"
			? "running inside sandbox; run this file from a normal terminal or pi --no-sandbox"
			: srtVersion() !== SRT_VERSION
				? `srt ${SRT_VERSION} not installed`
				: undefined;
// vitest swallows console output during collection, so the notice goes straight to stderr.
if (skipReason) process.stderr.write(`\nSKIPPED: sandbox-bash integration (${skipReason})\n`);

describe.skipIf(skipReason !== undefined)("sandboxed bash against real srt", () => {
	let scratch: string;
	let project: string;
	let agentDir: string;
	let run: (command: string) => Promise<string>;
	let settingsPath: string;
	const saved = {
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		GITHUB_TOKEN: process.env.GITHUB_TOKEN,
	};

	beforeAll(async () => {
		scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-int-")));
		project = path.join(scratch, "project");
		agentDir = path.join(scratch, "agent");
		fs.mkdirSync(path.join(project, ".pi", "extensions"), { recursive: true });
		fs.writeFileSync(path.join(project, ".env"), "SBX_FIXTURE=visible\n");
		// srt denies .git/config writes, so the repo is created outside the sandbox.
		execFileSync("git", ["init", "-q", project]);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.GITHUB_TOKEN = "sbx-fake-token";

		const fake = createFakePi();
		fake.exec = (command: string, args: string[], options?: { cwd?: string; timeout?: number }) =>
			new Promise((resolve) => {
				execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout, encoding: "utf8" }, (error, stdout, stderr) => {
					const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
					resolve({ stdout, stderr, code, killed: false });
				});
			});
		const extensionPath = path.join(repoRoot, ".pi", "extensions", "sandbox-bash.ts");
		fake.getAllTools = () => [{ name: "bash", sourceInfo: { path: extensionPath } }];
		sandboxBashExtension(asExtensionAPI(fake));
		const ui = createFakeUi();
		await Promise.all(fake.handlers.get("session_start")!.map((h) => h({}, { cwd: project, hasUI: true, ui })));
		expect(ui.setStatus.mock.calls.at(-1)?.[1], ui.notify.mock.calls.map((c: unknown[]) => c[0]).join(" / ")).toMatch(
			/^sandbox: /,
		);
		settingsPath = path.join(agentDir, "sandbox-run", fs.readdirSync(path.join(agentDir, "sandbox-run"))[0]);

		const tool = fake.tools.get("bash")!;
		const ctx = { cwd: project, sessionManager: { getSessionId: () => "int", getSessionFile: () => undefined } };
		// Every probe ends with `true` so a denied step shows up in the text, not as a thrown exit code.
		run = async (command) => {
			const result = await tool.execute("int", { command: `${command}; true`, timeout: 60 }, undefined, undefined, ctx);
			return result.content.map((part: { text: string }) => part.text).join("");
		};
	}, 60_000);

	afterAll(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		fs.rmSync(scratch, { recursive: true, force: true });
		fs.rmSync(path.join(os.homedir(), "sbx-probe"), { force: true });
	});

	it("runs a plain command", async () => {
		expect(await run("echo hi")).toContain("hi");
	});

	it("denies reading ssh keys and gh credentials", async () => {
		expect(await run("cat ~/.ssh/known_hosts 2>&1")).toMatch(/Operation not permitted|No such file/);
		expect(await run("ls ~/.config/gh 2>&1")).toMatch(/Operation not permitted|No such file/);
	});

	it("denies reading .env files in the project", async () => {
		const out = await run("cat .env 2>&1");
		expect(out).toMatch(/Operation not permitted/);
		expect(out).not.toContain("SBX_FIXTURE");
	});

	it("never prints an npm auth token", async () => {
		expect(await run('cat "$HOME/.npmrc" 2>&1')).not.toMatch(/_authToken=\S{8,}/);
	});

	it("stops an interpreter from writing outside the project", async () => {
		await run(`node -e "require('fs').writeFileSync(process.env.HOME+'/sbx-probe','x')" 2>&1`);
		expect(fs.existsSync(path.join(os.homedir(), "sbx-probe"))).toBe(false);
	});

	it("denies writes to .pi/ and to its own settings file", async () => {
		expect(await run("echo x > .pi/extensions/probe.ts 2>&1")).toMatch(/Operation not permitted/);
		expect(fs.existsSync(path.join(project, ".pi", "extensions", "probe.ts"))).toBe(false);
		expect(await run(`echo x >> '${settingsPath}' 2>&1`)).toMatch(/Operation not permitted/);
	});

	it("allows writes in the project and in the host TMPDIR", async () => {
		const out = await run('echo x > ./tmp-probe && echo "$TMPDIR" && echo y > "$TMPDIR/sbx-int-probe" && echo wrote');
		expect(out).toContain(os.tmpdir());
		expect(out).toContain("wrote");
		expect(fs.existsSync(path.join(project, "tmp-probe"))).toBe(true);
		fs.rmSync(path.join(os.tmpdir(), "sbx-int-probe"), { force: true });
	});

	it("reaches the npm registry and nothing else", async () => {
		expect(await run("curl -sI --max-time 20 https://registry.npmjs.org | head -1")).toMatch(/200/);
		expect(await run("curl -sI --max-time 20 https://example.com 2>&1 | head -1")).toMatch(/403|Forbidden/);
		expect(await run(`node -e "require('dns').lookup('sbx-probe.example.com',(e,a)=>console.log(e?e.code:a))"`)).toMatch(
			/ENOTFOUND|EAI_AGAIN/,
		);
	}, 60_000);

	it("removes secret env vars and keeps the socket paths", async () => {
		const out = await run('echo "gh=[${GITHUB_TOKEN:-}] ssh=[${SSH_AUTH_SOCK:+set}] cmux=[${CMUX_SOCKET_PATH:+set}]"');
		expect(out).toContain("gh=[]");
		if (process.env.SSH_AUTH_SOCK) expect(out).toContain("ssh=[set]");
		if (process.env.CMUX_SOCKET_PATH) expect(out).toContain("cmux=[set]");
	});

	it("passes awkward commands through unchanged", async () => {
		const value = `it's $(echo no) \`id\` "$HOME"\nline2 \\ ; |`;
		const out = await run(`cat <<'SBX_EOF'\n${value}\nSBX_EOF`);
		expect(out).toContain(value);
	});

	it("blocks app launches, AppleScript and git config writes", async () => {
		expect(await run("open -a Calculator 2>&1; echo rc=$?")).not.toContain("rc=0");
		expect(await run("osascript -e 'display notification \"x\"' 2>&1; echo rc=$?")).not.toContain("rc=0");
		expect(await run("git config --local sbx.probe z 2>&1")).toMatch(/could not write config|Operation not permitted/);
	});
});

describe("bash tool ownership", () => {
	// pi resolves a tool name to the last registration, so a second bash would silently bypass the sandbox.
	it("no other installed extension registers a bash tool", () => {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		const roots = [
			...[".pi/npm/node_modules", ".pi/extensions", ".pi/local-packages"].map((p) => path.join(repoRoot, p)),
			...["npm/node_modules", "extensions", "local-packages"].map((p) => path.join(agentDir, p)),
		];
		const offenders: string[] = [];
		const walk = (dir: string, depth: number) => {
			if (!fs.existsSync(dir) || depth > 8) return;
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name === "@earendil-works" || (entry.name === "node_modules" && depth > 0)) continue;
					walk(full, depth + 1);
				} else if (/\.(ts|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
					const source = fs.readFileSync(full, "utf8");
					const definesBash = /name:\s*["']bash["']/.test(source) || /createBashTool(Definition)?\(/.test(source);
					if (definesBash && source.includes("registerTool")) offenders.push(full);
				}
			}
		};
		for (const root of roots) walk(root, 0);
		// The global copy appears once the extension is synced; any other file is an override.
		const allowed = new Set([path.join(repoRoot, ".pi/extensions/sandbox-bash.ts"), path.join(agentDir, "extensions/sandbox-bash.ts")]);
		expect(offenders.filter((file) => !allowed.has(file))).toEqual([]);
		expect(offenders).toContain(path.join(repoRoot, ".pi/extensions/sandbox-bash.ts"));
		// Walking every installed package is slow under full-suite load.
	}, 30_000);
});
