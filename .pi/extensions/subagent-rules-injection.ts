import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const SUBAGENT_RULES_REGISTERED = Symbol.for("pi.extensions.subagent-rules-injection.registered");
const SUBAGENT_RULES_INJECTED = Symbol.for("pi.extensions.subagent-rules-injection.injected");

// pi-subagents embeds this tag in every subagent system prompt (buildAgentPrompt) and
// documents it as the hook for downstream extensions to detect child sessions.
const SUBAGENT_TAG = '<active_agent name="';

// Subagents start with noContextFiles, so replace-mode agents see neither file unless
// it is injected; append-mode agents already carry both in the copied parent prompt.
const INSTRUCTION_FILES = [
    { file: join(".pi", "SYSTEM.md"), heading: "The project's durable rules (.pi/SYSTEM.md) — follow them:" },
    { file: "AGENTS.md", heading: "The project's instructions (AGENTS.md) — follow them:" },
];

// Fail-safe: a missing, unreadable, or empty file must never break the child
// session's boot — it is simply left out.
function readOptional(filePath: string): string | undefined {
    try {
        return readFileSync(filePath, "utf8").trim() || undefined;
    } catch {
        return undefined;
    }
}

export default function subagentRulesInjection(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[SUBAGENT_RULES_REGISTERED]) return;
    guardPi[SUBAGENT_RULES_REGISTERED] = true;

    pi.on("before_agent_start", async (event, ctx) => {
        const systemPrompt = (event as { systemPrompt?: string }).systemPrompt ?? "";
        // Parent session: no subagent tag, nothing to do.
        if (!systemPrompt.includes(SUBAGENT_TAG)) return { action: "continue" };
        // Same session already injected (steer / resubmitted prompt).
        if (guardPi[SUBAGENT_RULES_INJECTED]) return { action: "continue" };

        // A worktree or cwd-override subagent works in its own checkout, so its files win.
        const base = ctx?.cwd || process.cwd();
        // Append-mode subagents embed both files verbatim in the parent prompt. Matching
        // each file's own text keeps the check right however often the files are edited.
        const sections = INSTRUCTION_FILES.flatMap(({ file, heading }) => {
            const text = readOptional(join(base, file));
            return text && !systemPrompt.includes(text) ? [`${heading}\n${text}`] : [];
        });
        if (sections.length === 0) return { action: "continue" };

        guardPi[SUBAGENT_RULES_INJECTED] = true;
        return {
            message: {
                customType: "subagent-rules-injection",
                display: false,
                content: sections.join("\n\n"),
            },
        };
    });
}
