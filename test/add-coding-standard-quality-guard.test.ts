import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import piQualityGuardExtension from "../.pi/skills/add-coding-standard/scripts/samples/pi-quality-guard.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

const sampleHookPath = path.join(process.cwd(), ".pi", "skills", "add-coding-standard", "scripts", "samples", "quality-guard.mjs");

function makeTmpRepo(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(cwd: string, relativePath: string, content: string): void {
    const filePath = path.join(cwd, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function copyHookIntoRepo(cwd: string): void {
    const target = path.join(cwd, ".github", "hooks", "quality-guard.mjs");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sampleHookPath, target);
}

function writeExecutable(cwd: string, relativePath: string, content: string): string {
    writeFile(cwd, relativePath, content);
    const filePath = path.join(cwd, relativePath);
    fs.chmodSync(filePath, 0o755);
    return filePath;
}

function runGit(cwd: string, args: string[]): void {
    const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
    }
}

function initializeGitRepo(cwd: string): void {
    runGit(cwd, ["init"]);
    runGit(cwd, ["config", "user.email", "test@example.com"]);
    runGit(cwd, ["config", "user.name", "Test User"]);
}

function runHook(cwd: string, payload: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env) {
    const result = spawnSync(process.execPath, [sampleHookPath], {
        cwd,
        input: `${JSON.stringify(payload)}\n`,
        encoding: "utf-8",
        env,
    });
    const stdout = result.stdout.trim();
    const parsed = stdout ? JSON.parse(stdout.split(/\r?\n/).at(-1) ?? "{}") : undefined;
    return { ...result, parsed };
}

function withFakePath(cwd: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        PATH: `${path.join(cwd, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    };
}

describe("add-coding-standard universal quality guard hook", () => {
    const originalPath = process.env.PATH;

    afterEach(() => {
        process.env.PATH = originalPath;
    });

    it("blocks existing .env reads through PreToolUse", () => {
        const cwd = makeTmpRepo("agent-quality-env-read-");
        writeFile(cwd, ".env", "SECRET=value\n");

        const result = runHook(cwd, {
            cwd,
            hook_event_name: "PreToolUse",
            tool_name: "Read",
            tool_input: { file_path: ".env" },
        });

        expect(result.status).toBe(0);
        expect(result.parsed.continue).toBe(false);
        expect(result.parsed.hookSpecificOutput.permissionDecision).toBe("deny");
        expect(result.parsed.stopReason).toContain("Blocked read");
    });

    it("allows .env.example and missing .env", () => {
        const withEnv = makeTmpRepo("agent-quality-env-example-");
        writeFile(withEnv, ".env", "SECRET=value\n");
        writeFile(withEnv, ".env.example", "SECRET=\n");

        const envExample = runHook(withEnv, {
            cwd: withEnv,
            hookEventName: "PreToolUse",
            toolName: "read",
            toolInput: { path: ".env.example" },
        });
        expect(envExample.parsed).toEqual({ continue: true });

        const withoutEnv = makeTmpRepo("agent-quality-no-env-");
        const missingEnv = runHook(withoutEnv, {
            cwd: withoutEnv,
            hookEventName: "PreToolUse",
            toolName: "read",
            toolInput: { path: ".env" },
        });
        expect(missingEnv.parsed).toEqual({ continue: true });
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
            expect(result.parsed.continue).toBe(false);
            expect(result.parsed.stopReason).toContain(`Blocked ${toolName}`);
        }
    });

    it("blocks apply_patch changes to an existing .env", () => {
        const cwd = makeTmpRepo("agent-quality-env-patch-");
        writeFile(cwd, ".env", "SECRET=value\n");

        const result = runHook(cwd, {
            cwd,
            hookEventName: "PreToolUse",
            toolName: "apply_patch",
            toolInput: {
                command: "*** Begin Patch\n*** Update File: .env\n@@\n-SECRET=value\n+SECRET=other\n*** End Patch\n",
            },
        });

        expect(result.parsed.continue).toBe(false);
        expect(result.parsed.stopReason).toContain("Blocked apply_patch");
    });

    it("runs package lint after PostToolUse edit", () => {
        const cwd = makeTmpRepo("agent-quality-package-lint-");
        writeFile(cwd, "package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));
        writeExecutable(cwd, "bin/npm", "#!/usr/bin/env sh\necho package lint ok\n");

        const result = runHook(
            cwd,
            {
                cwd,
                hookEventName: "PostToolUse",
                toolName: "Edit",
                toolInput: { path: "src/index.ts" },
            },
            withFakePath(cwd),
        );

        expect(result.status).toBe(0);
        expect(result.parsed.continue).toBe(true);
        expect(result.parsed.systemMessage).toContain("Post-change lint passed (package:lint)");
        expect(result.parsed.systemMessage).toContain("package lint ok");
    });

    it("detects Python Ruff from pyproject.toml", () => {
        const cwd = makeTmpRepo("agent-quality-python-");
        writeFile(cwd, "pyproject.toml", "[tool.ruff]\nline-length = 100\n");
        writeExecutable(cwd, "bin/uv", "#!/usr/bin/env sh\necho ruff ok\n");

        const result = runHook(
            cwd,
            {
                cwd,
                hookEventName: "PostToolUse",
                toolName: "write",
                toolInput: { path: "src/app.py" },
            },
            withFakePath(cwd),
        );

        expect(result.status).toBe(0);
        expect(result.parsed.systemMessage).toContain("Post-change lint passed (python:ruff-check)");
        expect(result.parsed.systemMessage).toContain("ruff ok");
    });

    it("passes PostToolUse silently when no linter exists", () => {
        const cwd = makeTmpRepo("agent-quality-no-linter-");

        const result = runHook(cwd, {
            cwd,
            hookEventName: "PostToolUse",
            toolName: "write",
            toolInput: { path: "src/index.ts" },
        });

        expect(result.status).toBe(0);
        expect(result.parsed).toEqual({ continue: true });
    });

    it("emits failure JSON and blocking status when lint fails", () => {
        const cwd = makeTmpRepo("agent-quality-lint-fail-");
        writeFile(cwd, "package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));
        writeExecutable(cwd, "bin/npm", "#!/usr/bin/env sh\necho lint failed >&2\nexit 1\n");

        const result = runHook(
            cwd,
            {
                cwd,
                hookEventName: "PostToolUse",
                toolName: "write",
                toolInput: { path: "src/index.ts" },
            },
            withFakePath(cwd),
        );

        expect(result.status).toBe(2);
        expect(result.parsed.continue).toBe(false);
        expect(result.parsed.stopReason).toContain("Post-change lint failed (package:lint)");
        expect(result.parsed.systemMessage).toContain("lint failed");
    });

    it("blocks test-only file changes", () => {
        const cwd = makeTmpRepo("agent-quality-test-only-");
        initializeGitRepo(cwd);
        writeFile(cwd, "src/index.ts", "export const value = 1;\n");
        runGit(cwd, ["add", "src/index.ts"]);
        runGit(cwd, ["commit", "-m", "initial"]);
        writeFile(cwd, "test/index.test.ts", "import { value } from '../src/index';\nexpect(value).toBe(1);\n");

        const result = runHook(cwd, {
            cwd,
            hookEventName: "PostToolUse",
            toolName: "write",
            toolInput: { path: "test/index.test.ts" },
        });

        expect(result.status).toBe(2);
        expect(result.parsed.continue).toBe(false);
        expect(result.parsed.stopReason).toContain("Blocked test-only change");
        expect(result.parsed.stopReason).toContain("test/index.test.ts");
    });

    it("allows test changes when implementation files also changed", () => {
        const cwd = makeTmpRepo("agent-quality-test-with-implementation-");
        initializeGitRepo(cwd);
        writeFile(cwd, "src/index.ts", "export const value = 1;\n");
        runGit(cwd, ["add", "src/index.ts"]);
        runGit(cwd, ["commit", "-m", "initial"]);
        writeFile(cwd, "src/index.ts", "export const value = 2;\n");
        writeFile(cwd, "test/index.test.ts", "import { value } from '../src/index';\nexpect(value).toBe(2);\n");

        const result = runHook(cwd, {
            cwd,
            hookEventName: "PostToolUse",
            toolName: "write",
            toolInput: { path: "test/index.test.ts" },
        });

        expect(result.status).toBe(0);
        expect(result.parsed).toEqual({ continue: true });
    });
});

describe("add-coding-standard PI quality guard adapter", () => {
    const originalPath = process.env.PATH;

    afterEach(() => {
        process.env.PATH = originalPath;
    });

    it("maps shared PreToolUse denial to PI tool_call block", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-deny-");
        writeFile(cwd, ".env", "SECRET=value\n");
        copyHookIntoRepo(cwd);

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const result = await handlers[0](
            { toolName: "read", toolCallId: "1", input: { path: ".env" } },
            { cwd },
        );

        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("Blocked read");
    });

    it("maps shared PostToolUse lint output to PI tool_result patch", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-lint-");
        writeFile(cwd, "package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));
        writeExecutable(cwd, "bin/npm", "#!/usr/bin/env sh\necho pi lint ok\n");
        copyHookIntoRepo(cwd);
        process.env.PATH = withFakePath(cwd).PATH;

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_result") ?? [];

        const result = await handlers[0](
            {
                toolName: "edit",
                toolCallId: "1",
                input: { path: "src/index.ts" },
                content: [{ type: "text", text: "edited" }],
                isError: false,
            },
            { cwd },
        );

        expect(result?.isError).toBe(false);
        expect(result?.content?.map((item: { text: string }) => item.text).join("\n")).toContain("Post-change lint passed");
        expect(result?.content?.map((item: { text: string }) => item.text).join("\n")).toContain("pi lint ok");
    });

    it("does not call shared hook after failed PI tool results", async () => {
        const cwd = makeTmpRepo("agent-quality-pi-failed-tool-");
        writeFile(cwd, "package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));
        copyHookIntoRepo(cwd);

        const pi = createFakePi();
        piQualityGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_result") ?? [];

        const result = await handlers[0](
            {
                toolName: "write",
                toolCallId: "1",
                input: { path: "src/index.ts" },
                content: [{ type: "text", text: "failed" }],
                isError: true,
            },
            { cwd },
        );

        expect(result).toBeUndefined();
    });
});
