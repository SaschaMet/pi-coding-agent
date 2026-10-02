/**
 * Pure tag/restore logic for reversible PII redaction. No I/O: the analyzer,
 * key file, and PI wiring live in the pii-redaction package.
 *
 * A tag is `<pii:TYPE:` + 12 hex of HMAC-SHA256(key, value) + `>`. The same value
 * always gets the same tag, so resumed sessions and count-based history reuse
 * in claude-bridge keep seeing identical text.
 */
import { createHmac } from "node:crypto";

export const TAG_RE = /<pii:([A-Z_]+):([0-9a-f]{12})>/g;
export const WITHHELD = "[pii-redaction: withheld, analyzer unavailable]";
export type Span = { entity_type: string; start: number; end: number; score: number };
/** tag → original value */
export type Reverse = Map<string, string>;

const TAG_SPLIT_RE = /(<pii:[A-Z_]+:[0-9a-f]{12}>)/;

export function makeTag(type: string, value: string, key: Buffer): string {
    const safeType = /^[A-Z_]+$/.test(type) ? type : "PII";
    const mac = createHmac("sha256", key).update(value).digest("hex").slice(0, 12);
    return `<pii:${safeType}:${mac}>`;
}

const outranks = (a: Span, b: Span) => a.end - a.start > b.end - b.start || (a.end - a.start === b.end - b.start && a.score > b.score);

/**
 * Joins overlapping spans into one covering span, so every character any
 * recognizer flagged is hidden. The type comes from the longest member (tie:
 * higher score); the score is the highest member score.
 */
export function mergeSpans(spans: Span[]): Span[] {
    const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
    const merged: Array<Span & { lead: Span }> = [];
    for (const s of sorted) {
        const last = merged[merged.length - 1];
        if (last && s.start < last.end) {
            last.end = Math.max(last.end, s.end);
            last.score = Math.max(last.score, s.score);
            if (outranks(s, last.lead)) {
                last.lead = s;
                last.entity_type = s.entity_type;
            }
        } else {
            merged.push({ ...s, lead: s });
        }
    }
    return merged.map(({ lead: _lead, ...span }) => span);
}

/** Presidio reports Python code-point offsets; JS strings index UTF-16 units. */
function codePointToUtf16(text: string): number[] {
    const map: number[] = [];
    let unit = 0;
    for (const char of text) {
        map.push(unit);
        unit += char.length;
    }
    map.push(unit);
    return map;
}

export function redactText(text: string, spans: Span[], key: Buffer, reverse: Reverse): string {
    const map = codePointToUtf16(text);
    let out = text;
    // Right to left, so earlier offsets stay valid after each replacement.
    for (const s of mergeSpans(spans).sort((a, b) => b.start - a.start)) {
        const start = map[s.start];
        const end = map[s.end];
        if (start === undefined || end === undefined) throw new Error("PII span out of range");
        const value = text.slice(start, end);
        const tag = makeTag(s.entity_type, value, key);
        const known = reverse.get(tag);
        if (known !== undefined && known !== value) throw new Error("PII tag collision");
        reverse.set(tag, value);
        out = out.slice(0, start) + tag + out.slice(end);
    }
    return out;
}

/** Alternates plain text (even indices) and tags (odd indices). */
export function splitTags(text: string): string[] {
    return text.split(TAG_SPLIT_RE);
}

function mapPlain(text: string, fn: (plain: string) => string): string {
    return splitTags(text)
        .map((part, i) => (i % 2 === 0 ? fn(part) : part))
        .join("");
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Re-tags values seen before, so a value stays hidden even when NER misses it later. */
export function applyKnown(text: string, reverse: Reverse): string {
    const entries = [...reverse.entries()].sort((a, b) => b[1].length - a[1].length);
    let out = text;
    for (const [tag, value] of entries) {
        if (!out.includes(value)) continue;
        const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`, "gu");
        out = mapPlain(out, (plain) => plain.replace(re, () => tag));
    }
    return out;
}

export function restoreText(text: string, reverse: Reverse): string {
    return text.replace(TAG_RE, (tag) => reverse.get(tag) ?? tag);
}

/** Returns a copy of `v` with `fn` applied to every string leaf; the shape is unchanged. */
function mapStrings<T>(v: T, fn: (text: string) => string): T {
    if (typeof v === "string") return fn(v) as T;
    if (Array.isArray(v)) return v.map((child) => mapStrings(child, fn)) as T;
    if (v && typeof v === "object") {
        return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, mapStrings(child, fn)])) as T;
    }
    return v;
}

export function restoreDeep<T>(value: T, reverse: Reverse): { value: T; unknown: string[] } {
    const unknown: string[] = [];
    const restored = mapStrings(value, (text) =>
        text.replace(TAG_RE, (tag) => {
            const real = reverse.get(tag);
            if (real === undefined) unknown.push(tag);
            return real ?? tag;
        }),
    );
    return { value: restored, unknown };
}

type Part = { type: string; text?: string; arguments?: unknown };

type Content = string | Part[];

function mapContent(content: Content, fn: (text: string) => string): Content {
    if (typeof content === "string") return fn(content);
    if (!Array.isArray(content)) return content;
    return content.map((part) => {
        if (part?.type === "text" && typeof part.text === "string") return { ...part, text: fn(part.text) };
        if (part?.type === "toolCall") return { ...part, arguments: mapStrings(part.arguments, fn) };
        return part;
    });
}

/** Same as `mapMessageTexts`, for the session-entry fields a branch summary sends to the model. */
export function mapEntryTexts<T>(entry: T, fn: (text: string) => string): T {
    const e = entry as Record<string, unknown>;
    switch (e.type) {
        case "message":
            return { ...e, message: mapMessageTexts([e.message], fn)[0] } as T;
        case "custom_message":
            return { ...e, content: mapContent(e.content as Content, fn) } as T;
        case "branch_summary":
        case "compaction":
            return { ...e, summary: fn(String(e.summary ?? "")) } as T;
        default:
            return entry;
    }
}

/**
 * Applies `fn` to every model-visible text field. Never adds or drops a message
 * and never changes roles, ids, thinking, signatures, or images. Unknown roles
 * have every string withheld: their shape is unknown, so nothing passes raw.
 */
export function mapMessageTexts<T>(messages: T[], fn: (text: string) => string): T[] {
    return messages.map((message) => {
        const m = message as Record<string, unknown>;
        switch (m.role) {
            case "user":
            case "custom":
            case "assistant":
            case "toolResult":
                return { ...m, content: mapContent(m.content as Content, fn) } as T;
            case "bashExecution":
                if (m.excludeFromContext) return message;
                return { ...m, command: fn(String(m.command ?? "")), output: fn(String(m.output ?? "")) } as T;
            case "compactionSummary":
            case "branchSummary":
                return { ...m, summary: fn(String(m.summary ?? "")) } as T;
            default:
                return Object.fromEntries(
                    Object.entries(m).map(([k, v]) => [k, k === "role" ? v : mapStrings(v, () => WITHHELD)]),
                ) as T;
        }
    });
}
