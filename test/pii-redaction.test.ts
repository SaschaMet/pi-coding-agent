import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import piiRedactionDefault, {
    AnalyzerUnavailable,
    createPiiRedaction,
    type Analyze,
} from "../.pi/local-packages/pii-redaction.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";
import {
    applyKnown,
    makeTag,
    mapEntryTexts,
    mapMessageTexts,
    mergeSpans,
    redactText,
    restoreDeep,
    restoreText,
    splitTags,
    WITHHELD,
    type Reverse,
} from "../.pi/extensions/lib/pii-redaction.ts";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const EMAIL = "max.mustermann@example.de";

function span(text: string, value: string, entity_type = "EMAIL_ADDRESS", score = 1) {
    // Presidio offsets are code points, not UTF-16 units.
    const cpStart = [...text.slice(0, text.indexOf(value))].length;
    return { entity_type, start: cpStart, end: cpStart + [...value].length, score };
}

describe("pii-redaction core", () => {
    it("tags a detected email with a stable HMAC tag", () => {
        const text = `Login as ${EMAIL}`;
        const reverse: Reverse = new Map();
        const out = redactText(text, [span(text, EMAIL)], KEY, reverse);
        expect(out).toMatch(/^Login as <pii:EMAIL_ADDRESS:[0-9a-f]{12}>$/);
        expect(out).not.toContain(EMAIL);
        expect(reverse.get(out.slice("Login as ".length))).toBe(EMAIL);
    });

    it("produces the same tag for the same value and key, and a different one for another key", () => {
        expect(makeTag("EMAIL_ADDRESS", EMAIL, KEY)).toBe(makeTag("EMAIL_ADDRESS", EMAIL, KEY));
        expect(makeTag("EMAIL_ADDRESS", EMAIL, KEY)).not.toBe(makeTag("EMAIL_ADDRESS", EMAIL, OTHER_KEY));
    });

    it("converts code-point offsets so an astral character before an email still tags exactly the email", () => {
        const text = `😀 mail ${EMAIL} end`;
        const out = redactText(text, [span(text, EMAIL)], KEY, new Map());
        expect(out).toBe(`😀 mail ${makeTag("EMAIL_ADDRESS", EMAIL, KEY)} end`);
    });

    it("lets the longer span win when en and de hits overlap", () => {
        const merged = mergeSpans([
            { entity_type: "PERSON", start: 0, end: 4, score: 0.85 },
            { entity_type: "PERSON", start: 0, end: 11, score: 0.85 },
            { entity_type: "PHONE_NUMBER", start: 20, end: 30, score: 0.4 },
            { entity_type: "IBAN_CODE", start: 20, end: 30, score: 1 },
        ]);
        expect(merged).toHaveLength(2);
        expect(merged.find((s) => s.start === 0)?.end).toBe(11);
        expect(merged.find((s) => s.start === 20)?.entity_type).toBe("IBAN_CODE");
    });

    it("joins partly overlapping spans so no flagged character stays raw", () => {
        const merged = mergeSpans([
            { entity_type: "PERSON", start: 0, end: 10, score: 0.85 },
            { entity_type: "PHONE_NUMBER", start: 8, end: 20, score: 0.4 },
        ]);
        expect(merged).toEqual([{ entity_type: "PHONE_NUMBER", start: 0, end: 20, score: 0.85 }]);
    });

    it("throws on a tag collision instead of mapping one tag to two values", () => {
        const text = `Login as ${EMAIL}`;
        const tag = makeTag("EMAIL_ADDRESS", EMAIL, KEY);
        const reverse: Reverse = new Map([[tag, "someone.else@example.de"]]);
        expect(() => redactText(text, [span(text, EMAIL)], KEY, reverse)).toThrow();
    });

    it("splits existing tags out so only plain text is analyzed", () => {
        const tag = makeTag("PERSON", "Hans Müller", KEY);
        const parts = splitTags(`hi ${tag} and ${EMAIL}`);
        expect(parts).toEqual(["hi ", tag, ` and ${EMAIL}`]);
    });

    it("re-tags a known value even when the analyzer misses it", () => {
        const tag = makeTag("PERSON", "Hans Müller", KEY);
        const reverse: Reverse = new Map([[tag, "Hans Müller"]]);
        expect(applyKnown("Danke, Hans Müller!", reverse)).toBe(`Danke, ${tag}!`);
        expect(applyKnown("Hans Müllerstraße", reverse)).toBe("Hans Müllerstraße");
        expect(applyKnown(`already ${tag}`, reverse)).toBe(`already ${tag}`);
    });

    it("restores known tags deeply and reports unknown ones", () => {
        const tag = makeTag("EMAIL_ADDRESS", EMAIL, KEY);
        const unknownTag = makeTag("EMAIL_ADDRESS", "x@y.de", OTHER_KEY);
        const reverse: Reverse = new Map([[tag, EMAIL]]);
        const input = { command: `login ${tag}`, list: [[`a ${tag}`], 3], other: unknownTag };
        const { value, unknown } = restoreDeep(input, reverse);
        expect(value).toEqual({ command: `login ${EMAIL}`, list: [[`a ${EMAIL}`], 3], other: unknownTag });
        expect(unknown).toEqual([unknownTag]);
        expect(input.command).toBe(`login ${tag}`);
        expect(restoreText(`hi ${tag}`, reverse)).toBe(`hi ${EMAIL}`);
    });

    it("maps text fields per role and keeps thinking, signatures, ids and images", () => {
        const up = (s: string) => s.toUpperCase();
        const image = { type: "image", data: "abc", mimeType: "image/png" };
        const messages = [
            { role: "user", content: "hello", timestamp: 1 },
            { role: "user", content: [{ type: "text", text: "hi" }, image], timestamp: 1 },
            { role: "custom", customType: "x", content: "note", display: true, timestamp: 1 },
            {
                role: "assistant",
                content: [
                    { type: "thinking", thinking: "secret", thinkingSignature: "sig" },
                    { type: "text", text: "answer", textSignature: "tsig" },
                    { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "echo", n: 1, nested: ["deep"] } },
                ],
                timestamp: 1,
            },
            { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "out" }, image], isError: false, timestamp: 1 },
            { role: "bashExecution", command: "ls", output: "files", exitCode: 0, cancelled: false, truncated: false, timestamp: 1 },
            { role: "compactionSummary", summary: "sum", tokensBefore: 1, timestamp: 1 },
            { role: "branchSummary", summary: "branch", fromId: null, timestamp: 1 },
            { role: "mystery", payload: "raw", timestamp: 1 },
        ];
        const out = mapMessageTexts(messages as any[], up) as any[];
        expect(out.map((m) => m.role)).toEqual(messages.map((m) => m.role));
        expect(out[0].content).toBe("HELLO");
        expect(out[1].content).toEqual([{ type: "text", text: "HI" }, image]);
        expect(out[2].content).toBe("NOTE");
        expect(out[3].content[0]).toEqual({ type: "thinking", thinking: "secret", thinkingSignature: "sig" });
        expect(out[3].content[1]).toEqual({ type: "text", text: "ANSWER", textSignature: "tsig" });
        expect(out[3].content[2]).toEqual({ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ECHO", n: 1, nested: ["DEEP"] } });
        expect(out[4].content).toEqual([{ type: "text", text: "OUT" }, image]);
        expect(out[4].toolCallId).toBe("call_1");
        expect([out[5].command, out[5].output]).toEqual(["LS", "FILES"]);
        expect(out[6].summary).toBe("SUM");
        expect(out[7].summary).toBe("BRANCH");
        expect(out[8].payload).toBe(WITHHELD);
        expect((messages[0] as any).content).toBe("hello");
    });

    it("maps the session-entry fields a branch summary reads", () => {
        const up = (s: string) => s.toUpperCase();
        const message = { type: "message", id: "e1", message: { role: "user", content: "hi", timestamp: 1 } };
        expect(mapEntryTexts(message, up)).toEqual({ ...message, message: { ...message.message, content: "HI" } });
        const custom = { type: "custom_message", id: "e2", customType: "x", content: [{ type: "text", text: "note" }] };
        expect(mapEntryTexts(custom, up)).toEqual({ ...custom, content: [{ type: "text", text: "NOTE" }] });
        const compaction = { type: "compaction", id: "e3", summary: "sum" };
        expect(mapEntryTexts(compaction, up)).toEqual({ ...compaction, summary: "SUM" });
        const label = { type: "label", id: "e4", label: "keep" };
        expect(mapEntryTexts(label, up)).toBe(label);
        expect(message.message.content).toBe("hi");
    });
});

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;

