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
