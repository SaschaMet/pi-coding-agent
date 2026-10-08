import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import securityGuardExtension from "../.pi/extensions/security-guard.ts";
import { isScanBlocked, scanText } from "../.pi/security/guard-core.ts";
import { policy } from "../.pi/security/policy.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";
import { fakeSecrets, promptCases, toolCases, type ToolCase } from "./fixtures/security/cases.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, ".pi/security/guard-cli.ts");

const CLAUDE_TOOL_NAMES: Record<string, string> = {
	read: "Read",
	write: "Write",
	edit: "Edit",
	grep: "Grep",
	find: "Glob",
	ls: "LS",
	bash: "Bash",
	powershell: "PowerShell",
};

function toClaudeInput(testCase: ToolCase): Record<string, unknown> {
	if (!["read", "write", "edit"].includes(testCase.tool) || !("path" in testCase.input)) return testCase.input;
	const { path: filePath, ...rest } = testCase.input;
	return { ...rest, file_path: filePath };
}

function runCli(payload: unknown, cli = CLI) {
	return spawnSync(process.execPath, [cli], { input: JSON.stringify(payload), encoding: "utf8", timeout: 20_000 });
}

let repos: Record<"main" | "feature", string>;
let scratch: string;

beforeAll(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pi-security-parity-"));
	const init = (name: string, branch: string): string => {
		const dir = path.join(scratch, name);
		fs.mkdirSync(dir);
		execFileSync("git", ["init", "-q", "-b", branch, dir]);
		return dir;
	};
	repos = { main: init("main", "main"), feature: init("feature", "feature/x") };
});

afterAll(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

describe("PI and Claude adapters agree", () => {
	it.each(toolCases.map((c) => [c.name, c] as const))("%s", async (_name, testCase) => {
		const cwd = repos[testCase.branch ?? "feature"];
		const pi = createFakePi();
		securityGuardExtension(asExtensionAPI(pi));
		const [handler] = pi.handlers.get("tool_call") ?? [];
		const piResult = await handler({ toolName: testCase.tool, input: testCase.input }, { hasUI: false, cwd });
		const piDecision = piResult?.block ? "deny" : "allow";

		const cli = runCli({
			hook_event_name: "PreToolUse",
			tool_name: CLAUDE_TOOL_NAMES[testCase.tool] ?? testCase.tool,
			tool_input: toClaudeInput(testCase),
			cwd,
		});
		const cliDecision = cli.status === 2 ? "deny" : cli.status === 0 ? "allow" : `exit ${cli.status}`;

		expect(piDecision).toBe(testCase.expect);
		expect(cliDecision).toBe(testCase.expect);
		if (cliDecision === "deny") expect(cli.stderr.trim()).toBeTruthy();
	});

	it.each(promptCases.map((c) => [c.name, c] as const))("prompt: %s", (_name, testCase) => {
		const cli = runCli({ hook_event_name: "UserPromptSubmit", prompt: testCase.text, cwd: repos.feature });
		expect(cli.status).toBe(testCase.expect === "block" ? 2 : 0);
		if (testCase.pattern) expect(cli.stderr).toContain(testCase.pattern);
		for (const secret of Object.values(fakeSecrets)) expect(cli.stderr).not.toContain(secret);
	});
});

describe("Claude hook CLI fails closed", () => {
	it("exits 2 with a reason when the policy is missing", () => {
		const copy = path.join(scratch, "broken");
		fs.mkdirSync(copy);
		for (const file of ["guard-cli.ts", "guard-core.ts"]) {
			fs.copyFileSync(path.join(REPO_ROOT, ".pi/security", file), path.join(copy, file));
		}
		const cli = runCli({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a" } }, path.join(copy, "guard-cli.ts"));
		expect(cli.status).toBe(2);
		expect(cli.stderr).toMatch(/failed to load/);
	});

	it("exits 2 on input that is not JSON", () => {
		const cli = spawnSync(process.execPath, [CLI], { input: "not json", encoding: "utf8" });
		expect(cli.status).toBe(2);
	});

	it("exits 2 on hook input that is too large to check", () => {
		const cli = runCli({ hook_event_name: "UserPromptSubmit", prompt: "a".repeat(9 * 1024 * 1024) });
		expect(cli.status).toBe(2);
	});

	it("turns a missing CLI into exit 2 through the installed hook command", () => {
		const missing = path.join(scratch, "nope", "guard-cli.ts");
		const hook = spawnSync("sh", ["-c", `"${process.execPath}" "${missing}" || exit 2`], { input: "{}", encoding: "utf8" });
		expect(hook.status).toBe(2);
	});
});

describe("committed files", () => {
	it("hold no string that matches a blocking secret pattern", () => {
		const files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
		const offenders = files.filter((file) => {
			const full = path.join(REPO_ROOT, file);
			if (!fs.existsSync(full) || fs.statSync(full).size > policy.maxScanChars) return false;
			const text = fs.readFileSync(full, "utf8");
			return !text.includes("\0") && isScanBlocked(scanText(text, policy));
		});
		expect(offenders).toEqual([]);
	});
});
