/**
 * Pure checks behind the tool-guards extension: repeat-loop tracking and the
 * cmux target check. No `pi`, no events, no filesystem.
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

const TYPES_INTO_PANE = /\bcmux\s+send/;
const TYPING_VERBS = new Set(["send", "send-key"]);
// Any wrapper (`timeout 5`, `sudo`, `(`, `$(`, `\`) may precede cmux, so every word is a candidate.
const CMUX_WORD = /(?:^|[/(`{\\])cmux$/;
const TEXT_COMMANDS = new Set(["echo", "printf"]);
const SHELL_WORD = /(?:^|\/)(?:bash|sh|zsh)$/;
const LINE_CONTINUATION = /\\\r?\n/g;
const TARGET_FLAGS = ["--surface", "--workspace"] as const;
// The tokenizer drops empty quoted words, so `--surface ""` is caught on the raw text.
const EMPTY_TARGET = /--(surface|workspace)(?:=|\s+)(?:""|'')(?=\s|$)/;
const GUARDED_VALUE = /^\$\{(?:[A-Za-z_]\w*|\d+):\?[^}]*\}$/;
const CMUX_VALUE = /^\$\{?CMUX_\w+\}?$/;
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
            else if (TYPES_INTO_PANE.test(line)) return null;
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

/** End of a cmux invocation: the next background `&` or the next cmux word. */
function invocationEnd(words: Token[], from: number): number {
    const end = words.findIndex((word, i) => i >= from && (word.value === "&" || CMUX_WORD.test(word.value)));
    return end < 0 ? words.length : end;
}

function checkSegment(words: Token[]): string | undefined {
    for (let i = 0; i < words.length; i++) {
        const word = words[i].value;
        if (SHELL_WORD.test(word) && words[i + 1]?.value === "-c" && words[i + 2]) {
            const inner = checkCmuxSurface(words[i + 2].value);
            if (inner) return inner;
        }
        if (!CMUX_WORD.test(word) || !TYPING_VERBS.has(words[i + 1]?.value)) continue;
        const start = commandStart(words, i);
        if (start < i && TEXT_COMMANDS.has(words[start].value)) continue;
        const end = invocationEnd(words, i + 2);
        const surfaces = flagValues(words, i + 2, end, "--surface");
        if (surfaces.length === 0) {
            return "[CMUX] cmux send needs --surface: without it cmux types into the caller's own pane ($CMUX_SURFACE_ID). Pass --surface surface:N or \"${W:?}\".";
        }
        for (const flag of TARGET_FLAGS) {
            const unsafe = flagValues(words, i + 2, end, flag).find((value) => !targetOk(value));
            if (unsafe !== undefined) return unsafeReason(flag, unsafe);
        }
    }
    return undefined;
}

const unsafeReason = (flag: string, value: string) =>
    `[CMUX] ${flag} is ${JSON.stringify(value)}. Each bash call is a fresh shell: variables from earlier calls are empty, and an empty target types into the user's focused pane. Write ${flag} "\${W:?}" (bash then stops if W is empty) or the literal ref (surface:N).`;

/** Reason to block a `cmux send|send-key` with an unsafe target, else undefined. */
export function checkCmuxSurface(rawCommand: string): string | undefined {
    const command = rawCommand.replace(LINE_CONTINUATION, " ");
    if (!TYPES_INTO_PANE.test(command)) return undefined;
    const empty = command.match(EMPTY_TARGET);
    if (empty) return unsafeReason(`--${empty[1]}`, "");
    const stripped = stripHeredocBodies(command);
    const segments = stripped === null ? null : tokenizeCommand(stripped);
    if (segments === null) {
        return '[CMUX] Cannot check this cmux send: a heredoc never ends, contains a cmux send, or the command has a here-string. Send in a separate command with --surface surface:N or "${W:?}".';
    }
    for (const words of segments) {
        const reason = checkSegment(words);
        if (reason) return reason;
    }
    return undefined;
}
