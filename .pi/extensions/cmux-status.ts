/**
 * cmux status indicator extension.
 *
 * Shows a per-pane badge in the cmux sidebar while the top-level agent loop
 * is active: "running" on agent_start, "needs input" (plus flash and
 * notification) while a UI prompt blocks the loop, cleared on agent_end (all
 * outcomes). Uses the cmux CLI via pi.exec; silently no-ops when pi runs
 * outside cmux (no socket → exec fails, fire-and-forget).
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

// One chain keeps calls in order, so a late "running" cannot overtake a
// "clear". Nothing awaits it: the agent loop never waits on cmux.
let queue: Promise<unknown> = Promise.resolve();

const runCmux = (pi: ExtensionAPI, args: string[]): void => {
    queue = queue
        .then(() => pi.exec("cmux", args, { timeout: EXEC_TIMEOUT_MS }))
        .catch(() => {});
};

const runningArgs = (): string[] => [
    "set-status",
    badgeKey(),
    "running",
    "--icon",
    "sparkle",
    "--color",
    "#ff9500",
];

export default function cmuxStatusExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[CMUX_STATUS_REGISTERED]) return;
    guardPi[CMUX_STATUS_REGISTERED] = true;

    let agentRunning = false;

    pi.on("agent_start", (_event, ctx) => {
        // Subagent sessions bind extensions in "print" mode; only the
        // interactive session should manage the badge.
        if (ctx.mode !== "tui") return;
        agentRunning = true;
        runCmux(pi, runningArgs());
    });

    pi.on("agent_end", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        agentRunning = false;
        runCmux(pi, ["clear-status", badgeKey()]);
    });

    // Prompt events can arrive after agent_end, and slash-command dialogs
    // run while idle: only react during a run.
    pi.on("ui_prompt_start", (_event, ctx) => {
        if (ctx.mode !== "tui" || !agentRunning) return;
        runCmux(pi, [
            "set-status",
            badgeKey(),
            "needs input",
            "--icon",
            "bell.fill",
            "--color",
            "#ff3b30",
        ]);
        // Without a surface id these would target a pane that is not ours.
        if (!process.env.CMUX_SURFACE_ID) return;
        runCmux(pi, ["trigger-flash"]);
        runCmux(pi, ["notify", "--title", "π", "--body", "Needs input"]);
    });

    pi.on("ui_prompt_end", (_event, ctx) => {
        if (ctx.mode !== "tui" || !agentRunning) return;
        runCmux(pi, runningArgs());
    });
}
