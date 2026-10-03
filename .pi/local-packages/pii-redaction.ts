/**
 * Reversible PII redaction for every model request.
 *
 * `context` replaces PII with stable tags before any provider (claude-bridge
 * included) and before noheadroom see the messages; `tool_call` swaps tags back
 * for local built-in tools; `message_end` shows real values to the user. The
 * compaction and branch-summary hooks cover the summary calls that skip
 * `context`. Detection runs on a local Presidio analyzer (en + de).
 *
 * Loaded as a `packages` entry, not from `.pi/extensions/`, because packages run
 * first and this must run before noheadroom. Every failure withholds text:
 * PI's runner ignores a throwing `context` handler and would send raw text.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    applyKnown,
    mapEntryTexts,
    mapMessageTexts,
    redactText,
    restoreDeep,
    restoreText,
    splitTags,
    WITHHELD,
    type Reverse,
    type Span,
} from "../extensions/lib/pii-redaction.ts";

const ANALYZER_URL = "http://127.0.0.1:5002";
const LANGUAGES = ["en", "de"];
const ENTITIES = ["EMAIL_ADDRESS", "PHONE_NUMBER", "IBAN_CODE", "CREDIT_CARD", "PERSON"];
// Phone hits score 0.4 unless an English context word is near; a higher bar
// would drop nearly every German number.
const SCORE_THRESHOLD = 0.4;
// Only local tools get real values; MCP, web, AskClaude and subagents keep tags.
const RESTORE_TOOLS = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);
// The NER model scores every PERSON hit 0.85, real names and false hits alike, so a
// threshold cannot separate them. Common words it mislabels are skipped by exact match.
const NOT_A_PERSON = new Set(["stop", "when", "done", "read-only", "docker", "claude"]);
const REQUEST_TIMEOUT_MS = 15_000;
const COOLDOWN_MS = 30_000;
const BATCH_MAX_TEXTS = 20;
const BATCH_MAX_BYTES = 200_000;
const CACHE_MAX = 5000;
const STATE_KEY = Symbol.for("pi.pii-redaction.state");
const FLAG_KEY = Symbol.for("pi.pii-redaction.flag");
// Written into a session that ran with redaction on, so reopening it without the flag stays private.
const PRIVATE_MARKER = "pii-private";

export type Analyze = (texts: string[], language: string) => Promise<Span[][]>;
export type Deps = { analyze: Analyze; keyPath: string; now?: () => number };

/** The analyzer cannot be reached; skip it for a while instead of stalling every turn. */
export class AnalyzerUnavailable extends Error {}

type State = {
    reverse: Reverse;
    cache: Map<string, string>;
    key?: Buffer;
    enabled: boolean;
    decided: boolean;
    downUntil: number;
    warned: boolean;
};

type Notify = Pick<ExtensionContext, "hasUI" | "ui">;

/**
 * One state per key file, shared by every loaded copy (project + global) and
 * in-process subagents, so a tag made by one copy restores in another.
 */
function sharedState(keyPath: string): State {
    const g = globalThis as Record<symbol, unknown>;
    const all = (g[STATE_KEY] ??= new Map<string, State>()) as Map<string, State>;
    let state = all.get(keyPath);
    if (!state) {
        state = { reverse: new Map(), cache: new Map(), enabled: true, decided: false, downUntil: 0, warned: false };
        all.set(keyPath, state);
    }
    return state;
}

