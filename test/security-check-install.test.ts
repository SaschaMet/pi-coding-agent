import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../.pi/security/check-install.ts");
const GUARD_COMMAND = 'node "$HOME/.pi/agent/security/guard-cli.ts" || exit 2';
const SECRET_MARKER = "settings-content-marker-7f3a";

let root: string;
let home: string;
let agent: string;
let gitConfig: string;
let repo: string;

function writeFile(file: string, content: string, mode = 0o644): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	fs.chmodSync(file, mode);
}

function claudeSettings(overrides: Record<string, unknown> = {}): string {
	const hook = { type: "command", command: GUARD_COMMAND, timeout: 30 };
	return JSON.stringify({
		env: { OTEL_HEADER: SECRET_MARKER },
		hooks: {
			PreToolUse: [{ matcher: "*", hooks: [hook] }],
			UserPromptSubmit: [{ hooks: [hook] }],
		},
		...overrides,
	});
}

function setGlobal(key: string, value: string): void {
	const result = spawnSync("git", ["config", "--file", gitConfig, key, value]);
	expect(result.status).toBe(0);
}

function runCheck(cwd = repo, extraEnv: NodeJS.ProcessEnv = {}) {
	return spawnSync(process.execPath, [SCRIPT], {
		cwd,
		encoding: "utf8",
		timeout: 30_000,
		env: {
			PATH: process.env.PATH,
			HOME: home,
			GIT_CONFIG_GLOBAL: gitConfig,
			GIT_CONFIG_NOSYSTEM: "1",
			PI_CODING_AGENT_DIR: agent,
			...extraEnv,
		},
	});
}

const lines = (stdout: string) => stdout.split("\n").filter(Boolean);
const line = (stdout: string, check: string) => lines(stdout).find((l) => l.includes(` ${check}:`)) ?? "";

