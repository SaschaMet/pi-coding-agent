/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, type KeyId } from "@mariozechner/pi-tui";
import { loadProjectAgentConfig } from "../shared/agent-config.ts";
import { extractTodoItems, formatTodoItemsForDisplay, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.ts";

// Tools
const DEFAULT_PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "ask_questions", "ask", "web_search", "fetch_web_page", "subagent"];

const DEFAULT_PLAN_WIDGET_SHORTCUT = "ctrl+alt+w";

interface PlanModeConfig {
    toggleWidgetShortcut?: string | null;
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
    let executionMode = false;
    let planWidgetVisible = false;
    let shortcutRegistered = false;
    let todoItems: TodoItem[] = [];
    let normalModeTools: string[] = [];
    let planModeTools: string[] = [...DEFAULT_PLAN_MODE_TOOLS];

    pi.registerFlag("plan", {
        description: "Start in plan mode (read-only exploration)",
        type: "boolean",
        default: false,
    });

    function updateStatus(ctx: ExtensionContext): void {
        const hasPlan = todoItems.length > 0;
        const shouldShowWidget = hasPlan && (executionMode || planWidgetVisible);

        // Footer status
        if (executionMode && hasPlan) {
            const completed = todoItems.filter((t) => t.completed).length;
            ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
        } else if (planModeEnabled) {
            ctx.ui.setStatus(
                "plan-mode",
                ctx.ui.theme.fg("warning", hasPlan ? `Plan ready (${todoItems.length})` : "⏸ plan"),
            );
        } else {
            ctx.ui.setStatus("plan-mode", undefined);
        }

        // Widget showing todo list
        if (shouldShowWidget) {
            const lines = todoItems.map((item) => {
                if (executionMode && item.completed) {
                    return (
                        ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
                    );
                }
                return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
            });
            ctx.ui.setWidget("plan-todos", lines);
        } else {
            ctx.ui.setWidget("plan-todos", undefined);
        }
    }

    function togglePlanMode(ctx: ExtensionContext): void {
        planModeEnabled = !planModeEnabled;
        executionMode = false;
        planWidgetVisible = false;
        todoItems = [];

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

    function togglePlanWidget(ctx: ExtensionContext): void {
        if (todoItems.length === 0) {
            ctx.ui.notify("No plan available yet.", "info");
            return;
        }
        planWidgetVisible = !planWidgetVisible;
        updateStatus(ctx);
        ctx.ui.notify(planWidgetVisible ? "Plan widget shown." : "Plan widget hidden.", "info");
    }

    function persistState(): void {
        // Intentionally no-op.
        // Plan todos are runtime-only to avoid stale todo resurrection across sessions.
    }

    pi.registerCommand("plan", {
        description: "Toggle plan mode (read-only exploration)",
        handler: async (_args, ctx) => togglePlanMode(ctx),
    });

    pi.registerCommand("todos", {
        description: "Show current plan todo list",
        handler: async (_args, ctx) => {
            if (todoItems.length === 0) {
                ctx.ui.notify("No todos. Create a plan first with /plan", "info");
                return;
            }
            const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
            ctx.ui.notify(`Plan Progress:\n${list}`, "info");
        },
    });

    pi.registerCommand("plan-widget", {
        description: "Toggle the plan widget visibility",
        handler: async (_args, ctx) => togglePlanWidget(ctx),
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

    // Filter out stale plan/execution context when neither mode is active
    pi.on("context", async (event) => {
        if (planModeEnabled || executionMode) return;

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

    // Inject plan/execution context before agent starts
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

Ask clarifying questions using ask_questions.
Use web_search (or brave-search skill) for web research.
Use fetch_web_page when you already have a specific URL and need its readable page content.

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

        if (executionMode && todoItems.length > 0) {
            const remaining = todoItems.filter((t) => !t.completed);
            const todoList = formatTodoItemsForDisplay(remaining);
            return {
                message: {
                    customType: "plan-execution-context",
                    content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
                    display: false,
                },
            };
        }
    });

    // Track progress after each turn
    pi.on("turn_end", async (event, ctx) => {
        if (!executionMode || todoItems.length === 0) return;
        if (!isAssistantMessage(event.message)) return;

        const text = getTextContent(event.message);
        if (markCompletedSteps(text, todoItems) > 0) {
            updateStatus(ctx);
        }
        persistState();
    });

    // Handle plan completion and plan mode UI
    pi.on("agent_end", async (event, ctx) => {
        // Check if execution is complete
        if (executionMode && todoItems.length > 0) {
            if (todoItems.every((t) => t.completed)) {
                executionMode = false;
                planWidgetVisible = false;
                todoItems = [];
                pi.setActiveTools(normalModeTools.length > 0 ? normalModeTools : pi.getAllTools().map((tool) => tool.name));
                updateStatus(ctx);
                ctx.ui.notify("Plan complete.", "info");
                persistState(); // Save cleared state so resume doesn't restore old execution mode
            }
            return;
        }

        if (!planModeEnabled || !ctx.hasUI) return;

        // Extract todos from last assistant message
        const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
        if (lastAssistant) {
            const extracted = extractTodoItems(getTextContent(lastAssistant));
            if (extracted.length > 0) {
                todoItems = extracted;
            }
        }

        // Show plan steps and prompt for next action
        if (todoItems.length > 0) {
            updateStatus(ctx);
        }

        const choice = await ctx.ui.select("Plan mode - what next?", [
            todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
            "Stay in plan mode",
            "Refine the plan",
        ]);

        if (choice?.startsWith("Execute")) {
            planModeEnabled = false;
            executionMode = todoItems.length > 0;
            pi.setActiveTools(normalModeTools.length > 0 ? normalModeTools : pi.getAllTools().map((tool) => tool.name));
            updateStatus(ctx);

            const firstTodo = todoItems[0];
            const execMessage =
                firstTodo
                    ? `Execute the plan. Start with: ${firstTodo.text}`
                    : "Execute the plan you just created.";
            pi.sendMessage(
                { customType: "plan-mode-execute", content: execMessage, display: false },
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
        executionMode = false;
        planWidgetVisible = false;
        todoItems = [];
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
        if (!shortcutRegistered) {
            const shortcut = config.toggleWidgetShortcut?.trim() || DEFAULT_PLAN_WIDGET_SHORTCUT;
            if (shortcut) {
                pi.registerShortcut(shortcut as KeyId, {
                    description: "Toggle the plan widget visibility",
                    handler: async (shortcutCtx) => togglePlanWidget(shortcutCtx),
                });
            }
            shortcutRegistered = true;
        }

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
