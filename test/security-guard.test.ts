import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import securityGuardExtension from "../.pi/extensions/security-guard.ts";
import { policy } from "../.pi/security/policy.ts";
import { asExtensionAPI, createFakePi, createFakeUi } from "./helpers/fake-pi.ts";
import { fakeSecrets, promptCases, toolCases, type ToolCase } from "./fixtures/security/cases.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

type ToolCallHandler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>;

type InputHandler = (event: unknown, ctx: unknown) => Promise<{ action: string } | undefined>;

function loadHandler<T>(extension: (pi: never) => void, event: "tool_call" | "input"): T {
	const pi = createFakePi();
	extension(asExtensionAPI(pi) as never);
	const handlers = pi.handlers.get(event) ?? [];
	expect(handlers).toHaveLength(1);
	return handlers[0] as T;
}

const loadToolCallHandler = (extension: (pi: never) => void) => loadHandler<ToolCallHandler>(extension, "tool_call");
const loadInputHandler = (extension: (pi: never) => void) => loadHandler<InputHandler>(extension, "input");

function copyExtensionWithoutPolicy(target: string): void {
	fs.cpSync(path.join(REPO_ROOT, ".pi/extensions/lib"), path.join(target, ".pi/extensions/lib"), { recursive: true });
	fs.copyFileSync(
		path.join(REPO_ROOT, ".pi/extensions/security-guard.ts"),
		path.join(target, ".pi/extensions/security-guard.ts"),
	);
	fs.mkdirSync(path.join(target, ".pi/security"));
	fs.copyFileSync(path.join(REPO_ROOT, ".pi/security/guard-core.ts"), path.join(target, ".pi/security/guard-core.ts"));
}

let repos: Record<"main" | "feature", string>;
let scratch: string;

beforeAll(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pi-security-guard-"));
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

describe("security guard extension", () => {
	it("registers its tool_call handler once", () => {
		const pi = createFakePi();
		securityGuardExtension(asExtensionAPI(pi));
		securityGuardExtension(asExtensionAPI(pi));
		expect(pi.handlers.get("tool_call")).toHaveLength(1);
	});

	it.each(toolCases.map((c) => [c.name, c] as const))("%s", async (_name, testCase: ToolCase) => {
		const handler = loadToolCallHandler(securityGuardExtension as never);
		const result = await handler(
			{ toolName: testCase.tool, input: testCase.input },
			{ hasUI: false, cwd: repos[testCase.branch ?? "feature"] },
		);
		if (testCase.expect === "deny") {
			expect(result?.block).toBe(true);
			expect(result?.reason).toBeTruthy();
		} else {
			expect(result?.block).not.toBe(true);
		}
	});

	it("blocks every tool call and drops every prompt when the policy cannot be loaded", async () => {
		const copy = path.join(scratch, "broken");
		copyExtensionWithoutPolicy(copy);
		const { default: brokenExtension } = await import(path.join(copy, ".pi/extensions/security-guard.ts"));
		const handler = loadToolCallHandler(brokenExtension);
		const result = await handler({ toolName: "read", input: { path: "README.md" } }, { hasUI: false, cwd: copy });
		expect(result?.block).toBe(true);
		expect(result?.reason).toMatch(/failed to load/);
		expect(result?.reason).toMatch(/npm run pi:sync-global/);

		const ui = createFakeUi();
		const input = loadInputHandler(brokenExtension);
		const prompt = await input({ type: "input", text: "hello", source: "interactive" }, { hasUI: true, ui, cwd: copy });
		expect(prompt).toEqual({ action: "handled" });
		expect(ui.notify).toHaveBeenCalledWith(expect.stringMatching(/failed to load/), "error");
	});
});

describe("security guard prompt scan", () => {
	it.each(promptCases.map((c) => [c.name, c] as const))("%s", async (_name, testCase) => {
		const ui = createFakeUi();
		const handler = loadInputHandler(securityGuardExtension as never);
		const result = await handler(
			{ type: "input", text: testCase.text, source: "interactive" },
			{ hasUI: true, ui, cwd: repos.feature },
		);
		const notified = ui.notify.mock.calls.map(([message]) => String(message)).join("\n");
		if (testCase.expect === "block") {
			expect(result).toEqual({ action: "handled" });
			expect(notified).toContain(testCase.pattern);
			expect(notified).toContain(policy.rotateSentence);
		} else if (testCase.expect === "warn") {
			expect(result).toEqual({ action: "continue" });
			expect(notified).toContain(testCase.pattern);
		} else {
			expect(result).toEqual({ action: "continue" });
			expect(ui.notify).not.toHaveBeenCalled();
		}
		for (const secret of Object.values(fakeSecrets)) expect(notified).not.toContain(secret);
	});

	it("blocks a secret from an rpc prompt", async () => {
		const ui = createFakeUi();
		const handler = loadInputHandler(securityGuardExtension as never);
		const result = await handler({ type: "input", text: fakeSecrets.aws, source: "rpc" }, { hasUI: true, ui, cwd: repos.feature });
		expect(result).toEqual({ action: "handled" });
	});

	it("does not scan input from extensions", async () => {
		const ui = createFakeUi();
		const handler = loadInputHandler(securityGuardExtension as never);
		const result = await handler({ type: "input", text: fakeSecrets.aws, source: "extension" }, { hasUI: true, ui, cwd: repos.feature });
		expect(result).toEqual({ action: "continue" });
	});

	it("writes the pattern name to stderr when there is no UI", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const handler = loadInputHandler(securityGuardExtension as never);
		const result = await handler(
			{ type: "input", text: fakeSecrets.aws, source: "interactive" },
			{ hasUI: false, ui: createFakeUi(), cwd: repos.feature },
		);
		expect(result).toEqual({ action: "handled" });
		expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("AWS access key ID");
	});

	it("drops the prompt when the scanner throws", async () => {
		const handler = loadInputHandler(securityGuardExtension as never);
		const event = {
			type: "input",
			source: "interactive",
			get text(): string {
				throw new Error("boom");
			},
		};
		const result = await handler(event, { hasUI: true, ui: createFakeUi(), cwd: repos.feature });
		expect(result).toEqual({ action: "handled" });
	});

	it("drops a prompt that is too large to scan", async () => {
		const handler = loadInputHandler(securityGuardExtension as never);
		const text = "a ".repeat(policy.maxScanChars);
		const result = await handler({ type: "input", text, source: "interactive" }, { hasUI: true, ui: createFakeUi(), cwd: repos.feature });
		expect(result).toEqual({ action: "handled" });
	});
});

describe("security policy", () => {
	it("compiles every regex with JavaScript flags, not Python inline flags", () => {
		const sources = [
			...policy.secretPatterns,
			...policy.commandRules,
			{ source: policy.rmFlag },
			{ source: policy.rmDangerousTarget },
		];
		for (const entry of sources) {
			expect(entry.source).not.toMatch(/^\(\?[a-zA-Z]+\)/);
			expect(() => new RegExp(entry.source, (entry as { flags?: string }).flags)).not.toThrow();
		}
	});
});
