import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DELEGATION_POLICY_REGISTERED = Symbol.for("pi.extensions.subagent-delegation-policy.registered");

function isLocalBrowserOrLoopbackTask(text: string): boolean {
    return (
        /\b(browser|browser tool|browser-desktop)\b/i.test(text) &&
        /\b(localhost|127\.0\.0\.1|::1|local app)\b/i.test(text)
    ) || /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\b/i.test(text);
}

function normalizeExplicitDelegation(text: string): string | null {
    const fetchSummarize = text.match(
        /\bfetch\s+and\s+summariz(?:e|ing)\b[\s\S]*?(https?:\/\/[^\s)]+)\s*$/i,
    );
    if (fetchSummarize) {
        const url = fetchSummarize[1];
        return [
            "Use the `subagent` tool in `chain` mode for this explicit delegation request.",
            "Run exactly two delegated steps with the readonly profile:",
            `1. agent: generic-readonly, task: Fetch and extract readable text from ${url} using fetch_web_page. Return the extracted text.`,
            "2. agent: generic-readonly, task: Summarize this fetched page text: {previous}",
        ].join("\n");
    }

    const match = text.match(
        /spawn\s+(?:a\s+)?sub-?agent\s+for\s+(.+?)\s+and\s+another\s+(?:one\s+)?for\s+(.+)/i,
    );
    if (!match) return null;

    const firstTask = match[1]?.trim();
    const secondTask = match[2]?.trim();
    if (!firstTask || !secondTask) return null;

    return [
        "Use the `subagent` tool in `chain` mode for this explicit delegation request.",
        "Run exactly two delegated steps:",
        `1. agent: generic-readonly, task: ${firstTask}`,
        `2. agent: generic-readonly, task: ${secondTask}. Use this prior output as needed: {previous}`,
    ].join("\n");
}

function normalizeSkillDelegation(text: string): string | null {
    const skillCommand = text.match(/^\/skill:([a-z0-9_-]+)\s*(.*)$/i);
    if (skillCommand) {
        const skill = skillCommand[1];
        const task = skillCommand[2]?.trim() || "execute requested skill workflow";
        if (skill === "browser-desktop" && isLocalBrowserOrLoopbackTask(task)) {
            return "Use the browser tool in the current session. Keep this localhost/local-app browser task local.";
        }
        return `Use the \`subagent\` tool. Delegate to agent \`${skill}\` with task: ${task}`;
    }

    const skillRequest = text.match(/\buse\s+([a-z0-9_-]+)\s+skill\b/i);
    if (!skillRequest) return null;
    const skill = skillRequest[1];
    if (skill === "browser-desktop" && isLocalBrowserOrLoopbackTask(text)) {
        return "Use the browser tool in the current session. Keep this localhost/local-app browser task local.";
    }
    return `Use the \`subagent\` tool. Delegate to agent \`${skill}\` and execute the requested skill workflow.`;
}

export default function subagentDelegationPolicy(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[DELEGATION_POLICY_REGISTERED]) return;
    guardPi[DELEGATION_POLICY_REGISTERED] = true;

    pi.on("input", async (event) => {
        const raw = event.text.trim();
        if (raw.length === 0) return { action: "continue" };

        const skillInstruction = normalizeSkillDelegation(raw);
        if (skillInstruction) {
            return { action: "transform", text: skillInstruction };
        }

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
                    "- Explicit user delegation request: must call `subagent`.",
                    "- Skill execution request: must run through a matching skill-backed subagent. Do not run /skill inline.",
                    "- Do not delegate by default. First decide whether in-session execution is simpler and lower-overhead.",
                    "- Use `generic-readonly` for research/planning/summarization tasks.",
                    "- Use `generic-worker` for implementation or file-modifying tasks.",
                    "- External-doc or web research task: prefer delegated readonly recon only when the task benefits from isolation or parallelism.",
                    "- High-context reconnaissance tasks: prefer multi-step delegation chains over one large local turn.",
                    "- Keep trivial, localized tasks in-session unless user explicitly asks for delegation.",
                    "- Browser or localhost/local-app tasks should stay in-session unless the user explicitly requires delegation.",
                    "- Do not route localhost/local-app browser tasks through subagents.",
                    "- Prefer sandbox or other runtime restrictions for risky, destructive, networked, or untrusted delegated work.",
                ].join("\n"),
            },
        };
    });
}
