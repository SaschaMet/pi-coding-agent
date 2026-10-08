import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PatchState = "applied" | "needed" | "conflict" | "absent";

export interface PatchStatus {
    pkg: string;
    name: string;
    file: string;
    state: PatchState;
    installed?: string;
    reviewed?: string;
    reviewDue: boolean;
}

export function getAgentDir(): string {
    const fromEnv = process.env.PI_CODING_AGENT_DIR?.trim();
    return path.resolve(fromEnv || path.join(os.homedir(), ".pi", "agent"));
}

export function listPatches(agentDir: string): string[] {
    const root = path.join(agentDir, "patches");
    if (!fs.existsSync(root)) return [];
    const files: string[] = [];
    for (const pkg of fs.readdirSync(root, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        for (const file of fs.readdirSync(path.join(root, pkg.name)).sort()) {
            if (file.endsWith(".patch")) files.push(path.join(root, pkg.name, file));
        }
    }
    return files;
}

// The global install, plus the project's own copy when one exists (`<project>/.pi/npm`).
const packageDirs = (agentDir: string, file: string, projectDir?: string): string[] => {
    const pkg = path.basename(path.dirname(file));
    const roots = [path.join(agentDir, "npm", "node_modules")];
    if (projectDir) roots.push(path.join(projectDir, ".pi", "npm", "node_modules"));
    return [...new Set(roots.map((root) => path.join(root, pkg)))].filter((dir) => fs.existsSync(dir));
};

// `git apply` ignores text before the first diff line, so metadata lives there.
const header = (text: string, key: string): string | undefined =>
    new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text.split(/^--- /m)[0])?.[1].trim();

const installedVersion = (pkgDir: string): string | undefined => {
    try {
        const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
        return typeof version === "string" ? version : undefined;
    } catch {
        return undefined;
    }
};

// cwd is the package dir: git apply skips paths outside its cwd, so a patch can never reach elsewhere.
const git = (cwd: string, args: string[]) =>
    spawnSync("git", ["apply", ...args], { cwd, encoding: "utf8", timeout: 10_000 });

const stateIn = (pkgDir: string, file: string): Exclude<PatchState, "absent"> =>
    git(pkgDir, ["--check", "-R", file]).status === 0
        ? "applied"
        : git(pkgDir, ["--check", file]).status === 0
          ? "needed"
          : "conflict";

// Worst state across copies: one conflict outranks a needed copy, which outranks applied.
const RANK: Record<PatchState, number> = { absent: 0, applied: 1, needed: 2, conflict: 3 };

export function checkPatch(agentDir: string, file: string, projectDir?: string): PatchStatus {
    const base = {
        pkg: path.basename(path.dirname(file)),
        name: path.basename(file, ".patch"),
        file,
    };
    const reviewed = header(fs.readFileSync(file, "utf8"), "Reviewed-Version");
    const dirs = packageDirs(agentDir, file, projectDir);
    if (dirs.length === 0) return { ...base, state: "absent", reviewed, reviewDue: false };

    const state = dirs.map((dir) => stateIn(dir, file)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
    // Versions can differ between copies; the first (global) one decides the review.
    const installed = installedVersion(dirs[0]);
    const reviewDue = Boolean(reviewed && installed && reviewed !== installed);
    return { ...base, state, installed, reviewed, reviewDue };
}

export function applyPatch(agentDir: string, file: string, projectDir?: string): PatchState {
    // A conflicting copy blocks the whole patch so copies never drift apart.
    if (checkPatch(agentDir, file, projectDir).state === "needed") {
        for (const dir of packageDirs(agentDir, file, projectDir)) {
            if (stateIn(dir, file) === "needed") git(dir, [file]);
        }
    }
    // Re-check: a session that started at the same time may have applied it first.
    return checkPatch(agentDir, file, projectDir).state;
}

export function runCheck(agentDir: string, projectDir?: string): { statuses: PatchStatus[]; exitCode: 0 | 1 | 2 } {
    const statuses = listPatches(agentDir).map((file) => checkPatch(agentDir, file, projectDir));
    const exitCode = statuses.some((s) => s.state === "conflict")
        ? 2
        : statuses.some((s) => s.state === "needed")
          ? 1
          : 0;
    return { statuses, exitCode };
}

export function formatStatus(s: PatchStatus): string {
    const review = s.reviewDue ? ` (review due: reviewed ${s.reviewed}, installed ${s.installed})` : "";
    return `${s.pkg}/${s.name}: ${s.state}${review}`;
}
