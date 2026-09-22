import path from "node:path";
import { isWithinRoot, resolvePathWithRealAncestor, systemTempRoots } from "./extension-helpers.ts";

/**
 * Bash command parsing: which paths a shell command plausibly mutated. Kept
 * separate from the checks in `gate-checks.ts` that consume the result.
 */

export type BashMutation = {
    path: string;
};

/** Shell metacharacters a mutated-path token must never contain. */
const BASH_MUTATION_METACHARS = /[$(){}<>&;"'`\\|]/;
const REDIRECT_TARGETS = new Set([">", ">>", "2>", "&>"]);
const MUTATION_COMMANDS = new Set(["touch", "tee", "mkdir", "mv", "rm", "ln"]);

type Token = { value: string; quoted: boolean };

/**
 * Quote-aware single-pass tokenizer. Splits the whole command into segments on
 * unquoted `;`, `|`, `||`, `&&` and newline only — a delimiter inside quotes
 * never splits, unlike a pre-tokenize regex split. Returns `null` for a command
 * containing an unquoted `<<`: a heredoc body cannot be told apart from real
 * arguments, so the whole command is skipped rather than misread.
 */
function tokenizeCommand(command: string): Token[][] | null {
    const segments: Token[][] = [];
    let currentSegment: Token[] = [];
    let current = "";
    let currentQuoted = false;
    let quote: string | undefined;

    const flushWord = () => {
        if (current.length > 0) {
            currentSegment.push({ value: current, quoted: currentQuoted });
            current = "";
            currentQuoted = false;
        }
    };
    const flushSegment = () => {
        flushWord();
        if (currentSegment.length > 0) segments.push(currentSegment);
        currentSegment = [];
    };

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (quote !== undefined) {
            if (ch === quote) quote = undefined;
            else current += ch;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            currentQuoted = true;
            continue;
        }
        if (ch === "<" && command[i + 1] === "<") return null;
        if (ch === "\n" || ch === ";") {
            flushSegment();
            continue;
        }
        if (ch === "|") {
            if (command[i + 1] === "|") i++;
            flushSegment();
            continue;
        }
        if (ch === "&" && command[i + 1] === "&") {
            i++;
            flushSegment();
            continue;
        }
        if (/\s/.test(ch)) {
            flushWord();
            continue;
        }
        current += ch;
    }
    flushSegment();
    return segments;
}

function isPathLike(token: string): boolean {
    if (token.length === 0 || token.length > 200) return false;
    if (token.startsWith("-")) return false;
    return !BASH_MUTATION_METACHARS.test(token);
}

/** /dev/* and system-temp-root targets are routine noise, not reportable mutations. */
function isExemptPath(targetPath: string): boolean {
    if (!path.isAbsolute(targetPath)) return false;
    const resolved = resolvePathWithRealAncestor(targetPath);
    if (isWithinRoot(resolved, "/dev")) return true;
    return systemTempRoots().some((root) => isWithinRoot(resolved, root));
}

/**
 * Conservative allowlist extraction of file paths a shell command plausibly
 * mutated: redirections, `sed -i`, `mv`, `git mv`, `cp`, `rm`, `touch`, `tee`,
 * `mkdir`, `ln`. Anything unrecognized yields nothing (fail-open — a missed
 * form degrades to today's behavior, never to a false block).
 */
export function extractBashMutations(command: string): BashMutation[] {
    const segments = tokenizeCommand(command);
    if (segments === null) return [];

    const mutations: BashMutation[] = [];
    const push = (rawPath: string): void => {
        if (!isPathLike(rawPath) || isExemptPath(rawPath)) return;
        mutations.push({ path: rawPath });
    };

    for (const tokens of segments) {
        for (let i = 0; i < tokens.length - 1; i++) {
            if (!tokens[i].quoted && REDIRECT_TARGETS.has(tokens[i].value)) {
                push(tokens[i + 1].value);
            }
        }

        const values = tokens.map((token) => token.value);
        const [head, ...rest] = values;
        let args: string[] | undefined;
        if (head === "git" && rest[0] === "mv") {
            args = rest.slice(1);
        } else if (MUTATION_COMMANDS.has(head)) {
            args = rest;
        } else if (head === "sed") {
            if (!rest.includes("-i")) continue;
            const pathLike = rest.filter(isPathLike);
            // sed [-i] script file...: the file operand is last; the script is not a path.
            if (pathLike.length > 0) push(pathLike[pathLike.length - 1]);
            continue;
        } else if (head === "cp") {
            // cp sources and destination are all recorded (source inclusion is deliberate).
            for (const arg of rest.filter(isPathLike)) push(arg);
            continue;
        }
        if (args === undefined) continue;
        for (const arg of args) push(arg);
    }
    return mutations;
}
