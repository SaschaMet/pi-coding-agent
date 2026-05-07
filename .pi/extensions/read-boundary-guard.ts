import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const READ_BOUNDARY_GUARD_REGISTERED = Symbol.for("pi.extensions.read-boundary-guard.registered");
const GUARDED_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

type ToolCallEvent = {
    toolName: string;
    input: Record<string, unknown>;
};

function getToolPathInput(toolName: string, input: Record<string, unknown>): string | undefined {
    if (toolName === "read" || toolName === "write" || toolName === "edit") {
        const explicit = (input.path as string | undefined) ?? (input.file_path as string | undefined);
        return typeof explicit === "string" && explicit.trim().length > 0 ? explicit : undefined;
    }

    if (toolName === "grep" || toolName === "find" || toolName === "ls") {
        const explicit = input.path as string | undefined;
        return typeof explicit === "string" && explicit.trim().length > 0 ? explicit : ".";
    }

    return undefined;
}

function resolvePathWithRealAncestor(candidate: string): string {
    const absolute = path.resolve(candidate);
    const partsToReattach: string[] = [];
    const root = path.parse(absolute).root;

    let cursor = absolute;
    while (true) {
        try {
            const realBase = fs.realpathSync.native(cursor);
            if (partsToReattach.length === 0) return path.normalize(realBase);
            return path.normalize(path.join(realBase, ...partsToReattach.reverse()));
        } catch {
            if (cursor === root) break;
            partsToReattach.push(path.basename(cursor));
            cursor = path.dirname(cursor);
        }
    }

    return absolute;
}

function isOutsideWorkingDirectory(inputPath: string, cwd: string): boolean {
    const resolvedCwd = resolvePathWithRealAncestor(cwd);
    const resolvedTarget = resolvePathWithRealAncestor(path.isAbsolute(inputPath) ? inputPath : path.join(cwd, inputPath));
    const relative = path.relative(resolvedCwd, resolvedTarget);
    return relative.length > 0 && (relative.startsWith("..") || path.isAbsolute(relative));
}

export default function readBoundaryGuardExtension(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[READ_BOUNDARY_GUARD_REGISTERED]) return;
    guardPi[READ_BOUNDARY_GUARD_REGISTERED] = true;

    pi.on("tool_call", async (event, ctx) => {
        if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

        const input = (event as ToolCallEvent).input ?? {};
        const inputPath = getToolPathInput(event.toolName, input);
        if (!inputPath) return undefined;

        const currentCwd = ctx.cwd;
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