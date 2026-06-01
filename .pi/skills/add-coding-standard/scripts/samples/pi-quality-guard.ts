import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const QUALITY_GUARD_REGISTERED = Symbol.for("pi.skills.add-coding-standard.pi-quality-guard.registered");

type JsonObject = Record<string, unknown>;
type ToolInput = Record<string, unknown>;
type HookResult = {
    continue?: boolean;
    stopReason?: string;
    systemMessage?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
    hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
    };
};

function hookScriptPath(cwd: string, scriptName: string): string {
    return path.join(cwd, ".github", "hooks", "scripts", scriptName);
}

function hookExists(cwd: string, scriptName: string): boolean {
    try {
        return fs.statSync(hookScriptPath(cwd, scriptName)).isFile();
    } catch {
        return false;
    }
}

function runHook(cwd: string, scriptName: string, payload: JsonObject): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn("bash", [hookScriptPath(cwd, scriptName)], {
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
        .filter((part) => part.startsWith("{") && part.endsWith("}"))
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

function compactMessage(stdout: string, stderr: string): string {
    return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 8000);
}

export default function piQualityGuardExtension(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[QUALITY_GUARD_REGISTERED]) return;
    guardPi[QUALITY_GUARD_REGISTERED] = true;

    pi.on("tool_call", async (event, ctx) => {
        if (!hookExists(ctx.cwd, "block-env-read.sh")) return undefined;

        const hook = await runHook(ctx.cwd, "block-env-read.sh", {
            cwd: ctx.cwd,
            hookEventName: "PreToolUse",
            toolName: event.toolName,
            toolInput: getToolInput(event),
            toolCallId: event.toolCallId,
        });
        const result = parseHookResult(hook.stdout);
        const decision = result?.hookSpecificOutput?.permissionDecision ?? result?.permissionDecision;
        const reason =
            result?.hookSpecificOutput?.permissionDecisionReason ??
            result?.permissionDecisionReason ??
            result?.stopReason ??
            result?.systemMessage;

        if (decision === "deny" || result?.continue === false) {
            return { block: true, reason: reason ?? "Blocked by quality guard." };
        }

        return undefined;
    });

    pi.on("session_shutdown", async (event, ctx) => {
        if (!hookExists(ctx.cwd, "lint-on-session-end.sh")) return undefined;

        const hook = await runHook(ctx.cwd, "lint-on-session-end.sh", {
            cwd: ctx.cwd,
            hookEventName: "SessionEnd",
            reason: event.reason,
        });
        const message = parseHookResult(hook.stdout)?.systemMessage ?? compactMessage(hook.stdout, hook.stderr);

        if (message && ctx.hasUI) {
            ctx.ui.notify(message, "info");
        }

        return undefined;
    });
}
