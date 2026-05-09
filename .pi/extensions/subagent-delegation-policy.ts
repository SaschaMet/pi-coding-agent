import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

export default function subagentDelegationPolicy(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[DELEGATION_POLICY_REGISTERED]) return;
    guardPi[DELEGATION_POLICY_REGISTERED] = true;

    pi.on("input", async (event) => {
        const raw = event.text.trim();
        if (raw.length === 0) return { action: "continue" };

        const explicitDelegation = normalizeExplicitDelegation(raw);
        if (explicitDelegation) {
            return { action: "transform", text: explicitDelegation };
        }

        return { action: "continue" };
    });

    pi.on("before_agent_start", async () => {
        return {
            message: {
                customType: "subagent-delegation-policy",
                display: false,
                content: [
                    "[DELEGATION POLICY]",
                    "- Explicit user delegation request: must call `Agent` from `@tintinweb/pi-subagents`.",
                    "- Retrieve background results with `get_subagent_result`; steer running agents with `steer_subagent`.",
                    "- Skill execution requests stay in the current session unless the user explicitly asks for delegation.",
                    "- Do not delegate by default. Inspect and edit the current project/repository directly for normal coding tasks.",
                    "- When delegation is explicitly requested, use `generic-readonly` or built-in `Explore`/`Plan` for research/planning/summarization tasks.",
                    "- When delegation is explicitly requested, use `generic-worker` or built-in `general-purpose` for implementation or file-modifying tasks.",
                    "- External-doc or web research task: keep it in-session unless the user explicitly asks for subagents.",
                    "- High-context repository reconnaissance stays in-session unless the user explicitly asks for delegation.",
                    "- Keep trivial, localized tasks in-session unless user explicitly asks for delegation.",
                ].join("\n"),
            },
        };
    });
}
