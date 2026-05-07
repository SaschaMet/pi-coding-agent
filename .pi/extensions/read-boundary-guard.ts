import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const READ_BOUNDARY_GUARD_REGISTERED = Symbol.for("pi.extensions.read-boundary-guard.registered");
const GUARDED_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

type ToolCallEvent = {
    toolName: string;
    input: Record<string, unknown>;
};

function firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return undefined;
}

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

function expandHomePath(rawPath: string): string {
    const trimmed = rawPath.trim();
    if (trimmed === "~") return os.homedir();
    if (trimmed.startsWith("~/") || trimmed.startsWith(`~${path.sep}`)) {
        return path.join(os.homedir(), trimmed.slice(2));
    }

    const home = process.env.HOME;
    if (home && (trimmed.startsWith("$HOME/") || trimmed.startsWith("${HOME}/"))) {
        const prefixLen = trimmed.startsWith("$HOME/") ? "$HOME/".length : "${HOME}/".length;
        return path.join(home, trimmed.slice(prefixLen));
    }

    return trimmed;
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
    const normalizedInputPath = expandHomePath(inputPath);
    const resolvedCwd = resolvePathWithRealAncestor(cwd);
    const resolvedTarget = resolvePathWithRealAncestor(
        path.isAbsolute(normalizedInputPath) ? normalizedInputPath : path.join(cwd, normalizedInputPath),
    );
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
        if (!inputPath) {
            return {
                block: true,
                reason: `Blocked ${event.toolName}: missing or invalid path argument for boundary enforcement.`,
            };
        }

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