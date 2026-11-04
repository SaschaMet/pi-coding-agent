import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGitPointers } from "../.pi/extensions/lib/git-worktree.ts";

let scratch: string;
let main: string;
let common: string;

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

beforeEach(() => {
	scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gpc-")));
	main = path.join(scratch, "main");
	fs.mkdirSync(main);
	git(main, "init", "-q", "-b", "main");
	git(main, "config", "user.email", "t@example.com");
	git(main, "config", "user.name", "t");
	fs.writeFileSync(path.join(main, "f.txt"), "x\n");
	git(main, "add", "f.txt");
	git(main, "commit", "-q", "-m", "init");
	git(main, "worktree", "add", "-q", "-b", "handsoff/t/a", path.join(main, ".worktrees", "a"), "HEAD");
	git(main, "worktree", "add", "-q", "-b", "handsoff/t/b", path.join(main, ".worktrees", "b"), "HEAD");
	common = path.join(main, ".git");
});

afterEach(() => {
	const lock = path.join(common, "worktrees", "a", "commondir");
	try {
		fs.chmodSync(lock, 0o600);
	} catch {
		// file may not exist in this fixture
	}
	fs.rmSync(scratch, { recursive: true, force: true });
});

function expectProblem(fragment: string) {
	const problems = checkGitPointers(main);
	expect(problems.length).toBeGreaterThan(0);
	expect(problems.some((line) => line.includes(fragment))).toBe(true);
	for (const line of problems) expect(line.startsWith("bad ")).toBe(true);
}

describe("checkGitPointers", () => {
	it("returns no problems for a clean checkout with two worktrees", () => {
		expect(checkGitPointers(main)).toEqual([]);
	});

	it("flags a commondir pointing at another folder", () => {
		const other = fs.mkdtempSync(path.join(scratch, "other-"));
		fs.writeFileSync(path.join(common, "worktrees", "a", "commondir"), `${other}\n`);
		expectProblem("worktrees/a/commondir");
	});

	it("flags a gitdir record naming another folder", () => {
		const other = fs.mkdtempSync(path.join(scratch, "other-"));
		fs.mkdirSync(path.join(other, ".git"));
		fs.writeFileSync(path.join(common, "worktrees", "a", "gitdir"), `${path.join(other, ".git")}\n`);
		expectProblem("worktrees/a/gitdir");
	});

	it("flags a worktree .git file pointing at a sibling record", () => {
		fs.writeFileSync(path.join(main, ".worktrees", "a", ".git"), `gitdir: ${path.join(common, "worktrees", "b")}\n`);
		expectProblem(".worktrees/a/.git");
	});

	it("flags a worktree .git file pointing at a planted folder", () => {
		const planted = fs.mkdtempSync(path.join(scratch, "planted-"));
		fs.writeFileSync(path.join(main, ".worktrees", "a", ".git"), `gitdir: ${planted}\n`);
		expectProblem(".worktrees/a/.git");
	});

	it("flags a worktree .git replaced by a directory", () => {
		const dot = path.join(main, ".worktrees", "a", ".git");
		fs.rmSync(dot);
		fs.mkdirSync(dot);
		expectProblem(".worktrees/a/.git");
	});

	it("flags a worktree .git replaced by a symlink", () => {
		const dot = path.join(main, ".worktrees", "a", ".git");
		fs.rmSync(dot);
		fs.symlinkSync(path.join(common, "worktrees", "a"), dot);
		expectProblem(".worktrees/a/.git");
	});

	it("flags an unreadable commondir", () => {
		const file = path.join(common, "worktrees", "a", "commondir");
		fs.chmodSync(file, 0o000);
		expectProblem("commondir");
	});

	it("flags a per-worktree config.worktree", () => {
		fs.writeFileSync(path.join(common, "worktrees", "a", "config.worktree"), "[core]\n");
		expectProblem("config.worktree");
	});

	it("flags a shared config.worktree", () => {
		fs.writeFileSync(path.join(common, "config.worktree"), "[core]\n");
		expectProblem("config.worktree");
	});

	it("flags a commondir file in the common dir", () => {
		fs.writeFileSync(path.join(common, "commondir"), "../elsewhere\n");
		expectProblem("commondir");
	});

	it("flags submodule storage in the common dir", () => {
		fs.mkdirSync(path.join(common, "modules", "x"), { recursive: true });
		expectProblem("modules");
	});

	it("flags a symlinked main .git", () => {
		fs.renameSync(common, path.join(main, "realgit"));
		fs.symlinkSync(path.join(main, "realgit"), common);
		expectProblem(".git");
	});

	it("flags a worktree folder that was removed while its record stays", () => {
		fs.rmSync(path.join(main, ".worktrees", "b"), { recursive: true, force: true });
		expectProblem(".worktrees/b");
	});

	it("flags a nested repository", () => {
		git(main, "init", "-q", "sub");
		expectProblem("sub/.git");
	});

	it("flags a nested repository whose .git folder is spelled in capitals", () => {
		fs.mkdirSync(path.join(main, "sub", ".GIT"), { recursive: true });
		expectProblem("sub/.GIT");
	});

	it("flags a nested pointer file spelled in mixed case", () => {
		fs.mkdirSync(path.join(main, "sub2"));
		fs.writeFileSync(path.join(main, "sub2", ".Git"), "gitdir: /nowhere\n");
		expectProblem("sub2/.Git");
	});

	it("flags a nested pointer file inside a worktree", () => {
		const sub = path.join(main, ".worktrees", "a", "sub2");
		fs.mkdirSync(sub);
		fs.writeFileSync(path.join(sub, ".git"), "gitdir: /nowhere\n");
		expectProblem("sub2/.git");
	});

	it("ignores .git folders under node_modules", () => {
		fs.mkdirSync(path.join(main, "node_modules", "x", ".git"), { recursive: true });
		expect(checkGitPointers(main)).toEqual([]);
	});

	it("fails closed for a non-existent checkout", () => {
		let result: string[] = [];
		expect(() => {
			result = checkGitPointers(path.join(scratch, "does-not-exist"));
		}).not.toThrow();
		expect(result.length).toBeGreaterThan(0);
	});
});

