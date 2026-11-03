import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cacheClockExtension from "../.pi/extensions/cache-clock.ts";
import {
    AUTO_COMPACT_AFTER_MS,
    cacheTtl,
    cmuxStatusKey,
    formatCacheStatus,
    MINUTE_MS,
    shouldAutoCompact,
} from "../.pi/extensions/lib/cache-clock.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

type Fake = ReturnType<typeof createFakePi>;
type Model = { provider?: string; api?: string } | undefined;

const STATUS_KEY = "cache-clock";
const SURFACE_ID = "TEST-SURFACE-1";
const START = new Date("2026-11-03T12:00:00Z").getTime();
const TICK_MS = 15_000;
const OK_EXEC = { stdout: "", stderr: "", code: 0, killed: false };
const OPTS = { timeout: 3000 };
const BRIDGE: Model = { provider: "claude-bridge", api: "anthropic-messages" };

const TOUCHED_ENV = ["PI_CACHE_RETENTION", "CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID", "PI_CODING_AGENT_DIR"] as const;

function makeCtx(model: Model, opts: { idle?: boolean; pending?: boolean } = {}) {
    const state = { idle: opts.idle ?? true, pending: opts.pending ?? false };
    return {
        mode: "tui",
        hasUI: true,
        ui: { setStatus: vi.fn(), notify: vi.fn() },
        model,
        isIdle: () => state.idle,
        hasPendingMessages: () => state.pending,
        compact: vi.fn(),
        state,
    };
}
type Ctx = ReturnType<typeof makeCtx>;

function register(): Fake {
    const pi = createFakePi();
    cacheClockExtension(asExtensionAPI(pi));
    return pi;
}

async function fire(pi: Fake, event: string, ctx: Ctx, payload: Record<string, unknown> = {}): Promise<void> {
    for (const handler of pi.handlers.get(event) ?? []) {
        await handler({ type: event, ...payload }, ctx);
    }
}

const respond = (pi: Fake, ctx: Ctx) => fire(pi, "message_end", ctx, { message: { role: "assistant" } });

/** Last value the extension wrote to its footer key. */
function lastStatus(ctx: Ctx): unknown {
    const calls = ctx.ui.setStatus.mock.calls.filter((call) => call[0] === STATUS_KEY);
    return calls.length ? calls[calls.length - 1][1] : "<never set>";
}

const statusCalls = (ctx: Ctx) => ctx.ui.setStatus.mock.calls.filter((call) => call[0] === STATUS_KEY);

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
    savedEnv = Object.fromEntries(TOUCHED_ENV.map((name) => [name, process.env[name]]));
    for (const name of TOUCHED_ENV) delete process.env[name];
    process.env.PI_CODING_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cache-clock-"));
    vi.useFakeTimers();
    vi.setSystemTime(START);
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const name of TOUCHED_ENV) {
        if (savedEnv[name] === undefined) delete process.env[name];
        else process.env[name] = savedEnv[name];
    }
});

