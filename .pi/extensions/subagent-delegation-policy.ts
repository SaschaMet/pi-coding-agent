import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DELEGATION_POLICY_REGISTERED = Symbol.for("pi.extensions.subagent-delegation-policy.registered");

function extractUrl(text: string): string | null {
    return text.match(/\bhttps?:\/\/[^\s)]+/i)?.[0] ?? null;
}

function isFetchWebPageRequest(text: string): boolean {
    return (
        /\bfetch_web_page\b/i.test(text) ||
        /\bfetch\s+(?:this\s+)?(?:web\s*)?(?:page|url|site|website|link)?\b/i.test(text) ||
        /\bread\s+(?:this\s+)?(?:web\s*)?(?:page|url|site|website|link)\b/i.test(text)
    );
}

function normalizeFetchWebPageDelegation(text: string): string | null {
    const url = extractUrl(text);
    if (!url || !isFetchWebPageRequest(text)) return null;

    if (/\bsummariz(?:e|ing|ation)|summary\b/i.test(text)) {
        return [
            "Use the `subagent` tool in `chain` mode for this web fetch request.",
            "Run exactly two delegated steps with the readonly profile:",
            `1. agent: generic-readonly, task: Fetch and extract readable text from ${url} using fetch_web_page. Return the extracted text.`,
            "2. agent: generic-readonly, task: Summarize this fetched page text: {previous}",
        ].join("\n");
    }

    return [
        "Use the `subagent` tool in `single` mode for this web fetch request.",
        `agent: generic-readonly, task: Fetch and extract readable text from ${url} using fetch_web_page. Return the extracted text.`,
    ].join("\n");
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

export default function subagentDelegationPolicy(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[DELEGATION_POLICY_REGISTERED]) return;
    guardPi[DELEGATION_POLICY_REGISTERED] = true;

    pi.on("input", async (event) => {
        const raw = event.text.trim();
        if (raw.length === 0) return { action: "continue" };

        const fetchDelegation = normalizeFetchWebPageDelegation(raw);
        if (fetchDelegation) {
            return { action: "transform", text: fetchDelegation };
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
                    "- Skill execution requests stay in the current session unless the user explicitly asks for delegation.",
                    "- Do not delegate by default. Inspect and edit the current project/repository directly for normal coding tasks.",
                    "- Web fetch requests that use `fetch_web_page` must run through delegated readonly subagents.",
                    "- When delegation is explicitly requested, use `generic-readonly` for research/planning/summarization tasks.",
                    "- When delegation is explicitly requested, use `generic-worker` for implementation or file-modifying tasks.",
                    "- External-doc or web research task: keep it in-session unless it uses `fetch_web_page` or the user explicitly asks for subagents.",
                    "- High-context repository reconnaissance stays in-session unless the user explicitly asks for delegation.",
                    "- Keep trivial, localized tasks in-session unless user explicitly asks for delegation.",
                    "- Browser or localhost/local-app tasks should stay in-session unless the user explicitly requires delegation.",
                    "- Do not route localhost/local-app browser tasks through subagents.",
                    "- Prefer sandbox or other runtime restrictions for delegated `fetch_web_page` work and other explicitly untrusted network fetches.",
                ].join("\n"),
            },
        };
    });
}
