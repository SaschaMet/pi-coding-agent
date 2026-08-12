import type {
    ExtensionAPI,
    ExtensionContext,
    MessageEndEvent,
    ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { readLastCustomEntry } from "./lib/extension-helpers.ts";
import {
    buildCorrection,
    checkChangesDisclosed,
    checkVerificationRan,
    checkWrittenArtifacts,
    parsePorcelain,
    type RecordedToolCall,
} from "./lib/gate-checks.ts";

const GATES_REGISTERED = Symbol.for("pi.extensions.gates.registered");
const GATES_STATE_TYPE = "gates-state";

type GatesState = {
    enabled: boolean;
    baseline: Set<string> | null;
    toolCalls: RecordedToolCall[];
    assistantText: string;
    consecutiveCorrections: number;
    workTreeChecked: boolean;
    isWorkTree: boolean;
};

const states = new WeakMap<object, GatesState>();

function defaultState(): GatesState {
    return {
        enabled: true,
        baseline: null,
        toolCalls: [],
        assistantText: "",
        consecutiveCorrections: 0,
        workTreeChecked: false,
        isWorkTree: false,
    };
}

function getState(pi: ExtensionAPI): GatesState {
    let state = states.get(pi as object);
    if (!state) {
        state = defaultState();
        states.set(pi as object, state);
    }
    return state;
}

function extractMessageText(message: MessageEndEvent["message"]): string {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
        .map((block) => {
            if (typeof block === "string") return block;
            if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
                return (block as { text: string }).text;
            }
            return "";
        })
        .join("\n");
}

async function isGitWorkTree(pi: ExtensionAPI, state: GatesState, cwd: string): Promise<boolean> {
    if (state.workTreeChecked) return state.isWorkTree;
    state.workTreeChecked = true;
    try {
        const result = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
        state.isWorkTree = result.code === 0 && result.stdout.trim() === "true";
    } catch {
        state.isWorkTree = false;
    }
    return state.isWorkTree;
}

/** Returns reported paths, or null when git cannot answer (gates then fail open). */
async function gitChangedPaths(
    pi: ExtensionAPI,
    state: GatesState,
    cwd: string,
): Promise<Set<string> | null> {
    try {
        if (!(await isGitWorkTree(pi, state, cwd))) return null;
        // `-uall` is required: plain --porcelain collapses untracked directories into a
        // single `?? dir/` entry, which would name a directory instead of the new file.
        // `core.quotePath=false` keeps non-ASCII paths readable instead of octal-escaped,
        // so a disclosed path can actually match what the assistant wrote.
        const result = await pi.exec(
            "git",
            ["-c", "core.quotePath=false", "status", "--porcelain", "-uall"],
            { cwd },
        );
        if (result.code !== 0) return null;
        return parsePorcelain(result.stdout);
    } catch {
        return null;
    }
}

export default function gatesExtension(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[GATES_REGISTERED]) return;
    guardPi[GATES_REGISTERED] = true;

    const report = (content: string) => {
        pi.sendMessage(
            { customType: GATES_STATE_TYPE, display: true, content },
            { deliverAs: "nextTurn" },
        );
    };

    /**
     * State lives on the `pi` object and outlives a branch switch, so a branch carrying no
     * gates entry must reset to the default rather than inherit the previous branch's toggle.
     */
    const applyPersistedState = (ctx: ExtensionContext) => {
        const entry = readLastCustomEntry<{ enabled?: unknown }>(ctx, GATES_STATE_TYPE);
        const state = getState(pi);
        state.enabled = typeof entry?.data?.enabled === "boolean" ? entry.data.enabled : true;
    };

    pi.on("session_start", async (_event, ctx) => {
        applyPersistedState(ctx);
    });
    pi.on("session_tree", async (_event, ctx) => {
        applyPersistedState(ctx);
    });

    pi.on("agent_start", async (_event, ctx) => {
        const state = getState(pi);
        state.toolCalls = [];
        state.assistantText = "";
        state.baseline = null;
        if (!state.enabled) return;
        state.baseline = await gitChangedPaths(pi, state, ctx.cwd);
    });

    // Recorded on `tool_result`, not `tool_call`: a call another guard blocked never
    // produces a result, so it can no longer be reported as a write that did not land.
    pi.on("tool_result", async (event: ToolResultEvent) => {
        const state = getState(pi);
        if (!state.enabled) return undefined;
        state.toolCalls.push({
            toolName: event.toolName,
            input: event.input,
            isError: event.isError,
        });
        return undefined;
    });

    pi.on("message_end", async (event) => {
        const state = getState(pi);
        if (!state.enabled) return undefined;
        if (event.message.role !== "assistant") return undefined;
        const text = extractMessageText(event.message);
        if (text.trim().length > 0) state.assistantText = text;
        return undefined;
    });

    pi.on("agent_end", async (_event, ctx) => {
        const state = getState(pi);
        if (!state.enabled) return;

        const current = await gitChangedPaths(pi, state, ctx.cwd);

        const violations = [
            ...(current === null || state.baseline === null
                ? []
                : checkChangesDisclosed(state.baseline, current, state.assistantText)),
            ...checkWrittenArtifacts(state.toolCalls, ctx.cwd),
            ...checkVerificationRan(state.toolCalls, state.assistantText),
        ];

        if (violations.length === 0) {
            state.consecutiveCorrections = 0;
            return;
        }

        // One correction per violating streak: a correction starts a new run, which would
        // otherwise re-trigger this handler indefinitely.
        if (state.consecutiveCorrections >= 1) {
            report(`[GATES] ${violations.length} violation(s) still open; a correction was already sent for this streak.`);
            return;
        }

        state.consecutiveCorrections += 1;
        pi.sendUserMessage(buildCorrection(violations));
    });

    pi.registerCommand("gates", {
        description: "Toggle deterministic post-turn gates (on|off; no argument reports status)",
        handler: async (args: string) => {
            const state = getState(pi);
            const requested = args.trim().toLowerCase();

            if (requested === "on" || requested === "off") {
                state.enabled = requested === "on";
                state.consecutiveCorrections = 0;
                pi.appendEntry(GATES_STATE_TYPE, { enabled: state.enabled });
                report(`Gates ${state.enabled ? "on" : "off"}.`);
                return;
            }

            report(
                [
                    `Gates are ${state.enabled ? "on" : "off"}.`,
                    "Checks: changes_disclosed, artifacts_exist/files_non_empty, verification_actually_ran.",
                    "Usage: /gates on | /gates off",
                ].join("\n"),
            );
        },
    });
}