beforeEach(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-check-install-")));
	home = path.join(root, "home");
	agent = path.join(root, "agent");
	gitConfig = path.join(root, "gitconfig");
	repo = path.join(root, "repo");
	writeFile(path.join(agent, "security/git-hooks/dispatch"), "#!/bin/sh\n", 0o755);
	writeFile(path.join(agent, "security/git-hooks/pre-commit"), "#!/bin/sh\n", 0o755);
	writeFile(path.join(agent, "security/gitignore-global"), ".env\n");
	writeFile(gitConfig, "");
	setGlobal("core.hooksPath", path.join(agent, "security/git-hooks"));
	setGlobal("core.excludesFile", path.join(agent, "security/gitignore-global"));
	writeFile(path.join(home, ".claude/settings.json"), claudeSettings());
	fs.mkdirSync(repo);
	expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe("check-install on a healthy machine", () => {
	it("prints one ok line per check and exits 0", () => {
		const result = runCheck();
		expect(result.status).toBe(0);
		const out = lines(result.stdout);
		expect(out.length).toBeGreaterThanOrEqual(6);
		for (const l of out) expect(l).toMatch(/^ok /);
	});

	it("reads the hook path from an included file", () => {
		const included = path.join(root, "included.gitconfig");
		writeFile(included, "");
		spawnSync("git", ["config", "--file", included, "core.hooksPath", path.join(agent, "security/git-hooks")]);
		spawnSync("git", ["config", "--file", gitConfig, "--unset", "core.hooksPath"]);
		setGlobal("include.path", included);
		const result = runCheck();
		expect(line(result.stdout, "core.hooksPath")).toMatch(/^ok /);
		expect(result.status).toBe(0);
	});

	it("accepts a ~ path and a path through a symlink", () => {
		const link = path.join(root, "agent-link");
		fs.symlinkSync(agent, link);
		setGlobal("core.hooksPath", path.join(link, "security/git-hooks/"));
		fs.renameSync(agent, path.join(home, "agent"));
		fs.rmSync(link);
		fs.symlinkSync(path.join(home, "agent"), link);
		setGlobal("core.excludesFile", "~/agent/security/gitignore-global");
		const result = runCheck(repo, { PI_CODING_AGENT_DIR: path.join(home, "agent") });
		expect(line(result.stdout, "core.hooksPath")).toMatch(/^ok /);
		expect(line(result.stdout, "core.excludesFile")).toMatch(/^ok /);
		expect(result.status).toBe(0);
	});

	it("uses CLAUDE_CONFIG_DIR when it is set", () => {
		const configDir = path.join(root, "claude-config");
		writeFile(path.join(configDir, "settings.json"), claudeSettings());
		fs.rmSync(path.join(home, ".claude"), { recursive: true });
		const result = runCheck(repo, { CLAUDE_CONFIG_DIR: configDir });
		expect(line(result.stdout, "claude-hook")).toMatch(/^ok /);
	});
});

describe("check-install reports a missing guard", () => {
	const expectMissing = (result: ReturnType<typeof runCheck>, check: string) => {
		expect(result.status).toBe(1);
		expect(line(result.stdout, check)).toMatch(/^missing /);
		expect(result.stdout).toContain("git config --global core.hooksPath ~/.pi/agent/security/git-hooks");
	};

	it("flags an unset core.hooksPath", () => {
		spawnSync("git", ["config", "--file", gitConfig, "--unset", "core.hooksPath"]);
		expectMissing(runCheck(), "core.hooksPath");
	});

	it("flags a core.hooksPath that points elsewhere", () => {
		setGlobal("core.hooksPath", path.join(root, "other-hooks"));
		expectMissing(runCheck(), "core.hooksPath");
	});

	it("flags a hook file without its exec bit", () => {
		fs.chmodSync(path.join(agent, "security/git-hooks/dispatch"), 0o644);
		expectMissing(runCheck(), "git-hooks/dispatch");
	});

	it("flags a core.excludesFile that points elsewhere", () => {
		setGlobal("core.excludesFile", path.join(root, "other-ignore"));
		expectMissing(runCheck(), "core.excludesFile");
	});

	it.each([
		["invalid JSON", "{ not json"],
		["no UserPromptSubmit entry", claudeSettings({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: GUARD_COMMAND }] }] } })],
		["a Bash-only PreToolUse matcher", claudeSettings({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: GUARD_COMMAND }] }], UserPromptSubmit: [{ hooks: [{ type: "command", command: GUARD_COMMAND }] }] } })],
		["disableAllHooks", claudeSettings({ disableAllHooks: true })],
	])("flags Claude settings with %s, without printing them", (_label, content) => {
		writeFile(path.join(home, ".claude/settings.json"), content);
		const result = runCheck();
		expectMissing(result, "claude-hook");
		expect(result.stdout + result.stderr).not.toContain(SECRET_MARKER);
	});

	it("skips the Claude check when no settings file exists", () => {
		fs.rmSync(path.join(home, ".claude"), { recursive: true });
		const result = runCheck();
		expect(line(result.stdout, "claude-hook")).toMatch(/^skip /);
		expect(result.status).toBe(0);
	});
});

describe("check-install repo check", () => {
	it("warns when the repo sets its own core.hooksPath, without failing", () => {
		expect(spawnSync("git", ["-C", repo, "config", "--local", "core.hooksPath", ".husky/_"]).status).toBe(0);
		const result = runCheck();
		expect(line(result.stdout, "repo")).toMatch(/^warn /);
		expect(result.status).toBe(0);
	});

	it("skips the repo check outside a git repo", () => {
		const plain = path.join(root, "plain");
		fs.mkdirSync(plain);
		const result = runCheck(plain);
		expect(line(result.stdout, "repo")).toMatch(/^skip /);
		expect(result.status).toBe(0);
	});
});

describe("check-install is read-only", () => {
	it("leaves git config, settings, and the home folder unchanged on a failed check", () => {
		spawnSync("git", ["config", "--file", gitConfig, "--unset", "core.hooksPath"]);
		const snapshot = () => [fs.readFileSync(gitConfig, "utf8"), fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8"), fs.readdirSync(home, { recursive: true }).sort().join(",")];
		const before = snapshot();
		expect(runCheck().status).toBe(1);
		expect(snapshot()).toEqual(before);
	});
});
