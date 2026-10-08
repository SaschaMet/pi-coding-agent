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

const packageDir = (agentDir: string, file: string): string =>
    path.join(agentDir, "npm", "node_modules", path.basename(path.dirname(file)));

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

export function checkPatch(agentDir: string, file: string): PatchStatus {
    const pkgDir = packageDir(agentDir, file);
    const base = {
        pkg: path.basename(path.dirname(file)),
        name: path.basename(file, ".patch"),
        file,
    };
    const reviewed = header(fs.readFileSync(file, "utf8"), "Reviewed-Version");
    if (!fs.existsSync(pkgDir)) return { ...base, state: "absent", reviewed, reviewDue: false };

    const installed = installedVersion(pkgDir);
    const state: PatchState =
        git(pkgDir, ["--check", "-R", file]).status === 0
            ? "applied"
            : git(pkgDir, ["--check", file]).status === 0
              ? "needed"
              : "conflict";
    const reviewDue = Boolean(reviewed && installed && reviewed !== installed);
    return { ...base, state, installed, reviewed, reviewDue };
}

export function applyPatch(agentDir: string, file: string): PatchState {
    const before = checkPatch(agentDir, file).state;
    if (before !== "needed") return before;
    git(packageDir(agentDir, file), [file]);
    // Re-check: a session that started at the same time may have applied it first.
    return checkPatch(agentDir, file).state;
}

export function runCheck(agentDir: string): { statuses: PatchStatus[]; exitCode: 0 | 1 | 2 } {
    const statuses = listPatches(agentDir).map((file) => checkPatch(agentDir, file));
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
