import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { policy } from "../.pi/security/policy.ts";
import { fakeSecrets } from "./fixtures/security/cases.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const HOOK_NAMES = [
	"applypatch-msg",
	"pre-applypatch",
	"post-applypatch",
	"pre-commit",
	"pre-merge-commit",
	"prepare-commit-msg",
	"commit-msg",
	"post-commit",
	"pre-rebase",
	"post-checkout",
	"post-merge",
	"pre-push",
	"post-rewrite",
	"pre-auto-gc",
];

let scratch: string;
let security: string;
let env: NodeJS.ProcessEnv;
let repo: string;

function git(args: string[], cwd = repo, input?: string) {
	return spawnSync("git", args, { cwd, env, encoding: "utf8", input, timeout: 30_000 });
}

function commit(message = "change") {
	return git(["commit", "-q", "-m", message]);
}

function stage(file: string, content: string) {
	fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
	fs.writeFileSync(path.join(repo, file), content);
	expect(git(["add", "--", file]).status).toBe(0);
}

function repoHook(name: string, body: string) {
	const hook = path.join(repo, ".git/hooks", name);
	fs.writeFileSync(hook, `#!/bin/sh\n${body}\n`);
	fs.chmodSync(hook, 0o755);
}

beforeAll(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pi-security-git-hook-"));
	security = path.join(scratch, "agent/security");
	fs.cpSync(path.join(REPO_ROOT, ".pi/security"), security, { recursive: true });
	const gitConfig = path.join(scratch, "gitconfig");
	fs.writeFileSync(gitConfig, `[core]\n\thooksPath = ${path.join(security, "git-hooks")}\n[init]\n\tdefaultBranch = main\n`);
	env = {
		...process.env,
		PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
		GIT_CONFIG_GLOBAL: gitConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.invalid",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.invalid",
	};
});

afterAll(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
	repo = fs.mkdtempSync(path.join(scratch, "repo-"));
	expect(git(["init", "-q"]).status).toBe(0);
	stage("README.md", "hello\n");
	expect(commit("init").status).toBe(0);
});

describe("global git hook layout", () => {
	it("has an executable wrapper for each chained hook and none for the excluded ones", () => {
		const dir = path.join(REPO_ROOT, ".pi/security/git-hooks");
		const entries = fs.readdirSync(dir).sort();
		expect(entries).toEqual([...HOOK_NAMES, "dispatch"].sort());
		for (const entry of entries) expect(fs.statSync(path.join(dir, entry)).mode & 0o111).not.toBe(0);
	});

	it("ignores .env files globally but not the example files", () => {
		const ignore = path.join(REPO_ROOT, ".pi/security/gitignore-global");
		const check = (file: string) => git(["-c", `core.excludesFile=${ignore}`, "check-ignore", "-q", file]).status;
		expect(check(".env")).toBe(0);
		expect(check(".env.local")).toBe(0);
		for (const suffix of policy.envAllowedSuffixes) expect(check(`.env.${suffix}`)).toBe(1);
	});
});

describe("global pre-commit scan", () => {
	it("blocks a staged secret by pattern name, without printing the value", () => {
		stage("config.ts", `export const key = "${fakeSecrets.aws}";\n`);
		const result = commit();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("AWS access key ID");
		expect(result.stderr).toContain(policy.rotateSentence);
		expect(result.stderr).not.toContain(fakeSecrets.aws);
	});

	it("lets a clean change through", () => {
		stage("src/a.ts", "export const a = 1;\n");
		expect(commit().status).toBe(0);
	});

	it("only warns for a docker digest and a config read", () => {
		stage("Dockerfile", `FROM node@sha256:${fakeSecrets.hex64}\n`);
		stage("src/config.ts", "const options = { apiKey: config.apiKey };\n");
		const result = commit();
		expect(result.status).toBe(0);
		expect(result.stderr).toContain("Hex private key");
	});

	it("blocks a staged .env even without a secret, and a rename onto .env", () => {
		stage(".env", "PLAIN=1\n");
		expect(commit().status).not.toBe(0);
		expect(git(["rm", "-q", "--cached", ".env"]).status).toBe(0);
		fs.rmSync(path.join(repo, ".env"));

		stage(".env.example", "PLAIN=\n");
		expect(commit().status).toBe(0);
		expect(git(["mv", ".env.example", ".env"]).status).toBe(0);
		const renamed = commit();
		expect(renamed.status).not.toBe(0);
		expect(renamed.stderr).toContain(".env");
	});

	it("blocks a staged text change over 5 MB but skips lockfiles", () => {
		stage("package-lock.json", "x\n".repeat(3 * 1024 * 1024));
		expect(commit().status).toBe(0);
		stage("data.txt", "y\n".repeat(3 * 1024 * 1024));
		const result = commit();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/split/i);
	});

	it("fails closed when the policy is missing", () => {
		const policyFile = path.join(security, "policy.ts");
		const saved = fs.readFileSync(policyFile);
		fs.rmSync(policyFile);
		try {
			stage("src/b.ts", "export const b = 2;\n");
			const result = commit();
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(/failed to load/);
		} finally {
			fs.writeFileSync(policyFile, saved);
		}
	});
});

describe("chaining to repo hooks", () => {
	it("runs the repo's own pre-commit and post-commit hooks", () => {
		repoHook("pre-commit", `echo pre >> "${repo}/.hooks.log"`);
		repoHook("post-commit", `echo post >> "${repo}/.hooks.log"`);
		stage("src/c.ts", "export const c = 3;\n");
		expect(commit().status).toBe(0);
		expect(fs.readFileSync(path.join(repo, ".hooks.log"), "utf8")).toBe("pre\npost\n");
	});

	it("aborts the commit when the repo's commit-msg hook fails", () => {
		repoHook("commit-msg", "exit 1");
		stage("src/d.ts", "export const d = 4;\n");
		expect(commit().status).not.toBe(0);
	});

	it("passes hook arguments and stdin through, also from a linked worktree", () => {
		const log = path.join(scratch, `chain-${path.basename(repo)}.log`);
		repoHook("commit-msg", `echo "msg $(basename "$1")" >> "${log}"`);
		repoHook("pre-push", `echo "push $1" >> "${log}"; cat >> "${log}"`);
		const remote = path.join(scratch, `remote-${path.basename(repo)}.git`);
		expect(git(["init", "-q", "--bare", remote], scratch).status).toBe(0);
		expect(git(["remote", "add", "origin", remote]).status).toBe(0);

		const worktree = path.join(scratch, `wt-${path.basename(repo)}`);
		expect(git(["worktree", "add", "-q", "-b", "feature/wt", worktree]).status).toBe(0);
		fs.writeFileSync(path.join(worktree, "e.ts"), "export const e = 5;\n");
		expect(git(["add", "e.ts"], worktree).status).toBe(0);
		expect(git(["commit", "-q", "-m", "wt"], worktree).status).toBe(0);
		expect(git(["push", "-q", "origin", "feature/wt"], worktree).status).toBe(0);

		const logged = fs.readFileSync(log, "utf8");
		expect(logged).toContain("msg COMMIT_EDITMSG");
		expect(logged).toContain("push origin");
		expect(logged).toContain("refs/heads/feature/wt");
	});
});
