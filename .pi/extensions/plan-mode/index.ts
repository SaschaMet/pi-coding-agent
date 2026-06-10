/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { loadProjectAgentConfig } from "../shared/agent-config.ts";
import { isSafeCommand } from "./utils.ts";

// Tools
const DEFAULT_PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];

interface PlanModeConfig {
    allowedTools?: string[] | null;
}

function loadPlanModeConfig(cwd: string): PlanModeConfig {
    const parsed = loadProjectAgentConfig<{ planMode?: PlanModeConfig }>(cwd);
    return parsed?.planMode ?? {};
}

function resolvePlanModeTools(pi: ExtensionAPI, config: PlanModeConfig): string[] {
    const configured = Array.isArray(config.allowedTools)
        ? config.allowedTools.map((tool) => tool.trim()).filter((tool) => tool.length > 0)
        : DEFAULT_PLAN_MODE_TOOLS;

    if (configured.length === 0) return [...DEFAULT_PLAN_MODE_TOOLS];

    const available = new Set(pi.getAllTools().map((tool) => tool.name));
    if (available.size === 0) {
        // Test doubles and early startup may not expose tools yet.
        return [...configured];
    }

    const filtered = configured.filter((tool) => available.has(tool));
    if (filtered.length > 0) return filtered;

    const safeFallback = DEFAULT_PLAN_MODE_TOOLS.filter((tool) => available.has(tool));
    return safeFallback.length > 0 ? safeFallback : [...DEFAULT_PLAN_MODE_TOOLS];
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
    return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
    return message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
    let planModeEnabled = false;
    let normalModeTools: string[] = [];
    let planModeTools: string[] = [...DEFAULT_PLAN_MODE_TOOLS];

    pi.registerFlag("plan", {
        description: "Start in plan mode (read-only exploration)",
        type: "boolean",
        default: false,
    });

    function updateStatus(ctx: ExtensionContext): void {
        if (planModeEnabled) {
            ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        } else {
            ctx.ui.setStatus("plan-mode", undefined);
        }
    }

    function togglePlanMode(ctx: ExtensionContext): void {
        planModeEnabled = !planModeEnabled;

        if (planModeEnabled) {
            normalModeTools = pi.getActiveTools();
            pi.setActiveTools(planModeTools);
            ctx.ui.notify(`Plan mode enabled. Tools: ${planModeTools.join(", ")}`);
        } else {
            pi.setActiveTools(normalModeTools.length > 0 ? normalModeTools : pi.getAllTools().map((tool) => tool.name));
            ctx.ui.notify("Plan mode disabled. Previous tool set restored.");
        }
        updateStatus(ctx);
    }

    pi.registerCommand("plan", {
        description: "Toggle plan mode (read-only exploration)",
        handler: async (_args, ctx) => togglePlanMode(ctx),
    });

    pi.registerShortcut(Key.ctrlAlt("p"), {
        description: "Toggle plan mode",
        handler: async (ctx) => togglePlanMode(ctx),
    });

    // Block destructive bash commands in plan mode
    pi.on("tool_call", async (event) => {
        if (!planModeEnabled || event.toolName !== "bash") return;

        const command = event.input.command as string;
        if (!isSafeCommand(command)) {
            return {
                block: true,
                reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
            };
        }
    });

    // Filter out stale plan/execution context when plan mode is inactive
    pi.on("context", async (event) => {
        if (planModeEnabled) return;

        return {
            messages: event.messages.filter((m) => {
                const msg = m as AgentMessage & { customType?: string };
                if (msg.customType === "plan-mode-context" || msg.customType === "plan-execution-context") return false;
                if (msg.role !== "user") return true;

                const content = msg.content;
                if (typeof content === "string") {
                    return !content.includes("[PLAN MODE ACTIVE]") && !content.includes("[EXECUTING PLAN - Full tool access enabled]");
                }
                if (Array.isArray(content)) {
                    return !content.some(
                        (c) =>
                            c.type === "text" &&
                            ((c as TextContent).text?.includes("[PLAN MODE ACTIVE]") ||
                                (c as TextContent).text?.includes("[EXECUTING PLAN - Full tool access enabled]")),
                    );
                }
                return true;
            }),
        };
    });

    // Inject plan context before agent starts
    pi.on("before_agent_start", async () => {
        if (planModeEnabled) {
            const fileMutationAllowed = planModeTools.includes("edit") || planModeTools.includes("write");
            const mutationLine = fileMutationAllowed
                ? "- File mutation tools are enabled by planMode.allowedTools configuration"
                : "- You CANNOT use: edit, write (file modifications are disabled)";
            return {
                message: {
                    customType: "plan-mode-context",
                    content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: ${planModeTools.join(", ")}
${mutationLine}
- Bash is restricted to an allowlist of read-only commands

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
                    display: false,
                },
            };
        }
    });

    // Handle plan completion and plan mode UI
    pi.on("agent_end", async (event, ctx) => {
        if (!planModeEnabled || !ctx.hasUI) return;

        const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
        if (!lastAssistant || !getTextContent(lastAssistant).match(/\*{0,2}Plan:\*{0,2}\s*\n/i)) return;

        const choice = await ctx.ui.select("Plan mode - what next?", ["Execute the plan", "Stay in plan mode", "Refine the plan"]);

        if (choice?.startsWith("Execute")) {
            planModeEnabled = false;
            pi.setActiveTools(normalModeTools.length > 0 ? normalModeTools : pi.getAllTools().map((tool) => tool.name));
            updateStatus(ctx);

            pi.sendMessage(
                { customType: "plan-mode-execute", content: "Execute the plan you just created.", display: false },
                { triggerTurn: true },
            );
        } else if (choice === "Refine the plan") {
            const refinement = await ctx.ui.editor("Refine the plan:", "");
            if (refinement?.trim()) {
                pi.sendUserMessage(refinement.trim());
            }
        }
    });

    function resetSessionState(): void {
        planModeEnabled = false;
        normalModeTools = [];
    }

    function restoreSessionState(ctx: ExtensionContext, includePlanFlag: boolean): void {
        if (includePlanFlag && pi.getFlag("plan") === true) {
            planModeEnabled = true;
        }

        if (planModeEnabled) {
            if (normalModeTools.length === 0) {
                normalModeTools = pi.getAllTools().map((tool) => tool.name);
            }
            pi.setActiveTools(planModeTools);
        }

        updateStatus(ctx);
    }

    function shouldIncludePlanFlag(event: unknown): boolean {
        const sessionEvent = event as { source?: string; reason?: string };
        if (sessionEvent.source === "session_established") {
            return false;
        }

        return sessionEvent.reason !== "new" && sessionEvent.reason !== "resume";
    }

    // Restore state on initial session load and on session establishment notifications.
    pi.on("session_start", async (event, ctx) => {
        const cwd = ctx.cwd ?? process.cwd();
        const config = loadPlanModeConfig(cwd);
        planModeTools = resolvePlanModeTools(pi, config);

        resetSessionState();
        restoreSessionState(ctx, shouldIncludePlanFlag(event));
    });

    // Runtime emits these events, but older ExtensionAPI typings may not include them yet.
    (pi.on as unknown as (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => void)(
        "session_switch",
        async (_event, ctx) => {
            resetSessionState();
            restoreSessionState(ctx, false);
        },
    );

    (pi.on as unknown as (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => void)(
        "session_established",
        async (_event, ctx) => {
            resetSessionState();
            restoreSessionState(ctx, false);
        },
    );

    // Clear visible plan UI before a session change is applied.
    pi.on("session_before_switch", async (_event, ctx) => {
        resetSessionState();
        updateStatus(ctx);
    });

}
