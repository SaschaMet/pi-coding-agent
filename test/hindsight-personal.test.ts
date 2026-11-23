import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHindsightPersonal } from "../.pi/extensions/hindsight-personal.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

const TOKEN = "test-token-not-a-secret";
const PROFILE_URL = "http://127.0.0.1:8888/v1/default/banks/personal/mental-models/user-profile?detail=content";
const MEMORIES_URL = "http://127.0.0.1:8888/v1/default/banks/personal/memories";

type Entry = { type: string; customType?: string };

// `trusted: "missing"` leaves isProjectTrusted off the context, as an older or partial host would.
function context(
    overrides: { mode?: string; hasUI?: boolean; confirm?: boolean; branch?: Entry[]; trusted?: boolean | "missing" } = {},
) {
    const trusted = overrides.trusted ?? true;
    return {
        mode: overrides.mode ?? "tui",
        hasUI: overrides.hasUI ?? true,
        ui: { confirm: vi.fn(async () => overrides.confirm ?? true) },
        sessionManager: { getBranch: () => overrides.branch ?? [] },
        ...(trusted === "missing" ? {} : { isProjectTrusted: () => trusted }),
    };
}

const PRIVATE_BRANCH: Entry[] = [{ type: "custom", customType: "pii-private" }];

function promptEvent(sections: Record<string, string> = {}) {
    return { type: "before_agent_start", prompt: "hi", systemPrompt: "base", systemPromptOptions: { sections } };
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("hindsight personal bank", () => {
    let scratch: string;
    let configPath: string;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        scratch = mkdtempSync(join(tmpdir(), "hindsight-personal-"));
        configPath = join(scratch, "coding-agent.json");
        writeFileSync(configPath, JSON.stringify({ apiUrl: "http://127.0.0.1:8888", apiToken: TOKEN }));
        fetchMock = vi.fn(async () => json({ content: "Prefers short answers." }));
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        rmSync(scratch, { recursive: true, force: true });
    });

    function load() {
        const pi = createFakePi();
        createHindsightPersonal(configPath)(asExtensionAPI(pi));
        const before = pi.handlers.get("before_agent_start")?.[0];
        const start = pi.handlers.get("session_start")?.[0];
        const tool = pi.tools.get("personal_remember");
        if (!before || !start || !tool) throw new Error("extension did not register its handlers and tool");
        return { pi, before, start, tool };
    }

    it("sets a user_profile section and keeps sections other handlers set", async () => {
        const { before } = load();
        const event = promptEvent({ delegation_policy: "policy" });
        const result = await before(event, context());

        expect(result?.systemPrompt).toBeUndefined();
        expect(event.systemPromptOptions.sections.delegation_policy).toBe("policy");
        expect(event.systemPromptOptions.sections.user_profile).toContain("Prefers short answers.");
        expect(event.systemPromptOptions.sections.user_profile).toContain("Untrusted memory");
        expect(fetchMock).toHaveBeenCalledWith(PROFILE_URL, expect.anything());
    });

    it.each([
        ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
        ["non-2xx", async () => json({ detail: "nope" }, 500)],
        ["empty", async () => json({ content: "   " })],
        ["missing content", async () => json({})],
        ["not JSON", async () => new Response("<html>", { status: 200 })],
    ])("sets no section and does not throw when the server is %s", async (_label, answer) => {
        fetchMock.mockImplementation(answer);
        const { before } = load();
        const event = promptEvent();

        expect(await before(event, context())).toBeUndefined();
        expect(event.systemPromptOptions.sections.user_profile).toBeUndefined();
    });

    it("aborts the profile fetch at 2000 ms", async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    signal = init.signal ?? undefined;
                    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                }),
        );
        const { before } = load();
        const event = promptEvent();
        const pending = Promise.resolve(before(event, context()));

        await vi.advanceTimersByTimeAsync(1999);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(signal?.aborted).toBe(true);
        await expect(pending).resolves.toBeUndefined();
        expect(event.systemPromptOptions.sections.user_profile).toBeUndefined();
    });

    it("fetches the profile once per session and sets an identical section on every turn", async () => {
        const { before, start } = load();
        const first = promptEvent();
        const second = promptEvent();
        await before(first, context());
        await before(second, context());

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(second.systemPromptOptions.sections.user_profile).toBe(first.systemPromptOptions.sections.user_profile);

        await start({ type: "session_start" }, context());
        await before(promptEvent(), context());
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("sends the bearer token from the Hindsight config", async () => {
        const { before } = load();
        await before(promptEvent(), context());

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    });

    it("posts the fact to the personal bank after the user confirms", async () => {
        fetchMock.mockImplementation(async () => json({ success: true }));
        const { tool } = load();
        const ctx = context();
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, ctx);

        expect(ctx.ui.confirm).toHaveBeenCalledWith(expect.any(String), "X");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(MEMORIES_URL);
        expect(init.method).toBe("POST");
        expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
        const body = JSON.parse(String(init.body));
        expect(body.items[0].content).toBe("X");
        expect(result.content[0].text).toMatch(/stored/i);
    });

    it("stores nothing when the user declines", async () => {
        const { tool } = load();
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, context({ confirm: false }));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.content[0].text).toMatch(/not stored/i);
    });

    it.each([
        ["no UI", { hasUI: false }],
        ["print mode", { mode: "print", hasUI: false }],
    ])("does nothing in a session without a UI: %s", async (_label, overrides) => {
        const { before, tool } = load();
        const ctx = context(overrides);
        const event = promptEvent();
        await before(event, ctx);
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, ctx);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(ctx.ui.confirm).not.toHaveBeenCalled();
        expect(event.systemPromptOptions.sections.user_profile).toBeUndefined();
        expect(result.content[0].text).toMatch(/not available/i);
    });

    it("adds no profile and stores nothing in a private session", async () => {
        const { before, tool } = load();
        const ctx = context({ branch: PRIVATE_BRANCH });
        const event = promptEvent();
        await before(event, ctx);
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, ctx);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(ctx.ui.confirm).not.toHaveBeenCalled();
        expect(event.systemPromptOptions.sections.user_profile).toBeUndefined();
        expect(result.content[0].text).toMatch(/not available/i);
    });

    it.each([
        ["untrusted", false],
        ["without a trust check", "missing"],
    ] as const)("adds no profile and stores nothing in a project that is %s", async (_label, trusted) => {
        const { before, tool } = load();
        const ctx = context({ trusted });
        const event = promptEvent();
        await before(event, ctx);
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, ctx);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(ctx.ui.confirm).not.toHaveBeenCalled();
        expect(event.systemPromptOptions.sections.user_profile).toBeUndefined();
        expect(result.content[0].text).toMatch(/not available/i);
    });

    it("returns an error text when the server answers non-2xx", async () => {
        fetchMock.mockImplementation(async () => json({ detail: "denied" }, 401));
        const { tool } = load();
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, context());

        expect(result.content[0].text).toContain("401");
        expect(result.content[0].text).toMatch(/not stored/i);
    });

    it("returns an error text when the server is unreachable", async () => {
        fetchMock.mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
        const { tool } = load();
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, context());

        expect(result.content[0].text).toMatch(/not stored/i);
    });

    it("adds no profile and reports not configured when the config has no token", async () => {
        writeFileSync(configPath, JSON.stringify({ apiUrl: "http://127.0.0.1:8888" }));
        const { before, tool } = load();
        const event = promptEvent();
        await before(event, context());
        const ctx = context();
        const result = await tool.execute("id", { fact: "X" }, undefined, undefined, ctx);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(ctx.ui.confirm).not.toHaveBeenCalled();
        expect(event.systemPromptOptions.sections.user_profile).toBeUndefined();
        expect(result.content[0].text).toMatch(/not configured/i);
    });

    it("adds no profile when the config file is missing", async () => {
        rmSync(configPath);
        const { before } = load();
        const event = promptEvent();

        expect(await before(event, context())).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
