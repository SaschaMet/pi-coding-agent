import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import piQualityGuardExtension, {
    detectLintCommand,
    shouldBlockEnvAccess,
} from "../.pi/skills/add-coding-standard/scripts/samples/pi-quality-guard.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

function makeTmpRepo(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(cwd: string, relativePath: string, content: string): void {
    const filePath = path.join(cwd, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

describe("add-coding-standard PI quality guard sample", () => {
    it("detects package lint scripts before broader checks", () => {
        const cwd = makeTmpRepo("pi-quality-package-");
        writeFile(
            cwd,
            "package.json",
            JSON.stringify({
                scripts: {
                    "check:fast": "npm test",
                    lint: "eslint .",
                },
            }),
        );
        writeFile(cwd, "package-lock.json", "{}");

        expect(detectLintCommand(cwd)).toEqual({
            label: "package:lint",
            command: "npm",
            args: ["run", "lint"],
        });
    });

    it("detects Python Ruff from pyproject.toml", () => {
        const cwd = makeTmpRepo("pi-quality-python-");
        writeFile(cwd, "pyproject.toml", "[tool.ruff]\nline-length = 100\n");

        expect(detectLintCommand(cwd)).toEqual({
            label: "python:ruff-check",
            command: "uv",
            args: ["run", "ruff", "check", "."],
        });
    });

    it("returns undefined when no linter exists", () => {
        const cwd = makeTmpRepo("pi-quality-none-");
        writeFile(cwd, "README.md", "# test\n");

        expect(detectLintCommand(cwd)).toBeUndefined();
    });

    it("blocks existing .env reads and writes but allows .env.example", () => {
        const cwd = makeTmpRepo("pi-quality-env-");
        writeFile(cwd, ".env", "SECRET=value\n");
        writeFile(cwd, ".env.example", "SECRET=\n");

        expect(shouldBlockEnvAccess(cwd, "read", { path: ".env" })).toContain("Blocked read");
        expect(shouldBlockEnvAccess(cwd, "write", { path: ".env", content: "x" })).toContain("Blocked write");
        expect(shouldBlockEnvAccess(cwd, "edit", { filePath: ".env" })).toContain("Blocked edit");
        expect(shouldBlockEnvAccess(cwd, "read", { path: ".env.example" })).toBeUndefined();
    });

    it("blocks grep/find/ls when the requested scope includes .env", () => {
        const cwd = makeTmpRepo("pi-quality-env-scope-");
        writeFile(cwd, ".env", "SECRET=value\n");
        writeFile(cwd, "src/index.ts", "export const ok = true;\n");

        expect(shouldBlockEnvAccess(cwd, "grep", { path: "." })).toContain("Blocked grep");
        expect(shouldBlockEnvAccess(cwd, "find", { path: cwd })).toContain("Blocked find");
        expect(shouldBlockEnvAccess(cwd, "ls", { path: "." })).toContain("Blocked ls");
    });

    it("allows grep/find/ls when scope does not include .env", () => {
        const cwd = makeTmpRepo("pi-quality-env-safe-scope-");
        writeFile(cwd, ".env", "SECRET=value\n");
        writeFile(cwd, "src/index.ts", "export const ok = true;\n");

        expect(shouldBlockEnvAccess(cwd, "grep", { path: "src" })).toBeUndefined();
        expect(shouldBlockEnvAccess(cwd, "find", { path: "src" })).toBeUndefined();
        expect(shouldBlockEnvAccess(cwd, "ls", { path: "src" })).toBeUndefined();
    });

    it("does not block .env paths when .env does not exist", () => {
        const cwd = makeTmpRepo("pi-quality-no-env-");

        expect(shouldBlockEnvAccess(cwd, "read", { path: ".env" })).toBeUndefined();
    });

    it("runs detected lint after successful edit/write results", async () => {
        const cwd = makeTmpRepo("pi-quality-run-lint-");
        writeFile(cwd, "package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));

        const pi = createFakePi();
        const exec = vi.fn(async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }));
        pi.exec = exec;
        piQualityGuardExtension(pi as any);

        const handlers = pi.handlers.get("tool_result") ?? [];
        const result = await handlers[0](
            { toolName: "edit", toolCallId: "1", input: { path: "src/a.ts" }, isError: false },
            { cwd, ui: { setStatus: vi.fn() } },
        );

        expect(exec).toHaveBeenCalledWith("npm", ["run", "lint"], { cwd });
        expect(result?.content?.[0]?.text).toContain("Post-change lint passed");
    });

    it("does not run lint after failed mutating tool results", async () => {
        const cwd = makeTmpRepo("pi-quality-failed-edit-");
        writeFile(cwd, "package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));

        const pi = createFakePi();
        const exec = vi.fn(async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }));
        pi.exec = exec;
        piQualityGuardExtension(pi as any);

        const handlers = pi.handlers.get("tool_result") ?? [];
        const result = await handlers[0](
            { toolName: "write", toolCallId: "1", input: { path: "src/a.ts" }, isError: true },
            { cwd, ui: { setStatus: vi.fn() } },
        );

        expect(exec).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it("passes silently after edits when no linter exists", async () => {
        const cwd = makeTmpRepo("pi-quality-edit-no-lint-");
        const pi = createFakePi();
        const exec = vi.fn(async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }));
        pi.exec = exec;
        piQualityGuardExtension(pi as any);

        const handlers = pi.handlers.get("tool_result") ?? [];
        const result = await handlers[0](
            { toolName: "edit", toolCallId: "1", input: { path: "src/a.ts" }, isError: false },
            { cwd, ui: { setStatus: vi.fn() } },
        );

        expect(exec).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
