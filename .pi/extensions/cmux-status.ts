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
 * Until the agent calls it, the tab gets a short form of the session name:
 * pi's own terminal title ("π - <name> - <folder>") is too long for the
 * sidebar, and an explicit cmux rename overrides it.
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

/** Strips control/format chars (bidi spoofing) and leading dashes. */
const cleanTitle = (raw: string): string =>
    raw
        .replace(/\p{Cf}/gu, "")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[-\s]+/, "");

/** cleanTitle, then cut by code point. */
const sanitizeTitle = (raw: string): string => Array.from(cleanTitle(raw)).slice(0, MAX_TITLE_CHARS).join("");

const SHORT_TITLE_WORDS = 4;
// Words that start a qualifier; the short title stops before them.
const CUT_WORDS = new Set(["for", "in", "into", "to", "of", "with", "on", "from", "and", "as", "via", "using"]);

/** "Investigate manual read approval for subagent orchestrator" → "Investigate manual read approval". */
const shortTitle = (name: string): string => {
    const words = cleanTitle(name.replace(/[.!?]+$/, "")).split(" ");
    const cut = words.findIndex((word, i) => i > 0 && CUT_WORDS.has(word.toLowerCase()));
    const kept = words.slice(0, cut === -1 ? SHORT_TITLE_WORDS : Math.min(cut, SHORT_TITLE_WORDS));
    // Drop whole words rather than let sanitizeTitle cut the last one mid-word.
    while (kept.length > 1 && Array.from(kept.join(" ")).length > MAX_TITLE_CHARS) kept.pop();
    return sanitizeTitle(kept.join(" "));
};

type CmuxTree = {
    windows?: Array<{
        workspaces?: Array<{
            id?: string;
            panes?: Array<{ surface_count?: number; surfaces?: Array<{ id?: unknown; title?: unknown }> }>;
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

const STATE_PILL = /^(pi-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})=/i;

/**
 * State pill keys (`pi-<surface uuid>`) whose tab no longer exists. A pi killed
 * without shutdown leaves its pill behind. Empty unless the tree lists the
 * caller's own tab, so a partial or failed tree answer never clears live pills.
 */
const staleStateKeys = (statusLines: string, treeJson: string, workspaceId: string, selfId: string): string[] => {
    const tree = parseTree(treeJson);
    const live = new Set<string>();
    for (const win of tree.windows ?? []) {
        for (const ws of win.workspaces ?? []) {
            if (ws.id !== workspaceId) continue;
            for (const surface of (ws.panes ?? []).flatMap((pane) => pane.surfaces ?? [])) {
                if (typeof surface.id === "string") live.add(surface.id.toUpperCase());
            }
        }
    }
    if (!live.has(selfId.toUpperCase())) return [];
    return statusLines
        .split("\n")
        .map((line) => STATE_PILL.exec(line.trim())?.[1])
        .filter((key): key is string => key !== undefined && !live.has(key.slice(3).toUpperCase()));
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
    // An explicit set_pane_title beats the auto title from the session name.
    let titlePinned = false;

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

    const clearStalePills = (): void => {
        const workspaceId = process.env.CMUX_WORKSPACE_ID;
        const selfId = process.env.CMUX_SURFACE_ID;
        if (!workspaceId || !selfId) return;
        runCmuxTask(async () => {
            const status = await pi.exec("cmux", ["list-status", "--workspace", workspaceId], {
                timeout: EXEC_TIMEOUT_MS,
            });
            const tree = await pi.exec("cmux", ["--id-format", "uuids", "tree", "--workspace", workspaceId, "--json"], {
                timeout: EXEC_TIMEOUT_MS,
            });
            for (const key of staleStateKeys(status.stdout, tree.stdout, workspaceId, selfId)) {
                await pi.exec("cmux", ["clear-status", key, "--workspace", workspaceId], { timeout: EXEC_TIMEOUT_MS });
            }
        });
    };

    const applyTitle = (title: string): void => {
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
    };

    const applySessionName = (name: string | undefined): void => {
        if (titlePinned || !name) return;
        const title = shortTitle(name);
        if (title) applyTitle(title);
    };

    pi.on("session_start", (event, ctx) => {
        if (!active(ctx)) return;
        setState(pi, "idle");
        refreshTabs();
        clearStalePills();
        // A reload keeps the tab's cmux rename, which may come from set_pane_title.
        if (event.reason !== "reload") {
            titlePinned = false;
            applySessionName(pi.getSessionName());
        }
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
                titlePinned = true;
                applyTitle(title);
                return { content: [{ type: "text", text: `Title requested: ${title}` }], details: undefined };
            },
        });
    });

    pi.on("session_info_changed", (event, ctx) => {
        if (!active(ctx)) return;
        applySessionName(event.name);
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
