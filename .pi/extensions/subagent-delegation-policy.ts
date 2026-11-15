import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isInsideCmux, isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const DELEGATION_POLICY_REGISTERED = Symbol.for("pi.extensions.subagent-delegation-policy.registered");

function normalizeExplicitDelegation(text: string): string | null {
    const match = text.match(
        /spawn\s+(?:a\s+)?sub-?agent\s+for\s+(.+?)\s+and\s+another\s+(?:one\s+)?for\s+(.+)/i,
    );
    if (!match) return null;

    const firstTask = match[1]?.trim();
    const secondTask = match[2]?.trim();
    if (!firstTask || !secondTask) return null;

    return [
        "Use the `Agent` tool from `@tintinweb/pi-subagents` for this explicit delegation request.",
        "Run the first delegated step in foreground:",
        `Agent({ subagent_type: "generic-readonly", description: "First delegated step", prompt: ${JSON.stringify(firstTask)} })`,
        "Then run the second delegated step after the first result is available:",
        `Agent({ subagent_type: "generic-readonly", description: "Second delegated step", prompt: ${JSON.stringify(`${secondTask}. Use the prior agent result as context.`)} })`,
    ].join("\n");
}

// Subagent sessions bind extensions in "print" mode; only the interactive
// session should steer toward panes.
const inCmuxTui = (ctx: { mode?: string }): boolean => ctx.mode === "tui" && isInsideCmux();

const CMUX_RULE =
    "- Running in cmux: work the user should watch (parallel workers, long research, reviews) goes to a cmux pane worker per `$cmux-orchestration`, not an inline `Agent`. Research for your own context and skill-mandated dispatch keep `Agent`.";

export default function subagentDelegationPolicy(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[DELEGATION_POLICY_REGISTERED]) return;
    guardPi[DELEGATION_POLICY_REGISTERED] = true;

    pi.on("input", async (event, ctx) => {
        const raw = event.text.trim();
        if (raw.length === 0) return { action: "continue" };

        if (inCmuxTui(ctx)) return { action: "continue" };

        const explicitDelegation = normalizeExplicitDelegation(raw);
        if (explicitDelegation) {
            return { action: "transform", text: explicitDelegation };
        }

        return { action: "continue" };
    });

    pi.on("before_agent_start", async (event, ctx) => {
        const policy = [
            "[DELEGATION POLICY]",
            "- Explicit user delegation request: must call `Agent` from `@tintinweb/pi-subagents`.",
            "- Retrieve background results with `get_subagent_result`; steer running agents with `steer_subagent`.",
            "- Skill execution requests stay in the current session unless the user explicitly asks for delegation.",
            "- Do not delegate implementation or edits by default. Inspect and edit the current project/repository directly for normal coding tasks.",
            "- Subagent models follow the **Model roles** section of `.pi/SYSTEM.md` (implementation: Sonnet 5.5 medium; review: Opus 5.5 medium) unless the user, the repo's `AGENTS.md`, or the invoked skill names another model. If the role model is unavailable, fall back to `iqRouter/grunt` once and tell the user.",
            "- Research and look-up subagents: `claude-bridge/claude-haiku-5-5`, thinking `low` for lookups and summaries, `medium` for research that feeds a document.",
            "- When delegation is explicitly requested, use `generic-readonly` for research/planning/summarization tasks.",
            "- When delegation is explicitly requested, use `generic-worker` or built-in `general-purpose` for implementation or file-modifying tasks.",
            "- External-doc or web research task: keep it in-session unless the user explicitly asks for subagents.",
            "- Repository reconnaissance that feeds a research artifact: delegate the searching to `generic-readonly` and keep only the returned summary in this context.",
            "- A skill may direct delegation for drafting a document (spec, research, review notes); follow the skill in that case. This is not implementation.",
            "- Keep trivial, localized tasks in-session unless user explicitly asks for delegation.",
            ...(inCmuxTui(ctx) ? [CMUX_RULE] : []),
        ].join("\n");
        // A section, not a forced prompt: the Claude bridge forwards sections, and an unchanged one is sent once.
        event.systemPromptOptions.sections.delegation_policy = policy;
    });
}
