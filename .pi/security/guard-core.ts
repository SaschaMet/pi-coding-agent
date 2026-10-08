// Pure evaluator for policy.ts. No PI, no filesystem, erasable TypeScript only,
// so plain `node` can run it from the Claude hook and the git hook.
import path from "node:path";
import type { Policy } from "./policy.ts";

export interface ToolCall {
	tool: string;
	input: Record<string, unknown>;
	cwd: string;
	home: string;
	getCurrentBranch?: () => string | undefined;
}

export type Decision = { decision: "allow" } | { decision: "deny"; reason: string };

export const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"] as const;
const SHELL_TOOLS = new Set(["bash", "powershell"]);
// Glob-valued inputs only get the .env check: listing *.pem is not reading it.
const GLOB_KEYS: Record<string, string[]> = { grep: ["glob"], find: ["pattern"], glob: ["pattern"] };

const ALLOW: Decision = { decision: "allow" };
const deny = (reason: string): Decision => ({ decision: "deny", reason });

const BOUNDARY_BEFORE = String.raw`(?:^|[\s"'` + "`" + String.raw`=<>|;&(:/\\])`;
const BOUNDARY_AFTER = String.raw`(?=$|[\s"'` + "`" + String.raw`;|&<>)/\\])`;
const ENV_RE = new RegExp(
	BOUNDARY_BEFORE + String.raw`\.env((?:\.[A-Za-z0-9_-]+)*)(\.?[*?\[][^\s"'` + "`" + String.raw`;|&<>)]*)?` + BOUNDARY_AFTER,
	"gi",
);

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function envReason(): string {
	return ".env files are blocked for agents. Use .env.example for shape, or ask the user.";
}

/** True when the text names a `.env` file that is not an allowed example file. */
export function mentionsBlockedEnvFile(text: string, policy: Policy): boolean {
	const allowed = new Set(policy.envAllowedSuffixes.map((s) => s.toLowerCase()));
	for (const match of text.matchAll(ENV_RE)) {
		const [, suffix, glob] = match;
		if (glob) return true;
		const parts = suffix ? suffix.slice(1).split(".") : [];
		if (parts.length !== 1 || !allowed.has(parts[0].toLowerCase())) return true;
	}
	return false;
}

function expandHome(input: string, home: string): string {
	if (input === "~") return home;
	if (input.startsWith("~/")) return path.join(home, input.slice(2));
	return input.replace(/^\$\{?HOME\}?(?=\/|$)/, home);
}

function isWithin(target: string, root: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function credentialPathReason(input: string, call: ToolCall, policy: Policy): string | undefined {
	const resolved = path.resolve(call.cwd, expandHome(input, call.home));
	const blocked =
		policy.credentialHomeDirs.some((dir) => isWithin(resolved, path.join(call.home, dir))) ||
		policy.credentialHomeFiles.some((file) => resolved === path.join(call.home, file)) ||
		policy.credentialExtensions.some((ext) => resolved.toLowerCase().endsWith(ext)) ||
		resolved.split(path.sep).some((segment) => policy.credentialDirNames.includes(segment));
	return blocked ? `Credential path '${input}' is blocked for agents.` : undefined;
}

function credentialCommandRegex(call: ToolCall, policy: Policy): RegExp {
	const home = String.raw`(?:~|\$HOME|\$\{HOME\}|` + escapeRegExp(call.home) + ")";
	const homeEntries = [...policy.credentialHomeDirs, ...policy.credentialHomeFiles].map(escapeRegExp).join("|");
	const extensions = policy.credentialExtensions.map((ext) => escapeRegExp(ext.slice(1))).join("|");
	const dirs = policy.credentialDirNames.map(escapeRegExp).join("|");
	return new RegExp(
		[
			BOUNDARY_BEFORE + home + "/(?:" + homeEntries + ")" + BOUNDARY_AFTER,
			String.raw`[\w.~/-]*[\w-]\.(?:` + extensions + ")" + BOUNDARY_AFTER,
			BOUNDARY_BEFORE + "(?:" + dirs + ")/",
		].join("|"),
		"i",
	);
}

function evaluatePathInput(value: string, call: ToolCall, policy: Policy): Decision {
	if (mentionsBlockedEnvFile(value, policy)) return deny(envReason());
	const credential = credentialPathReason(value, call, policy);
	return credential ? deny(credential) : ALLOW;
}

/**
 * Splits a shell command into simple commands (on `; & | ( )` and newlines),
 * each a list of words with quotes removed. A speed bump, not a parser:
 * obfuscated commands such as `$(printf ...)` pass.
 */
export function splitShellCommands(command: string): string[][] {
	const commands: string[][] = [];
	let words: string[] = [];
	let word = "";
	let inWord = false;
	let quote: "'" | '"' | undefined;
	const endWord = () => {
		if (inWord) words.push(word);
		word = "";
		inWord = false;
	};
	const endCommand = () => {
		endWord();
		if (words.length) commands.push(words);
		words = [];
	};
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === quote) quote = undefined;
			else if (char === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
			else word += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			inWord = true;
		} else if (char === "\\" && i + 1 < command.length) {
			word += command[++i];
			inWord = true;
		} else if (/[;&|()\n]/.test(char)) {
			endCommand();
		} else if (/\s/.test(char)) {
			endWord();
		} else {
			word += char;
			inWord = true;
		}
	}
	endCommand();
	return commands;
}

