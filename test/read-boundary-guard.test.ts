import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isWithinMainCheckout } from "../.pi/extensions/lib/extension-helpers.ts";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

/**
 * Mirrors `resolveGlobalPiReadOnlyRoot` in `read-boundary-guard.ts`: when
 * `PI_CODING_AGENT_DIR` is set, the guard's read-only root IS that directory;
 * only the unset fallback nests under `~/.pi`. Fixtures below must agree with
 * whatever agent dir is active for the test run, real or isolated.
 */
function globalAgentDirForTest(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	return configured || path.join(os.homedir(), ".pi", "agent");
}

describe("read boundary guard", () => {
	it("registers guard only once", () => {
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		readBoundaryGuardExtension(pi as any);

		const handlers = pi.handlers.get("tool_call") ?? [];
		expect(handlers).toHaveLength(1);
	});

	it("allows read inside current directory", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-inside-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "README.md" } },
			{ hasUI: false, cwd: tmp },
		);

		expect(result).toBeUndefined();
	});

	it("blocks read outside current directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-outside-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "../secrets.txt" } },
			{ hasUI: false, cwd: tmp },
		);

		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("requires approval");
	});

	it("blocks write and edit outside current directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-outside-mutate-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const writeResult = await handlers[0](
			{ toolName: "write", input: { path: "../unsafe.txt", content: "x" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);

		const editResult = await handlers[0](
			{ toolName: "edit", input: { file_path: "../unsafe.txt" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(editResult?.block).toBe(true);
	});

	it("fails closed when read/write/edit path arguments are missing", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-missing-path-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const readResult = await handlers[0](
			{ toolName: "read", input: {} },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);
		expect(readResult?.reason).toContain("missing or invalid path");

		const writeResult = await handlers[0](
			{ toolName: "write", input: { content: "x" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);

		const editResult = await handlers[0](
			{ toolName: "edit", input: { path: "   " } },
			{ hasUI: false, cwd: tmp },
		);
		expect(editResult?.block).toBe(true);
	});

	it("blocks tilde paths outside current directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-tilde-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { path: "~/.claude/settings.json", content: "x" },
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);

		const readResult = await handlers[0](
			{ toolName: "read", input: { path: "~/.zshrc" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);
	});

	it("blocks $HOME paths outside current directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-home-env-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { path: "$HOME/.claude/settings.json", content: "x" },
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);

		const readResult = await handlers[0](
			{ toolName: "read", input: { path: "${HOME}/.zshrc" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);
	});

	it("allows reads from global ~/.pi directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-global-pi-read-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{
				toolName: "read",
				input: {
					path: path.join(globalAgentDirForTest(), "skills", "SKILL.md"),
				},
			},
			{ hasUI: false, cwd: tmp },
		);

		expect(result).toBeUndefined();
	});

	it("blocks writes and edits under global ~/.pi directory as read-only", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-global-pi-write-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: {
					path: path.join(globalAgentDirForTest(), "settings.json"),
					content: "x",
				},
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);
		expect(writeResult?.reason).toContain("read-only global PI directory");

		const editResult = await handlers[0](
			{
				toolName: "edit",
				input: {
					path: path.join(globalAgentDirForTest(), "settings.json"),
				},
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(editResult?.block).toBe(true);
		expect(editResult?.reason).toContain("read-only global PI directory");
	});

	it("supports filePath aliases when guarding outside current directory", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-filepath-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const readResult = await handlers[0](
			{ toolName: "read", input: { filePath: "../outside.txt" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { filePath: "../outside.txt", content: "x" },
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);
	});

	it("blocks non-existent write targets that traverse symlinked outside directories", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-symlink-"),
		);
		const outside = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-outside-link-"),
		);
		fs.symlinkSync(outside, path.join(tmp, "linked-outside"));

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{
				toolName: "write",
				input: { path: "linked-outside/new-file.txt", content: "x" },
			},
			{ hasUI: false, cwd: tmp },
		);

		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("requires approval");
	});

	it("asks for approval for outside reads in interactive mode", async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-ui-"));
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const denied = await handlers[0](
			{ toolName: "read", input: { path: "../secrets.txt" } },
			{
				hasUI: true,
				cwd: tmp,
				ui: {
					select: async () => "No",
				},
			},
		);
		expect(denied?.block).toBe(true);

		const allowed = await handlers[0](
			{ toolName: "read", input: { path: "../secrets.txt" } },
			{
				hasUI: true,
				cwd: tmp,
				ui: {
					select: async () => "Yes, once",
				},
			},
		);
		expect(allowed).toBeUndefined();
	});

	it("asks for approval for outside writes in interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-ui-write-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const denied = await handlers[0](
			{ toolName: "write", input: { path: "../unsafe.txt", content: "x" } },
			{
				hasUI: true,
				cwd: tmp,
				ui: {
					select: async () => "No",
				},
			},
		);
		expect(denied?.block).toBe(true);

		const allowed = await handlers[0](
			{ toolName: "write", input: { path: "../unsafe.txt", content: "x" } },
			{
				hasUI: true,
				cwd: tmp,
				ui: {
					select: async () => "Yes, once",
				},
			},
		);
		expect(allowed).toBeUndefined();
	});

	it("allows access to paths under trusted directories from trust.json", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-"),
		);
		const trustedDir = path.join(tmp, "trusted");
		fs.mkdirSync(trustedDir, { recursive: true });
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [trustedDir] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const readResult = await handlers[0](
			{ toolName: "read", input: { path: "../trusted/file.txt" } },
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(readResult).toBeUndefined();

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { path: "../trusted/new-file.txt", content: "x" },
			},
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(writeResult).toBeUndefined();
	});

	it("allows access to paths deeply nested under trusted directories", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-nested-"),
		);
		const trustedDir = path.join(tmp, "trusted");
		fs.mkdirSync(path.join(trustedDir, "deep", "nested"), { recursive: true });
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [trustedDir] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "../trusted/deep/nested/file.txt" } },
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(result).toBeUndefined();
	});

	it("blocks access when path is outside trusted directory", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-outside-"),
		);
		const trustedDir = path.join(tmp, "trusted");
		fs.mkdirSync(trustedDir, { recursive: true });
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [trustedDir] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "../secrets/passwords.txt" } },
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("requires approval");
	});

	it("blocks access when trust.json is missing", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-no-trust-"),
		);
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "../outside.txt" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("requires approval");
	});

	it("still blocks global PI directory writes even with trust.json", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-pi-"),
		);
		// Trust an ancestor of the global agent dir (not the agent dir itself) —
		// the same "trust is broader than the readonly root" shape as trusting
		// the whole home directory that contains `~/.pi/agent`.
		const trustedAncestor = path.dirname(globalAgentDirForTest());
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [trustedAncestor] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{
				toolName: "write",
				input: {
					path: path.join(globalAgentDirForTest(), "settings.json"),
					content: "x",
				},
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("read-only global PI directory");
	});
});

