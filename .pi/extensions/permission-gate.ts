/**
 * Permission Gate Extension
 *
 * Prompts for confirmation for capability-gated bash commands and blocks
 * sensitive or disallowed commands using the shared capability policy.
 */

import process from "node:process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { evaluateBashCommand, loadCapabilityConfigCached } from "./capability-policy.ts";

const PERMISSION_GATE_REGISTERED = Symbol.for("pi.extensions.permission-gate.registered");

export default function (pi: ExtensionAPI) {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[PERMISSION_GATE_REGISTERED]) return;
    guardPi[PERMISSION_GATE_REGISTERED] = true;

    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "bash") return undefined;

        const command = event.input.command as string;
        const capabilityConfig = loadCapabilityConfigCached(process.cwd());
        const decision = evaluateBashCommand(command, ctx.hasUI, capabilityConfig);

        if (decision.action === "allow") return undefined;
        if (decision.action === "block") {
            if (!ctx.hasUI) {
                return { block: true, reason: decision.reason ?? "Command blocked by capability policy" };
            }

            const choice = await ctx.ui.select(
                `⚠️ ${decision.reason ?? "Command blocked by capability policy"}:\n\n  ${command}\n\nOverride and allow anyway?`,
                ["Yes", "No"],
            );
            if (choice !== "Yes") {
                return { block: true, reason: "Blocked by user" };
            }

            return undefined;
        }

        if (!ctx.hasUI) {
            return { block: true, reason: decision.reason ?? "Command requires confirmation (no UI for confirmation)" };
        }

        const choice = await ctx.ui.select(`⚠️ ${decision.reason ?? "Command requires confirmation"}:\n\n  ${command}\n\nAllow?`, [
            "Yes",
            "No",
        ]);
        if (choice !== "Yes") {
            return { block: true, reason: "Blocked by user" };
        }

        return undefined;
    });
}