const baseName = (word: string): string => word.slice(word.lastIndexOf("/") + 1);

function globToRegExp(glob: string): RegExp {
	return new RegExp("^" + glob.split("*").map(escapeRegExp).join(".*") + "$");
}

function isProtectedBranch(branch: string, policy: Policy): boolean {
	const name = branch.replace(/^refs\/heads\//, "");
	return policy.protectedBranches.some((pattern) => globToRegExp(pattern).test(name));
}

const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix"]);
const PUSH_OPTIONS_WITH_VALUE = new Set(["--repo", "-o", "--push-option", "--receive-pack", "--exec"]);
const COMMIT_SHORT_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);
const COMMIT_SHORT_ATTACHED_ONLY = new Set(["S", "u"]);
const CONFIG_WRITE_FLAGS = new Set(["--unset", "--unset-all", "--add", "--replace-all", "--remove-section", "--rename-section", "--edit", "-e", "set", "unset"]);
const CONFIG_READ_FLAGS = new Set(["--get", "--get-all", "--get-regexp", "get"]);
const HOOKS_PATH_RE = /core\.hookspath/i;

interface GitInvocation {
	subcommand: string;
	args: string[];
}

function findGit(words: string[]): GitInvocation | undefined {
	const start = words.findIndex((word) => baseName(word) === "git");
	if (start === -1) return undefined;
	let i = start + 1;
	while (i < words.length && words[i].startsWith("-")) {
		const option = words[i];
		i += GIT_OPTIONS_WITH_VALUE.has(option) ? 2 : 1;
	}
	if (i >= words.length) return undefined;
	return { subcommand: words[i], args: words.slice(i + 1) };
}