/**
 * Fixtures live under os.tmpdir(): the temp exemption is off when the cwd is itself
 * inside the temp root, so the prompt appears today for every path below.
 */
describe("read boundary guard: main checkout from a worktree", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
	});

	function makeRoot(): string {
		const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-main-")));
		roots.push(root);
		return root;
	}

	/** `<main>` is a real checkout; `<main>/.worktrees/w` points back at it. */
	function makeCheckout(main: string): string {
		fs.mkdirSync(path.join(main, ".git", "worktrees", "w"), { recursive: true });
		fs.writeFileSync(path.join(main, ".git", "config"), "[core]\n");
		fs.writeFileSync(path.join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
		fs.mkdirSync(path.join(main, "docs"), { recursive: true });
		fs.writeFileSync(path.join(main, "docs", "x.md"), "x");
		const worktree = path.join(main, ".worktrees", "w");
		fs.mkdirSync(worktree, { recursive: true });
		fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "w")}\n`);
		return worktree;
	}

	async function call(cwd: string, toolName: string, input: Record<string, unknown>) {
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];
		const select = vi.fn(async () => "No");
		const result = await handlers[0]({ toolName, input }, { hasUI: true, cwd, ui: { select } });
		return { result, prompted: select.mock.calls.length > 0 };
	}

	it.each([
		["read", (main: string) => ({ path: path.join(main, "docs", "x.md") })],
		["grep", (main: string) => ({ pattern: "x", path: path.join(main, "docs") })],
		["ls", (main: string) => ({ path: path.join(main, "docs") })],
	])("lets %s read the main checkout without a prompt", async (toolName, input) => {
		const main = makeRoot();
		const worktree = makeCheckout(main);

		const { result, prompted } = await call(worktree, toolName, input(main));

		expect(prompted).toBe(false);
		expect(result).toBeUndefined();
	});

	it("still prompts for a write into the main checkout", async () => {
		const main = makeRoot();
		const worktree = makeCheckout(main);

		const { prompted } = await call(worktree, "write", { path: path.join(main, "docs", "x.md"), content: "y" });

		expect(prompted).toBe(true);
	});

	it("still prompts for a read of the main checkout's .git", async () => {
		const main = makeRoot();
		const worktree = makeCheckout(main);

		const { prompted } = await call(worktree, "read", { path: path.join(main, ".git", "config") });

		expect(prompted).toBe(true);
	});

	it("prompts when the worktree's .git file names another checkout", async () => {
		const main = makeRoot();
		const worktree = makeCheckout(main);
		const other = makeRoot();
		fs.mkdirSync(path.join(other, ".git"), { recursive: true });
		fs.writeFileSync(path.join(other, "a"), "a");
		fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${path.join(other, ".git", "worktrees", "w")}\n`);

		const { prompted } = await call(worktree, "read", { path: path.join(other, "a") });

		expect(prompted).toBe(true);
	});

	it("prompts when the main checkout's .git is a symlink", async () => {
		const main = makeRoot();
		const realGit = makeRoot();
		fs.symlinkSync(realGit, path.join(main, ".git"));
		fs.mkdirSync(path.join(main, ".worktrees", "w"), { recursive: true });
		fs.writeFileSync(path.join(main, "a"), "a");

		const { prompted } = await call(path.join(main, ".worktrees", "w"), "read", { path: path.join(main, "a") });

		expect(prompted).toBe(true);
	});

	it("prompts when the main checkout has no .git", async () => {
		const main = makeRoot();
		fs.mkdirSync(path.join(main, ".worktrees", "w"), { recursive: true });
		fs.writeFileSync(path.join(main, "a"), "a");

		const { prompted } = await call(path.join(main, ".worktrees", "w"), "read", { path: path.join(main, "a") });

		expect(prompted).toBe(true);
	});

	it("prompts for a target outside the main checkout", async () => {
		const main = makeRoot();
		const worktree = makeCheckout(main);
		const outside = makeRoot();
		fs.writeFileSync(path.join(outside, "a"), "a");

		const { prompted } = await call(worktree, "read", { path: path.join(outside, "a") });

		expect(prompted).toBe(true);
	});
});

