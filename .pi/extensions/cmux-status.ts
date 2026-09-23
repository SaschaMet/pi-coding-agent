/**
 * cmux status indicator extension.
 *
 * Shows a per-pane "running" badge in the cmux sidebar while the top-level
 * agent loop is active: sets a status pill on agent_start, clears it on
 * agent_end (all outcomes). Uses the cmux CLI via pi.exec; silently no-ops
 * when pi runs outside cmux (no socket → exec fails, fire-and-forget).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const CMUX_STATUS_REGISTERED = Symbol.for("pi.extensions.cmux-status.registered");

const EXEC_TIMEOUT_MS = 3000;

/** Per-pane badge key; shared key when the surface id is unknown. */
const badgeKey = (): string => {
    const surfaceId = process.env.CMUX_SURFACE_ID;
    return surfaceId ? `pi-${surfaceId}` : "pi";
};

const runCmux = (pi: ExtensionAPI, args: string[]): void => {
    // Fire-and-forget: a slow or missing cmux socket must not block the
    // agent loop.
    void pi.exec("cmux", args, { timeout: EXEC_TIMEOUT_MS }).catch(() => {});
};

export default function cmuxStatusExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[CMUX_STATUS_REGISTERED]) return;
    guardPi[CMUX_STATUS_REGISTERED] = true;

    pi.on("agent_start", (_event, ctx) => {
        // Subagent sessions bind extensions in "print" mode; only the
        // interactive session should manage the badge.
        if (ctx.mode !== "tui") return;
        runCmux(pi, [
            "set-status",
            badgeKey(),
            "running",
            "--icon",
            "sparkle",
            "--color",
            "#ff9500",
        ]);
    });

    pi.on("agent_end", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        runCmux(pi, ["clear-status", badgeKey()]);
    });
}
