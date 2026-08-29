import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import piQualityGuardExtension from "../.pi/skills/add-coding-standard/scripts/samples/pi-quality-guard.ts";
import { createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

const samplesDir = path.join(
    process.cwd(),
    ".pi",
    "skills",
    "add-coding-standard",
    "scripts",
    "samples",
);
const sampleHookPath = path.join(samplesDir, "quality-guard.mjs");
const sampleBlockEnvReadPath = path.join(samplesDir, "block-env-read.sh");
const sampleLintSessionEndPath = path.join(
    samplesDir,
    "lint-on-session-end.sh",
);

function makeTmpRepo(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(cwd: string, relativePath: string, content: string): void {
    const filePath = path.join(cwd, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}

function writeExecutable(
    cwd: string,
    relativePath: string,
    content: string,
): string {
    writeFile(cwd, relativePath, content);
    const filePath = path.join(cwd, relativePath);
    fs.chmodSync(filePath, 0o755);
    return filePath;
}

function copyHookScriptIntoRepo(
    cwd: string,
    scriptName: string,
    sourcePath: string,
): void {
    const target = path.join(cwd, ".github", "hooks", "scripts", scriptName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sourcePath, target);
}

function runHook(
    cwd: string,
    payload: Record<string, unknown>,
    env: NodeJS.ProcessEnv = process.env,
) {
    const result = spawnSync(process.execPath, [sampleHookPath], {
        cwd,
        input: `${JSON.stringify(payload)}\n`,
        encoding: "utf8",
        env,
    });
    const stdout = result.stdout.trim();
    const parsed = stdout
        ? JSON.parse(stdout.split(/\r?\n/).at(-1) ?? "{}")
        : undefined;
    return { ...result, parsed };
}

function withFakePath(cwd: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        PATH: `${path.join(cwd, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    };
}

describe("add-coding-standard universal quality guard hook", () => {
    it("blocks existing .env reads through PreToolUse", () => {
        const cwd = makeTmpRepo("agent-quality-env-read-");
        writeFile(cwd, ".env", "SECRET=value\n");

        const result = runHook(cwd, {
            cwd,
            hookEventName: "PreToolUse",
            toolName: "read",
            toolInput: { path: ".env" },
        });

        expect(result.status).toBe(0);
        expect(result.parsed.continue).toBe(false);
        expect(result.parsed.permissionDecision).toBe("deny");
        expect(result.parsed.hookSpecificOutput.permissionDecision).toBe(
            "deny",
        );
        expect(result.parsed.permissionDecisionReason).toContain(
            "Blocked read",
        );
    });

    it("allows .env.example and blocks .env even when the file is missing", () => {
        const withEnv = makeTmpRepo("agent-quality-env-example-");
        writeFile(withEnv, ".env", "SECRET=value\n");
        writeFile(withEnv, ".env.example", "SECRET=\n");

        const envExample = runHook(withEnv, {
            cwd: withEnv,
            hookEventName: "PreToolUse",
            toolName: "read",
            toolInput: { path: ".env.example" },
        });
        expect(envExample.parsed).toEqual({});

        const withoutEnv = makeTmpRepo("agent-quality-no-env-");
        const missingEnv = runHook(withoutEnv, {
            cwd: withoutEnv,
            hookEventName: "PreToolUse",
            toolName: "read",
            toolInput: { path: ".env" },
        });
        expect(missingEnv.parsed.continue).toBe(false);
        expect(missingEnv.parsed.permissionDecisionReason).toContain(
            "Blocked read",
        );
    });

    it("blocks write and edit changes to .env", () => {
        const cwd = makeTmpRepo("agent-quality-env-mutate-");
        writeFile(cwd, ".env", "SECRET=value\n");

        for (const toolName of ["write", "edit"]) {
            const result = runHook(cwd, {
                cwd,
                hookEventName: "PreToolUse",
                toolName,
                toolInput: { path: ".env" },
            });
            expect(result.parsed.continue, toolName).toBe(false);
            expect(result.parsed.permissionDecisionReason, toolName).toContain(
                `Blocked ${toolName}`,
            );
        }
    });

    it("blocks search and list scopes that include .env", () => {
        const cwd = makeTmpRepo("agent-quality-env-scope-");
        writeFile(cwd, ".env", "SECRET=value\n");
        writeFile(cwd, "src/index.ts", "export const ok = true;\n");

        for (const toolName of ["grep", "find", "ls"]) {
            const result = runHook(cwd, {
                cwd,
                hookEventName: "PreToolUse",
                toolName,
                toolInput: { path: "." },
            });
            expect(result.parsed.continue, toolName).toBe(false);
            expect(result.parsed.permissionDecisionReason, toolName).toContain(
                "Search/list scope includes .env files",
            );
        }
    });

    it("blocks shell commands that target .env files and allows .env.example commands", () => {
        const cwd = makeTmpRepo("agent-quality-env-bash-");
        writeFile(cwd, ".env", "SECRET=value\n");

        const blocked = runHook(cwd, {
            cwd,
            hookEventName: "PreToolUse",
            toolName: "bash",
            toolInput: { command: "cat .env" },
        });
        expect(blocked.parsed.continue).toBe(false);
        expect(blocked.parsed.permissionDecisionReason).toContain(
            "Shell command targeting .env",
        );

        const allowed = runHook(cwd, {
            cwd,
            hookEventName: "PreToolUse",
            toolName: "bash",
            toolInput: { command: "cat .env.example" },
        });
        expect(allowed.parsed).toEqual({});
    });

    it("runs package lint at SessionEnd", () => {
        const cwd = makeTmpRepo("agent-quality-package-lint-");
        writeFile(
            cwd,
            "package.json",
            JSON.stringify({ scripts: { lint: "eslint ." } }),
        );
        writeExecutable(
            cwd,
            "bin/npm",
            "#!/usr/bin/env sh\necho package lint ok\n",
        );

        const result = runHook(
            cwd,
            {
                cwd,
                hookEventName: "SessionEnd",
                reason: "complete",
            },
            withFakePath(cwd),
        );

        expect(result.status).toBe(0);
        expect(result.parsed.continue).toBe(true);
        expect(result.parsed.systemMessage).toContain(
            "Session-end lint passed (package:lint)",
        );
        expect(result.parsed.systemMessage).toContain("package lint ok");
    });

    it("detects Python Ruff from pyproject.toml at SessionEnd", () => {
        const cwd = makeTmpRepo("agent-quality-python-");
        writeFile(cwd, "pyproject.toml", "[tool.ruff]\nline-length = 100\n");
        writeExecutable(cwd, "bin/uv", "#!/usr/bin/env sh\necho ruff ok\n");

        const result = runHook(
            cwd,
            {
                cwd,
                hookEventName: "SessionEnd",
                reason: "complete",
            },
            withFakePath(cwd),
        );

        expect(result.status).toBe(0);
        expect(result.parsed.systemMessage).toContain(
            "Session-end lint passed (python:ruff-check)",
        );
        expect(result.parsed.systemMessage).toContain("ruff ok");
    });

    it("skips lint at SessionEnd when no linter exists", () => {
        const cwd = makeTmpRepo("agent-quality-no-linter-");

        const result = runHook(cwd, {
            cwd,
            hookEventName: "SessionEnd",
            reason: "complete",
        });

        expect(result.status).toBe(0);
        expect(result.parsed.continue).toBe(true);
        expect(result.parsed.systemMessage).toContain(
            "Session-end lint skipped",
        );
    });

    it("reports lint issues without blocking at SessionEnd", () => {
        const cwd = makeTmpRepo("agent-quality-lint-fail-");
        writeFile(
            cwd,
            "package.json",
            JSON.stringify({ scripts: { lint: "eslint ." } }),
        );
        writeExecutable(
            cwd,
            "bin/npm",
            "#!/usr/bin/env sh\necho lint failed >&2\nexit 1\n",
        );

        const result = runHook(
            cwd,
            {
                cwd,
                hookEventName: "SessionEnd",
                reason: "complete",
            },
            withFakePath(cwd),
        );

        // Session-end lint is informational: the hook always exits 0 and keeps continue true.
        expect(result.status).toBe(0);
        expect(result.parsed.continue).toBe(true);
        expect(result.parsed.systemMessage).toContain(
            "Session-end lint finished with issues (package:lint)",
        );
        expect(result.parsed.systemMessage).toContain("lint failed");
    });
});

describe("add-coding-standard PI quality guard adapter", () => {
    it("maps the bash hook denial to a PI tool_call block", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-deny-");
        writeFile(cwd, ".env", "SECRET=value\n");
        copyHookScriptIntoRepo(
            cwd,
            "block-env-read.sh",
            sampleBlockEnvReadPath,
        );

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const result = await handlers[0](
            { toolName: "read", toolCallId: "1", input: { path: ".env" } },
            { cwd },
        );

        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("Access to .env files is blocked");
    });

    it("allows non-.env tool calls when the hook is installed", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-allow-");
        writeFile(cwd, ".env", "SECRET=value\n");
        writeFile(cwd, "src/index.ts", "export const ok = true;\n");
        copyHookScriptIntoRepo(
            cwd,
            "block-env-read.sh",
            sampleBlockEnvReadPath,
        );

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const result = await handlers[0](
            {
                toolName: "read",
                toolCallId: "1",
                input: { path: "src/index.ts" },
            },
            { cwd },
        );

        expect(result).toBeUndefined();
    });

    it("no-ops tool_call when the hook script is missing", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-no-hook-");
        writeFile(cwd, ".env", "SECRET=value\n");

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const result = await handlers[0](
            { toolName: "read", toolCallId: "1", input: { path: ".env" } },
            { cwd },
        );

        expect(result).toBeUndefined();
    });

    it("runs the session-end lint hook and notifies the UI", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-lint-");
        copyHookScriptIntoRepo(
            cwd,
            "lint-on-session-end.sh",
            sampleLintSessionEndPath,
        );

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("session_shutdown") ?? [];

        const ui = createFakeUi();
        await handlers[0]({ reason: "complete" }, { cwd, hasUI: true, ui });

        expect(ui.notify).toHaveBeenCalled();
        expect(String(ui.notify.mock.calls[0]?.[0])).toContain(
            "[lint-on-session-end]",
        );
    });

    it("no-ops session_shutdown when the hook script is missing", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-no-lint-hook-");

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("session_shutdown") ?? [];

        const ui = createFakeUi();
        const result = await handlers[0](
            { reason: "complete" },
            { cwd, hasUI: true, ui },
        );

        expect(result).toBeUndefined();
        expect(ui.notify).not.toHaveBeenCalled();
    });
});