/** Finds emails in every language and "Hans Müller" only in German, like real NER. */
function fakeSpans(text: string, language: string) {
    const spans = [...text.matchAll(EMAIL_RE)].map((m) => span(text, m[0]));
    if (language === "de" && text.includes("Hans Müller")) spans.push(span(text, "Hans Müller", "PERSON", 0.85));
    return spans;
}

function setup(overrides: { analyze?: Analyze; now?: () => number; keyPath?: string; flags?: Record<string, boolean | string> } = {}) {
    const analyze = vi.fn(overrides.analyze ?? (async (texts: string[], language: string) => texts.map((t) => fakeSpans(t, language))));
    const fake = createFakePi({ flags: overrides.flags });
    const keyPath = overrides.keyPath ?? path.join(tmp, "state", "hmac.key");
    createPiiRedaction({ analyze, keyPath, now: overrides.now })(asExtensionAPI(fake));
    const handler = (name: string) => fake.handlers.get(name)?.[0] as (event: any, ctx: any) => any;
    return { fake, analyze, keyPath, handler };
}

const newCtx = (entries: any[] = []) => ({ hasUI: true, ui: { notify: vi.fn() }, sessionManager: { getBranch: () => entries } });
const startSession = (handler: (event: any, ctx: any) => any, ctx: any) => handler({ type: "session_start", reason: "startup" }, ctx);
const RAW = [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }];

