import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import claudeUsageExtension, {
    formatUsage,
    mergeUsage,
    parseUsageHeaders,
} from "../.pi/extensions/claude-usage.ts";
import { asExtensionAPI, createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

const STATUS_KEY = "claude-usage";

// Real payload captured from a claude-bridge run: utilization is a 0..1
// fraction, the reset headers are epoch seconds.
const CAPTURED_HEADERS = {
    "anthropic-ratelimit-unified-status": "allowed",
    "anthropic-ratelimit-unified-5h-utilization": "0.13",
    "anthropic-ratelimit-unified-5h-reset": "1793824200",
    "anthropic-ratelimit-unified-7d-utilization": "0.57",
    "anthropic-ratelimit-unified-7d-reset": "1794117600",
};
const FIVE_HOUR_ONLY = {
    "anthropic-ratelimit-unified-5h-utilization": "0.2",
    "anthropic-ratelimit-unified-5h-reset": "1793824200",
};
const BEFORE_RESET = 1793800000 * 1000;
const AFTER_FIVE_HOUR_RESET = 1793830000 * 1000;

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

describe("parseUsageHeaders", () => {
    it("converts the captured headers to percentages and millisecond resets", () => {
        expect(parseUsageHeaders(CAPTURED_HEADERS)).toEqual({
            fiveHour: { percent: 13, resetAt: 1793824200000 },
            sevenDay: { percent: 57, resetAt: 1794117600000 },
        });
    });

    it("matches header names case-insensitively", () => {
        const upper = Object.fromEntries(
            Object.entries(CAPTURED_HEADERS).map(([name, value]) => [name.toUpperCase(), value]),
        );
        expect(parseUsageHeaders(upper)?.fiveHour?.percent).toBe(13);
    });

    it("rounds and clamps the percentage to 0-100", () => {
        const headers = {
            "anthropic-ratelimit-unified-5h-utilization": "0.144",
            "anthropic-ratelimit-unified-7d-utilization": "1.7",
        };
        expect(parseUsageHeaders(headers)).toEqual({
            fiveHour: { percent: 14, resetAt: null },
            sevenDay: { percent: 100, resetAt: null },
        });
    });

    it("reports only the windows present in the headers", () => {
        expect(parseUsageHeaders(FIVE_HOUR_ONLY)).toEqual({
            fiveHour: { percent: 20, resetAt: 1793824200000 },
        });
    });

    it("returns undefined when no window carries a finite utilization", () => {
        expect(parseUsageHeaders({})).toBeUndefined();
        expect(parseUsageHeaders({ "anthropic-ratelimit-unified-status": "allowed" })).toBeUndefined();
        expect(
            parseUsageHeaders({ "anthropic-ratelimit-unified-5h-utilization": "lots" }),
        ).toBeUndefined();
    });

    it("ignores a reset header that is not a number", () => {
        const headers = {
            "anthropic-ratelimit-unified-5h-utilization": "0.5",
            "anthropic-ratelimit-unified-5h-reset": "soon",
        };
        expect(parseUsageHeaders(headers)?.fiveHour).toEqual({ percent: 50, resetAt: null });
    });
});

describe("mergeUsage", () => {
    const previous = parseUsageHeaders(CAPTURED_HEADERS)!;

    it("keeps a remembered window the new event does not carry", () => {
        const merged = mergeUsage(previous, parseUsageHeaders(FIVE_HOUR_ONLY)!, BEFORE_RESET);
        expect(merged.fiveHour?.percent).toBe(20);
        expect(merged.sevenDay?.percent).toBe(57);
    });

    it("drops a remembered window whose reset time has passed", () => {
        const merged = mergeUsage(previous, parseUsageHeaders(FIVE_HOUR_ONLY)!, AFTER_FIVE_HOUR_RESET);
        expect(merged.sevenDay?.percent).toBe(57);
        const droppedFiveHour = mergeUsage(
            previous,
            { sevenDay: { percent: 60, resetAt: 1794117600000 } },
            AFTER_FIVE_HOUR_RESET,
        );
        expect(droppedFiveHour.fiveHour).toBeUndefined();
        expect(droppedFiveHour.sevenDay?.percent).toBe(60);
    });
});

describe("formatUsage", () => {
    it("formats both windows", () => {
        expect(formatUsage(parseUsageHeaders(CAPTURED_HEADERS)!)).toBe("Claude 5h 13% · 7d 57%");
    });

    it("formats the one known window", () => {
        expect(formatUsage({ fiveHour: { percent: 20, resetAt: null } })).toBe("Claude 5h 20%");
        expect(formatUsage({ sevenDay: { percent: 57, resetAt: null } })).toBe("Claude 7d 57%");
    });

    it("returns undefined when no window is known", () => {
        expect(formatUsage({})).toBeUndefined();
    });
});

describe("claude-usage extension", () => {
    let dir: string;
    let snapshotFile: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-usage-"));
        snapshotFile = path.join(dir, "usage-bar", "usage.json");
        process.env.AGENT_USAGE_BAR_SNAPSHOT = snapshotFile;
        // The captured reset times are real dates; pin the clock before them.
        vi.useFakeTimers({ toFake: ["Date"], now: BEFORE_RESET });
    });

    afterEach(() => {
        vi.useRealTimers();
        delete process.env.AGENT_USAGE_BAR_SNAPSHOT;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const readSnapshot = () => JSON.parse(fs.readFileSync(snapshotFile, "utf8"));

    it("shows usage and writes the snapshot after a response with usage headers", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "Claude 5h 13% · 7d 57%");
        expect(readSnapshot()).toMatchObject({
            schema: 1,
            fiveHour: 13,
            sevenDay: 57,
            fiveHourResetAt: 1793824200000,
            sevenDayResetAt: 1794117600000,
        });
        expect(typeof readSnapshot().updatedAt).toBe("number");
    });

    it("creates the snapshot file with mode 0600 in a 0700 directory", async () => {
        const { pi, ctx } = setup();
        await fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx);
        expect(fs.statSync(snapshotFile).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.dirname(snapshotFile)).mode & 0o777).toBe(0o700);
    });

    it("ignores responses without usage headers", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "after_provider_response", { status: 200, headers: { "content-type": "x" } }, ctx);
        expect(ui.setStatus).not.toHaveBeenCalled();
        expect(fs.existsSync(snapshotFile)).toBe(false);
    });

    it("keeps a window it already knows when a later event carries only the other one", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx);
        await fire(pi, "after_provider_response", { status: 200, headers: FIVE_HOUR_ONLY }, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "Claude 5h 20% · 7d 57%");
        expect(readSnapshot()).toMatchObject({ fiveHour: 20, sevenDay: 57 });
    });

    it("writes null for a window it has not seen", async () => {
        const { pi, ctx } = setup();
        await fire(pi, "after_provider_response", { status: 200, headers: FIVE_HOUR_ONLY }, ctx);
        expect(readSnapshot()).toMatchObject({ fiveHour: 20, sevenDay: null, sevenDayResetAt: null });
    });

    it("writes the snapshot but leaves the footer alone in print mode (subagent sessions)", async () => {
        const { pi, ui, ctx } = setup("print");
        await fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx);
        expect(ui.setStatus).not.toHaveBeenCalled();
        expect(readSnapshot().fiveHour).toBe(13);
    });

    it("does not throw when the snapshot cannot be written", async () => {
        process.env.AGENT_USAGE_BAR_SNAPSHOT = path.join(dir, "file", "usage.json");
        fs.writeFileSync(path.join(dir, "file"), "not a directory");
        const { pi, ui, ctx } = setup();
        await expect(
            fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx),
        ).resolves.toBeUndefined();
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "Claude 5h 13% · 7d 57%");
    });

    it("clears the footer and forgets remembered windows on session start", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx);
        await fire(pi, "session_start", {}, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
        await fire(pi, "after_provider_response", { status: 200, headers: FIVE_HOUR_ONLY }, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "Claude 5h 20%");
    });

    it("drops a remembered window from the footer and snapshot once its reset time has passed", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx);
        vi.setSystemTime(AFTER_FIVE_HOUR_RESET);
        const sevenDayOnly = {
            "anthropic-ratelimit-unified-7d-utilization": "0.6",
            "anthropic-ratelimit-unified-7d-reset": "1794117600",
        };
        await fire(pi, "after_provider_response", { status: 200, headers: sevenDayOnly }, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "Claude 7d 60%");
        expect(readSnapshot()).toMatchObject({ fiveHour: null, sevenDay: 60 });
    });

    it("forgets remembered windows on session start in print mode too", async () => {
        const { pi, ctx } = setup("print");
        await fire(pi, "after_provider_response", { status: 200, headers: CAPTURED_HEADERS }, ctx);
        await fire(pi, "session_start", {}, ctx);
        await fire(pi, "after_provider_response", { status: 200, headers: FIVE_HOUR_ONLY }, ctx);
        expect(readSnapshot()).toMatchObject({ fiveHour: 20, sevenDay: null });
    });

    it("clears the footer when switching to another provider", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "model_select", { model: { provider: "iqRouter", id: "grunt" } }, ctx);
        expect(ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
    });

    it("leaves the footer alone when switching to a claude-bridge model", async () => {
        const { pi, ui, ctx } = setup();
        await fire(pi, "model_select", { model: { provider: "claude-bridge", id: "claude-opus-5-5" } }, ctx);
        expect(ui.setStatus).not.toHaveBeenCalled();
    });
});