describe("cache-clock lib", () => {
    it("AC1 formatCacheStatus floors the minutes left", () => {
        const ttl = 60 * MINUTE_MS;
        const state = { lastResponseAt: START, compacted: false };
        expect(formatCacheStatus(state, ttl, START)).toBe("cache 60m");
        expect(formatCacheStatus(state, ttl, START + 30_000)).toBe("cache 59m");
        expect(formatCacheStatus(state, ttl, START + MINUTE_MS)).toBe("cache 59m");
        expect(formatCacheStatus(state, ttl, START + 59 * MINUTE_MS + 59_000)).toBe("cache 0m");
    });

    it("AC3 formatCacheStatus shows none, cold, and compacted", () => {
        const ttl = 60 * MINUTE_MS;
        expect(formatCacheStatus({ compacted: false }, ttl, START)).toBe("cache none");
        expect(formatCacheStatus({ lastResponseAt: START, compacted: false }, ttl, START + ttl)).toBe("cache cold");
        expect(formatCacheStatus({ lastResponseAt: START, compacted: false }, ttl, START + ttl + MINUTE_MS)).toBe(
            "cache cold",
        );
        expect(formatCacheStatus({ compacted: true }, ttl, START)).toBe("cache compacted");
    });

    it("AC6 cacheTtl maps providers to TTL and auto-compact", () => {
        const hour = { ttlMs: 60 * MINUTE_MS, autoCompact: true };
        const short = { ttlMs: 5 * MINUTE_MS, autoCompact: false };
        expect(cacheTtl({ provider: "claude-bridge" }, {})).toEqual(hour);
        expect(cacheTtl({ provider: "anthropic" }, { PI_CACHE_RETENTION: "long" })).toEqual(hour);
        expect(cacheTtl({ provider: "anthropic" }, {})).toEqual(short);
        expect(cacheTtl({ provider: "proxy", api: "anthropic-messages" }, { PI_CACHE_RETENTION: "long" })).toEqual(hour);
        expect(cacheTtl({ provider: "proxy", api: "anthropic-messages" }, {})).toEqual(short);
        expect(cacheTtl({ provider: "openai", api: "openai-responses" }, { PI_CACHE_RETENTION: "long" })).toEqual(short);
        expect(cacheTtl(undefined, { PI_CACHE_RETENTION: "long" })).toEqual(short);
    });

    it("AC4 shouldAutoCompact fires at minute 58 on a known clock", () => {
        const base = {
            lastResponseAt: START,
            attemptedFor: undefined,
            compacting: false,
            running: false,
            autoCompact: true,
        };
        expect(AUTO_COMPACT_AFTER_MS).toBe(58 * MINUTE_MS);
        expect(shouldAutoCompact({ ...base, now: START + AUTO_COMPACT_AFTER_MS - 1 })).toBe(false);
        expect(shouldAutoCompact({ ...base, now: START + AUTO_COMPACT_AFTER_MS })).toBe(true);
        expect(shouldAutoCompact({ ...base, now: START + 60 * MINUTE_MS })).toBe(true);
    });

    it("AC5 shouldAutoCompact refuses while running, compacting, already attempted, or without a response", () => {
        const now = START + AUTO_COMPACT_AFTER_MS;
        const base = { lastResponseAt: START, compacting: false, running: false, autoCompact: true, now };
        expect(shouldAutoCompact({ ...base, running: true })).toBe(false);
        expect(shouldAutoCompact({ ...base, compacting: true })).toBe(false);
        expect(shouldAutoCompact({ ...base, attemptedFor: START })).toBe(false);
        expect(shouldAutoCompact({ ...base, lastResponseAt: undefined })).toBe(false);
        expect(shouldAutoCompact({ ...base, attemptedFor: START - MINUTE_MS })).toBe(true);
    });

    it("AC6 shouldAutoCompact never fires when auto-compact is off", () => {
        expect(
            shouldAutoCompact({
                lastResponseAt: START,
                compacting: false,
                running: false,
                autoCompact: false,
                now: START + 60 * MINUTE_MS,
            }),
        ).toBe(false);
    });

    it("AC7 cmuxStatusKey uses the surface id when present", () => {
        expect(cmuxStatusKey({ CMUX_SURFACE_ID: SURFACE_ID })).toBe(`cache-clock-${SURFACE_ID}`);
        expect(cmuxStatusKey({})).toBe("cache-clock");
    });
});

