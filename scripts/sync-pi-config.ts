import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export type Mode = "pull" | "push";
type JsonObject = Record<string, unknown>;

const EXCLUDED_TOP_LEVEL_PATHS = new Set(["auth.json", "sessions", "npm"]);
const SETTINGS_RELATIVE_PATH = "settings.json";

function resolveGlobalAgentDir(): string {
    const fromEnv = process.env.PI_CODING_AGENT_DIR?.trim();
    if (fromEnv) return path.resolve(fromEnv);
    return path.join(os.homedir(), ".pi", "agent");
}

function parseMode(argv: string[]): Mode {
    const mode = argv[2] as Mode | undefined;
    if (!mode || (mode !== "pull" && mode !== "push")) {
        throw new Error("Usage: tsx scripts/sync-pi-config.ts <pull|push>");
    }
    return mode;
}

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function isManagedRelativePath(relativePath: string): boolean {
    const normalized = relativePath.split(path.sep).join("/");
    if (!normalized) return false;
    if (path.posix.basename(normalized) === ".DS_Store") return false;

    const topLevel = normalized.split("/")[0];
    return !EXCLUDED_TOP_LEVEL_PATHS.has(topLevel);
}

function listRelativeFilesRecursive(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const files: string[] = [];

    const walk = (relativeDir: string) => {
        const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;

        for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
            const relativePath = relativeDir
                ? path.posix.join(relativeDir.split(path.sep).join("/"), entry.name)
                : entry.name;

            if (!isManagedRelativePath(relativePath)) continue;

            if (entry.isDirectory()) {
                walk(relativePath);
                continue;
            }

            if (entry.isFile()) {
                files.push(relativePath);
            }
        }
    };

    walk("");
    return files.sort();
}

function parseObjectJson(text: string): JsonObject | undefined {
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
        return parsed as JsonObject;
    } catch {
        return undefined;
    }
}

function parseNpmPackageName(spec: string): string | undefined {
    if (!spec.startsWith("npm:")) return undefined;

    const raw = spec.slice(4);
    if (!raw) return undefined;

    const atIndex = raw.lastIndexOf("@");
    if (atIndex <= 0) return raw;
    return raw.slice(0, atIndex);
}

function mergePackages(sourcePackages: string[], targetPackages: string[]): string[] {
    const merged: string[] = [];
    const addExact = (value: string) => {
        if (!merged.includes(value)) merged.push(value);
    };

    for (const sourceValue of sourcePackages) addExact(sourceValue);

    for (const targetValue of targetPackages) {
        const targetName = parseNpmPackageName(targetValue);
        if (!targetName) {
            addExact(targetValue);
            continue;
        }

        const existingByNameIndex = merged.findIndex((candidate) => parseNpmPackageName(candidate) === targetName);
        if (existingByNameIndex === -1) {
            addExact(targetValue);
            continue;
        }

        merged[existingByNameIndex] = targetValue;
    }

    return merged;
}

function mergeSettingsPackages(sourceBuf: Buffer, targetBuf: Buffer): Buffer | undefined {
    const sourceJson = parseObjectJson(sourceBuf.toString("utf-8"));
    const targetJson = parseObjectJson(targetBuf.toString("utf-8"));
    if (!sourceJson || !targetJson) return undefined;

    const sourcePackages = Array.isArray(sourceJson.packages)
        ? sourceJson.packages.filter((v): v is string => typeof v === "string")
        : [];
    const targetPackages = Array.isArray(targetJson.packages)
        ? targetJson.packages.filter((v): v is string => typeof v === "string")
        : [];

    sourceJson.packages = mergePackages(sourcePackages, targetPackages);
    return Buffer.from(`${JSON.stringify(sourceJson, null, 2)}\n`, "utf-8");
}

function copyFileIfChanged(source: string, target: string, relativePath: string): boolean {
    const sourceBuf = fs.readFileSync(source);
    let outputBuf = sourceBuf;

    if (fs.existsSync(target)) {
        const targetBuf = fs.readFileSync(target);
        if (relativePath === SETTINGS_RELATIVE_PATH) {
            const mergedSettings = mergeSettingsPackages(sourceBuf, targetBuf);
            if (mergedSettings) outputBuf = mergedSettings;
        }
        if (outputBuf.equals(targetBuf)) return false;
    }

    ensureDir(path.dirname(target));
    fs.writeFileSync(target, outputBuf);
    return true;
}

function removeFileIfExists(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath);
    return true;
}

function pruneEmptyManagedDirectories(root: string, relativeDir = ""): void {
    const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;
    if (!fs.existsSync(absoluteDir)) return;

    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const childRelative = relativeDir
            ? path.posix.join(relativeDir.split(path.sep).join("/"), entry.name)
            : entry.name;

        if (!isManagedRelativePath(childRelative)) continue;
        pruneEmptyManagedDirectories(root, childRelative);
    }

    if (!relativeDir) return;

    if (fs.readdirSync(absoluteDir).length === 0) {
        fs.rmdirSync(absoluteDir);
    }
}

export function syncManagedPiDirectory(mode: Mode, localPiDir: string, globalAgentDir: string): { updated: number; deleted: number } {
    const sourceRoot = mode === "push" ? localPiDir : globalAgentDir;
    const targetRoot = mode === "push" ? globalAgentDir : localPiDir;
    ensureDir(targetRoot);

    const sourceFiles = listRelativeFilesRecursive(sourceRoot);
    const sourceSet = new Set(sourceFiles);

    let updated = 0;
    for (const relativePath of sourceFiles) {
        const sourcePath = path.join(sourceRoot, relativePath);
        const targetPath = path.join(targetRoot, relativePath);
        if (copyFileIfChanged(sourcePath, targetPath, relativePath)) updated += 1;
    }

    let deleted = 0;
    for (const targetRelativePath of listRelativeFilesRecursive(targetRoot)) {
        if (sourceSet.has(targetRelativePath)) continue;
        const targetPath = path.join(targetRoot, targetRelativePath);
        if (removeFileIfExists(targetPath)) deleted += 1;
    }

    pruneEmptyManagedDirectories(targetRoot);

    return { updated, deleted };
}

export function main(): void {
    const mode = parseMode(process.argv);
    const projectRoot = process.cwd();
    const localPiDir = path.join(projectRoot, ".pi");
    const globalAgentDir = resolveGlobalAgentDir();

    if (!fs.existsSync(localPiDir)) {
        throw new Error(`Local .pi directory not found: ${localPiDir}`);
    }

    ensureDir(globalAgentDir);

    console.log(`Sync start: mode=${mode} local=${localPiDir} global=${globalAgentDir}`);
    const result = syncManagedPiDirectory(mode, localPiDir, globalAgentDir);

    console.log(`Mode: ${mode}`);
    console.log(`Local: ${localPiDir}`);
    console.log(`Global: ${globalAgentDir}`);
    console.log(`Updated files: ${result.updated}`);
    console.log(`Deleted files: ${result.deleted}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
