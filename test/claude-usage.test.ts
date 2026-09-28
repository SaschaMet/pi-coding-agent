import { afterEach, describe, expect, it, vi } from "vitest";
import claudeUsageExtension, { formatUsage } from "../.pi/extensions/claude-usage.ts";
import { asExtensionAPI, createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

const STATUS_KEY = "claude-usage";

const stats = (fiveHour: unknown, sevenDay: unknown) => ({
    subscription_window: {
        latest: {
            five_hour: { utilization_pct: fiveHour },
            seven_day: { utilization_pct: sevenDay },
            polled_at: "2026-09-25T07:50:47Z",
        },
    },
});

const okResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });

const bridgeReply = { role: "assistant", provider: "claude-bridge", content: [] };
const otherReply = { role: "assistant", provider: "iqRouter", content: [] };

type Fake = ReturnType<typeof createFakePi>;

function setup(mode = "tui") {
    const pi = createFakePi();
    claudeUsageExtension(asExtensionAPI(pi));
    const ui = createFakeUi();
    const ctx = { mode, hasUI: true, ui };
    return { pi, ui, ctx };
}

async function fire(pi: Fake, event: string, payload: object, ctx: object): Promise<void> {
    const handlers = pi.handlers.get(event) ?? [];
    expect(handlers.length).toBe(1);
    await handlers[0]({ type: event, ...payload }, ctx);
}

// The fetch runs in the background, so let its promise chain settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("formatUsage", () => {
    it("formats rounded five-hour and seven-day utilization", () => {
        expect(formatUsage(stats(14.4, 85.6))).toBe("Claude 5h 14% · 7d 86%");
    });

    it("returns undefined when a utilization value is missing or not finite", () => {
        expect(formatUsage(stats(null, 86))).toBeUndefined();
        expect(formatUsage(stats(14, "86"))).toBeUndefined();
        expect(formatUsage(stats(Number.NaN, 86))).toBeUndefined();
        expect(formatUsage({})).toBeUndefined();
        expect(formatUsage(null)).toBeUndefined();
    });
});

describe("claude-usage extension", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows usage after a claude-bridge turn", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(okResponse(stats(14, 86)));
        const { pi, ui, ctx } = setup();
        await fire(pi, "turn_end", { message: bridgeReply }, ctx);
        await settle();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0][0])).toBe("http://127.0.0.1:8788/stats");
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "Claude 5h 14% · 7d 86%");
    });

    it("ignores turns from other providers", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const { pi, ui, ctx } = setup();
        await fire(pi, "turn_end", { message: otherReply }, ctx);
        await settle();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(ui.setStatus).not.toHaveBeenCalled();
    });

    it("hides the segment when the fetch fails", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
        const { pi, ui, ctx } = setup();
        await fire(pi, "turn_end", { message: bridgeReply }, ctx);
        await settle();
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
    });

    it("hides the segment on a non-200 response", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
        const { pi, ui, ctx } = setup();
        await fire(pi, "turn_end", { message: bridgeReply }, ctx);
        await settle();
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
    });

    it("hides the segment when the stats lack utilization fields", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ summary: {} }));
        const { pi, ui, ctx } = setup();
        await fire(pi, "turn_end", { message: bridgeReply }, ctx);
        await settle();
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
    });

    it("clears the segment when switching to another provider", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "model_select", { model: { provider: "iqRouter", id: "grunt" } }, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
    });

    it("leaves the segment alone when switching to a claude-bridge model", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "model_select", { model: { provider: "claude-bridge", id: "claude-opus-5-5" } }, ctx);
        expect(ui.setStatus).not.toHaveBeenCalled();
    });

    it("clears the segment on session start", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "session_start", {}, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
    });

    it("keeps the segment cleared when a fetch resolves after switching away", async () => {
        let resolveFetch: (value: Response) => void = () => {};
        vi.spyOn(globalThis, "fetch").mockReturnValue(
            new Promise<Response>((resolve) => {
                resolveFetch = resolve;
            }),
        );
        const { pi, ui, ctx } = setup();
        await fire(pi, "turn_end", { message: bridgeReply }, ctx);
        await fire(pi, "model_select", { model: { provider: "iqRouter", id: "grunt" } }, ctx);
        resolveFetch(okResponse(stats(14, 86)));
        await settle();
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
        expect(ui.setStatus).not.toHaveBeenCalledWith(STATUS_KEY, "Claude 5h 14% · 7d 86%");
    });

    it("does nothing in print mode (subagent sessions)", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const { pi, ui, ctx } = setup("print");
        await fire(pi, "turn_end", { message: bridgeReply }, ctx);
        await settle();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(ui.setStatus).not.toHaveBeenCalled();
    });
});
