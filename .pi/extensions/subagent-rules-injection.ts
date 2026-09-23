import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const SUBAGENT_RULES_REGISTERED = Symbol.for("pi.extensions.subagent-rules-injection.registered");
const SUBAGENT_RULES_INJECTED = Symbol.for("pi.extensions.subagent-rules-injection.injected");

// pi-subagents embeds this tag in every subagent system prompt (buildAgentPrompt) and
// documents it as the hook for downstream extensions to detect child sessions.
const SUBAGENT_TAG = '<active_agent name="';

// Stable line 1 of .pi/SYSTEM.md. An append-mode subagent's system prompt already
// contains the rules (the parent prompt embeds SYSTEM.md as its base), so a prompt
// that carries this marker needs no re-injection.
export const RULES_MARKER = "# Role and Communication";

const RULES_FILE = join(".pi", "SYSTEM.md");

export default function subagentRulesInjection(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[SUBAGENT_RULES_REGISTERED]) return;
    guardPi[SUBAGENT_RULES_REGISTERED] = true;

    pi.on("before_agent_start", async (event) => {
        const systemPrompt = (event as { systemPrompt?: string }).systemPrompt ?? "";
        // Parent session: no subagent tag, nothing to do.
        if (!systemPrompt.includes(SUBAGENT_TAG)) return { action: "continue" };
        // Append-mode subagent: parent prompt already carries the rules.
        if (systemPrompt.includes(RULES_MARKER)) return { action: "continue" };
        // Same session already injected (steer / resubmitted prompt).
        if (guardPi[SUBAGENT_RULES_INJECTED]) return { action: "continue" };

        // Fail-safe: a missing, unreadable, or empty rules file must never break the
        // child session's boot — the subagent simply starts without the injected rules.
        let rules: string;
        try {
            const rulesPath = join(process.cwd(), RULES_FILE);
            if (!existsSync(rulesPath)) return { action: "continue" };
            rules = readFileSync(rulesPath, "utf8");
        } catch {
            return { action: "continue" };
        }
        if (rules.trim().length === 0) return { action: "continue" };

        guardPi[SUBAGENT_RULES_INJECTED] = true;
        return {
            message: {
                customType: "subagent-rules-injection",
                display: false,
                content: [
                    "The project's durable rules (.pi/SYSTEM.md) — follow them:",
                    rules,
                ].join("\n"),
            },
        };
    });
}