describe("git-pointer-check script", () => {
	const repoRoot = path.resolve(import.meta.dirname, "..");
	const scriptPath = path.join(repoRoot, "scripts", "git-pointer-check.ts");

	function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
		return spawnSync(path.join(repoRoot, "node_modules", ".bin", "tsx"), [scriptPath, ...args], {
			cwd: repoRoot,
			encoding: "utf8",
			env,
		});
	}

	function fakeGitEnv() {
		const fakeBin = fs.mkdtempSync(path.join(scratch, "fakebin-"));
		const marker = path.join(fakeBin, "marker");
		const gitPath = path.join(fakeBin, "git");
		fs.writeFileSync(gitPath, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
		fs.chmodSync(gitPath, 0o755);
		return { marker, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } };
	}

	it("prints the worktree count and exits 0 for a clean checkout", () => {
		const result = run([main]);
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/^ok 2 worktrees$/m);
	});

	it("prints bad lines and exits 1 for a poisoned checkout", () => {
		fs.writeFileSync(path.join(common, "commondir"), "../elsewhere\n");
		const result = run([main]);
		expect(result.status).toBe(1);
		const lines = result.stdout.split("\n");
		expect(lines.some((line) => line.startsWith("bad ") && line.includes("commondir"))).toBe(true);
	});

	it("prints usage to stderr and exits 2 without an argument", () => {
		const result = run([]);
		expect(result.status).toBe(2);
		expect(result.stderr.trim().length).toBeGreaterThan(0);
	});

	it("never runs git", () => {
		const { marker, env } = fakeGitEnv();
		expect(run([main], env).status).toBe(0);
		expect(fs.existsSync(marker)).toBe(false);
		fs.writeFileSync(path.join(common, "commondir"), "../elsewhere\n");
		expect(run([main], env).status).toBe(1);
		expect(fs.existsSync(marker)).toBe(false);
	});

	it("does not import process-spawning modules", () => {
		const text = fs.readFileSync(scriptPath, "utf8");
		expect(text).not.toMatch(/child_process|spawn|exec/);
	});
});
