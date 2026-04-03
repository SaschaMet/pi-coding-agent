/**
 * Protected Paths Extension
 *
 * Blocks read/write/search/list operations that target protected paths,
 * using the shared capability policy.
 */

import process from "node:process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { evaluatePathToolAccess, loadCapabilityConfigCached } from "./capability-policy.ts";

export default function (pi: ExtensionAPI) {
    pi.on("tool_call", async (event, ctx) => {
        const appliesToTool =
            event.toolName === "read" ||
            event.toolName === "write" ||
            event.toolName === "edit" ||
            event.toolName === "grep" ||
            event.toolName === "find" ||
            event.toolName === "ls";

        if (!appliesToTool) {
            return undefined;
        }

        const eventInput = event.input as Record<string, unknown>;
        const inputPath =
            ((eventInput.path as string | undefined) ?? (eventInput.file_path as string | undefined) ?? "") ||
            (event.toolName === "grep" || event.toolName === "find" ? "." : "");

        if (inputPath.length === 0) return undefined;

        const capabilityConfig = loadCapabilityConfigCached(process.cwd());
        const decision = evaluatePathToolAccess(event.toolName, inputPath, process.cwd(), capabilityConfig);
        if (decision.action === "allow") return undefined;
        if (decision.action === "block") {
            if (ctx.hasUI) {
                ctx.ui.notify(`Blocked ${event.toolName} on protected path: ${inputPath}`, "warning");
            }
            return { block: true, reason: decision.reason ?? `Path '${inputPath}' blocked by capability policy` };
        }

        if (!ctx.hasUI) {
            return { block: true, reason: (decision.reason ?? "Path access requires confirmation") + " (no UI for confirmation)" };
        }

        const choice = await ctx.ui.select(
            `⚠️ ${decision.reason ?? "Path access requires confirmation"} for ${event.toolName}\n\n  ${inputPath}\n\nAllow?`,
            ["Yes", "No"],
        );
        if (choice !== "Yes") {
            return { block: true, reason: "Blocked by user" };
        }

        return undefined;
    });
}
