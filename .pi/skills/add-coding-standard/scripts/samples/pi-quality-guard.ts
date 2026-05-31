import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@mariozechner/pi-coding-agent";

const QUALITY_GUARD_REGISTERED = Symbol.for("pi.skills.add-coding-standard.quality-guard.registered");
const MUTATING_TOOLS = new Set(["edit", "write"]);
const READ_ENV_TOOLS = new Set(["read", "grep", "find", "ls"]);
const MUTATE_ENV_TOOLS = new Set(["edit", "write"]);

export interface LintCommand {
    label: string;
    command: string;
    args: string[];
}

type ToolResultPatch = {
    content?: Array<{ type: "text"; text: string }>;
    details?: unknown;
    isError?: boolean;
};

type ToolInput = Record<string, unknown>;

function fileExists(filePath: string): boolean {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function readJsonFile(filePath: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return undefined;
    }
}

function hasPackageScript(cwd: string, script: string): boolean {
    const parsed = readJsonFile(path.join(cwd, "package.json"));
    if (typeof parsed !== "object" || parsed === null) return false;
    const scripts = (parsed as { scripts?: unknown }).scripts;
    return typeof scripts === "object" && scripts !== null && typeof (scripts as Record<string, unknown>)[script] === "string";
}

function detectPackageManager(cwd: string): string {
    if (fileExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (fileExists(path.join(cwd, "yarn.lock"))) return "yarn";
    if (fileExists(path.join(cwd, "bun.lock")) || fileExists(path.join(cwd, "bun.lockb"))) return "bun";
    return "npm";
}

function packageScriptCommand(cwd: string, script: string): LintCommand {
    const packageManager = detectPackageManager(cwd);
    return {
        label: `package:${script}`,
        command: packageManager,
        args: ["run", script],
    };
}

function makefileHasTarget(cwd: string, target: string): boolean {
    const makefilePath = fileExists(path.join(cwd, "Makefile"))
        ? path.join(cwd, "Makefile")
        : path.join(cwd, "makefile");
    if (!fileExists(makefilePath)) return false;

    const content = fs.readFileSync(makefilePath, "utf-8");
    const targetPattern = new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
    return targetPattern.test(content);
}

function pyprojectHasRuff(cwd: string): boolean {
    const pyprojectPath = path.join(cwd, "pyproject.toml");
    if (!fileExists(pyprojectPath)) return false;
    const content = fs.readFileSync(pyprojectPath, "utf-8");
    return /^\[tool\.ruff(?:\.|])/.test(content) || /\bruff\b/.test(content);
}

function hasPreCommitConfig(cwd: string): boolean {
    return fileExists(path.join(cwd, ".pre-commit-config.yaml")) || fileExists(path.join(cwd, ".pre-commit-config.yml"));
}

export function detectLintCommand(cwd: string): LintCommand | undefined {
    if (makefileHasTarget(cwd, "lint")) return { label: "make:lint", command: "make", args: ["lint"] };

    for (const script of ["lint", "check:fast", "check"]) {
        if (hasPackageScript(cwd, script)) return packageScriptCommand(cwd, script);
    }

    if (pyprojectHasRuff(cwd)) {
        return { label: "python:ruff-check", command: "uv", args: ["run", "ruff", "check", "."] };
    }

    if (hasPreCommitConfig(cwd)) {
        return { label: "pre-commit", command: "pre-commit", args: ["run", "--all-files"] };
    }

    return undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return undefined;
}

function getToolPathInput(toolName: string, input: ToolInput): string | undefined {
    if (toolName === "read" || toolName === "write" || toolName === "edit") {
        return firstNonEmptyString(input.path, input.file_path, input.filePath);
    }

    if (toolName === "grep" || toolName === "find" || toolName === "ls") {
        return firstNonEmptyString(input.path, input.file_path, input.filePath) ?? ".";
    }

    return undefined;
}

function resolveToolPath(cwd: string, inputPath: string): string {
    return path.resolve(cwd, inputPath);
}

function envPath(cwd: string): string {
    return path.join(cwd, ".env");
}

function isEnvPath(cwd: string, inputPath: string): boolean {
    return path.relative(envPath(cwd), resolveToolPath(cwd, inputPath)) === "";
}

function pathContainsEnvScope(cwd: string, inputPath: string): boolean {
    const resolvedScope = resolveToolPath(cwd, inputPath);
    const resolvedEnv = envPath(cwd);

    if (resolvedScope === resolvedEnv) return true;

    const relativeEnv = path.relative(resolvedScope, resolvedEnv);
    return relativeEnv === ".env" || (!relativeEnv.startsWith("..") && !path.isAbsolute(relativeEnv));
}

export function shouldBlockEnvAccess(cwd: string, toolName: string, input: ToolInput): string | undefined {
    if (!fileExists(envPath(cwd))) return undefined;
    if (!READ_ENV_TOOLS.has(toolName) && !MUTATE_ENV_TOOLS.has(toolName)) return undefined;

    const inputPath = getToolPathInput(toolName, input);
    if (!inputPath) return undefined;

    if (toolName === "grep" || toolName === "find" || toolName === "ls") {
        if (!pathContainsEnvScope(cwd, inputPath)) return undefined;
    } else if (!isEnvPath(cwd, inputPath)) {
        return undefined;
    }

    const action = MUTATE_ENV_TOOLS.has(toolName) ? "change" : "read";
    return `Blocked ${toolName}: refusing to ${action} existing .env file. Use .env.example for documentation.`;
}

async function gitStatus(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
    const result = await pi.exec("git", ["status", "--porcelain"], { cwd });
    if (result.code !== 0) return undefined;
    return result.stdout;
}

async function runLint(pi: ExtensionAPI, ctx: ExtensionContext): Promise<ToolResultPatch | undefined> {
    const lintCommand = detectLintCommand(ctx.cwd);
    if (!lintCommand) return undefined;

    ctx.ui.setStatus("quality-guard", `lint: ${lintCommand.label}`);
    const result = await pi.exec(lintCommand.command, lintCommand.args, { cwd: ctx.cwd });
    ctx.ui.setStatus("quality-guard", undefined);

    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    const text = output.length > 0 ? output : `No output from ${lintCommand.label}.`;

    if (result.code === 0) {
        return {
            content: [{ type: "text", text: `Post-change lint passed (${lintCommand.label}).\n${text}` }],
        };
    }

    return {
        isError: true,
        content: [{ type: "text", text: `Post-change lint failed (${lintCommand.label}).\n${text}` }],
    };
}

export default function piQualityGuardExtension(pi: ExtensionAPI): void {
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[QUALITY_GUARD_REGISTERED]) return;
    guardPi[QUALITY_GUARD_REGISTERED] = true;

    const bashStatusBefore = new Map<string, string | undefined>();

    pi.on("tool_call", async (event, ctx) => {
        const input = (event as { input?: ToolInput }).input ?? {};
        const blockReason = shouldBlockEnvAccess(ctx.cwd, event.toolName, input);
        if (blockReason) return { block: true, reason: blockReason };

        if (event.toolName === "bash") {
            bashStatusBefore.set(event.toolCallId, await gitStatus(pi, ctx.cwd));
        }

        return undefined;
    });

    pi.on("tool_result", async (event: ToolResultEvent, ctx): Promise<ToolResultPatch | undefined> => {
        if (event.isError) return undefined;

        if (MUTATING_TOOLS.has(event.toolName)) return runLint(pi, ctx);

        if (event.toolName === "bash") {
            const before = bashStatusBefore.get(event.toolCallId);
            bashStatusBefore.delete(event.toolCallId);
            if (before === undefined) return undefined;

            const after = await gitStatus(pi, ctx.cwd);
            if (after !== undefined && after !== before) return runLint(pi, ctx);
        }

        return undefined;
    });
}
