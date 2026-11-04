/**
 * Claude subscription usage extension.
 *
 * Reads the 5-hour and 7-day plan utilization that claude-bridge forwards as
 * `anthropic-ratelimit-unified-*` headers on `after_provider_response`, shows
 * it in the footer, and writes it to the snapshot file the agent-usage-bar
 * menu-bar app reads. Claude Code only sends an event when a usage window
 * changes, so the footer stays empty until the first one and any parse or
 * write failure hides data rather than showing wrong numbers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const CLAUDE_USAGE_REGISTERED = Symbol.for("pi.extensions.claude-usage.registered");

const STATUS_KEY = "claude-usage";
const BRIDGE_PROVIDER = "claude-bridge";
const HEADER_PREFIX = "anthropic-ratelimit-unified-";
const SNAPSHOT_SCHEMA = 1;

export interface UsageWindow {
    /** Used share of the window, 0-100. */
    percent: number;
    /** Reset time in epoch ms, or null when the event carried none. */
    resetAt: number | null;
}

export interface Usage {
    fiveHour?: UsageWindow;
    sevenDay?: UsageWindow;
}

const finiteNumber = (value: string | undefined): number | undefined => {
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const parseWindow = (headers: Record<string, string>, abbreviation: string): UsageWindow | undefined => {
    const utilization = finiteNumber(headers[`${HEADER_PREFIX}${abbreviation}-utilization`]);
    if (utilization === undefined) return undefined;
    const reset = finiteNumber(headers[`${HEADER_PREFIX}${abbreviation}-reset`]);
    return {
        percent: Math.min(100, Math.max(0, Math.round(utilization * 100))),
        resetAt: reset === undefined ? null : reset * 1000,
    };
};

/** Windows carried by one response's headers, or undefined when it carries none. */
export function parseUsageHeaders(headers: Record<string, string>): Usage | undefined {
    const lowered = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const fiveHour = parseWindow(lowered, "5h");
    const sevenDay = parseWindow(lowered, "7d");
    if (!fiveHour && !sevenDay) return undefined;
    return { ...(fiveHour && { fiveHour }), ...(sevenDay && { sevenDay }) };
}

const stillCurrent = (window: UsageWindow | undefined, now: number): UsageWindow | undefined =>
    window && (window.resetAt === null || window.resetAt > now) ? window : undefined;

/** An event may carry one window only: keep the other from before, unless its reset time has passed. */
export function mergeUsage(previous: Usage, incoming: Usage, now: number): Usage {
    const fiveHour = incoming.fiveHour ?? stillCurrent(previous.fiveHour, now);
    const sevenDay = incoming.sevenDay ?? stillCurrent(previous.sevenDay, now);
    return { ...(fiveHour && { fiveHour }), ...(sevenDay && { sevenDay }) };
}

/** Footer text, or undefined when no window is known. */
export function formatUsage(usage: Usage): string | undefined {
    const parts = [
        usage.fiveHour && `5h ${usage.fiveHour.percent}%`,
        usage.sevenDay && `7d ${usage.sevenDay.percent}%`,
    ].filter(Boolean);
    return parts.length > 0 ? `Claude ${parts.join(" · ")}` : undefined;
}

const snapshotPath = (): string => {
    const override = process.env.AGENT_USAGE_BAR_SNAPSHOT?.trim();
    if (override) return path.resolve(override);
    const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
    return path.join(configDir, "usage-bar", "usage.json");
};

/** Same shape and permissions as agent-usage-bar's own writer; never throws. */
function writeSnapshot(usage: Usage, now: number): void {
    try {
        const target = snapshotPath();
        const dir = path.dirname(target);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const snapshot = {
            schema: SNAPSHOT_SCHEMA,
            updatedAt: now,
            fiveHour: usage.fiveHour?.percent ?? null,
            sevenDay: usage.sevenDay?.percent ?? null,
            fiveHourResetAt: usage.fiveHour?.resetAt ?? null,
            sevenDayResetAt: usage.sevenDay?.resetAt ?? null,
        };
        const temp = path.join(dir, `.usage.${process.pid}.tmp`);
        fs.writeFileSync(temp, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
        fs.renameSync(temp, target);
    } catch {
        // A failed write must never fail the turn; the bar just keeps its last reading.
    }
}

export default function claudeUsageExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[CLAUDE_USAGE_REGISTERED]) return;
    guardPi[CLAUDE_USAGE_REGISTERED] = true;

    let latest: Usage = {};

    const clearFooter = (ctx: ExtensionContext): void => {
        ctx.ui.setStatus(STATUS_KEY, undefined);
    };

    pi.on("session_start", (_event, ctx) => {
        latest = {};
        if (ctx.mode !== "tui") return;
        clearFooter(ctx);
    });

    pi.on("model_select", (event, ctx) => {
        if (ctx.mode !== "tui") return;
        if (event.model.provider !== BRIDGE_PROVIDER) clearFooter(ctx);
    });

    pi.on("after_provider_response", (event, ctx) => {
        const incoming = parseUsageHeaders(event.headers);
        if (!incoming) return;
        const now = Date.now();
        latest = mergeUsage(latest, incoming, now);
        // Every session writes: subagent sessions spend the same quota.
        writeSnapshot(latest, now);
        // Subagent sessions bind extensions in "print" mode; only the
        // interactive session owns the footer.
        if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, formatUsage(latest));
    });
}
