import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import semver from "semver";
import { isManagedRelativePath } from "./sync-pi-config.ts";

export interface CompatViolation {
    name: string;
    location: string;
    range: string;
    installedVersion: string;
}

const HOST_PACKAGE = "@earendil-works/pi-coding-agent";

function scanDir(dir: string, installedVersion: string, violations: CompatViolation[]): void {
    if (!fs.existsSync(dir)) return;

    for (const name of fs.readdirSync(dir)) {
        const child = path.join(dir, name);
        if (!fs.existsSync(path.join(child, "package.json"))) {
            // scoped npm package layout: `@scope/pkg/package.json` one level down
            if (name.startsWith("@")) scanDir(child, installedVersion, violations);
            continue;
        }

        const pkgPath = path.join(child, "package.json");

        let pkg: { peerDependencies?: Record<string, string> };
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        } catch {
            continue;
        }

        const range = pkg.peerDependencies?.[HOST_PACKAGE];
        if (!range) continue;

        if (!semver.satisfies(installedVersion, range)) {
            violations.push({
                name,
                location: path.dirname(pkgPath),
                range,
                installedVersion,
            });
        }
    }
}

/**
 * Drift guard: verifies every extension/package declaring a peer dependency on
 * the pi coding agent host is compatible with the installed SDK version.
 * Host-range only by design: third-party extensions may declare stale ranges
 * for other packages, which must not fail the gate. Missing directories and
 * packages without a host range are skipped; malformed package.json files are
 * skipped (Fail-Safe: an unreadable file must not break discovery).
 */
export function checkExtensionCompat(options: {
    dirs: readonly string[];
    installedVersion: string;
}): CompatViolation[] {
    const violations: CompatViolation[] = [];
    for (const dir of options.dirs) {
        scanDir(dir, options.installedVersion, violations);
    }
    return violations;
}

export interface ExtensionTreeDiff {
    path: string;
    status: "differ" | "only-project";
}

function hashFile(absolutePath: string): string {
    return createHash("sha256")
        .update(fs.readFileSync(absolutePath))
        .digest("hex");
}

function listExtensionFiles(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const files: string[] = [];
    const walk = (absoluteDir: string, relativeDir: string): void => {
        for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
            const relativePath = relativeDir
                ? `${relativeDir}/${entry.name}`
                : entry.name;
            if (!isManagedRelativePath(relativePath)) continue;
            const absolute = path.join(absoluteDir, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                walk(absolute, relativePath);
                continue;
            }
            if (entry.isFile()) files.push(relativePath);
        }
    };
    walk(root, "");
    return files.sort();
}

/**
 * Drift guard for the project→global extension copy: lists files that exist in
 * the project tree but differ from (or are missing in) the global tree. Content
 * compared by sha256; exclusion rules reused from sync-pi-config; symlinks
 * skipped. Global-only files are deliberately not reported — the push flow
 * cannot create them, and reporting would be permanent noise.
 */
export function compareExtensionTrees(
    projectDir: string,
    globalDir: string,
): ExtensionTreeDiff[] {
    const projectFiles = listExtensionFiles(projectDir);
    const globalFiles = listExtensionFiles(globalDir);
    const globalAbsolute = new Map<string, string>(
        globalFiles.map((relativePath) => [
            relativePath,
            path.join(globalDir, relativePath),
        ]),
    );

    const diffs: ExtensionTreeDiff[] = [];
    for (const relativePath of projectFiles) {
        const absoluteGlobal = globalAbsolute.get(relativePath);
        if (absoluteGlobal === undefined) {
            diffs.push({ path: relativePath, status: "only-project" });
            continue;
        }
        if (
            hashFile(path.join(projectDir, relativePath)) !==
            hashFile(absoluteGlobal)
        ) {
            diffs.push({ path: relativePath, status: "differ" });
        }
    }
    return diffs;
}
