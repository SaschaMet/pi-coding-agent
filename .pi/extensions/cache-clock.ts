/**
 * Prompt-cache clock extension.
 *
 * Shows the minutes until the provider's prompt cache goes cold in the footer
 * (and the cmux sidebar inside cmux), counted from the last assistant
 * response. On a known 60-minute cache it compacts an idle session between
 * minute 58 and 60, so the next prompt does not pay to re-cache the full
 * history. Past minute 60 the cache is already cold, so it does not compact.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";
import {
    cacheTtl,
    type ClockState,
    cmuxStatusKey,
    formatCacheStatus,
    shouldAutoCompact,
} from "./lib/cache-clock.ts";

const CACHE_CLOCK_REGISTERED = Symbol.for("pi.extensions.cache-clock.registered");

// Sorts before "headroom", so the footer shows it left of that segment.
const STATUS_KEY = "cache-clock";
const TICK_MS = 15_000;
const EXEC_TIMEOUT_MS = 3000;

export default function cacheClockExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[CACHE_CLOCK_REGISTERED]) return;
    guardPi[CACHE_CLOCK_REGISTERED] = true;

    let state: ClockState = { compacted: false };
    let attemptedFor: number | undefined;
    let running = false;
    let compacting = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let footerText: string | undefined;
    let cmuxText: string | undefined;

    // One chain keeps cmux calls in order; nothing awaits it and errors are dropped.
    let queue: Promise<unknown> = Promise.resolve();
    const runCmux = (args: string[]): void => {
        if (!process.env.CMUX_WORKSPACE_ID) return;
        queue = queue.then(() => pi.exec("cmux", args, { timeout: EXEC_TIMEOUT_MS })).catch(() => {});
    };

    const render = (ctx: ExtensionContext): void => {
        const { ttlMs } = cacheTtl(ctx.model, process.env);
        const text = formatCacheStatus(state, ttlMs, Date.now());
        if (text !== footerText) {
            footerText = text;
            ctx.ui.setStatus(STATUS_KEY, text);
        }
        if (text !== cmuxText) {
            cmuxText = text;
            runCmux(["set-status", cmuxStatusKey(process.env), text, "--icon", "clock"]);
        }
    };

    const maybeCompact = (ctx: ExtensionContext): void => {
        const { autoCompact } = cacheTtl(ctx.model, process.env);
        const due = shouldAutoCompact({
            lastResponseAt: state.lastResponseAt,
            attemptedFor,
            compacting,
            running,
            autoCompact,
            now: Date.now(),
        });
        if (!due || !ctx.isIdle() || ctx.hasPendingMessages()) return;
        // Marked before the call: onError may fire synchronously.
        attemptedFor = state.lastResponseAt;
        compacting = true;
        ctx.ui.notify("Prompt cache expires in 2 minutes; compacting the idle session.", "info");
        ctx.compact({
            onComplete: () => {
                compacting = false;
            },
            onError: () => {
                compacting = false;
            },
        });
    };

    const tick = (ctx: ExtensionContext): void => {
        try {
            render(ctx);
            maybeCompact(ctx);
        } catch {
            // A throw here would surface as an uncaught timer error; the next tick retries the render.
        }
    };

    const stopTimer = (): void => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
    };

    pi.on("session_start", (_event, ctx) => {
        // Subagent sessions bind extensions in "print" mode; only the
        // interactive session owns the footer.
        if (ctx.mode !== "tui") return;
        stopTimer();
        state = { compacted: false };
        attemptedFor = undefined;
        running = false;
        compacting = false;
        timer = setInterval(() => tick(ctx), TICK_MS);
        render(ctx);
    });

    pi.on("message_end", (event, ctx) => {
        if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
        state = { lastResponseAt: Date.now(), compacted: false };
        render(ctx);
    });

    pi.on("agent_start", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        running = true;
    });

    pi.on("agent_end", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        running = false;
    });

    pi.on("session_before_compact", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        compacting = true;
    });

    pi.on("session_compact", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        compacting = false;
        // The old prefix is gone; only a new response restarts the clock.
        state = { compacted: true };
        render(ctx);
    });

    pi.on("session_compact_failed", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        compacting = false;
    });

    pi.on("session_shutdown", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        stopTimer();
        footerText = undefined;
        ctx.ui.setStatus(STATUS_KEY, undefined);
        if (cmuxText !== undefined) runCmux(["clear-status", cmuxStatusKey(process.env)]);
        cmuxText = undefined;
    });
}
