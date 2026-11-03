/**
 * cmux status indicator extension.
 *
 * Shows a per-pane state pill in the cmux sidebar: "idle" between runs,
 * "working" while the top-level agent loop is active, "needs input" (plus
 * flash and notification) while a UI prompt blocks the loop. A second,
 * workspace-wide pill lists the workspace's tab names. Both pills are removed
 * on session shutdown. Uses the cmux CLI via pi.exec and runs nothing outside
 * a live cmux terminal.
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

// The cmux gate guarantees a surface id, so the key is always per pane.
const stateKey = (): string => `pi-${process.env.CMUX_SURFACE_ID}`;
const TABS_KEY = "pi-tabs";
const TAB_SEPARATOR = " · ";

const STATES = {
    working: ["working", "--icon", "sparkle", "--color", "#ff9500"],
    needsInput: ["needs input", "--icon", "bell.fill", "--color", "#ff3b30"],
    idle: ["idle", "--icon", "moon.zzz", "--color", "#8e8e93"],
} as const;

// One chain keeps calls in order, so a late "working" cannot overtake an
// "idle". Only shutdown awaits it: the agent loop never waits on cmux.
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

type CmuxTree = {
    windows?: Array<{
        workspaces?: Array<{
            id?: string;
            panes?: Array<{ surface_count?: number; surfaces?: Array<{ title?: unknown }> }>;
        }>;
    }>;
};

/** Unparsable output reads as an empty tree: callers then send nothing. */
const parseTree = (treeJson: string): CmuxTree => {
    try {
        return JSON.parse(treeJson) as CmuxTree;
    } catch {
        return {};
    }
};

/** True when the workspace holds exactly one surface (workers share the orchestrator's workspace). */
const isOnlySurface = (treeJson: string, workspaceId: string): boolean => {
    const tree = parseTree(treeJson);
    for (const win of tree.windows ?? []) {
        for (const ws of win.workspaces ?? []) {
            if (ws.id !== workspaceId) continue;
            const total = (ws.panes ?? []).reduce((sum, pane) => sum + (pane.surface_count ?? 0), 0);
            return total === 1;
        }
    }
    return false;
};

/** Tab titles of one workspace in pane, then surface order; empty titles dropped. */
const tabNames = (treeJson: string, workspaceId: string): string[] => {
    const tree = parseTree(treeJson);
    for (const win of tree.windows ?? []) {
        for (const ws of win.workspaces ?? []) {
            if (ws.id !== workspaceId) continue;
            return (ws.panes ?? [])
                .flatMap((pane) => pane.surfaces ?? [])
                .map((surface) => (typeof surface.title === "string" ? sanitizeTitle(surface.title) : ""))
                .filter((name) => name.length > 0);
        }
    }
    return [];
};

const setState = (pi: ExtensionAPI, state: keyof typeof STATES): void => {
    runCmux(pi, ["set-status", stateKey(), ...STATES[state]]);
};

// Subagent sessions bind extensions in "print" mode and must not touch the
// parent's pills; outside a live cmux terminal no cmux process may start.
const active = (ctx: { mode: string }): boolean => ctx.mode === "tui" && isInsideCmux();

export default function cmuxStatusExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[CMUX_STATUS_REGISTERED]) return;
    guardPi[CMUX_STATUS_REGISTERED] = true;

    let agentRunning = false;
    // Last tab text sent, so an unchanged list costs no set-status call.
    let lastTabs = "";

    // force: another pi session in this workspace may have cleared the shared
    // pill on its shutdown, so an unchanged text still has to be re-sent.
    const refreshTabs = (force = false): void => {
        const workspaceId = process.env.CMUX_WORKSPACE_ID;
        if (!workspaceId) return;
        runCmuxTask(async () => {
            const tree = await pi.exec("cmux", ["tree", "--workspace", workspaceId, "--json"], {
                timeout: EXEC_TIMEOUT_MS,
            });
            const text = tabNames(tree.stdout, workspaceId).join(TAB_SEPARATOR);
            if (!text || (!force && text === lastTabs)) return;
            await pi.exec(
                "cmux",
                ["set-status", TABS_KEY, text, "--icon", "rectangle.stack", "--workspace", workspaceId],
                { timeout: EXEC_TIMEOUT_MS },
            );
            lastTabs = text;
        });
    };

    pi.on("session_start", (_event, ctx) => {
        if (!active(ctx)) return;
        setState(pi, "idle");
        refreshTabs();
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
                refreshTabs();
                return { content: [{ type: "text", text: `Title requested: ${title}` }], details: undefined };
            },
        });
    });

    pi.on("agent_start", (_event, ctx) => {
        if (!active(ctx)) return;
        agentRunning = true;
        setState(pi, "working");
    });

    pi.on("agent_end", (_event, ctx) => {
        if (!active(ctx)) return;
        agentRunning = false;
        setState(pi, "idle");
        refreshTabs(true);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        if (!active(ctx)) return;
        runCmux(pi, ["clear-status", stateKey()]);
        const workspaceId = process.env.CMUX_WORKSPACE_ID;
        if (workspaceId) runCmux(pi, ["clear-status", TABS_KEY, "--workspace", workspaceId]);
        lastTabs = "";
        // pi may exit right after this handler; stale pills would outlive it.
        await queue;
    });

    // Prompt events can arrive after agent_end, and slash-command dialogs
    // run while idle: only react during a run.
    pi.on("ui_prompt_start", (_event, ctx) => {
        if (!active(ctx) || !agentRunning) return;
        setState(pi, "needsInput");
        runCmux(pi, ["trigger-flash"]);
        runCmux(pi, ["notify", "--title", "π", "--body", "Needs input"]);
    });

    pi.on("ui_prompt_end", (_event, ctx) => {
        if (!active(ctx) || !agentRunning) return;
        setState(pi, "working");
    });
}
