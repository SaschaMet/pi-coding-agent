import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import {
    firstNonEmptyString,
    isOutsideWorkingDirectory,
    isWithinRoot,
    resolveInputPath,
    resolvePathWithRealAncestor,
} from "./lib/extension-helpers.ts";

const READ_BOUNDARY_GUARD_REGISTERED = Symbol.for("pi.extensions.read-boundary-guard.registered");
const GUARDED_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const MUTATING_TOOLS = new Set(["write", "edit"]);

function getToolPathInput(toolName: string, input: Record<string, unknown>): string | undefined {
    if (toolName === "read" || toolName === "write" || toolName === "edit") {
        return firstNonEmptyString(input.path, input.file_path, input.filePath);
    }

    if (toolName === "grep" || toolName === "find" || toolName === "ls") {
        const explicit = firstNonEmptyString(input.path, input.file_path, input.filePath);
        return explicit ?? ".";
    }

    return undefined;
}

function resolveGlobalPiReadOnlyRoot(): string {
    const configuredGlobalAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
    if (configuredGlobalAgentDir) {
        return resolvePathWithRealAncestor(configuredGlobalAgentDir);
    }
    return resolvePathWithRealAncestor(path.join(os.homedir(), ".pi"));
}

export default function readBoundaryGuardExtension(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[READ_BOUNDARY_GUARD_REGISTERED]) return;
    guardPi[READ_BOUNDARY_GUARD_REGISTERED] = true;
    const globalPiReadOnlyRoot = resolveGlobalPiReadOnlyRoot();

    pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | undefined> => {
        if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

        const inputPath = getToolPathInput(event.toolName, event.input as Record<string, unknown>);
        if (!inputPath) {
            return {
                block: true,
                reason: `Blocked ${event.toolName}: missing or invalid path argument for boundary enforcement.`,
            };
        }

        const currentCwd = ctx.cwd;
        const resolvedTarget = resolveInputPath(inputPath, currentCwd);

        if (isWithinRoot(resolvedTarget, globalPiReadOnlyRoot)) {
            if (READ_ONLY_TOOLS.has(event.toolName)) return undefined;
            if (MUTATING_TOOLS.has(event.toolName)) {
                return {
                    block: true,
                    reason: `Path '${inputPath}' is under read-only global PI directory '${globalPiReadOnlyRoot}'.`,
                };
            }
        }

        if (!isOutsideWorkingDirectory(inputPath, currentCwd)) return undefined;

        const reason = `Path '${inputPath}' is outside the current working directory and requires approval.`;
        if (!ctx.hasUI) {
            return { block: true, reason: `${reason} (no UI for approval)` };
        }

        const choice = await ctx.ui.select(
            `Allow ${event.toolName} outside current directory?\n\nPath: ${inputPath}\nCWD: ${currentCwd}`,
            ["Yes", "No"],
        );
        if (choice !== "Yes") {
            return { block: true, reason: "Blocked by user" };
        }

        return undefined;
    });
}