describe("cache-clock extension", () => {
    it("AC1 shows whole minutes left after a response", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        expect(lastStatus(ctx)).toBe("cache 60m");
        vi.advanceTimersByTime(30_000);
        expect(lastStatus(ctx)).toBe("cache 59m");
        vi.advanceTimersByTime(30_000);
        expect(lastStatus(ctx)).toBe("cache 59m");
        expect("cache-clock" < "headroom").toBe(true);
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC2 refreshes from a session_start timer and leaves none after shutdown", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        expect(vi.getTimerCount()).toBe(0);
        await fire(pi, "session_start", ctx);
        expect(vi.getTimerCount()).toBe(1);
        await respond(pi, ctx);
        const before = statusCalls(ctx).length;
        vi.advanceTimersByTime(60_000);
        expect(statusCalls(ctx).length).toBeGreaterThan(before);
        expect(lastStatus(ctx)).toBe("cache 59m");
        await fire(pi, "session_shutdown", ctx);
        expect(vi.getTimerCount()).toBe(0);
        expect(lastStatus(ctx)).toBeUndefined();
    });

    it("AC2 a second session_start replaces the old timer", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await fire(pi, "session_start", ctx);
        expect(vi.getTimerCount()).toBe(1);
        await fire(pi, "session_shutdown", ctx);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("AC2 does nothing outside tui mode", async () => {
        const pi = register();
        const ctx = { ...makeCtx(BRIDGE), mode: "print" };
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        expect(vi.getTimerCount()).toBe(0);
        expect(statusCalls(ctx)).toHaveLength(0);
    });

    it("AC3 shows none before the first response and cold at TTL", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        expect(lastStatus(ctx)).toBe("cache none");
        await fire(pi, "message_end", ctx, { message: { role: "user" } });
        vi.advanceTimersByTime(TICK_MS);
        expect(lastStatus(ctx)).toBe("cache none");
        await respond(pi, ctx);
        // Busy agent keeps compaction away, so the clock can run to cold.
        ctx.state.idle = false;
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache cold");
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC4 auto-compacts once at minute 58 when idle", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(AUTO_COMPACT_AFTER_MS - TICK_MS);
        expect(ctx.compact).not.toHaveBeenCalled();
        vi.advanceTimersByTime(TICK_MS);
        expect(ctx.compact).toHaveBeenCalledTimes(1);
        expect(ctx.ui.notify).toHaveBeenCalled();
        vi.advanceTimersByTime(2 * MINUTE_MS);
        expect(ctx.compact).toHaveBeenCalledTimes(1);
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC4 does not retry after the compact call completes or fails", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        ctx.compact.mockImplementation((options?: { onError?: (error: Error) => void }) => {
            options?.onError?.(new Error("boom"));
        });
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(ctx.compact).toHaveBeenCalledTimes(1);
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC4 skips compaction while messages are pending", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE, { pending: true });
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(ctx.compact).not.toHaveBeenCalled();
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC5 never compacts while the agent runs", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        await fire(pi, "agent_start", ctx);
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(ctx.compact).not.toHaveBeenCalled();
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC5 never compacts while a compaction runs", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        await fire(pi, "session_before_compact", ctx);
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(ctx.compact).not.toHaveBeenCalled();
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC5 never compacts again after session_compact and shows compacted until the next response", async () => {
        const pi = register();
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(10 * MINUTE_MS);
        await fire(pi, "session_before_compact", ctx);
        await fire(pi, "session_compact", ctx);
        expect(lastStatus(ctx)).toBe("cache compacted");
        vi.advanceTimersByTime(120 * MINUTE_MS);
        expect(ctx.compact).not.toHaveBeenCalled();
        expect(lastStatus(ctx)).toBe("cache compacted");
        await respond(pi, ctx);
        expect(lastStatus(ctx)).toBe("cache 60m");
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC6 claude-bridge counts down from 60 minutes", async () => {
        const pi = register();
        const ctx = makeCtx({ provider: "claude-bridge" });
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache 59m");
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC6 anthropic with PI_CACHE_RETENTION=long counts 60 minutes and auto-compacts", async () => {
        process.env.PI_CACHE_RETENTION = "long";
        const pi = register();
        const ctx = makeCtx({ provider: "anthropic", api: "anthropic-messages" });
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache 59m");
        vi.advanceTimersByTime(AUTO_COMPACT_AFTER_MS);
        expect(ctx.compact).toHaveBeenCalledTimes(1);
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC6 anthropic without long retention counts 5 minutes and never compacts", async () => {
        const pi = register();
        const ctx = makeCtx({ provider: "anthropic", api: "anthropic-messages" });
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache 4m");
        vi.advanceTimersByTime(4 * MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache cold");
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(ctx.compact).not.toHaveBeenCalled();
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC6 an unknown provider never compacts", async () => {
        process.env.PI_CACHE_RETENTION = "long";
        const pi = register();
        const ctx = makeCtx({ provider: "openai", api: "openai-responses" });
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache 4m");
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache cold");
        expect(ctx.compact).not.toHaveBeenCalled();
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC6 no model falls back to 5 minutes and never compacts", async () => {
        const pi = register();
        const ctx = makeCtx(undefined);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache 4m");
        vi.advanceTimersByTime(60 * MINUTE_MS);
        expect(ctx.compact).not.toHaveBeenCalled();
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC6 reads the model at each render", async () => {
        const pi = register();
        const ctx = makeCtx(undefined);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(MINUTE_MS);
        expect(lastStatus(ctx)).toBe("cache 4m");
        ctx.model = BRIDGE;
        vi.advanceTimersByTime(TICK_MS);
        expect(lastStatus(ctx)).toBe("cache 58m");
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC7 sets the cmux status once per text change and clears it on shutdown", async () => {
        process.env.CMUX_WORKSPACE_ID = "TEST-WS-1";
        process.env.CMUX_SURFACE_ID = SURFACE_ID;
        const key = `cache-clock-${SURFACE_ID}`;
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(30_000);
        await vi.advanceTimersByTimeAsync(0);
        vi.advanceTimersByTime(30_000);
        await vi.advanceTimersByTimeAsync(0);

        const argLists = execSpy.mock.calls.map((call) => (call as unknown[])[1] as string[]);
        const setCalls = argLists.filter((args) => args[0] === "set-status");
        expect(setCalls.map((args) => args[2])).toEqual(["cache none", "cache 60m", "cache 59m"]);
        expect(execSpy).toHaveBeenCalledWith("cmux", ["set-status", key, "cache 59m", "--icon", "clock"], OPTS);

        await fire(pi, "session_shutdown", ctx);
        await vi.advanceTimersByTimeAsync(0);
        expect(execSpy).toHaveBeenLastCalledWith("cmux", ["clear-status", key], OPTS);
    });

    it("AC7 uses the shared key without a surface id", async () => {
        process.env.CMUX_WORKSPACE_ID = "TEST-WS-1";
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await vi.advanceTimersByTimeAsync(0);
        expect(execSpy).toHaveBeenCalledWith("cmux", ["set-status", "cache-clock", "cache none", "--icon", "clock"], OPTS);
        await fire(pi, "session_shutdown", ctx);
    });

    it("AC7 makes no cmux call without CMUX_WORKSPACE_ID", async () => {
        process.env.CMUX_SURFACE_ID = SURFACE_ID;
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
        const ctx = makeCtx(BRIDGE);
        await fire(pi, "session_start", ctx);
        await respond(pi, ctx);
        vi.advanceTimersByTime(2 * MINUTE_MS);
        await fire(pi, "session_shutdown", ctx);
        await vi.advanceTimersByTimeAsync(0);
        expect(execSpy).not.toHaveBeenCalled();
    });

    it("AC7 swallows a rejected cmux exec", async () => {
        process.env.CMUX_WORKSPACE_ID = "TEST-WS-1";
        process.env.CMUX_SURFACE_ID = SURFACE_ID;
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec").mockRejectedValue(new Error("no cmux socket"));
        const ctx = makeCtx(BRIDGE);
        await expect(fire(pi, "session_start", ctx)).resolves.toBeUndefined();
        await expect(respond(pi, ctx)).resolves.toBeUndefined();
        expect(() => vi.advanceTimersByTime(2 * MINUTE_MS)).not.toThrow();
        await vi.advanceTimersByTimeAsync(0);
        await expect(fire(pi, "session_shutdown", ctx)).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(0);
        expect(execSpy).toHaveBeenCalled();
        expect(lastStatus(ctx)).toBeUndefined();
    });
});