let tmp = "";
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pii-redaction-"));
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.state")];
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.flag")];
});
afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function runContext(handler: (event: any, ctx: any) => any, messages: any[], ctx = newCtx()) {
    const result = await handler({ type: "context", messages }, ctx);
    return { messages: (result?.messages ?? messages) as any[], ctx };
}

describe("pii-redaction extension", () => {
    it("is registered as a package that loads before noheadroom", () => {
        const settings = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".pi", "settings.json"), "utf8"));
        const packages: string[] = settings.packages;
        const pii = packages.indexOf("./local-packages/pii-redaction.ts");
        const noheadroom = packages.findIndex((p) => p.startsWith("npm:@raquezha/noheadroom"));
        expect(pii).toBeGreaterThanOrEqual(0);
        expect(pii).toBeLessThan(noheadroom);
    });

    it("default export is an extension factory", () => {
        expect(typeof piiRedactionDefault).toBe("function");
    });

    it("redacts prompts and tool results with both languages", async () => {
        const { handler, analyze } = setup();
        const { messages } = await runContext(handler("context"), [
            { role: "user", content: `Login as ${EMAIL}`, timestamp: 1 },
            { role: "toolResult", toolCallId: "c", toolName: "bash", content: [{ type: "text", text: "Ich bin Hans Müller" }], isError: false, timestamp: 1 },
        ]);
        expect(messages[0].content).toMatch(/^Login as <pii:EMAIL_ADDRESS:[0-9a-f]{12}>$/);
        expect(messages[1].content[0].text).toMatch(/^Ich bin <pii:PERSON:[0-9a-f]{12}>$/);
        expect(analyze.mock.calls.map((c) => c[1]).sort()).toEqual(["de", "en"]);
    });

    it("withholds uncached text when the analyzer is down, warns once, and cools down", async () => {
        let now = 0;
        let down = false;
        const { handler, analyze } = setup({
            now: () => now,
            analyze: async (texts, language) => {
                if (down) throw new AnalyzerUnavailable("down");
                return texts.map((t) => fakeSpans(t, language));
            },
        });
        const ctx = newCtx();
        const cached = { role: "user", content: `Login as ${EMAIL}`, timestamp: 1 };
        await runContext(handler("context"), [cached]);
        down = true;
        const fresh = { role: "user", content: "mail other@example.de", timestamp: 2 };
        const first = await runContext(handler("context"), [cached, fresh], ctx);
        expect(first.messages[0].content).toMatch(/<pii:EMAIL_ADDRESS:/);
        expect(first.messages[1].content).toBe(WITHHELD);
        const callsAfterOutage = analyze.mock.calls.length;
        const second = await runContext(handler("context"), [cached, fresh], ctx);
        expect(second.messages[1].content).toBe(WITHHELD);
        expect(analyze.mock.calls.length).toBe(callsAfterOutage);
        expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
        now = 31_000;
        down = false;
        const third = await runContext(handler("context"), [cached, fresh], ctx);
        expect(third.messages[1].content).toMatch(/^mail <pii:EMAIL_ADDRESS:/);
    });

    it("withholds only the text the analyzer rejects", async () => {
        const { handler } = setup({
            analyze: async (texts, language) => {
                if (texts.some((t) => t.includes("POISON"))) throw new Error("analyzer HTTP 500");
                return texts.map((t) => fakeSpans(t, language));
            },
        });
        const { messages } = await runContext(handler("context"), [
            { role: "user", content: `Login as ${EMAIL}`, timestamp: 1 },
            { role: "user", content: "POISON text", timestamp: 2 },
        ]);
        expect(messages[0].content).toMatch(/^Login as <pii:EMAIL_ADDRESS:/);
        expect(messages[1].content).toBe(WITHHELD);
    });

    it("sends at most 20 texts per analyzer request", async () => {
        const { handler, analyze } = setup();
        const messages = Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `text ${i}`, timestamp: i }));
        await runContext(handler("context"), messages);
        expect(Math.max(...analyze.mock.calls.map((c) => c[0].length))).toBeLessThanOrEqual(20);
        expect(analyze.mock.calls.every((c) => c[0].length > 0 && c[0].every((t: string) => t.length > 0))).toBe(true);
    });

    it("restores known tags for built-in tools and blocks unknown ones", async () => {
        const { handler } = setup();
        const { messages } = await runContext(handler("context"), [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }]);
        const tag = messages[0].content.slice("Login as ".length);
        const call = { type: "tool_call", toolCallId: "c1", toolName: "bash", input: { command: `echo ${tag}`, env: [[tag]] } };
        expect(await handler("tool_call")(call, newCtx())).toBeUndefined();
        expect(call.input).toEqual({ command: `echo ${EMAIL}`, env: [[EMAIL]] });

        const unknownTag = makeTag("EMAIL_ADDRESS", "x@y.de", OTHER_KEY);
        const bad = { type: "tool_call", toolCallId: "c2", toolName: "write", input: { path: "a", content: `${tag} ${unknownTag}` } };
        const result = await handler("tool_call")(bad, newCtx());
        expect(result).toMatchObject({ block: true });
        expect(bad.input.content).toBe(`${tag} ${unknownTag}`);

        const ask = { type: "tool_call", toolCallId: "c3", toolName: "AskClaude", input: { prompt: `${tag} ${unknownTag}` } };
        expect(await handler("tool_call")(ask, newCtx())).toBeUndefined();
        expect(ask.input.prompt).toBe(`${tag} ${unknownTag}`);
    });

    it("shows real values in assistant text and keeps thinking and tool calls", async () => {
        const { handler } = setup();
        const { messages } = await runContext(handler("context"), [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }]);
        const tag = messages[0].content.slice("Login as ".length);
        const thinking = { type: "thinking", thinking: `t ${tag}`, thinkingSignature: "s" };
        const toolCall = { type: "toolCall", id: "c", name: "bash", arguments: { command: tag } };
        const message = { role: "assistant", content: [thinking, { type: "text", text: `Your login is ${tag}` }, toolCall], timestamp: 2 };
        const result = await handler("message_end")({ type: "message_end", message }, newCtx());
        expect(result.message.content).toEqual([thinking, { type: "text", text: `Your login is ${EMAIL}` }, toolCall]);
    });

    it("re-tags a restored value even when the analyzer misses it later", async () => {
        const { handler } = setup();
        const first = await runContext(handler("context"), [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }]);
        const tag = first.messages[0].content.slice("Login as ".length);
        const { messages } = await runContext(handler("context"), [
            { role: "assistant", content: [{ type: "text", text: `max.mustermann@example.de works` }], timestamp: 2 },
        ]);
        expect(messages[0].content[0].text).toBe(`${tag} works`);
    });

    it("stays off after a flagless session_start and makes no analyzer call", async () => {
        const { handler, analyze } = setup();
        await startSession(handler("session_start"), newCtx());
        expect((await runContext(handler("context"), RAW)).messages[0].content).toBe(`Login as ${EMAIL}`);
        expect(analyze).not.toHaveBeenCalled();
    });

    it("redacts after a session_start with --private", async () => {
        const { handler } = setup({ flags: { private: true } });
        await startSession(handler("session_start"), newCtx());
        expect((await runContext(handler("context"), RAW)).messages[0].content).toMatch(/<pii:EMAIL_ADDRESS:/);
    });

    it("/pii on after a flagless start redacts and marks the session", async () => {
        const { fake, handler } = setup();
        const ctx = newCtx(fake.entries);
        await startSession(handler("session_start"), ctx);
        await fake.commands.get("pii")!.handler("on", ctx);
        expect((await runContext(handler("context"), RAW)).messages[0].content).toMatch(/<pii:EMAIL_ADDRESS:/);
        expect(fake.entries.map((e: any) => e.customType)).toEqual(["pii-private"]);
    });

    it("/pii off passes messages through, status reports it, and a later session_start keeps it off", async () => {
        const { fake, handler } = setup({ flags: { private: true } });
        const ctx = newCtx();
        await startSession(handler("session_start"), ctx);
        await fake.commands.get("pii")!.handler("off", ctx);
        expect((await runContext(handler("context"), RAW)).messages[0].content).toBe(`Login as ${EMAIL}`);
        await fake.commands.get("pii")!.handler("status", ctx);
        expect(ctx.ui.notify.mock.calls.at(-1)?.[0]).toMatch(/off/);
        await startSession(handler("session_start"), ctx);
        expect((await runContext(handler("context"), RAW)).messages[0].content).toBe(`Login as ${EMAIL}`);
    });

    it("a flagless session_start from a second copy (subagent) keeps redaction on", async () => {
        const first = setup({ flags: { private: true } });
        await startSession(first.handler("session_start"), newCtx());
        const second = setup();
        await startSession(second.handler("session_start"), newCtx());
        expect((await runContext(first.handler("context"), RAW)).messages[0].content).toMatch(/<pii:EMAIL_ADDRESS:/);
    });

    it("stays off and writes no marker when the non-registering copy starts first", async () => {
        const registering = setup();
        const other = setup();
        const entries: any[] = [];
        const ctx = newCtx(entries);
        await startSession(other.handler("session_start"), ctx);
        await startSession(registering.handler("session_start"), ctx);
        expect(other.fake.entries).toEqual([]);
        expect(registering.fake.entries).toEqual([]);
        expect((await runContext(registering.handler("context"), RAW)).messages[0].content).toBe(`Login as ${EMAIL}`);
    });

    it("registers the private flag once across two loaded copies", () => {
        const first = setup();
        const second = setup();
        expect(first.fake.registerFlag).toHaveBeenCalledTimes(1);
        expect(first.fake.registerFlag.mock.calls[0]).toEqual(["private", expect.objectContaining({ type: "boolean", default: false })]);
        expect(second.fake.registerFlag).not.toHaveBeenCalled();
    });

    it("writes the private marker once per session", async () => {
        const { fake, handler } = setup({ flags: { private: true } });
        const ctx = newCtx(fake.entries);
        await startSession(handler("session_start"), ctx);
        await startSession(handler("session_start"), ctx);
        expect(fake.entries.filter((e: any) => e.customType === "pii-private")).toHaveLength(1);
    });

    it("switches on when a reopened session holds the marker, and stays off without it", async () => {
        const marked = setup();
        await startSession(marked.handler("session_start"), newCtx([{ type: "custom", customType: "pii-private" }]));
        expect((await runContext(marked.handler("context"), RAW)).messages[0].content).toMatch(/<pii:EMAIL_ADDRESS:/);
        delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.state")];
        delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.flag")];
        const plain = setup();
        await startSession(plain.handler("session_start"), newCtx([{ type: "custom", customType: "other" }]));
        expect((await runContext(plain.handler("context"), RAW)).messages[0].content).toBe(`Login as ${EMAIL}`);
    });

    it("shares state between two loaded copies and redacts once per emit", async () => {
        const a = setup();
        const b = setup({ analyze: a.analyze, keyPath: a.keyPath });
        const ctx = newCtx();
        const raw = [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }];
        const afterA = await runContext(a.handler("context"), raw, ctx);
        const afterB = await runContext(b.handler("context"), afterA.messages, ctx);
        expect(afterB.messages[0].content).toBe(afterA.messages[0].content);
        expect(a.analyze).toHaveBeenCalledTimes(2);
        const tag = afterA.messages[0].content.slice("Login as ".length);
        const call = { type: "tool_call", toolCallId: "c", toolName: "bash", input: { command: tag } };
        await b.handler("tool_call")(call, newCtx());
        expect(call.input.command).toBe(EMAIL);
        await runContext(b.handler("context"), [{ role: "user", content: "mail other@example.de", timestamp: 2 }], newCtx());
        expect(a.analyze.mock.calls.length).toBeGreaterThan(2);
    });

    it("redacts compaction input without touching session messages, and cancels when the analyzer is down", async () => {
        const { handler } = setup();
        const original = { role: "user", content: `Login as ${EMAIL}`, timestamp: 1 };
        const preparation: any = { messagesToSummarize: [original], turnPrefixMessages: [original], previousSummary: `Earlier: ${EMAIL}` };
        const result = await handler("session_before_compact")({ type: "session_before_compact", preparation }, newCtx());
        expect(result).toBeUndefined();
        expect(preparation.messagesToSummarize[0].content).toMatch(/^Login as <pii:EMAIL_ADDRESS:/);
        expect(preparation.turnPrefixMessages[0].content).toMatch(/^Login as <pii:EMAIL_ADDRESS:/);
        expect(preparation.previousSummary).toMatch(/^Earlier: <pii:EMAIL_ADDRESS:/);
        expect(original.content).toBe(`Login as ${EMAIL}`);

        const down = setup({ analyze: async () => { throw new AnalyzerUnavailable("down"); }, keyPath: path.join(tmp, "other", "hmac.key") });
        delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.state")];
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.flag")];
        const prep2: any = { messagesToSummarize: [{ role: "user", content: "new other@example.de", timestamp: 1 }], turnPrefixMessages: [] };
        const ctx = newCtx();
        expect(await down.handler("session_before_compact")({ type: "session_before_compact", preparation: prep2 }, ctx)).toEqual({ cancel: true });
        expect(ctx.ui.notify).toHaveBeenCalled();
    });

    it("redacts branch-summary entries in place with copies", async () => {
        const { handler } = setup();
        const entry = { type: "message", id: "e1", message: { role: "user", content: `Login as ${EMAIL}`, timestamp: 1 } };
        const entriesToSummarize = [entry];
        const preparation = { entriesToSummarize, userWantsSummary: true };
        await handler("session_before_tree")({ type: "session_before_tree", preparation }, newCtx());
        expect(entriesToSummarize[0].message.content).toMatch(/^Login as <pii:EMAIL_ADDRESS:/);
        expect(entry.message.content).toBe(`Login as ${EMAIL}`);
    });

    it("keeps tags stable across a restart and stores the key privately", async () => {
        const first = setup();
        const a = await runContext(first.handler("context"), [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }]);
        delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.state")];
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("pi.pii-redaction.flag")];
        const second = setup({ keyPath: first.keyPath });
        const b = await runContext(second.handler("context"), [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }]);
        expect(b.messages[0].content).toBe(a.messages[0].content);
        expect(fs.statSync(first.keyPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.dirname(first.keyPath)).mode & 0o777).toBe(0o700);
        expect(fs.readFileSync(first.keyPath)).toHaveLength(32);
    });

    it("withholds everything when the key file is corrupt", async () => {
        const keyPath = path.join(tmp, "bad", "hmac.key");
        fs.mkdirSync(path.dirname(keyPath), { recursive: true });
        fs.writeFileSync(keyPath, "short");
        const { handler } = setup({ keyPath });
        const { messages } = await runContext(handler("context"), [{ role: "user", content: `Login as ${EMAIL}`, timestamp: 1 }]);
        expect(messages[0].content).toBe(WITHHELD);
    });
});
