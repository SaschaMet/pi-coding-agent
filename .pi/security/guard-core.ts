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
// In bash a backslash escapes the next character, so `\.env` is regex text, not a path.
// PowerShell and path inputs keep it: there it is the Windows separator.
const SH_BOUNDARY_BEFORE = String.raw`(?:^|[\s"'` + "`" + String.raw`=<>|;&(:/])`;
const BOUNDARY_AFTER = String.raw`(?=$|[\s"'` + "`" + String.raw`;|&<>)/\\])`;
const envRegExp = (before: string): RegExp =>
	new RegExp(
		before + String.raw`\.env((?:\.[A-Za-z0-9_-]+)*)(\.?[*?\[][^\s"'` + "`" + String.raw`;|&<>)]*)?` + BOUNDARY_AFTER,
		"gi",
	);
const ENV_RE = envRegExp(BOUNDARY_BEFORE);
const SH_ENV_RE = envRegExp(SH_BOUNDARY_BEFORE);

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function envReason(): string {
	return ".env files are blocked for agents. Use .env.example for shape, or ask the user.";
}

/** True when the text names a `.env` file that is not an allowed example file. */
export function mentionsBlockedEnvFile(text: string, policy: Policy, envRe = ENV_RE): boolean {
	const allowed = new Set(policy.envAllowedSuffixes.map((s) => s.toLowerCase()));
	for (const match of text.matchAll(envRe)) {
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
			// No path prefix: it may be empty, so it never decides a match, and on a long
			// run of path characters it made each start position rescan the run.
			String.raw`[\w-]\.(?:` + extensions + ")" + BOUNDARY_AFTER,
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
 * A word with quotes removed. `unquoted[i]` is "1" when the shell would expand
 * `text[i]` as a glob or brace, else "0". A string, not an array: brace
 * expansion copies words, and string slices and joins stay cheap.
 */
interface ShellWord {
	text: string;
	unquoted: string;
}

const isUnquoted = (word: ShellWord, i: number): boolean => word.unquoted[i] === "1";

/**
 * Splits a shell command into simple commands (on `; & | ( )` and newlines),
 * each a list of words with quotes removed. A speed bump, not a parser:
 * obfuscated commands such as `$(printf ...)` pass.
 */
export function splitShellCommands(command: string): string[][] {
	return splitShellWords(command).map((words) => words.map((word) => word.text));
}

// PowerShell escapes with a backtick; a backslash there is the path separator.
function splitShellWords(command: string, tool = "bash"): ShellWord[][] {
	const escape = tool === "powershell" ? "`" : "\\";
	const commands: ShellWord[][] = [];
	let words: ShellWord[] = [];
	let word: ShellWord = { text: "", unquoted: "" };
	let inWord = false;
	let quote: "'" | '"' | undefined;
	const add = (char: string, unquoted: boolean) => {
		word.text += char;
		word.unquoted += unquoted ? "1" : "0";
		inWord = true;
	};
	const endWord = () => {
		if (inWord) words.push(word);
		word = { text: "", unquoted: "" };
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
			// Inside double quotes bash drops the backslash only before these characters.
			else if (char === escape && quote === '"' && (escape === "`" || /[$`"\\\n]/.test(command[i + 1] ?? "")))
				add(command[++i] ?? "", false);
			else add(char, false);
		} else if (char === "'" || char === '"') {
			quote = char;
			inWord = true;
		} else if (char === escape && i + 1 < command.length) {
			add(command[++i], false);
		} else if (/[;&|()\n]/.test(char)) {
			endCommand();
		} else if (/\s/.test(char)) {
			endWord();
		} else {
			add(char, true);
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
		// A target built at run time cannot be checked here, so it fails closed.
		if (/[$`]/.test(refspec)) return deny("git push target is built at run time. Type the branch name.");
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
	if (git.subcommand === "config" && changesHookConfig(git.args))
		return deny("Changing core or include settings can drop the security git hook.");
	if (git.subcommand === "push") return pushDecision(git.args, call, policy);
	return ALLOW;
}

const INCLUDE_KEY_RE = /^include(?:if\..+)?\.path$/i;
const SECTION_OPS = new Set(["--remove-section", "--rename-section", "remove-section", "rename-section"]);

// Dropping [core] or adding an include overrides core.hooksPath without naming it.
function changesHookConfig(args: string[]): boolean {
	if (args.some((arg, i) => SECTION_OPS.has(arg) && args[i + 1]?.toLowerCase() === "core")) return true;
	const readOnly = args.some((arg) => CONFIG_READ_FLAGS.has(arg)) && !args.some((arg) => CONFIG_WRITE_FLAGS.has(arg));
	return !readOnly && args.some((arg) => INCLUDE_KEY_RE.test(arg));
}

const MAX_SHELL_DEPTH = 3;
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

/** The `-c` command string of a sh/bash/zsh/dash call in this simple command, if there is one. */
function shellDashC(words: string[]): string | undefined {
	const start = words.findIndex((word) => SHELLS.has(baseName(word)));
	if (start === -1) return undefined;
	for (let i = start + 1; i < words.length; i++) {
		const arg = words[i];
		if (arg === "-o" || arg === "+o") i++;
		// Lookahead form: `^-[a-zA-Z]*c[a-zA-Z]*$` backtracks once per `c` and is quadratic on one long word.
		else if (/^-(?=[a-zA-Z]*c)[a-zA-Z]*$/.test(arg)) return words[i + 1] ?? "";
		else if (!/^[-+]/.test(arg)) return undefined;
	}
	return undefined;
}

function invokesGit(commands: string[][], depth: number): boolean {
	return commands.some((words) => {
		if (findGit(words)) return true;
		const inner = shellDashC(words);
		return inner !== undefined && depth < MAX_SHELL_DEPTH && invokesGit(splitShellCommands(inner), depth + 1);
	});
}

/**
 * `dropsHome[j]`: the `env` arguments starting at word j drop HOME (`-i`, `-`, `-u HOME`).
 * One backward pass, because a run of dash words such as `-/env` would otherwise be
 * rescanned once per `env`.
 */
function envDropsHomeFrom(words: string[]): boolean[] {
	const dropsHome = new Array<boolean>(words.length + 2).fill(false);
	for (let j = words.length - 1; j >= 0; j--) {
		const arg = words[j];
		if (arg === "-" || arg === "--ignore-environment" || /^-(?=[a-z]*i)[a-z]*$/.test(arg)) dropsHome[j] = true;
		else if (arg === "-uHOME" || arg === "--unset=HOME") dropsHome[j] = true;
		else if (arg === "-u" || arg === "--unset") dropsHome[j] = words[j + 1] === "HOME" || dropsHome[j + 2];
		else dropsHome[j] = arg.startsWith("-") && dropsHome[j + 1];
	}
	return dropsHome;
}

// Without HOME, git cannot find ~/.gitconfig and so skips the global core.hooksPath.
function hidesHome(commands: string[][]): boolean {
	return commands.some((words) => {
		const lastHome = words.lastIndexOf("HOME");
		let dropsHome: boolean[] | undefined;
		return words.some(
			(word, i) =>
				/^HOME=/.test(word) ||
				(word === "unset" && lastHome > i) ||
				(baseName(word) === "env" && (dropsHome ??= envDropsHomeFrom(words))[i + 1]),
		);
	});
}

function normalizeRmTarget(target: string, home: string): string {
	let normalized = target.replace(/^\$\{?HOME\}?(?=\/|$)/, "~");
	if (normalized === home || normalized.startsWith(home + "/")) normalized = "~" + normalized.slice(home.length);
	if (normalized.length <= 1) return normalized;
	// A loop, not `/\/+$/`: that regex is quadratic on a long run of `/` inside a word,
	// and this runs on every word of the command.
	let end = normalized.length;
	while (end > 0 && normalized[end - 1] === "/") end--;
	return normalized.slice(0, end) || "/";
}

function rmDecision(words: string[], call: ToolCall, policy: Policy): Decision {
	const flag = new RegExp(policy.rmFlag);
	const dangerous = new RegExp(policy.rmDangerousTarget);
	// A dangerous target starts with `/` or `~`, never `-`, so an `rm`'s first dangerous
	// target is simply the first dangerous word after it. One backward pass finds them all.
	const nextDanger = new Array<number>(words.length + 1).fill(-1);
	for (let i = words.length - 1; i >= 0; i--) {
		nextDanger[i] = dangerous.test(normalizeRmTarget(words[i], call.home)) ? i : nextDanger[i + 1];
	}
	// A later `rm` with no `--` before it sees a subset of the earlier one's flags and
	// targets, so only the first `rm` after the start or after each `--` needs a check.
	let covered = false;
	for (let start = 0; start < words.length; start++) {
		if (words[start] === "--") covered = false;
		if (covered || baseName(words[start]) !== "rm") continue;
		covered = true;
		const hit = nextDanger[start + 1];
		if (hit === -1) continue;
		let forced = false;
		for (let i = start + 1; i < words.length && words[i] !== "--" && !forced; i++) {
			forced = words[i].startsWith("-") && flag.test(words[i]);
		}
		if (forced) return deny(`Destructive delete of '${words[hit]}' is blocked. Delete a narrower path.`);
	}
	return ALLOW;
}

const MAX_BRACE_WORDS = 64;
const GLOB_CHARS = new Set(["*", "?", "["]);
// Bash sequences hold integers or single letters; a step only thins the range.
const SEQUENCE_RE = /^(?:-?\d+\.\.-?\d+|([A-Za-z])\.\.([A-Za-z]))(?:\.\.-?\d+)?$/;

const sliceWord = (word: ShellWord, start: number, end?: number): ShellWord => ({
	text: word.text.slice(start, end),
	unquoted: word.unquoted.slice(start, end),
});

const joinWords = (...parts: ShellWord[]): ShellWord => ({
	text: parts.reduce((text, part) => text + part.text, ""),
	unquoted: parts.reduce((unquoted, part) => unquoted + part.unquoted, ""),
});

const literal = (text: string): ShellWord => ({ text, unquoted: "0".repeat(text.length) });

interface BraceGroup {
	start: number;
	end: number;
	choices: ShellWord[];
}

// Numbers cannot spell a file name, so one digit stands in for a number range.
// A letter range keeps every letter in it, ignoring the step, which fails closed.
function sequenceChoices(inner: ShellWord): ShellWord[] | undefined {
	const match = inner.unquoted.includes("0") ? null : SEQUENCE_RE.exec(inner.text);
	if (!match) return undefined;
	if (!match[1]) return [literal("0")];
	const [low, high] = [match[1].charCodeAt(0), match[2].charCodeAt(0)].sort((a, b) => a - b);
	return Array.from({ length: high - low + 1 }, (_, k) => literal(String.fromCharCode(low + k)));
}

/** The first unquoted `{a,b}` or `{x..y}` group at or after `from`; `${VAR}` and nested groups are not expanded. */
function findBraceGroup(word: ShellWord, from: number): BraceGroup | undefined {
	for (let open = word.text.indexOf("{", from); open !== -1; open = word.text.indexOf("{", open + 1)) {
		if (!isUnquoted(word, open) || word.text[open - 1] === "$") continue;
		const bounds = [open];
		let close = -1;
		for (let i = open + 1; i < word.text.length && close === -1; i++) {
			if (!isUnquoted(word, i)) continue;
			const char = word.text[i];
			if (char === "{") break;
			if (char === ",") bounds.push(i);
			else if (char === "}") close = i;
		}
		if (close === -1) continue;
		bounds.push(close);
		const choices =
			bounds.length > 2
				? bounds.slice(1).map((end, k) => sliceWord(word, bounds[k] + 1, end))
				: sequenceChoices(sliceWord(word, open + 1, close));
		if (choices) return { start: open, end: close + 1, choices };
	}
	return undefined;
}

/**
 * Brace expansion, one level deep; undefined past MAX_BRACE_WORDS results.
 * The result count is checked before any word is built, so a crafted group
 * cannot make the check slow or run out of memory.
 */
function expandBraces(word: ShellWord): ShellWord[] | undefined {
	const groups: BraceGroup[] = [];
	let count = 1;
	for (let group = findBraceGroup(word, 0); group; group = findBraceGroup(word, group.end)) {
		count *= group.choices.length;
		if (count > MAX_BRACE_WORDS) return undefined;
		groups.push(group);
	}
	let results = [literal("")];
	let cursor = 0;
	for (const group of groups) {
		const between = sliceWord(word, cursor, group.start);
		results = results.flatMap((result) => group.choices.map((choice) => joinWords(result, between, choice)));
		cursor = group.end;
	}
	const rest = sliceWord(word, cursor);
	return results.map((result) => joinWords(result, rest));
}

// The shell's `*` and `?` skip a leading dot, so only a glob whose fixed start is
// a dot can reach the file: `.e*` can, `*env` cannot.
function dotGlobHitsEnv(word: ShellWord, separators: string): boolean {
	let segment = word.text.length;
	while (segment > 0 && !separators.includes(word.text[segment - 1])) segment--;
	let glob = segment;
	while (glob < word.text.length && !(isUnquoted(word, glob) && GLOB_CHARS.has(word.text[glob]))) glob++;
	if (glob === word.text.length) return false;
	// An `=` before the glob ends a `NAME=` or `--opt=` prefix; one inside `[...]` belongs to the glob.
	const start = Math.max(segment, word.text.lastIndexOf("=", glob) + 1);
	const prefix = word.text.slice(start, glob).toLowerCase();
	return prefix.startsWith(".") && (".env".startsWith(prefix) || prefix.startsWith(".env."));
}

/** Checks a word as the shell would expand it: split at redirects, braces expanded, unquoted globs matched. */
function envWordDecision(word: ShellWord, policy: Policy, tool: string): Decision | undefined {
	// `cat .e*>&2` holds a file glob and a redirect in one word; each piece can name a file.
	const pieces: ShellWord[] = [];
	let start = 0;
	for (let i = 0; i <= word.text.length; i++) {
		if (i < word.text.length && !(isUnquoted(word, i) && "<>".includes(word.text[i]))) continue;
		if (i > start) pieces.push(sliceWord(word, start, i));
		start = i + 1;
	}
	const powershell = tool === "powershell";
	for (const piece of pieces) {
		const words = expandBraces(piece);
		if (!words) return deny("Brace expansion is too complex to check.");
		const hit = words.some(
			(w) => dotGlobHitsEnv(w, powershell ? "/\\" : "/") || mentionsBlockedEnvFile(w.text, policy, powershell ? ENV_RE : SH_ENV_RE),
		);
		if (hit) return deny(envReason());
	}
	return undefined;
}

const FIND_PATTERN_FLAGS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename"]);
const ENV_PROBES = [".env", ".env.local", ".env.production", "./a/.env"];

/** The pattern index after one `?`, `[...]`, escaped, or literal element matches `char`; -1 when it does not. */
function matchGlobElement(pattern: string, p: number, char: string): number {
	const element = pattern[p];
	if (element === "?") return p + 1;
	if (element === "\\" && p + 1 < pattern.length) return pattern[p + 1] === char ? p + 2 : -1;
	if (element === "[") {
		let i = p + 1;
		const negate = pattern[i] === "!" || pattern[i] === "^";
		if (negate) i++;
		const first = i;
		let hit = false;
		for (; i < pattern.length && (pattern[i] !== "]" || i === first); i++) {
			if (pattern[i + 1] === "-" && pattern[i + 2] !== undefined && pattern[i + 2] !== "]") {
				if (pattern[i] <= char && char <= pattern[i + 2]) hit = true;
				i += 2;
			} else if (pattern[i] === char) hit = true;
		}
		if (i < pattern.length) return hit !== negate ? i + 1 : -1;
	}
	return element === char ? p + 1 : -1;
}

// Iterative wildcard match in O(pattern x text): a regex here backtracks for
// seconds on a run of `*`, and the Claude hook allows the call when it times out.
function globMatch(pattern: string, text: string): boolean {
	let p = 0;
	let t = 0;
	let star = -1;
	let mark = 0;
	while (t < text.length) {
		if (pattern[p] === "*") {
			star = p++;
			mark = t;
			continue;
		}
		const next = p < pattern.length ? matchGlobElement(pattern, p, text[t]) : -1;
		if (next !== -1) {
			p = next;
			t++;
		} else if (star !== -1) {
			p = star + 1;
			t = ++mark;
		} else return false;
	}
	while (pattern[p] === "*") p++;
	return p === pattern.length;
}

// find globs match dotfiles, unlike the shell, so `-name '*env'` reaches the file.
function findHitsEnvFile(words: string[]): boolean {
	const start = words.findIndex((word) => baseName(word) === "find");
	if (start === -1) return false;
	return words.some((word, i) => {
		const pattern = words[i + 1];
		if (i <= start || !FIND_PATTERN_FLAGS.has(word) || pattern === undefined) return false;
		return ENV_PROBES.some((probe) => globMatch(pattern.toLowerCase(), probe));
	});
}

const WRAPPERS = new Set(["sudo", "nohup", "nice", "time", "exec", "xargs", "timeout", "env", "command"]);
const VARIABLE_LISTERS = new Set(["export", "declare", "typeset"]);
const ENV_OPTIONS_WITH_VALUE = new Set(["-u", "--unset", "-C", "--chdir"]);
const COMPOSE_OPTIONS_WITH_VALUE = new Set([
	"-f",
	"--file",
	"-p",
	"--project-name",
	"--profile",
	"--env-file",
	"--project-directory",
	"--ansi",
	"--progress",
	"--parallel",
]);
const COMPOSE_CONFIG_SAFE_FLAGS = new Set(["--services", "--volumes", "--profiles", "--images", "--networks", "--hash", "-q", "--quiet"]);
const DOCKER_OPTIONS_WITH_VALUE = new Set(["-c", "--context", "-H", "--host", "-l", "--log-level", "--config", "--tlscacert", "--tlscert", "--tlskey"]);
// Literal text and `{{.Field.Path}}` or `{{json .Field.Path}}` actions only: `$`, a bare `.`,
// and template functions can print the whole object, environment included.
const SAFE_INSPECT_FORMAT_RE = /^(?:[^{}]|\{\{\s*(?:json\s+)?(?:\.[A-Za-z_]\w*)+\s*\}\})*$/;
const POWERSHELL_ENV_DRIVE_RE = /^env:[\\/]?\*?$/i;
// Reserved words open a compound command; the command itself comes after them.
const RESERVED_WORDS = new Set(["{", "}", "!", "if", "then", "elif", "else", "fi", "do", "done", "while", "until"]);
// Values that filter by file name: `\.env` there names the file, so the backslash stays a boundary.
const NAME_FILTER_FLAGS = new Set(["-regex", "-iregex", "-g", "--glob", "--iglob", "--include"]);

const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

function nameFilterHitsEnvFile(words: string[], policy: Policy): boolean {
	return words.some((word, i) => {
		const equals = word.indexOf("=");
		const value = NAME_FILTER_FLAGS.has(word)
			? words[i + 1]
			: equals > 0 && NAME_FILTER_FLAGS.has(word.slice(0, equals))
				? word.slice(equals + 1)
				: undefined;
		return value !== undefined && mentionsBlockedEnvFile(value, policy);
	});
}

// Any path from /proc to an environ file, such as /proc/self/task/1/environ. indexOf keeps it linear.
function readsProcEnviron(word: string): boolean {
	const lower = word.toLowerCase();
	const proc = lower.indexOf("/proc/");
	return proc !== -1 && lower.indexOf("/environ", proc) !== -1;
}

// Every word after a wrapper counts: option values cannot be told apart from
// the command without a flag table per tool, and those tables drift.
function commandStarts(words: string[]): number[] {
	let start = words.findIndex((word) => !isAssignment(word) && !RESERVED_WORDS.has(word));
	// `function NAME { body; }`: the body's first command follows the name and the brace.
	if (words[start] === "function") {
		start += 2;
		while (start < words.length && RESERVED_WORDS.has(words[start])) start++;
		if (start >= words.length) return [];
	}
	if (start === -1) return [];
	const name = baseName(words[start]);
	const later = (match: (word: string) => boolean) => words.some((word, i) => i > start && match(word));
	const wraps =
		(WRAPPERS.has(name) && !(name === "command" && /^-[vV]$/.test(words[start + 1] ?? ""))) ||
		((name === "docker" || name === "docker-compose") && later((word) => word === "exec" || word === "run")) ||
		(name === "kubectl" && later((word) => word === "exec"));
	return wraps ? words.map((_, i) => i).slice(start) : [start];
}

/**
 * Per-command lookups for the dump checks, each indexed by the word to start from and
 * built in one backward pass. Every word after a wrapper is a command start, so scanning
 * forward from each start is quadratic on a run of dash words such as `sudo -/env … x`
 * (`baseName("-/env")` is `env`, and it starts with `-`, so a forward scan does not stop).
 */
interface DumpScan {
	/** The last word that does not start with `-`; -1 when every word does. */
	lastNonFlag: number;
	/** `env` arguments from here hold only options and `NAME=value` words. */
	envOnly: boolean[];
	/** The `docker inspect` format given in the run of options from here. */
	format: (string | undefined)[];
	/** A safe `docker compose config` flag sits in the run of options from here. */
	safeCompose: boolean[];
	/** The first word after docker or compose options from here. */
	dockerSkip: number[];
	composeSkip: number[];
}

function scanForDumps(words: string[]): DumpScan {
	const n = words.length;
	const isOption = (j: number): boolean => j < n && words[j].startsWith("-");
	const skipOptions = (withValue: Set<string>): number[] => {
		const next = Array.from({ length: n + 2 }, (_, j) => j);
		for (let j = n - 1; j >= 0; j--) if (isOption(j)) next[j] = next[j + (withValue.has(words[j]) ? 2 : 1)];
		return next;
	};
	let lastNonFlag = n - 1;
	while (lastNonFlag >= 0 && isOption(lastNonFlag)) lastNonFlag--;
	const envOnly = new Array<boolean>(n + 2).fill(true);
	const format = new Array<string | undefined>(n + 1).fill(undefined);
	const safeCompose = new Array<boolean>(n + 1).fill(false);
	for (let j = n - 1; j >= 0; j--) {
		const word = words[j];
		envOnly[j] = ENV_OPTIONS_WITH_VALUE.has(word) ? envOnly[j + 2] : (word.startsWith("-") || isAssignment(word)) && envOnly[j + 1];
		if (!word.startsWith("-")) continue;
		if (word === "-f" || word === "--format") format[j] = words[j + 1] ?? "";
		else if (word.startsWith("--format=")) format[j] = word.slice("--format=".length);
		else if (/^-f./.test(word)) format[j] = word.slice(2);
		else format[j] = format[j + 1];
		safeCompose[j] = COMPOSE_CONFIG_SAFE_FLAGS.has(word.split("=")[0]) || safeCompose[j + 1];
	}
	return {
		lastNonFlag,
		envOnly,
		format,
		safeCompose,
		dockerSkip: skipOptions(DOCKER_OPTIONS_WITH_VALUE),
		composeSkip: skipOptions(COMPOSE_OPTIONS_WITH_VALUE),
	};
}

function composeDump(words: string[], from: number, scan: DumpScan): string | undefined {
	const i = scan.composeSkip[from];
	const subcommand = words[i];
	if (subcommand !== "config" && subcommand !== "convert") return undefined;
	return scan.safeCompose[i + 1] ? undefined : `docker compose ${subcommand}`;
}

function dockerDump(words: string[], from: number, scan: DumpScan): string | undefined {
	const i = scan.dockerSkip[from];
	if (words[i] === "compose") return composeDump(words, i + 1, scan);
	const inspect = words[i] === "container" ? i + 1 : i;
	if (words[inspect] !== "inspect") return undefined;
	const format = scan.format[inspect + 1];
	const showsEnv = format === undefined || /config|env/i.test(format) || !SAFE_INSPECT_FORMAT_RE.test(format);
	return showsEnv ? "docker inspect" : undefined;
}

function dumpAt(words: string[], start: number, scan: DumpScan): string | undefined {
	const name = baseName(words[start]);
	const from = start + 1;
	const onlyFlags = scan.lastNonFlag < from;
	if (name === "printenv" && onlyFlags) return "printenv";
	if (name === "env" && scan.envOnly[from]) return "env";
	if (VARIABLE_LISTERS.has(name) && onlyFlags) return name;
	if (name === "set" && from === words.length) return "set";
	if (name === "docker") return dockerDump(words, from, scan);
	if (name === "docker-compose") return composeDump(words, from, scan);
	return undefined;
}

/** The dump command when this simple command prints all environment variables. */
function dumpsEnvironment(words: string[], tool: string): string | undefined {
	if (words.some((word) => /debug:dotenv/i.test(word))) return "debug:dotenv";
	if (words.some(readsProcEnviron)) return "/proc/…/environ";
	if (tool === "powershell" && words.some((word) => POWERSHELL_ENV_DRIVE_RE.test(word))) return "env:";
	const scan = scanForDumps(words);
	for (const start of commandStarts(words)) {
		const dump = dumpAt(words, start, scan);
		if (dump) return dump;
	}
	return undefined;
}

function evaluateShellCommand(command: string, call: ToolCall, policy: Policy, depth = 0): Decision {
	if (depth > MAX_SHELL_DEPTH) return deny("Nested shell -c is too deep to check.");
	if (command.length > policy.maxScanChars) return deny("Command is too large to check.");
	const tool = call.tool.toLowerCase();
	if (mentionsBlockedEnvFile(command, policy, tool === "bash" ? SH_ENV_RE : ENV_RE)) return deny(envReason());
	if (credentialCommandRegex(call, policy).test(command)) return deny("Command touches a credential path.");
	for (const rule of policy.commandRules) {
		if (new RegExp(rule.source, rule.flags).test(command)) return deny(`Blocked: ${rule.name}.`);
	}
	const parsed = splitShellWords(command, tool);
	const commands = parsed.map((words) => words.map((word) => word.text));
	if (commands.some((words) => words.some((word) => /^GIT_CONFIG_GLOBAL=/.test(word))))
		return deny("Hiding the global git config skips the security git hook. To search for it, drop the '='.");
	if (hidesHome(commands) && invokesGit(commands, depth))
		return deny("Hiding HOME hides ~/.gitconfig and skips the security git hook.");
	for (const [index, words] of commands.entries()) {
		for (const word of parsed[index]) {
			const decision = envWordDecision(word, policy, tool);
			if (decision) return decision;
		}
		if (findHitsEnvFile(words) || nameFilterHitsEnvFile(words, policy)) return deny(envReason());
		const dump = dumpsEnvironment(words, tool);
		if (dump)
			return deny(`'${dump}' prints all environment variables, which can hold secrets. Read only the variable you need by name.`);
		const inner = shellDashC(words);
		if (inner !== undefined) {
			const decision = evaluateShellCommand(inner, call, policy, depth + 1);
			if (decision.decision === "deny") return decision;
		}
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
