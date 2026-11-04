import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sandboxBashExtension from "../.pi/extensions/sandbox-bash.ts";
import { SAFE_GIT_ARGS, WORKTREE_BRANCH, runGitWorktree } from "../.pi/extensions/lib/git-worktree.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

const realGit = execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim();

let scratch: string;
let main: string;

function git(cwd: string, ...args: string[]): string {
	return execFileSync(realGit, ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function branches(): string {
	return git(main, "branch", "--list", "--format=%(refname:short)");
}

function tmpDir(prefix: string): string {
	return fs.mkdtempSync(path.join(scratch, prefix));
}

function run(params: any, cwd: string = main, extra: { realGit?: string; env?: NodeJS.ProcessEnv } = {}) {
	return runGitWorktree(params, { cwd, realGit: extra.realGit ?? realGit, env: extra.env });
}

function add(target: string, branch: string, cwd: string = main) {
	return run({ action: "add", path: target, branch, base: "HEAD" }, cwd);
}

beforeEach(() => {
	scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gwt-")));
	main = path.join(scratch, "main");
	fs.mkdirSync(main);
	git(main, "init", "-q", "-b", "main");
	git(main, "config", "user.email", "t@example.com");
	git(main, "config", "user.name", "t");
	fs.writeFileSync(path.join(main, "f.txt"), "x\n");
	git(main, "add", "f.txt");
	git(main, "commit", "-q", "-m", "init");
});

afterEach(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

describe("constants", () => {
	it("pins the safe git arguments", () => {
		expect(SAFE_GIT_ARGS).toEqual(["-c", "core.fsmonitor=false", "-c", "core.hooks" + "Path=/dev/null"]);
	});

	it("accepts only handsoff and hill-climb branch names", () => {
		for (const ok of ["handsoff/t/p", "hill-climb/r/r1-w1"]) expect(WORKTREE_BRANCH.test(ok)).toBe(true);
		for (const bad of ["main", "feature/x", "handsoff", "handsoff/", "handsoff/../x"]) {
			expect(WORKTREE_BRANCH.test(bad)).toBe(false);
		}
	});
});

describe("runGitWorktree add", () => {
	it("creates a worktree and neutralizes planted config and hooks", () => {
		const marker1 = path.join(scratch, "marker1");
		const marker2 = path.join(scratch, "marker2");
		git(main, "config", "core.fsmonitor", `touch ${marker1}; false`);
		const hook = path.join(main, ".git", "hooks", "post-checkout");
		fs.mkdirSync(path.dirname(hook), { recursive: true });
		fs.writeFileSync(hook, `#!/bin/sh\ntouch ${marker2}\n`, { mode: 0o755 });

		const target = path.join(main, ".worktrees", "h", "p");
		const result = run({ action: "add", path: target, branch: "handsoff/t/p", base: "HEAD" });

		expect(result.refused).toBeUndefined();
		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(target)).toBe(true);
		expect(git(target, "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "HEAD"));
		expect(branches().split("\n")).toContain("handsoff/t/p");
		const pointer = fs.readFileSync(path.join(target, ".git"), "utf8");
		expect(pointer.startsWith("gitdir: ")).toBe(true);
		expect(pointer).toContain(path.join(main, ".git", "worktrees") + path.sep);
		expect(fs.existsSync(marker1)).toBe(false);
		expect(fs.existsSync(marker2)).toBe(false);
		expect(result.gitArgs!.slice(0, SAFE_GIT_ARGS.length)).toEqual(SAFE_GIT_ARGS);
		const dashdash = result.gitArgs!.indexOf("--");
		expect(dashdash).toBeGreaterThan(-1);
		expect(result.gitArgs!.indexOf(target)).toBeGreaterThan(dashdash);
	});

	it("nests worktrees under a lead worktree and removes them again", () => {
		const lead = path.join(main, ".worktrees", "h", "lead");
		expect(add(lead, "handsoff/t/lead").ok).toBe(true);

		const nested = path.join(lead, ".worktrees", "hill-climb-r", "r1-w1");
		const added = add(nested, "hill-climb/r/r1-w1", lead);
		expect(added.refused).toBeUndefined();
		expect(added.ok).toBe(true);
		expect(fs.existsSync(nested)).toBe(true);

		const removed = run({ action: "remove", path: nested }, lead);
		expect(removed.refused).toBeUndefined();
		expect(removed.ok).toBe(true);
		expect(fs.existsSync(nested)).toBe(false);
	});

	describe("refusals", () => {
		const cases: Array<[string, () => any]> = [
			["path directly under the checkout", () => ({ path: path.join(main, "x"), branch: "handsoff/t/x" })],
			["path inside .git", () => ({ path: path.join(main, ".git", "x"), branch: "handsoff/t/x" })],
			["path outside the checkout", () => ({ path: path.join(scratch, "x"), branch: "handsoff/t/x" })],
			["path with a dot-dot segment", () => ({ path: `${main}/.worktrees/../x`, branch: "handsoff/t/x" })],
			["path with a NUL byte", () => ({ path: path.join(main, ".worktrees", "h", "a\0b"), branch: "handsoff/t/x" })],
			["branch main", () => ({ path: path.join(main, ".worktrees", "h", "x"), branch: "main" })],
			["branch feature/x", () => ({ path: path.join(main, ".worktrees", "h", "x"), branch: "feature/x" })],
			["branch ending in .lock", () => ({ path: path.join(main, ".worktrees", "h", "x"), branch: "handsoff/x.lock" })],
			["branch with double dots", () => ({ path: path.join(main, ".worktrees", "h", "x"), branch: "handsoff/a..b" })],
			["branch that looks like an option", () => ({ path: path.join(main, ".worktrees", "h", "x"), branch: "-b" })],
			["base that looks like an option", () => ({ path: path.join(main, ".worktrees", "h", "x"), branch: "handsoff/t/x", base: "-x" })],
			["base that is not a ref", () => ({ path: path.join(main, ".worktrees", "h", "x"), branch: "handsoff/t/x", base: "nope-not-a-ref" })],
			["missing branch", () => ({ path: path.join(main, ".worktrees", "h", "x") })],
		];

		for (const [name, build] of cases) {
			it(`refuses ${name}`, () => {
				const before = branches();
				const params = { action: "add", ...build() };
				const result = run(params);
				expect(result.ok).toBe(false);
				expect(result.refused?.length).toBeGreaterThan(0);
				expect(branches()).toBe(before);
				if (typeof params.path === "string" && !params.path.includes("\0")) {
					expect(fs.existsSync(path.join(main, ".worktrees", "h", "x"))).toBe(false);
				}
			});
		}

		it("refuses when .worktrees is a symlink", () => {
			const ext = tmpDir("ext-");
			fs.symlinkSync(ext, path.join(main, ".worktrees"));
			const before = branches();
			const result = add(path.join(main, ".worktrees", "h", "x"), "handsoff/t/x");
			expect(result.refused?.length).toBeGreaterThan(0);
			expect(fs.existsSync(path.join(ext, "h", "x"))).toBe(false);
			expect(branches()).toBe(before);
		});

		it("refuses when an intermediate folder is a symlink", () => {
			const ext = tmpDir("ext-");
			fs.mkdirSync(path.join(main, ".worktrees"));
			fs.symlinkSync(ext, path.join(main, ".worktrees", "h"));
			const before = branches();
			const result = add(path.join(main, ".worktrees", "h", "x"), "handsoff/t/x");
			expect(result.refused?.length).toBeGreaterThan(0);
			expect(fs.existsSync(path.join(ext, "x"))).toBe(false);
			expect(branches()).toBe(before);
		});

		it("refuses an existing target folder", () => {
			const target = path.join(main, ".worktrees", "h", "x");
			fs.mkdirSync(target, { recursive: true });
			const before = branches();
			const result = add(target, "handsoff/t/x");
			expect(result.refused?.length).toBeGreaterThan(0);
			expect(branches()).toBe(before);
		});

		it("refuses a branch that already exists", () => {
			git(main, "branch", "handsoff/t/dup");
			const target = path.join(main, ".worktrees", "h", "x");
			const result = add(target, "handsoff/t/dup");
			expect(result.refused?.length).toBeGreaterThan(0);
			expect(fs.existsSync(target)).toBe(false);
		});

		it("refuses a path inside a sibling worktree's .worktrees", () => {
			const other = path.join(main, ".worktrees", "h", "other");
			expect(add(other, "handsoff/t/other").ok).toBe(true);
			const target = path.join(other, ".worktrees", "x");
			const before = branches();
			const result = add(target, "handsoff/t/x");
			expect(result.refused?.length).toBeGreaterThan(0);
			expect(fs.existsSync(target)).toBe(false);
			expect(branches()).toBe(before);
		});

		it("refuses a relative git path", () => {
			const target = path.join(main, ".worktrees", "h", "x");
			const result = run({ action: "add", path: target, branch: "handsoff/t/x", base: "HEAD" }, main, { realGit: "git" });
			expect(result.refused?.length).toBeGreaterThan(0);
			expect(fs.existsSync(target)).toBe(false);
		});
	});
});

describe("runGitWorktree add, target moved by git's run", () => {
	// A wrapper that lets git finish, then swaps the new folder for a symlink to it, the way a
	// parallel process could redirect the checkout.
	it("refuses the result when the target no longer resolves to itself", () => {
		const bin = tmpDir("bin-");
		const wrapper = path.join(bin, "git");
		fs.writeFileSync(
			wrapper,
			`#!/bin/sh\n'${realGit}' "$@"\nrc=$?\nif [ "$rc" = 0 ] && [ "$5" = worktree ] && [ "$6" = add ]; then\n  for a in "$@"; do dir=$prev; prev=$a; done\n  mv "$dir" "$dir.real" && ln -s "$dir.real" "$dir"\nfi\nexit $rc\n`,
			{ mode: 0o755 },
		);
		const target = path.join(main, ".worktrees", "h", "p");
		const result = run({ action: "add", path: target, branch: "handsoff/t/p", base: "HEAD" }, main, { realGit: wrapper });
		expect(result.ok).toBe(false);
		expect(result.refused?.some((line) => /moved/.test(line))).toBe(true);
		expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
	});
});

describe("runGitWorktree remove", () => {
	it("refuses the main checkout", () => {
		const result = run({ action: "remove", path: main });
		expect(result.refused?.length).toBeGreaterThan(0);
		expect(fs.existsSync(main)).toBe(true);
	});

	it("refuses to remove its own tree", () => {
		const lead = path.join(main, ".worktrees", "h", "lead");
		expect(add(lead, "handsoff/t/lead").ok).toBe(true);
		const result = run({ action: "remove", path: lead }, lead);
		expect(result.refused?.length).toBeGreaterThan(0);
		expect(fs.existsSync(lead)).toBe(true);
	});

	it("refuses a plain folder that is not a registered worktree", () => {
		const plain = path.join(main, ".worktrees", "h", "plain");
		fs.mkdirSync(plain, { recursive: true });
		const result = run({ action: "remove", path: plain });
		expect(result.refused?.length).toBeGreaterThan(0);
		expect(fs.existsSync(plain)).toBe(true);
	});

	it("refuses a registered worktree outside the allowed roots", () => {
		const outside = path.join(scratch, "outside-wt");
		git(main, "worktree", "add", "-q", "-b", "outside-branch", outside, "HEAD");
		const result = run({ action: "remove", path: outside });
		expect(result.refused?.length).toBeGreaterThan(0);
		expect(fs.existsSync(outside)).toBe(true);
	});

	it("reports git's failure verbatim for a dirty worktree", () => {
		const target = path.join(main, ".worktrees", "h", "dirty");
		expect(add(target, "handsoff/t/dirty").ok).toBe(true);
		fs.writeFileSync(path.join(target, "untracked.txt"), "u\n");
		fs.writeFileSync(path.join(target, "f.txt"), "changed\n");

		const result = run({ action: "remove", path: target });
		expect(result.refused).toBeUndefined();
		expect(result.ok).toBe(false);
		expect(typeof result.exitCode).toBe("number");
		expect(result.exitCode).not.toBe(0);
		expect(typeof result.stderr).toBe("string");
		expect(result.stderr!.length).toBeGreaterThan(0);
		expect(result.stderr).toContain("contains modified or untracked files");
		expect(fs.existsSync(target)).toBe(true);
	});

	it("rejects unknown fields", () => {
		const target = path.join(main, ".worktrees", "h", "p");
		expect(add(target, "handsoff/t/p").ok).toBe(true);
		const result = run({ action: "remove", path: target, force: true });
		expect(result.refused?.length).toBeGreaterThan(0);
		expect(fs.existsSync(target)).toBe(true);
	});
});

describe("pointer pre-check", () => {
	it("refuses an add when a bad pointer exists", () => {
		fs.writeFileSync(path.join(main, ".git", "commondir"), "../elsewhere\n");
		const target = path.join(main, ".worktrees", "h", "p");
		const result = add(target, "handsoff/t/p");
		expect(result.refused?.some((line) => line.startsWith("bad "))).toBe(true);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("refuses a remove when a bad pointer exists", () => {
		const target = path.join(main, ".worktrees", "h", "p");
		expect(add(target, "handsoff/t/p").ok).toBe(true);
		fs.writeFileSync(path.join(main, ".git", "commondir"), "../elsewhere\n");
		const result = run({ action: "remove", path: target });
		expect(result.refused?.some((line) => line.startsWith("bad "))).toBe(true);
		expect(fs.existsSync(target)).toBe(true);
	});
});

describe("environment and invocation", () => {
	it("refuses when the main checkout cannot be determined", () => {
		const notRepo = tmpDir("norepo-");
		const result = add(path.join(notRepo, ".worktrees", "h", "p"), "handsoff/t/p", notRepo);
		expect(result.refused?.length).toBeGreaterThan(0);
	});

	it("never runs a branch name through a shell", () => {
		const marker = path.join(scratch, "shell-marker");
		const target = path.join(main, ".worktrees", "h", "x");
		const result = add(target, `handsoff/$(touch ${marker})`);
		expect(result.refused?.length).toBeGreaterThan(0);
		expect(fs.existsSync(marker)).toBe(false);
	});

	it("handles paths with spaces and quotes", () => {
		const target = path.join(main, ".worktrees", "h", "it's a dir");
		const result = add(target, "handsoff/t/sq");
		expect(result.refused).toBeUndefined();
		expect(result.ok).toBe(true);
		expect(fs.existsSync(target)).toBe(true);
	});

	it("ignores hostile git environment variables and PATH entries", () => {
		const marker = path.join(scratch, "fake-git-marker");
		const bin = tmpDir("bin-");
		fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\ntouch ${marker}\nexit 1\n`, { mode: 0o755 });
		const env = {
			...process.env,
			GIT_DIR: "/nonexistent",
			GIT_WORK_TREE: "/nonexistent",
			PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
		};
		const target = path.join(main, ".worktrees", "h", "p");
		const result = run({ action: "add", path: target, branch: "handsoff/t/p", base: "HEAD" }, main, { env });
		expect(result.ok).toBe(true);
		expect(fs.existsSync(target)).toBe(true);
		expect(fs.existsSync(marker)).toBe(false);
	});
});

describe("extension registration", () => {
	it("registers a strict git_worktree tool", () => {
		const fake = createFakePi();
		sandboxBashExtension(asExtensionAPI(fake));
		const tool: any = fake.tools.get("git_worktree");
		expect(tool).toBeDefined();
		const schema = tool.parameters;
		expect(schema.additionalProperties).toBe(false);
		const action = schema.properties.action;
		const values: unknown[] = action.enum ?? (action.anyOf ?? action.oneOf ?? []).map((v: any) => v.const);
		expect([...values].sort()).toEqual(["add", "remove"]);
	});
});
