import type {
    ExtensionAPI,
    ToolCallEvent,
    ToolCallEventResult,
    ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";
import {
    callKey,
    checkCmuxSurface,
    checkRepeat,
    emptyRepeatState,
    recordResult,
    resultKey,
} from "./lib/tool-guards.ts";

const TOOL_GUARDS_REGISTERED = Symbol.for("pi.extensions.tool-guards.registered");

const BLOCK_REASON =
    "[LOOP] This exact call already returned the same result twice. Do not run it again. Read the result, change the approach, or stop and report what failed.";
const STOP_REASON = "[LOOP] Repeated a blocked call. The run is aborted so the user can step in.";

export default function toolGuards(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & { [TOOL_GUARDS_REGISTERED]?: boolean };
    if (guardPi[TOOL_GUARDS_REGISTERED]) return;
    guardPi[TOOL_GUARDS_REGISTERED] = true;

    let repeat = emptyRepeatState();

    // `agent_start` also fires on every internal continue, so only a settled run resets.
    pi.on("agent_settled", async () => {
        repeat = emptyRepeatState();
    });

    pi.on("tool_result", async (event: ToolResultEvent) => {
        recordResult(repeat, callKey(event.toolName, event.input), resultKey(event.content, event.isError));
        return undefined;
    });

    pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | undefined> => {
        if (event.toolName === "bash") {
            const input = event.input as { command?: unknown; cmd?: unknown };
            const command = input.command ?? input.cmd;
            const reason = checkCmuxSurface(typeof command === "string" ? command : "");
            if (reason) return { block: true, reason };
        }
        const verdict = checkRepeat(repeat, callKey(event.toolName, event.input));
        if (verdict === "allow") return undefined;
        if (verdict === "stop") {
            // After an abort the runtime reports "Operation aborted" instead of this reason, so the user hears it here.
            if (ctx.hasUI) ctx.ui.notify(STOP_REASON, "error");
            // `terminate` alone does not end a batch whose sibling calls lack it.
            ctx.abort();
        }
        return {
            block: true,
            terminate: verdict === "stop",
            reason: verdict === "stop" ? STOP_REASON : BLOCK_REASON,
        };
    });
}