function loadKey(keyPath: string): Buffer {
    const dir = path.dirname(keyPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    try {
        // "wx" so parallel sessions never overwrite each other's key.
        fs.writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const key = fs.readFileSync(keyPath);
    if (key.length !== 32) throw new Error("PII key file is not 32 bytes");
    return key;
}

const hasPrivateMarker = (ctx: Pick<ExtensionContext, "sessionManager">) =>
    ctx.sessionManager.getBranch().some((entry) => entry.type === "custom" && entry.customType === PRIVATE_MARKER);

const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

function parseSpans(body: unknown, count: number): Span[][] {
    if (!Array.isArray(body) || body.length !== count) throw new Error("analyzer returned an unexpected shape");
    return body.map((hits) => {
        if (!Array.isArray(hits)) throw new Error("analyzer returned an unexpected shape");
        return hits.map((h) => {
            const { entity_type, start, end, score } = h ?? {};
            if (typeof entity_type !== "string" || !Number.isInteger(start) || !Number.isInteger(end) || typeof score !== "number") {
                throw new Error("analyzer returned an unexpected span");
            }
            return { entity_type, start, end, score };
        });
    });
}

export function httpAnalyzer(url: string): Analyze {
    return async (texts, language) => {
        let response: Response;
        try {
            response = await fetch(`${url}/analyze`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text: texts, language, entities: ENTITIES, score_threshold: SCORE_THRESHOLD }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch {
            throw new AnalyzerUnavailable("PII analyzer unreachable");
        }
        if (!response.ok) throw new Error(`PII analyzer HTTP ${response.status}`);
        return parseSpans(await response.json(), texts.length);
    };
}

type Pending = { text: string; parts: string[]; plain: number[] };

export function createPiiRedaction(deps: Deps) {
    const now = deps.now ?? Date.now;

    return function piiRedaction(pi: ExtensionAPI): void {
        const state = sharedState(deps.keyPath);

        const warn = (ctx: Notify | undefined, message: string) => {
            if (state.warned) return;
            state.warned = true;
            if (ctx?.hasUI) ctx.ui.notify(message, "warning");
        };

        // The output is cached as its own fixed point, so a second loaded copy
        // re-running on already-redacted text costs no analyzer call.
        const remember = (text: string, redacted: string) => {
            state.cache.set(hashText(text), redacted);
            state.cache.set(hashText(redacted), redacted);
            for (const oldest of state.cache.keys()) {
                if (state.cache.size <= CACHE_MAX) break;
                state.cache.delete(oldest);
            }
        };

        /** Redacts one batch; spans from both languages are merged per text. */
        const redactBatch = async (batch: Pending[], key: Buffer, out: Map<string, string>) => {
            const plains = batch.flatMap((p) => p.plain.map((i) => p.parts[i] ?? ""));
            const perLanguage = await Promise.all(LANGUAGES.map((lang) => deps.analyze(plains, lang)));
            let cursor = 0;
            for (const p of batch) {
                const parts = [...p.parts];
                for (const i of p.plain) {
                    const chars = [...(parts[i] ?? "")];
                    const spans = perLanguage
                        .flatMap((result) => result[cursor] ?? [])
                        .filter((h) => h.entity_type !== "PERSON" || !NOT_A_PERSON.has(chars.slice(h.start, h.end).join("").trim().toLowerCase()));
                    parts[i] = redactText(parts[i] ?? "", spans, key, state.reverse);
                    cursor += 1;
                }
                const redacted = parts.join("");
                out.set(p.text, redacted);
                remember(p.text, redacted);
            }
        };

        const batchesOf = (pending: Pending[]) => {
            const batches: Pending[][] = [];
            let current: Pending[] = [];
            let texts = 0;
            let bytes = 0;
            for (const p of pending) {
                const size = p.plain.reduce((sum, i) => sum + Buffer.byteLength(p.parts[i] ?? ""), 0);
                if (current.length && (texts + p.plain.length > BATCH_MAX_TEXTS || bytes + size > BATCH_MAX_BYTES)) {
                    batches.push(current);
                    current = [];
                    texts = 0;
                    bytes = 0;
                }
                current.push(p);
                texts += p.plain.length;
                bytes += size;
            }
            if (current.length) batches.push(current);
            return batches;
        };

        /** Never throws. Returns the redacted text per input and whether anything was withheld. */
        const redactTexts = async (texts: string[], ctx: Notify | undefined) => {
            const out = new Map<string, string>();
            const pending: Pending[] = [];
            for (const text of new Set(texts)) {
                if (!text.trim()) {
                    out.set(text, text);
                    continue;
                }
                const cached = state.cache.get(hashText(text));
                if (cached !== undefined) {
                    out.set(text, applyKnown(cached, state.reverse));
                    continue;
                }
                const parts = splitTags(applyKnown(text, state.reverse));
                const plain = parts.flatMap((part, i) => (i % 2 === 0 && part.trim() ? [i] : []));
                if (plain.length === 0) out.set(text, parts.join(""));
                else pending.push({ text, parts, plain });
            }

            let key = state.key;
            if (pending.length && !key) {
                try {
                    key = state.key = loadKey(deps.keyPath);
                } catch {
                    warn(ctx, "PII redaction: key file unusable, content withheld.");
                }
            }
            for (const batch of batchesOf(pending)) {
                if (!key || now() < state.downUntil) break;
                try {
                    await redactBatch(batch, key, out);
                    state.warned = false;
                } catch (err) {
                    if (err instanceof AnalyzerUnavailable) {
                        state.downUntil = now() + COOLDOWN_MS;
                        warn(ctx, "PII redaction: analyzer unavailable, content withheld. Start it with `npm run presidio:up`.");
                        break;
                    }
                    // One rejected text must not withhold the whole batch.
                    for (const p of batch) {
                        try {
                            await redactBatch([p], key, out);
                        } catch {
                            // left unset: withheld below
                        }
                    }
                }
            }

            let withheld = false;
            for (const text of texts) {
                if (!out.has(text)) {
                    out.set(text, WITHHELD);
                    withheld = true;
                }
            }
            return { out, withheld };
        };

        /** Collects every text a walk visits, redacts them in one go, then walks again to replace them. */
        const redactWalk = async <T>(walk: (fn: (text: string) => string) => T, ctx: Notify | undefined) => {
            const texts: string[] = [];
            walk((text) => {
                texts.push(text);
                return text;
            });
            const { out, withheld } = await redactTexts(texts, ctx);
            return { value: walk((text) => out.get(text) ?? WITHHELD), withheld };
        };

        // Both the project and the global copy load; only one may register the flag.
        const g = globalThis as Record<symbol, unknown>;
        const registersFlag = !g[FLAG_KEY];
        g[FLAG_KEY] = true;
        if (registersFlag) {
            pi.registerFlag("private", { description: "Enable PII redaction (needs the Presidio analyzer)", type: "boolean", default: false });
        }

        const markPrivate = (ctx: Pick<ExtensionContext, "sessionManager">) => {
            if (!hasPrivateMarker(ctx)) pi.appendEntry(PRIVATE_MARKER, {});
        };

        pi.on("session_start", (_event, ctx) => {
            // Decided once: later starts (subagents, /new, /resume) never switch it off.
            if (registersFlag && !state.decided) {
                state.decided = true;
                state.enabled = pi.getFlag("private") === true;
            }
            if (hasPrivateMarker(ctx)) state.enabled = true;
            // Before the decision `enabled` is only the fail-safe default, not a choice to record.
            if (state.decided && state.enabled) markPrivate(ctx);
        });

        pi.on("context", async (event, ctx) => {
            if (!state.enabled) return;
            try {
                const { value } = await redactWalk((fn) => mapMessageTexts(event.messages, fn), ctx);
                return { messages: value };
            } catch {
                warn(ctx, "PII redaction failed, content withheld.");
                return { messages: mapMessageTexts(event.messages, () => WITHHELD) };
            }
        });

        pi.on("session_before_compact", async (event, ctx) => {
            if (!state.enabled) return;
            const prep = event.preparation;
            try {
                const { value, withheld } = await redactWalk(
                    (fn) => ({
                        messagesToSummarize: mapMessageTexts(prep.messagesToSummarize, fn),
                        turnPrefixMessages: mapMessageTexts(prep.turnPrefixMessages, fn),
                        previousSummary: prep.previousSummary === undefined ? undefined : fn(prep.previousSummary),
                    }),
                    ctx,
                );
                if (withheld) return cancelSummary(ctx);
                Object.assign(prep, value);
            } catch {
                return cancelSummary(ctx);
            }
        });

        pi.on("session_before_tree", async (event, ctx) => {
            if (!state.enabled || !event.preparation.userWantsSummary) return;
            // PI summarizes this exact array, so its elements are replaced; the session's entries stay untouched.
            const entries = event.preparation.entriesToSummarize;
            try {
                const { value, withheld } = await redactWalk((fn) => entries.map((entry) => mapEntryTexts(entry, fn)), ctx);
                if (withheld) return cancelSummary(ctx);
                entries.splice(0, entries.length, ...value);
            } catch {
                return cancelSummary(ctx);
            }
        });

        const cancelSummary = (ctx: Notify) => {
            warn(ctx, "PII redaction: summary cancelled, analyzer unavailable.");
            return { cancel: true };
        };

        pi.on("tool_call", (event) => {
            if (!state.enabled || !RESTORE_TOOLS.has(event.toolName)) return;
            const { value, unknown } = restoreDeep(event.input, state.reverse);
            if (unknown.length) return { block: true, reason: `Unknown PII tag ${unknown[0]}; ask the user for the value.` };
            Object.assign(event.input, value);
        });

        pi.on("message_end", (event) => {
            const message = event.message;
            if (!state.enabled || message.role !== "assistant") return;
            const content = message.content.map((part) =>
                part.type === "text" ? { ...part, text: restoreText(part.text, state.reverse) } : part,
            );
            return { message: { ...message, content } };
        });

        pi.registerCommand("pii", {
            description: "PII redaction: on | off | status",
            handler: async (args, ctx) => {
                const arg = args.trim();
                if (arg === "on" || arg === "off") state.enabled = arg === "on";
                if (state.enabled && arg === "on") markPrivate(ctx);
                const analyzer = now() < state.downUntil ? "down" : "ok";
                ctx.ui.notify(`PII redaction ${state.enabled ? "on" : "off"} · analyzer ${analyzer} · ${state.reverse.size} tags`, "info");
            },
        });
    };
}

const defaultKeyPath = () => path.join(os.homedir(), ".local", "state", "pi-pii-redaction", "hmac.key");

export default createPiiRedaction({ analyze: httpAnalyzer(ANALYZER_URL), keyPath: defaultKeyPath() });
