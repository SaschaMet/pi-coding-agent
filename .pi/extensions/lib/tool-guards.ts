/**
 * Pure checks behind the tool-guards extension: repeat-loop tracking and the
 * cmux pane check. No `pi`, no events, no filesystem.
 */
import { createHash } from "node:crypto";
import { tokenizeCommand, type Token } from "./bash-mutations.ts";

/** Identical results in a row before the next identical call is blocked. */
export const REPEAT_LIMIT = 2;

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

export const callKey = (toolName: string, input: unknown) => sha1(`${toolName}\0${stable(input)}`);

export const resultKey = (content: readonly { type: string; text?: string }[], isError: boolean) =>
    sha1(`${isError}\0${content.map((part) => part.text ?? `<${part.type}>`).join("\n")}`);

export type RepeatState = { call: string; result: string; streak: number; blocks: number };

export const emptyRepeatState = (): RepeatState => ({ call: "", result: "", streak: 0, blocks: 0 });

/** A blocked call produces no result, so `blocks` only resets when a call really ran. */
export function recordResult(state: RepeatState, call: string, result: string): void {
    state.streak = call === state.call && result === state.result ? state.streak + 1 : 1;
    state.call = call;
    state.result = result;
    state.blocks = 0;
}

export function checkRepeat(state: RepeatState, call: string): "allow" | "block" | "stop" {
    if (call !== state.call || state.streak < REPEAT_LIMIT) return "allow";
    state.blocks += 1;
    return state.blocks >= 2 ? "stop" : "block";
}

