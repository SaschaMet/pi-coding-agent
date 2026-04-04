import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadProjectAgentConfig } from "../shared/agent-config.ts";

export type SubagentAgentScope = "user" | "project" | "both";

export interface SubagentRuntimeConfig {
    defaultAgentScope: SubagentAgentScope;
    maxParallelTasks: number;
    maxConcurrency: number;
    strictLocalRuntime: boolean;
}

const DEFAULT_MAX_PARALLEL_TASKS = 8;
const DEFAULT_MAX_CONCURRENCY = 4;

function isDirectory(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

export function findNearestProjectPiDir(cwd: string): string | null {
    let currentDir = cwd;
    while (true) {
        const candidate = path.join(currentDir, ".pi");
        if (isDirectory(candidate)) return candidate;

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) return null;
        currentDir = parentDir;
    }
}

function resolveConfiguredPath(rawPath: string, baseDir: string): string {
    if (rawPath === "~") return os.homedir();
    if (rawPath.startsWith(`~${path.sep}`) || rawPath.startsWith("~/")) {
        return path.join(os.homedir(), rawPath.slice(2));
    }
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(baseDir, rawPath);
}

function isPathWithin(baseDir: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function loadConfiguredSkillRoots(cwd: string): { project: string[]; user: string[] } {
    const projectPiDir = findNearestProjectPiDir(cwd);
    if (!projectPiDir) return { project: [], user: [] };

    const projectRoot = path.dirname(projectPiDir);
    const settingsPath = path.join(projectPiDir, "settings.json");
    const projectRoots: string[] = [];
    const userRoots: string[] = [];
    const seen = new Set<string>();

    const addRoot = (resolvedPath: string) => {
        const normalized = path.resolve(resolvedPath);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        if (isPathWithin(projectRoot, normalized)) projectRoots.push(normalized);
        else userRoots.push(normalized);
    };

    try {
        if (isFile(settingsPath)) {
            const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as { skills?: unknown };
            if (Array.isArray(parsed.skills)) {
                for (const rawPath of parsed.skills) {
                    if (typeof rawPath !== "string" || rawPath.trim().length === 0) continue;
                    addRoot(resolveConfiguredPath(rawPath.trim(), projectRoot));
                }
            }
        }
    } catch {
        // Ignore invalid settings and fall back to the local .pi/skills directory below.
    }

    const localProjectSkillsDir = path.join(projectPiDir, "skills");
    if (isDirectory(localProjectSkillsDir)) addRoot(localProjectSkillsDir);

    return { project: projectRoots, user: userRoots };
}

export function loadSubagentRuntimeConfig(cwd: string): SubagentRuntimeConfig {
    const defaults: SubagentRuntimeConfig = {
        defaultAgentScope: "both",
        maxParallelTasks: DEFAULT_MAX_PARALLEL_TASKS,
        maxConcurrency: DEFAULT_MAX_CONCURRENCY,
        strictLocalRuntime: false,
    };

    const parsed = loadProjectAgentConfig<{
        subagent?: {
            defaultAgentScope?: SubagentAgentScope;
            maxParallelTasks?: number;
            maxConcurrency?: number;
            strictLocalRuntime?: boolean;
        };
        security?: {
            strictSubagentLocalRuntime?: boolean;
        };
    }>(cwd);
    if (!parsed) return defaults;

    const maxParallelTasks = parsed.subagent?.maxParallelTasks ?? defaults.maxParallelTasks;
    const maxConcurrency = parsed.subagent?.maxConcurrency ?? defaults.maxConcurrency;
    return {
        defaultAgentScope: parsed.subagent?.defaultAgentScope ?? defaults.defaultAgentScope,
        maxParallelTasks:
            Number.isFinite(maxParallelTasks) && maxParallelTasks > 0 ? Math.floor(maxParallelTasks) : defaults.maxParallelTasks,
        maxConcurrency:
            Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? Math.floor(maxConcurrency) : defaults.maxConcurrency,
        strictLocalRuntime:
            typeof parsed.security?.strictSubagentLocalRuntime === "boolean"
                ? parsed.security.strictSubagentLocalRuntime
                : typeof parsed.subagent?.strictLocalRuntime === "boolean"
                    ? parsed.subagent.strictLocalRuntime
                    : defaults.strictLocalRuntime,
    };
}