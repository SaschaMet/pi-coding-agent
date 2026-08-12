import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// Helpers shared by the guard extensions. Kept under `lib/` so the extension loader
// ignores it: discovery only picks up `extensions/*.ts` and `extensions/<dir>/index.ts`.

export function firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return undefined;
}

/**
 * Target path of a file-mutating tool call. The built-in `write`/`edit` tools use `path`;
 * `file_path`/`filePath` cover custom tools that follow the other common convention.
 */
export function getToolPath(input: Record<string, unknown>): string | undefined {
    return firstNonEmptyString(input.path, input.file_path, input.filePath);
}

export function toPosix(value: string): string {
    return value.split(path.sep).join("/");
}

export function expandHomePath(rawPath: string): string {
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

/**
 * Resolves symlinks as far as the path exists, then reattaches the not-yet-created tail.
 * A write target usually does not exist yet, so plain `realpathSync` cannot be used.
 */
export function resolvePathWithRealAncestor(candidate: string): string {
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

export function resolveInputPath(inputPath: string, cwd: string): string {
    const normalizedInputPath = expandHomePath(inputPath);
    return resolvePathWithRealAncestor(
        path.isAbsolute(normalizedInputPath) ? normalizedInputPath : path.join(cwd, normalizedInputPath),
    );
}

export function isWithinRoot(targetPath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, targetPath);
    return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isOutsideWorkingDirectory(inputPath: string, cwd: string): boolean {
    return !isWithinRoot(resolveInputPath(inputPath, cwd), resolvePathWithRealAncestor(cwd));
}

/**
 * Repo-relative posix path, resolved through `~`, `..`, and symlinks so every guard
 * answers "which file is this?" the same way. Returns a `../`-prefixed path when the
 * target escapes `cwd` — callers must reject that rather than pattern-match it.
 */
export function toRepoRelative(inputPath: string, cwd: string): string {
    return toPosix(path.relative(resolvePathWithRealAncestor(cwd), resolveInputPath(inputPath, cwd)));
}

/**
 * Last `custom` entry of this type on the active branch. `undefined` means the branch
 * carries no such entry, which callers must treat as "reset to default" rather than
 * "keep whatever the previous branch had".
 */
export function readLastCustomEntry<T>(
    ctx: Pick<ExtensionContext, "sessionManager">,
    customType: string,
): { data: T | undefined } | undefined {
    let found: { data: T | undefined } | undefined;
    for (const entry of ctx.sessionManager.getBranch() as SessionEntry[]) {
        if (entry.type === "custom" && entry.customType === customType) {
            found = { data: entry.data as T | undefined };
        }
    }
    return found;
}