// cmux takes global options before the verb (`cmux --socket /s send`).
const CMUX_PREFIX = String.raw`\bcmux\s+(?:-\S*\s+(?:[^-\s]\S*\s+)?)*`;
// Heredoc bodies stop only on typing: task files often name other cmux verbs in prose.
const TYPES_INTO_PANE = new RegExp(`${CMUX_PREFIX}(?:send|paste|[$\`])`);
const TOUCHES_PANES = new RegExp(
    `${CMUX_PREFIX}(?:send|paste|new-|workspace|move-|split-off|drag-surface|open|browser|markdown|diff|ssh|mosh|tab-action|join-pane|swap-pane|break-pane|rpc|vm|tmux|local-|recover|restore-session|vault|session|[$\`./~])`,
);
// Bash runs `"cmux"` and `c\mux` as cmux, so the quick checks ignore quotes and backslashes.
const matchesLoosely = (pattern: RegExp, text: string) => pattern.test(text.replace(/[\\'"]/g, ""));
// Verb → the flag that picks the pane; without it cmux falls back to the caller's or the focused pane.
const TYPING_VERBS = new Map([
    ["send", "--surface"],
    ["send-key", "--surface"],
    ["paste", "--surface"],
    ["paste-buffer", "--surface"],
    ["send-panel", "--panel"],
    ["send-key-panel", "--panel"],
]);
// Open or move a pane: allowed only inside the caller's own workspace.
const PLACING_VERBS = new Set([
    "new-split",
    "new-pane",
    "new-surface",
    "split-off",
    "drag-surface-to-split",
    "open",
    "diff",
    "markdown",
    "ssh-session-attach",
]);
// Create a workspace or window, or move a pane out of the caller's workspace.
// `rpc` reaches the raw API; pane swaps and joins may cross workspaces, which a literal ref cannot show.
const LEAVING_VERBS = new Set([
    "new-workspace",
    "new-window",
    "move-tab-to-new-workspace",
    "move-surface",
    "move-workspace-to-window",
    "join-pane",
    "swap-pane",
    "break-pane",
    "ssh",
    "ssh-tmux",
    "mosh",
    "mosh-tmux",
    "tmux",
    "local-tmux",
    "local-zellij",
    "vm",
    "recover",
    "restore-session",
    "rpc",
]);
const BROWSER_OPENERS = new Set(["open", "open-split", "new"]);
// Words that run the next word as the command: `timeout 5 cmux .` still opens a workspace.
const COMMAND_WRAPPERS = new Set(["timeout", "env", "nohup", "sudo", "exec", "command", "time", "nice"]);
const PANE_FLAGS = ["--surface", "--panel", "--pane"] as const;
// Any wrapper (`timeout 5`, `sudo`, `(`, `$(`, `\`) may precede cmux, so every word is a candidate.
const CMUX_WORD = /(?:^|[/(`{])cmux$/;
const isCmuxWord = (value: string) => CMUX_WORD.test(value.replace(/\\/g, ""));
const SUBSTITUTION = /\$\(|`/;
const TEXT_COMMANDS = new Set(["echo", "printf"]);
const SHELL_WORD = /(?:^|\/)(?:bash|sh|zsh)$/;
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;
const LINE_CONTINUATION = /\\\r?\n/g;
const TARGET_FLAGS = ["--surface", "--workspace", "--panel", "--window"] as const;
// The tokenizer drops empty quoted words, so `--surface ""` is caught on the raw text.
const EMPTY_TARGET = /--(surface|workspace|panel|pane|window)(?:=|\s+)(?:""|'')(?=\s|$)/;
const GUARDED_VALUE = /^\$\{(?:[A-Za-z_]\w*|\d+):\?[^}]*\}$/;
const CMUX_VALUE = /^\$\{?CMUX_(?:SURFACE|WORKSPACE|PANEL|TAB)_ID\}?$/;
const OWN_WORKSPACE = /^\$\{?CMUX_WORKSPACE_ID\}?$/;
// `<<<` is a here-string, not a heredoc; it stays and makes the tokenizer refuse.
const HEREDOC_START = /(?<!<)<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/;

const targetOk = (value: string) =>
    value !== "" && (!/[$`]/.test(value) || GUARDED_VALUE.test(value) || CMUX_VALUE.test(value));

/** Drops heredoc bodies; null when a body never ends or itself types into a pane. */
function stripHeredocBodies(command: string): string | null {
    const kept: string[] = [];
    let endTag: string | undefined;
    for (const line of command.split("\n")) {
        if (endTag !== undefined) {
            if (line.trim() === endTag) endTag = undefined;
            else if (matchesLoosely(TYPES_INTO_PANE, line)) return null;
            continue;
        }
        const start = line.match(HEREDOC_START);
        if (start) endTag = start[2];
        kept.push(start ? line.replace(HEREDOC_START, "") : line);
    }
    return endTag === undefined ? kept.join("\n") : null;
}

/** Every value of `flag` (repeated flags are all checked) between `from` and `to`. */
function flagValues(words: Token[], from: number, to: number, flag: string): string[] {
    const values: string[] = [];
    for (let i = from; i < to; i++) {
        const { value } = words[i];
        if (value === flag) values.push(words[i + 1]?.value ?? "");
        else if (value.startsWith(`${flag}=`)) values.push(value.slice(flag.length + 1));
    }
    return values;
}

/** Start of the command that word `i` belongs to: after the last background `&`. */
const commandStart = (words: Token[], i: number) => words.slice(0, i).map((word) => word.value).lastIndexOf("&") + 1;

/** End of a cmux invocation's flags: the next background `&`, the next cmux word, or `--` (text follows). */
function invocationEnd(words: Token[], from: number): number {
    const end = words.findIndex(
        (word, i) => i >= from && (word.value === "&" || word.value === "--" || isCmuxWord(word.value)),
    );
    return end < 0 ? words.length : end;
}

type VerbKind = "typing" | "placing" | "leaving" | "computed";
type Verb = { at: number; name: string; kind: VerbKind };

const hasWord = (words: Token[], from: number, value: string) =>
    words.slice(from, invocationEnd(words, from)).some((word) => word.value === value);

/** Whether the cmux word at `at` is the command itself, not an argument (`grep "cmux" .pi/`). */
function startsCommand(words: Token[], at: number): boolean {
    for (let k = at - 1; k >= commandStart(words, at); k--) {
        const { value } = words[k];
        const wrapperPart = COMMAND_WRAPPERS.has(value) || value.startsWith("-") || /^\d+[smhd]?$/.test(value) || /^[A-Za-z_]\w*=/.test(value);
        if (!wrapperPart) return false;
    }
    return true;
}

/** The guarded verb after the cmux word at `at`, past global options and their values. */
function verbAfter(words: Token[], at: number): Verb | undefined {
    for (let j = at + 1; j < words.length; j++) {
        const { value } = words[j];
        const verb = (kind: VerbKind): Verb => ({ at: j, name: value, kind });
        if (TYPING_VERBS.has(value)) return verb("typing");
        if (LEAVING_VERBS.has(value)) return verb("leaving");
        if (PLACING_VERBS.has(value)) return verb("placing");
        // Subcommands may follow options: `cmux workspace --json create`.
        if (value === "workspace") return hasWord(words, j + 1, "create") ? verb("leaving") : undefined;
        if (value === "browser") {
            const opens = words.slice(j + 1, invocationEnd(words, j + 1)).some((word) => BROWSER_OPENERS.has(word.value));
            return opens ? verb("placing") : undefined;
        }
        if (value === "session") return hasWord(words, j + 1, "move") ? verb("leaving") : undefined;
        if (value === "vault") return hasWord(words, j + 1, "--open") ? verb("leaving") : undefined;
        if (value === "tab-action") {
            const actions = flagValues(words, j + 1, invocationEnd(words, j + 1), "--action");
            if (actions.includes("move-to-new-workspace")) return verb("leaving");
            return actions.some((action) => action.startsWith("new-")) ? verb("placing") : undefined;
        }
        // A computed word may expand to any verb.
        if (SUBSTITUTION.test(value) || value.includes("$")) return verb("computed");
        if (value.startsWith("-")) continue;
        // A plain word is the value of the option before it, or the command: `cmux <path>` opens a new workspace.
        const opensPath = /^[./~]/.test(value) && startsCommand(words, at);
        if (j - 1 === at || !words[j - 1].value.startsWith("-")) return opensPath ? verb("leaving") : undefined;
    }
    return undefined;
}

/** `--help` prints usage and changes nothing; as a flag's value (`--name --help`) it is just text. */
const asksForHelp = (words: Token[], verb: Verb, end: number) =>
    words.slice(verb.at + 1, end).some((word, k) => word.value === "--help" && !words[verb.at + k].value.startsWith("-"));

const unsafeReason = (flag: string, value: string) =>
    `[CMUX] ${flag} is ${JSON.stringify(value)}. Each bash call is a fresh shell: variables from earlier calls are empty, and an empty target falls back to the user's focused pane or a pane outside this workspace. Write ${flag} "\${W:?}" (bash then stops if W is empty) or the literal ref (surface:N).`;

const foreignReason = (flag: string, value: string) =>
    `[CMUX] ${flag} is ${JSON.stringify(value)}: a new pane must open in the caller's workspace. Leave --workspace out or write --workspace "$CMUX_WORKSPACE_ID", and drop --window.`;

const leavingReason = (name: string) =>
    `[CMUX] cmux ${name} creates a workspace or window, or moves a pane out of the caller's workspace and its sidebar group. Split the caller's workspace instead: cmux new-split right --surface "$CMUX_SURFACE_ID". A separate workspace only on the user's explicit request: ask the user to run it.`;

function checkVerb(words: Token[], verb: Verb, end: number): string | undefined {
    const values = (flag: string) => flagValues(words, verb.at + 1, end, flag);
    if (verb.kind === "leaving") return leavingReason(verb.name);
    if (verb.kind === "computed") {
        return `[CMUX] Cannot check cmux ${verb.name}: the command name or an option value is computed. Write the cmux command and its options literally.`;
    }
    if (verb.kind === "placing") {
        const foreign = values("--workspace").find((value) => !OWN_WORKSPACE.test(value));
        if (foreign !== undefined) return foreignReason("--workspace", foreign);
        const window = values("--window")[0];
        if (window !== undefined) return foreignReason("--window", window);
        for (const flag of PANE_FLAGS) {
            const unsafe = values(flag).find((value) => !targetOk(value));
            if (unsafe !== undefined) return unsafeReason(flag, unsafe);
        }
        return undefined;
    }
    const required = TYPING_VERBS.get(verb.name) as string;
    if (values(required).length === 0) {
        return `[CMUX] cmux ${verb.name} needs ${required}: without it cmux types into the caller's own pane ($CMUX_SURFACE_ID) or the focused pane. Pass ${required} surface:N or "\${W:?}".`;
    }
    for (const flag of TARGET_FLAGS) {
        const unsafe = values(flag).find((value) => !targetOk(value));
        if (unsafe !== undefined) return unsafeReason(flag, unsafe);
    }
    return undefined;
}

/** Text that bash runs as its own command: a substitution, `bash -c "…"`, or `eval …`. */
function innerCommand(words: Token[], i: number, source: string): string | undefined {
    const word = words[i].value;
    if (SHELL_WORD.test(word) && SHELL_COMMAND_FLAG.test(words[i + 1]?.value ?? "")) return words[i + 2]?.value;
    if (word === "eval") return words.slice(i + 1).map((w) => w.value).join(" ");
    // Bash runs a substitution even inside double quotes or an echo.
    return SUBSTITUTION.test(word) && word.length < source.length ? word : undefined;
}

function checkSegment(words: Token[], source: string): string | undefined {
    for (let i = 0; i < words.length; i++) {
        const inner = innerCommand(words, i, source);
        const innerReason = inner === undefined ? undefined : checkCmuxSurface(inner);
        if (innerReason) return innerReason;
        if (!isCmuxWord(words[i].value)) continue;
        const verb = verbAfter(words, i);
        if (verb === undefined) continue;
        const start = commandStart(words, i);
        if (start < i && TEXT_COMMANDS.has(words[start].value)) continue;
        const end = invocationEnd(words, verb.at + 1);
        if (asksForHelp(words, verb, end)) continue;
        const reason = checkVerb(words, verb, end);
        if (reason) return reason;
    }
    return undefined;
}

/** Reason to block a cmux command that types into, opens, or moves a pane unsafely, else undefined. */
export function checkCmuxSurface(rawCommand: string): string | undefined {
    const command = rawCommand.replace(LINE_CONTINUATION, " ");
    if (!matchesLoosely(TOUCHES_PANES, command)) return undefined;
    const empty = command.match(EMPTY_TARGET);
    if (empty) return unsafeReason(`--${empty[1]}`, "");
    const stripped = stripHeredocBodies(command);
    const segments = stripped === null ? null : tokenizeCommand(stripped);
    if (segments === null) {
        return '[CMUX] Cannot check this cmux send: a heredoc never ends, contains a cmux send, or the command has a here-string. Send in a separate command with --surface surface:N or "${W:?}".';
    }
    for (const words of segments) {
        const reason = checkSegment(words, command);
        if (reason) return reason;
    }
    return undefined;
}

/** A session that can run shell commands but has neither `write` nor `edit`. */
export function isReadonlySession(tools: readonly string[]): boolean {
    return tools.includes("bash") && !tools.includes("write") && !tools.includes("edit");
}

const REPORTS_HINT = "Shell writes are allowed only to $TMPDIR/pi-reports/.";

type ShellWord = { value: string; singleQuoted: boolean; escaped: boolean };
type ShellSegment = { words: ShellWord[]; targets: ShellWord[] };

/** Index of the `)` that closes the `(` before `from`, or -1. Quotes inside are not tracked: an unbalanced case fails safe. */
function closingParen(source: string, from: number): number {
    let depth = 1;
    for (let i = from; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")" && --depth === 0) return i;
    }
    return -1;
}

/** Splits on unquoted `; | & ( )` and newlines; skips heredoc bodies and collects redirect targets. A string is a violation. */
function parseShell(source: string, tmpdir: string): ShellSegment[] | string {
    const segments: ShellSegment[] = [];
    const heredocs: Array<{ delimiter: string; stripTabs: boolean; quoted: boolean }> = [];
    let words: ShellWord[] = [];
    let targets: ShellWord[] = [];
    let value = "";
    let has = false;
    let singleQuoted = false;
    let escaped = false;
    let pending: "target" | "skip" | undefined;
    let quote: string | undefined;
    let failure: string | undefined;

    const flushWord = () => {
        if (!has) return;
        const word = { value, singleQuoted, escaped };
        if (pending === "target") targets.push(word);
        else if (pending === undefined) words.push(word);
        pending = undefined;
        value = "";
        has = false;
        singleQuoted = false;
        escaped = false;
    };
    const flushSegment = () => {
        flushWord();
        if (pending !== undefined) failure ??= "a redirect has no target";
        pending = undefined;
        if (words.length > 0 || targets.length > 0) segments.push({ words, targets });
        words = [];
        targets = [];
    };
    // A number glued to a redirect (`2>`) is the file descriptor, not an argument.
    const flushBeforeRedirect = () => {
        if (has && !singleQuoted && !escaped && /^\d+$/.test(value)) {
            value = "";
            has = false;
        } else flushWord();
    };
    const substitute = (open: number): number => {
        const close = closingParen(source, open);
        if (close < 0) {
            failure ??= "an unclosed command substitution";
            return source.length;
        }
        const inner = source.slice(open, close);
        // A `)` closing a case pattern ends the substitution early, so the rest would go unchecked.
        if (/\bcase\b/.test(inner)) failure ??= "a case statement inside a command substitution";
        failure ??= readonlyBashViolation(inner, tmpdir);
        value += "$(…)";
        has = true;
        return close;
    };
    const backtick = (at: number): number => {
        const close = source.indexOf("`", at + 1);
        if (close < 0) {
            failure ??= "an unclosed backtick";
            return source.length;
        }
        failure ??= readonlyBashViolation(source.slice(at + 1, close), tmpdir);
        value += "$(…)";
        has = true;
        return close;
    };
    const readHeredocDelimiter = (from: number): number => {
        let i = from;
        const stripTabs = source[i] === "-";
        if (stripTabs) i++;
        while (source[i] === " " || source[i] === "\t") i++;
        let delimiter = "";
        let quoted = false;
        for (; i < source.length && !/[\s;|&<>()]/.test(source[i]); i++) {
            if (/['"\\]/.test(source[i])) quoted = true;
            else delimiter += source[i];
        }
        if (delimiter === "") failure ??= "a heredoc without a delimiter";
        heredocs.push({ delimiter, stripTabs, quoted });
        return i;
    };
    const skipHeredocBodies = (from: number): number => {
        let pos = from;
        for (const { delimiter, stripTabs, quoted } of heredocs.splice(0)) {
            let closed = false;
            while (pos < source.length && !closed) {
                const eol = source.indexOf("\n", pos);
                const end = eol < 0 ? source.length : eol;
                const line = source.slice(pos, end);
                pos = end + 1;
                closed = (stripTabs ? line.replace(/^\t+/, "") : line) === delimiter;
                // Only a quoted delimiter keeps the shell from expanding the body.
                if (!closed && !quoted && /\$\(|`/.test(line)) failure ??= "an unquoted heredoc body that runs a command";
            }
        }
        return pos;
    };

    for (let i = 0; i < source.length && failure === undefined; i++) {
        const ch = source[i];
        const next = source[i + 1];
        if (quote === "'") {
            if (ch === "'") quote = undefined;
            else value += ch;
            continue;
        }
        if (quote === '"') {
            if (ch === '"') quote = undefined;
            else if (ch === "\\" && next !== undefined) {
                value += next;
                escaped = true;
                i++;
            } else if (ch === "$" && next === "(") i = substitute(i + 2);
            else if (ch === "`") i = backtick(i);
            else value += ch;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            has = true;
            if (ch === "'") singleQuoted = true;
        } else if (ch === "\\") {
            has = true;
            escaped = true;
            if (next === "\n") i++;
            else if (next !== undefined) {
                value += next;
                i++;
            }
        } else if (ch === "$" && next === "(") i = substitute(i + 2);
        else if (ch === "`") i = backtick(i);
        else if (ch === "#" && !has) {
            while (i + 1 < source.length && source[i + 1] !== "\n") i++;
        } else if (ch === "\n") {
            flushSegment();
            if (heredocs.length > 0) i = skipHeredocBodies(i + 1) - 1;
        } else if (ch === ";" || ch === "(" || ch === ")") flushSegment();
        else if (ch === "|") {
            if (next === "|" || next === "&") i++;
            flushSegment();
        } else if (ch === "&") {
            if (next === ">") {
                flushWord();
                i += source[i + 2] === ">" ? 2 : 1;
                pending = "target";
            } else {
                if (next === "&") i++;
                flushSegment();
            }
        } else if (ch === ">") {
            if (next === "(") {
                failure = "a process substitution that writes";
                break;
            }
            flushBeforeRedirect();
            if (next === ">") i++;
            if (source[i + 1] === "|") i++;
            if (source[i + 1] === "&") {
                i++;
                // `2>&1` duplicates a descriptor; `>&file` and `>&2x` write a file.
                pending = /^(\d+|-)(?![^\s;|&<>()])/.test(source.slice(i + 1)) ? "skip" : "target";
            } else pending = "target";
        } else if (ch === "<") {
            if (next === "(") {
                i = substitute(i + 2);
                continue;
            }
            flushBeforeRedirect();
            if (next === "<" && source[i + 2] !== "<") {
                i = readHeredocDelimiter(i + 2) - 1;
                continue;
            }
            while (source[i + 1] === "<") i++;
            if (source[i + 1] === "&") i++;
            pending = "skip";
        } else if (/\s/.test(ch)) flushWord();
        else {
            value += ch;
            has = true;
        }
    }
    if (quote !== undefined) failure ??= "an unclosed quote";
    if (failure === undefined) flushSegment();
    return failure === undefined ? segments : `Cannot check this command (${failure}). ${REPORTS_HINT}`;
}

const MUTATING_COMMANDS = new Set([
    "rm", "mv", "cp", "touch", "mkdir", "ln", "tee", "dd", "truncate", "install", "chmod", "chown", "rsync", "patch",
    "wget", "unzip", "npx", "pnpm", "yarn", "pip", "pip3", "sudo", "doas", "eval",
    "rmdir", "unlink", "shred", "trash", "mkfifo", "mknod", "split", "csplit", "gzip", "gunzip", "bzip2", "xz", "zip",
    "ditto", "kill", "killall", "pkill", "defaults", "launchctl", "xattr", "chgrp",
    // Run a command string or script the parser cannot see.
    "source", ".", "su", "script", "chroot", "busybox", "watch",
]);
const WRAPPERS = new Set([
    "env", "command", "builtin", "nohup", "time", "nice", "exec", "xargs",
    "timeout", "gtimeout", "stdbuf", "setsid", "caffeinate", "ionice",
]);
const SHELL_KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{", "}", "fi", "done", "esac"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const GIT_READ_COMMANDS = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "grep", "blame"]);
const GIT_BRANCH_LISTING_FLAGS = new Set(["-a", "-r", "-v", "-vv", "--all", "--remotes", "--verbose", "--list", "-l", "--show-current"]);
const FIND_WRITING_ACTIONS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);

// A short-flag cluster may carry an attached value (`-i.bak`, `-oFILE`), so only the letters before it count.
const isShortFlagWith = (arg: string, letters: string) => new RegExp(`^-(?!-)[A-Za-z]*[${letters}]`).test(arg);
// A script that uses sed's `w` (write file) or `e` (run command) command.
const SED_WRITING_SCRIPT = /(^|[\s;{}/\d$])[we](\s|;|}|$)/;
const MAX_WRAPPER_FLAGS = 6;

function gitViolation(args: string[]): string | undefined {
    let i = 0;
    for (; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree") i++;
        else if (arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=") || arg === "--no-pager") continue;
        else if (arg.startsWith("-")) return `git option ${arg} is not allowed in a read-only agent.`;
        else break;
    }
    const sub = args[i];
    const rest = args.slice(i + 1);
    if (sub === undefined) return undefined;
    if (rest.some((arg) => arg.startsWith("--output"))) return `git ${sub} --output writes a file.`;
    if (sub === "grep" && rest.some((arg) => arg.startsWith("-O") || arg.startsWith("--open-files-in-pager"))) return "git grep -O runs a command.";
    if (GIT_READ_COMMANDS.has(sub)) return undefined;
    if (sub === "branch" && rest.every((arg) => GIT_BRANCH_LISTING_FLAGS.has(arg))) return undefined;
    if (sub === "worktree" && rest[0] === "list") return undefined;
    if (sub === "stash" && rest[0] === "list") return undefined;
    return `git ${sub} can change the repository.`;
}

/**
 * Every command a wrapper may run. A bare flag may or may not take the next word as its value
 * (`env -u A rm`, `env -i git`), so both readings are returned; null means too many flags to enumerate.
 */
function wrappedCommands(rest: string[], flagsSeen = 0): string[][] | null {
    const [first] = rest;
    if (first === undefined) return [[]];
    if (/^[A-Za-z_]\w*=/.test(first) || /^\d+(\.\d+)?[smhd]?$/.test(first)) return wrappedCommands(rest.slice(1), flagsSeen);
    if (!first.startsWith("-")) return [rest];
    if (flagsSeen >= MAX_WRAPPER_FLAGS) return null;
    const withFlagSkipped = wrappedCommands(rest.slice(1), flagsSeen + 1);
    if (withFlagSkipped === null || !/^-(-[\w-]+|[A-Za-z])$/.test(first)) return withFlagSkipped;
    const withValueSkipped = wrappedCommands(rest.slice(2), flagsSeen + 1);
    return withValueSkipped === null ? null : [...withFlagSkipped, ...withValueSkipped];
}

function commandViolation(words: ShellWord[]): string | undefined {
    const all = words.map((word) => word.value);
    // The folder an allowed redirect resolves against must not change mid-command.
    if (all.some((arg) => /^TMPDIR=/.test(arg)) || (all[0] === "unset" && all.includes("TMPDIR"))) return "TMPDIR is reassigned.";
    return argsViolation(all);
}

function argsViolation(all: string[]): string | undefined {
    let args = all;
    while (args.length > 0 && (/^[A-Za-z_]\w*=/.test(args[0]) || SHELL_KEYWORDS.has(args[0]))) args = args.slice(1);
    if (args.length === 0) return undefined;
    const head = args[0].split("/").pop() ?? "";
    const rest = args.slice(1);
    if (args[0].includes("$")) return "The command name comes from an expansion and cannot be checked.";
    if (WRAPPERS.has(head)) {
        if (head === "env" && rest.some((arg) => arg === "-S" || arg.startsWith("--split-string"))) return "env -S runs a command string that cannot be checked.";
        const candidates = wrappedCommands(rest);
        if (candidates === null) return `${head} has too many options to check.`;
        return candidates.map(argsViolation).find(Boolean);
    }
    if (MUTATING_COMMANDS.has(head)) return `${head} can change files.`;
    // A shell reads stdin, a script, or a string; none can be checked.
    if (SHELLS.has(head) && rest[0] !== "--version") return `${head} runs commands that cannot be checked.`;
    switch (head) {
        case "sed":
        case "perl":
            if (rest.some((arg) => isShortFlagWith(arg, "i") || arg.startsWith("--in-place"))) return `${head} -i edits files in place.`;
            if (head === "sed" && rest.some((arg) => isShortFlagWith(arg, "f") || arg.startsWith("--file"))) return "sed -f runs a script file that cannot be checked.";
            if (head === "sed" && rest.some((arg) => !arg.startsWith("-") && SED_WRITING_SCRIPT.test(arg))) return "sed w/e writes a file or runs a command.";
            return undefined;
        case "sort":
            return rest.some((arg) => isShortFlagWith(arg, "o") || arg.startsWith("--output")) ? "sort -o writes a file." : undefined;
        case "find":
            return rest.some((arg) => FIND_WRITING_ACTIONS.has(arg)) ? "find -delete/-exec/-fprint can change files." : undefined;
        case "curl":
            return rest.some(
                (arg) =>
                    isShortFlagWith(arg, "oOTK") ||
                    /^--(output|remote-name|upload-file|config)/.test(arg),
            )
                ? "curl -o/-O/-T/-K writes a file or reads a config that cannot be checked."
                : undefined;
        case "tar":
            return rest.some((arg) => isShortFlagWith(arg, "x") || /^[A-Za-z]*x[A-Za-z]*$/.test(arg) || arg === "--extract" || arg === "--get")
                ? "tar -x extracts files."
                : undefined;
        case "npm": {
            const verb = rest.find((arg) => !arg.startsWith("-"));
            return verb === "ls" || verb === "view" ? undefined : "npm can change files; only npm ls and npm view are allowed.";
        }
        case "git":
            return gitViolation(rest);
        default:
            return undefined;
    }
}

function redirectViolation(target: ShellWord, tmpdir: string): string | undefined {
    const value = target.value;
    if (value === "/dev/null") return undefined;
    const root = tmpdir.replace(/\/+$/, "");
    const literal = !target.singleQuoted && !target.escaped ? /^(?:\$TMPDIR|\$\{TMPDIR\})\//.exec(value) : null;
    const resolved = literal ? `${root}/${value.slice(literal[0].length)}` : value;
    const unknownExpansion = (literal ? value.slice(literal[0].length) : value).includes("$") || value.includes("`");
    const inReports = resolved.startsWith(`${root}/pi-reports/`) && resolved.length > root.length + 12;
    const escapes = resolved.split("/").includes("..") || target.escaped;
    if (inReports && !escapes && !unknownExpansion) return undefined;
    return `Redirect to ${value} is blocked.`;
}

/**
 * Why a read-only agent may not run this shell command, else undefined.
 * Interpreter bodies (python, node) are not inspected.
 */
export function readonlyBashViolation(command: string, tmpdir: string): string | undefined {
    const parsed = parseShell(command, tmpdir);
    if (typeof parsed === "string") return parsed;
    for (const { words, targets } of parsed) {
        const reason = targets.map((target) => redirectViolation(target, tmpdir)).find(Boolean) ?? commandViolation(words);
        if (reason) return `${reason} ${REPORTS_HINT}`;
    }
    return undefined;
}
