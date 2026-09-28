/**
 * Claude subscription usage extension.
 *
 * Shows the Claude plan's 5-hour and 7-day utilization in the footer, read
 * from the local Headroom proxy that the claude-bridge traffic runs through.
 * The segment appears only after a claude-bridge turn completes and is
 * cleared on session start or when switching to another provider. Any
 * fetch or parse failure hides it rather than showing stale numbers.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const CLAUDE_USAGE_REGISTERED = Symbol.for("pi.extensions.claude-usage.registered");

const STATUS_KEY = "claude-usage";
const BRIDGE_PROVIDER = "claude-bridge";
const STATS_URL = "http://127.0.0.1:8788/stats";
const FETCH_TIMEOUT_MS = 2000;

const utilization = (window: unknown): number | undefined => {
    const value = (window as { utilization_pct?: unknown } | undefined)?.utilization_pct;
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
};

/** Footer text from Headroom's /stats payload, or undefined when the fields are missing. */
export function formatUsage(stats: unknown): string | undefined {
    const latest = (stats as { subscription_window?: { latest?: Record<string, unknown> } } | null)
        ?.subscription_window?.latest;
    const fiveHour = utilization(latest?.five_hour);
    const sevenDay = utilization(latest?.seven_day);
    if (fiveHour === undefined || sevenDay === undefined) return undefined;
    return `Claude 5h ${fiveHour}% · 7d ${sevenDay}%`;
}

const fetchUsage = async (): Promise<string | undefined> => {
    try {
        const response = await fetch(STATS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return undefined;
        return formatUsage(await response.json());
    } catch {
        return undefined;
    }
};

export default function claudeUsageExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[CLAUDE_USAGE_REGISTERED]) return;
    guardPi[CLAUDE_USAGE_REGISTERED] = true;

    // Bumped on every clear, so a fetch that resolves after a clear is dropped.
    let generation = 0;

    const clear = (ctx: ExtensionContext): void => {
        generation += 1;
        ctx.ui.setStatus(STATUS_KEY, undefined);
    };

    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        clear(ctx);
    });

    pi.on("model_select", (event, ctx) => {
        if (ctx.mode !== "tui") return;
        if (event.model.provider !== BRIDGE_PROVIDER) clear(ctx);
    });

    pi.on("turn_end", (event, ctx) => {
        // Subagent sessions bind extensions in "print" mode; only the
        // interactive session owns the footer.
        if (ctx.mode !== "tui") return;
        const message = event.message as { role?: string; provider?: string };
        if (message.role !== "assistant" || message.provider !== BRIDGE_PROVIDER) return;
        const started = generation;
        // Not awaited: a slow proxy must not delay the agent loop.
        void fetchUsage().then((text) => {
            if (generation !== started) return;
            ctx.ui.setStatus(STATUS_KEY, text);
        });
    });
}