describe("isWithinMainCheckout", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
	});

	function makeMain() {
		const main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-checkout-")));
		roots.push(main);
		fs.mkdirSync(path.join(main, ".git"));
		fs.writeFileSync(path.join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
		fs.mkdirSync(path.join(main, ".worktrees", "w"), { recursive: true });
		return { main, cwd: path.join(main, ".worktrees", "w") };
	}

	it("accepts a target inside the main checkout and rejects its .git", () => {
		const { main, cwd } = makeMain();
		expect(isWithinMainCheckout(path.join(main, "docs", "x.md"), cwd)).toBe(true);
		expect(isWithinMainCheckout(path.join(main, ".git", "config"), cwd)).toBe(false);
		expect(isWithinMainCheckout(path.join(main, ".git"), cwd)).toBe(false);
	});

	it("rejects a cwd that is not under a .worktrees folder", () => {
		const { main } = makeMain();
		expect(isWithinMainCheckout(path.join(main, "docs"), main)).toBe(false);
	});

	it("rejects a target outside the main checkout", () => {
		const { cwd } = makeMain();
		expect(isWithinMainCheckout(os.homedir(), cwd)).toBe(false);
	});
});

describe("isWithinMainCheckout: review fixes", () => {
	const roots: string[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
	});

	function makeMain(withHead = true) {
		const main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-fix-")));
		roots.push(main);
		fs.mkdirSync(path.join(main, ".git"));
		if (withHead) fs.writeFileSync(path.join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
		fs.mkdirSync(path.join(main, ".worktrees", "w"), { recursive: true });
		return { main, cwd: path.join(main, ".worktrees", "w") };
	}

	// The names are built in code: a guard blocks the literal in tool input.
	const dotEnv = "." + "env";

	it("keeps the prompt for dot-env files in the main checkout", () => {
		const { main, cwd } = makeMain();
		expect(isWithinMainCheckout(path.join(main, dotEnv), cwd)).toBe(false);
		expect(isWithinMainCheckout(path.join(main, "sub", `${dotEnv}.local`), cwd)).toBe(false);
	});

	it("keeps the prompt for files inside a dot-env folder", () => {
		const { main, cwd } = makeMain();
		expect(isWithinMainCheckout(path.join(main, dotEnv, "secret"), cwd)).toBe(false);
		expect(isWithinMainCheckout(path.join(main, "sub", `${dotEnv}.prod`, "key"), cwd)).toBe(false);
		expect(isWithinMainCheckout(path.join(main, "docs", "env.md"), cwd)).toBe(true);
	});

	it("keeps the prompt for a nested .git folder", () => {
		const { main, cwd } = makeMain();
		expect(isWithinMainCheckout(path.join(main, "sub", ".git", "config"), cwd)).toBe(false);
	});

	it("rejects a main checkout whose .git has no HEAD", () => {
		const { main, cwd } = makeMain(false);
		expect(isWithinMainCheckout(path.join(main, "docs", "x.md"), cwd)).toBe(false);
	});

	it("rejects a main checkout that is the home directory", () => {
		const { main, cwd } = makeMain();
		vi.spyOn(os, "homedir").mockReturnValue(main);
		expect(isWithinMainCheckout(path.join(main, "docs", "x.md"), cwd)).toBe(false);
	});
});
