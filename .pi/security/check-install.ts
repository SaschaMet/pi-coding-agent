// Read-only check that the machine-wide security guard is installed, run by
// init-project and add-coding-standard: node ~/.pi/agent/security/check-install.ts
// It never writes and never prints the Claude settings content. Exit 0 = installed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Status = "ok" | "missing" | "warn" | "skip";

interface Result {
	status: Status;
	name: string;
	detail: string;
}

const GUARD_CLI = "security/guard-cli.ts";
const INSTALL_COMMANDS = [
	"Install it yourself (details: scripts/sync-pi-config.md in pi-coding-agent):",
	"  npm run pi:sync-global   # in the pi-coding-agent repo",
	"  git config --global core.hooksPath ~/.pi/agent/security/git-hooks",
	"  git config --global core.excludesFile ~/.pi/agent/security/gitignore-global",
	'  add the guard-cli.ts entries to ~/.claude/settings.json: PreToolUse (matcher "*") and UserPromptSubmit',
].join("\n");

const home = os.homedir();
const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(home, ".pi", "agent");
const security = path.join(agentDir, "security");

function git(args: string[]): string | undefined {
	try {
		const out = execFileSync("git", args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

// The same path can be written with ~, a trailing slash, or through a symlink.
function canonical(input: string): string {
	const expanded = input === "~" ? home : input.startsWith("~/") ? path.join(home, input.slice(2)) : input;
	const resolved = path.resolve(expanded);
	try {
		return fs.realpathSync(resolved);
	} catch {
		return resolved;
	}
}

function configEquals(key: string, expected: string): Result {
	// --includes: the value may sit in a file pulled in by include.path.
	const value = git(["config", "--global", "--includes", "--get", key]);
	if (!value) return { status: "missing", name: key, detail: "not set" };
	return canonical(value) === canonical(expected)
		? { status: "ok", name: key, detail: value }
		: { status: "missing", name: key, detail: `points at ${value}, expected ${expected}` };
}

function executable(file: string): Result {
	const name = path.relative(security, file);
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return { status: "ok", name, detail: "executable" };
	} catch {
		return { status: "missing", name, detail: "missing or not executable (git skips it)" };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasGuardHook(groups: unknown, needsWildcard: boolean): boolean {
	if (!Array.isArray(groups)) return false;
	return groups.some(
		(group) =>
			isRecord(group) &&
			(!needsWildcard || group.matcher === undefined || group.matcher === "*" || group.matcher === "") &&
			Array.isArray(group.hooks) &&
			group.hooks.some((hook) => isRecord(hook) && typeof hook.command === "string" && hook.command.includes(GUARD_CLI)),
	);
}

function claudeHooks(): Result {
	const name = "claude-hook";
	const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
	const file = path.join(configDir, "settings.json");
	if (!fs.existsSync(file)) return { status: "skip", name, detail: "no Claude settings file (Claude Code not set up)" };
	let settings: unknown;
	try {
		settings = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return { status: "missing", name, detail: `${file} is unreadable or not valid JSON` };
	}
	if (!isRecord(settings)) return { status: "missing", name, detail: `${file} is not a JSON object` };
	if (settings.disableAllHooks === true) return { status: "missing", name, detail: "disableAllHooks is set" };
	const hooks = isRecord(settings.hooks) ? settings.hooks : {};
	if (!hasGuardHook(hooks.PreToolUse, true)) return { status: "missing", name, detail: 'no PreToolUse entry with matcher "*" runs guard-cli.ts' };
	if (!hasGuardHook(hooks.UserPromptSubmit, false)) return { status: "missing", name, detail: "no UserPromptSubmit entry runs guard-cli.ts" };
	return { status: "ok", name, detail: "PreToolUse and UserPromptSubmit run guard-cli.ts" };
}

function repoHooksPath(cwd: string): Result {
	const name = "repo";
	if (git(["-C", cwd, "rev-parse", "--is-inside-work-tree"]) !== "true") return { status: "skip", name, detail: "not a git repo" };
	const local = git(["-C", cwd, "config", "--local", "--get", "core.hooksPath"]);
	return local
		? { status: "warn", name, detail: `this repo sets core.hooksPath (${local}), so the global commit scan does not run here` }
		: { status: "ok", name, detail: "no local core.hooksPath" };
}

function main(): number {
	const results = [
		configEquals("core.hooksPath", path.join(security, "git-hooks")),
		executable(path.join(security, "git-hooks", "dispatch")),
		executable(path.join(security, "git-hooks", "pre-commit")),
		configEquals("core.excludesFile", path.join(security, "gitignore-global")),
		claudeHooks(),
		repoHooksPath(process.cwd()),
	];
	for (const result of results) console.log(`${result.status} ${result.name}: ${result.detail}`);
	if (!results.some((result) => result.status === "missing")) return 0;
	console.log(INSTALL_COMMANDS);
	return 1;
}

try {
	process.exitCode = main();
} catch (error) {
	console.log(`missing check: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