function pushDecision(args: string[], call: ToolCall, policy: Policy): Decision {
	let force = false;
	let lease = false;
	let includes = false;
	let deleting = false;
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") {
			positionals.push(...args.slice(i + 1));
			break;
		}
		if (PUSH_OPTIONS_WITH_VALUE.has(arg)) i++;
		else if (arg === "--force") force = true;
		else if (arg === "--force-with-lease" || arg.startsWith("--force-with-lease=")) lease = true;
		else if (arg === "--force-if-includes") includes = true;
		else if (arg === "--delete") deleting = true;
		else if (arg === "--mirror" || arg === "--all" || arg === "--branches")
			return deny(`git push ${arg} can overwrite protected branches.`);
		else if (/^-[a-zA-Z]+$/.test(arg)) {
			if (arg.includes("f")) force = true;
			if (arg.includes("d")) deleting = true;
			if (arg.endsWith("o")) i++;
		} else if (!arg.startsWith("-")) positionals.push(arg);
	}
	if (force || (includes && !lease)) return deny("Force push is blocked. Use --force-with-lease on a feature branch.");

	const refspecs = positionals.slice(1);
	const current = (): string | undefined => call.getCurrentBranch?.();
	const targets: string[] = [];
	if (refspecs.length === 0) {
		const branch = current();
		if (!branch) return deny("git push without a refspec: the current branch is unknown.");
		targets.push(branch);
	}
	for (const refspec of refspecs) {
		if (refspec.startsWith("+")) return deny("Force push (+refspec) is blocked.");
		const colon = refspec.indexOf(":");
		const source = colon === -1 ? refspec : refspec.slice(0, colon);
		const destination = colon === -1 ? "" : refspec.slice(colon + 1);
		let target = destination || source;
		if (target === "HEAD" || target === "@") {
			const branch = current();
			if (!branch) return deny("git push HEAD: the current branch is unknown.");
			target = branch;
		}
		targets.push(target);
	}
	const hit = targets.find((target) => isProtectedBranch(target, policy));
	if (!hit) return ALLOW;
	return deny(
		deleting || refspecs.some((r) => r.startsWith(":"))
			? `Deleting protected branch '${hit}' is blocked.`
			: `Direct push to protected branch '${hit}' is blocked. Use a feature branch and a PR.`,
	);
}

function commitSkipsHooks(args: string[]): boolean {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") return false;
		if (!/^-[a-zA-Z]+$/.test(arg)) continue;
		for (let j = 1; j < arg.length; j++) {
			const flag = arg[j];
			if (flag === "n") return true;
			if (COMMIT_SHORT_ATTACHED_ONLY.has(flag)) break;
			if (COMMIT_SHORT_WITH_VALUE.has(flag)) {
				if (j === arg.length - 1) i++;
				break;
			}
		}
	}
	return false;
}

function gitDecision(words: string[], call: ToolCall, policy: Policy): Decision {
	const setsHooksEnv = words.some((word) => /^GIT_CONFIG_/.test(word) && HOOKS_PATH_RE.test(word));
	const git = findGit(words);
	if (!git) return setsHooksEnv ? deny("Overriding core.hooksPath skips the security git hook.") : ALLOW;

	if (words.includes("--no-verify")) return deny("--no-verify skips git hooks and is blocked.");
	if (words.some((word) => HOOKS_PATH_RE.test(word))) {
		const readOnly =
			git.subcommand === "config" &&
			git.args.some((arg) => CONFIG_READ_FLAGS.has(arg)) &&
			!git.args.some((arg) => CONFIG_WRITE_FLAGS.has(arg));
		if (!readOnly || setsHooksEnv) return deny("Changing core.hooksPath skips the security git hook.");
	}
	if (git.subcommand === "commit" && commitSkipsHooks(git.args)) return deny("git commit -n skips git hooks and is blocked.");
	if (git.subcommand === "push") return pushDecision(git.args, call, policy);
	return ALLOW;
}

function normalizeRmTarget(target: string, home: string): string {
	let normalized = target.replace(/^\$\{?HOME\}?(?=\/|$)/, "~");
	if (normalized === home || normalized.startsWith(home + "/")) normalized = "~" + normalized.slice(home.length);
	return normalized.length > 1 ? normalized.replace(/\/+$/, "") || "/" : normalized;
}

function rmDecision(words: string[], call: ToolCall, policy: Policy): Decision {
	const flag = new RegExp(policy.rmFlag);
	const dangerous = new RegExp(policy.rmDangerousTarget);
	for (let start = 0; start < words.length; start++) {
		if (baseName(words[start]) !== "rm") continue;
		const args = words.slice(start + 1);
		const endOfFlags = args.indexOf("--");
		const flags = (endOfFlags === -1 ? args : args.slice(0, endOfFlags)).filter((arg) => arg.startsWith("-"));
		const targets = args.filter((arg, index) => (endOfFlags !== -1 && index > endOfFlags) || !arg.startsWith("-"));
		if (!flags.some((f) => flag.test(f))) continue;
		const hit = targets.find((target) => dangerous.test(normalizeRmTarget(target, call.home)));
		if (hit) return deny(`Destructive delete of '${hit}' is blocked. Delete a narrower path.`);
	}
	return ALLOW;
}

