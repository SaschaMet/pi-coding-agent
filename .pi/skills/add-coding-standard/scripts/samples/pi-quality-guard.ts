import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ToolResultEvent } from "@mariozechner/pi-coding-agent";

const QUALITY_GUARD_REGISTERED = Symbol.for("pi.skills.add-coding-standard.pi-quality-guard.registered");

type JsonObject = Record<string, unknown>;
type ToolInput = Record<string, unknown>;
type HookResult = {
    continue?: boolean;
    stopReason?: string;
    systemMessage?: string;
    hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
    };
};
type ToolResultPatch = {
    content?: ToolResultEvent["content"];
    details?: unknown;
    isError?: boolean;
};

function hookScriptPath(cwd: string): string {
    return path.join(cwd, ".github", "hooks", "quality-guard.mjs");
}

function hookExists(cwd: string): boolean {
    try {
        return fs.statSync(hookScriptPath(cwd)).isFile();
    } catch {
        return false;
    }
}

function runHook(cwd: string, payload: JsonObject): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [hookScriptPath(cwd)], {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            resolve({ code: 1, stdout, stderr: error.message });
        });
        child.on("close", (code) => {
            resolve({ code, stdout, stderr });
        });

        child.stdin.end(`${JSON.stringify(payload)}\n`);
    });
}

function parseHookResult(stdout: string): HookResult | undefined {
    const line = stdout
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean)
        .at(-1);
    if (!line) return undefined;

    try {
        const parsed = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null) return parsed as HookResult;
    } catch {
        return undefined;
    }

    return undefined;
}

function getToolInput(event: { input?: ToolInput }): ToolInput {
    return event.input ?? {};
}

function textPatch(event: ToolResultEvent, message: string, isError: boolean): ToolResultPatch {
    return {
        isError,
        content: [...event.content, { type: "text", text: message }],
    };
}

export default function piQualityGuardExtension(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[QUALITY_GUARD_REGISTERED]) return;
    guardPi[QUALITY_GUARD_REGISTERED] = true;

    pi.on("tool_call", async (event, ctx) => {
        if (!hookExists(ctx.cwd)) return undefined;

        const hook = await runHook(ctx.cwd, {
            cwd: ctx.cwd,
            hookEventName: "PreToolUse",
            toolName: event.toolName,
            toolInput: getToolInput(event),
            toolCallId: event.toolCallId,
        });
        const result = parseHookResult(hook.stdout);
        const decision = result?.hookSpecificOutput?.permissionDecision;
        const reason = result?.hookSpecificOutput?.permissionDecisionReason ?? result?.stopReason ?? result?.systemMessage;

        if (decision === "deny" || result?.continue === false) {
            return { block: true, reason: reason ?? "Blocked by quality guard." };
        }

        return undefined;
    });

    pi.on("tool_result", async (event: ToolResultEvent, ctx): Promise<ToolResultPatch | undefined> => {
        if (event.isError || !hookExists(ctx.cwd)) return undefined;

        const hook = await runHook(ctx.cwd, {
            cwd: ctx.cwd,
            hookEventName: "PostToolUse",
            toolName: event.toolName,
            toolInput: event.input,
            toolCallId: event.toolCallId,
        });
        const result = parseHookResult(hook.stdout);
        const message = result?.systemMessage ?? result?.stopReason ?? hook.stderr.trim();

        if (result?.continue === false || hook.code === 2) {
            return textPatch(event, message || "Post-change quality guard failed.", true);
        }

        if (message) {
            return textPatch(event, message, false);
        }

        return undefined;
    });
}
