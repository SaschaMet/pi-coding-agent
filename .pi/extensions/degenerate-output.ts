import { randomUUID } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { CustomMessageEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";
import { judgeReply, type DegenerateReason } from "./lib/degenerate-output.ts";

const DEGENERATE_OUTPUT_REGISTERED = Symbol.for("pi.extensions.degenerate-output.registered");
const CUSTOM_TYPE = "degenerate-output";
// Only this provider's serving stack has produced garbage replies so far.
const WATCHED_PROVIDER = "iqRouter";

const RETRY_ENTRY: CustomMessageEntryDraft = {
    type: "custom_message",
    customType: CUSTOM_TYPE,
    content: "Your last reply was unreadable and was discarded. Answer the user's last message again.",
    display: false,
};

export default function degenerateOutput(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & { [DEGENERATE_OUTPUT_REGISTERED]?: boolean };
    if (guardPi[DEGENERATE_OUTPUT_REGISTERED]) return;
    guardPi[DEGENERATE_OUTPUT_REGISTERED] = true;

    let retried = false;
    let skipCache = false;
    let pending: { reason: DegenerateReason; original: AssistantMessage } | undefined;

    // `agent_start` also fires on the retry's own continue, so only a settled run resets.
    pi.on("agent_settled", async () => {
        retried = false;
        pending = undefined;
    });

    pi.on("message_end", async (event, ctx) => {
        if (event.message.role !== "assistant" || ctx.model?.provider !== WATCHED_PROVIDER) return undefined;
        // An auto-compaction request may come between settle and retry, so clear only once a reply arrived.
        skipCache = false;
        const reason = judgeReply(event.message);
        if (!reason) return undefined;
        pending = { reason, original: event.message };
        // Garbage left in context can poison the next turn, so only a notice stays.
        return {
            message: {
                ...event.message,
                content: [{ type: "text", text: `[Reply discarded: unreadable model output (${reason}).]` }],
            },
        };
    });

    pi.on("agent_before_settle", async (event, ctx) => {
        if (!pending) return undefined;
        // Each handler's list replaces the previous one, so keep what earlier handlers added.
        const earlier = event.entries ?? [];
        const { reason, original } = pending;
        pending = undefined;
        // Kept out of the model's context, for later analysis of the server fault.
        const evidence = { type: "custom" as const, customType: CUSTOM_TYPE, data: { reason, content: original.content } };
        if (retried) {
            if (ctx.hasUI) {
                ctx.ui.notify(
                    `Model output unreadable twice (${reason}). Likely a model-server cache fault: retry later or switch model.`,
                    "error",
                );
            }
            return { entries: [...earlier, evidence] };
        }
        retried = true;
        skipCache = true;
        if (ctx.hasUI) ctx.ui.notify(`Model output unreadable (${reason}); retrying once.`, "warning");
        return { continue: true, entries: [...earlier, evidence, RETRY_ENTRY] };
    });

    pi.on("before_provider_request", async (event, ctx) => {
        if (!skipCache || ctx.model?.provider !== WATCHED_PROVIDER) return undefined;
        if (event.payload === null || typeof event.payload !== "object") return undefined;
        // A fresh salt changes every cache key, so the server recomputes instead of reusing a broken entry.
        return { ...event.payload, cache_salt: randomUUID() };
    });
}
