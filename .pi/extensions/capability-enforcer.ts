import process from "node:process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
    getMissingCapabilityTools,
    getToolCapability,
    loadCapabilityConfigCached,
} from "./capability-policy.ts";

const CAPABILITY_ENFORCER_REGISTERED = Symbol.for("pi.extensions.capability-enforcer.registered");

function getToolPathInput(toolName: string, input: Record<string, unknown>): string {
    const explicitPath = (input.path as string | undefined) ?? (input.file_path as string | undefined);
    if (explicitPath) return explicitPath;
    if (toolName === "grep" || toolName === "find") return ".";
    return "";
}

export default function capabilityEnforcerExtension(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[CAPABILITY_ENFORCER_REGISTERED]) return;
    guardPi[CAPABILITY_ENFORCER_REGISTERED] = true;

    pi.on("session_start", async (_event, ctx) => {
        const cwd = process.cwd();
        const capabilityConfig = loadCapabilityConfigCached(cwd);

        const allTools = pi.getAllTools().map((tool) => tool.name);
        const missingTools = getMissingCapabilityTools(allTools, capabilityConfig);
        if (missingTools.length > 0 && ctx.hasUI) {
            ctx.ui.notify(`Missing capability entries: ${missingTools.join(", ")}`, "warning");
        }
    });

    pi.on("tool_call", async (event, ctx) => {
        const cwd = process.cwd();
        const capabilityConfig = loadCapabilityConfigCached(cwd);

        const capability = getToolCapability(event.toolName, capabilityConfig);
        if (!capability) {
            return { block: true, reason: `Tool '${event.toolName}' has no capability entry` };
        }

        if (capability.mode === "block") {
            const inputPath = getToolPathInput(event.toolName, event.input as Record<string, unknown>);
            const suffix = inputPath ? ` (path: ${inputPath})` : "";
            return { block: true, reason: `Tool '${event.toolName}' blocked by capability policy${suffix}` };
        }

        if (capability.mode === "confirm") {
            const nonInteractivePolicy = capability.nonInteractivePolicy ?? "deny";
            if (!ctx.hasUI && nonInteractivePolicy === "deny") {
                return {
                    block: true,
                    reason: `Tool '${event.toolName}' requires confirmation (no UI for confirmation)`,
                };
            }
            if (!ctx.hasUI) return undefined;

            const choice = await ctx.ui.select(`⚠️ Tool '${event.toolName}' requires confirmation. Allow?`, ["Yes", "No"]);
            if (choice !== "Yes") {
                return { block: true, reason: "Blocked by user" };
            }
        }

        return undefined;
    });
}
