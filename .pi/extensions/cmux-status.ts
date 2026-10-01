/**
 * cmux status indicator extension.
 *
 * Shows a per-pane badge in the cmux sidebar while the top-level agent loop
 * is active: "running" on agent_start, "needs input" (plus flash and
 * notification) while a UI prompt blocks the loop, cleared on agent_end (all
 * outcomes). Uses the cmux CLI via pi.exec; silently no-ops when pi runs
 * outside cmux (no socket → exec fails, fire-and-forget).
 *
 * Also offers a `set_pane_title` tool so the agent can name its tab and,
 * when the pane is alone in its workspace, the workspace. The tool is only
 * registered in interactive cmux sessions, so subagents never see it.
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isInsideCmux, isShadowedProjectCopy } from "./lib/extension-helpers.ts";

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

const runCmuxTask = (task: () => Promise<unknown>): void => {
    queue = queue.then(task).catch(() => {});
};

const MAX_TITLE_CHARS = 40;

/** Strips control/format chars (bidi spoofing), leading dashes, and cuts by code point. */
const sanitizeTitle = (raw: string): string =>
    Array.from(
        raw
            .replace(/\p{Cf}/gu, "")
            .replace(/\p{Cc}/gu, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/^[-\s]+/, ""),
    )
        .slice(0, MAX_TITLE_CHARS)
        .join("");

/** True when the workspace holds exactly one surface (workers share the orchestrator's workspace). */
const isOnlySurface = (treeJson: string, workspaceId: string): boolean => {
    const tree = JSON.parse(treeJson) as {
        windows?: Array<{
            workspaces?: Array<{ id?: string; panes?: Array<{ surface_count?: number }> }>;
        }>;
    };
    for (const win of tree.windows ?? []) {
        for (const ws of win.workspaces ?? []) {
            if (ws.id !== workspaceId) continue;
            const total = (ws.panes ?? []).reduce((sum, pane) => sum + (pane.surface_count ?? 0), 0);
            return total === 1;
        }
    }
    return false;
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

    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui" || !isInsideCmux()) return;
        pi.registerTool({
            name: "set_pane_title",
            label: "Set pane title",
            description:
                "Rename the cmux tab (and the workspace when this pane is alone in it) to a short task name.",
            promptSnippet: "Name the cmux tab after the current task",
            promptGuidelines: [
                "Call set_pane_title (max 4 words) once the task is clear, and again when the topic changes.",
            ],
            parameters: Type.Object({
                title: Type.String({ minLength: 1, maxLength: 80, description: "Short task name, max 4 words" }),
            }),
            execute: async (_id, params) => {
                const title = sanitizeTitle(params.title);
                if (!title) throw new Error("Title is empty after sanitizing");
                const surfaceId = process.env.CMUX_SURFACE_ID;
                const workspaceId = process.env.CMUX_WORKSPACE_ID;
                // --title: rename-tab parses a flag-like positional title as a flag, even after "--".
                runCmux(pi, ["rename-tab", "--surface", surfaceId ?? "", "--title", title]);
                if (workspaceId) {
                    runCmuxTask(async () => {
                        const tree = await pi.exec("cmux", ["tree", "--workspace", workspaceId, "--json"], {
                            timeout: EXEC_TIMEOUT_MS,
                        });
                        if (!isOnlySurface(tree.stdout, workspaceId)) return;
                        await pi.exec("cmux", ["workspace", "rename", workspaceId, "--title", title], {
                            timeout: EXEC_TIMEOUT_MS,
                        });
                    });
                }
                return { content: [{ type: "text", text: `Title requested: ${title}` }], details: undefined };
            },
        });
    });

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