function evaluateShellCommand(command: string, call: ToolCall, policy: Policy): Decision {
	if (command.length > policy.maxScanChars) return deny("Command is too large to check.");
	if (mentionsBlockedEnvFile(command, policy)) return deny(envReason());
	if (credentialCommandRegex(call, policy).test(command)) return deny("Command touches a credential path.");
	for (const rule of policy.commandRules) {
		if (new RegExp(rule.source, rule.flags).test(command)) return deny(`Blocked: ${rule.name}.`);
	}
	for (const words of splitShellCommands(command)) {
		for (const check of [gitDecision, rmDecision]) {
			const decision = check(words, call, policy);
			if (decision.decision === "deny") return decision;
		}
	}
	return ALLOW;
}

export interface ScanResult {
	blocked: string[];
	warned: string[];
	tooLarge: boolean;
}

const compiledPatterns = new WeakMap<Policy, { name: string; mode: string; regex: RegExp }[]>();

function secretPatterns(policy: Policy): { name: string; mode: string; regex: RegExp }[] {
	let compiled = compiledPatterns.get(policy);
	if (!compiled) {
		compiled = policy.secretPatterns.map((p) => ({ name: p.name, mode: p.mode, regex: new RegExp(p.source, p.flags) }));
		compiledPatterns.set(policy, compiled);
	}
	return compiled;
}

/** Names the secret patterns found in the text; never returns the matched values. */
export function scanText(text: string, policy: Policy): ScanResult {
	if (text.length > policy.maxScanChars) return { blocked: [], warned: [], tooLarge: true };
	const result: ScanResult = { blocked: [], warned: [], tooLarge: false };
	for (const pattern of secretPatterns(policy)) {
		if (!pattern.regex.test(text)) continue;
		(pattern.mode === "block" ? result.blocked : result.warned).push(pattern.name);
	}
	return result;
}

export function isScanBlocked(scan: ScanResult): boolean {
	return scan.tooLarge || scan.blocked.length > 0;
}

export function scanBlockMessage(scan: ScanResult, policy: Policy): string {
	if (scan.tooLarge) return "Blocked: the text is too large to scan for secrets. Split it up.";
	return `Blocked: possible secret (${scan.blocked.join(", ")}). ${policy.rotateSentence}`;
}

export function scanWarnMessage(scan: ScanResult): string {
	return `Warning: possible secret (${scan.warned.join(", ")}). Check it is not a real key.`;
}

/** Throws when the policy cannot work: a regex that does not compile, or a known-bad call it allows. */
export function checkPolicy(policy: Policy): void {
	for (const entry of [...policy.secretPatterns, ...policy.commandRules]) new RegExp(entry.source, entry.flags);
	new RegExp(policy.rmFlag);
	new RegExp(policy.rmDangerousTarget);
	const probe = evaluateToolCall({ tool: "read", input: { path: ".env" }, cwd: "/", home: "/nonexistent" }, policy);
	if (probe.decision !== "deny") throw new Error("policy check failed: reading .env is not denied");
}

export function evaluateToolCall(call: ToolCall, policy: Policy): Decision {
	const tool = call.tool.toLowerCase();
	if (SHELL_TOOLS.has(tool)) {
		const command = call.input.command;
		return typeof command === "string" ? evaluateShellCommand(command, call, policy) : ALLOW;
	}

	for (const key of PATH_KEYS) {
		const value = call.input[key];
		if (typeof value !== "string" || !value) continue;
		const decision = evaluatePathInput(value, call, policy);
		if (decision.decision === "deny") return decision;
	}
	for (const key of GLOB_KEYS[tool] ?? []) {
		const value = call.input[key];
		if (typeof value === "string" && mentionsBlockedEnvFile(value, policy)) return deny(envReason());
	}
	return ALLOW;
}
