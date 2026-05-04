import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

type Mode = "pull" | "push";

const EXCLUDED_TOP_LEVEL_PATHS = new Set(["auth.json", "sessions", "npm"]);

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

function copyFileIfChanged(source: string, target: string): boolean {
    const sourceBuf = fs.readFileSync(source);
    if (fs.existsSync(target)) {
        const targetBuf = fs.readFileSync(target);
        if (sourceBuf.equals(targetBuf)) return false;
    }
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, sourceBuf);
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

function syncManagedPiDirectory(mode: Mode, localPiDir: string, globalAgentDir: string): { updated: number; deleted: number } {
    const sourceRoot = mode === "push" ? localPiDir : globalAgentDir;
    const targetRoot = mode === "push" ? globalAgentDir : localPiDir;
    ensureDir(targetRoot);

    const sourceFiles = listRelativeFilesRecursive(sourceRoot);
    const sourceSet = new Set(sourceFiles);

    let updated = 0;
    for (const relativePath of sourceFiles) {
        const sourcePath = path.join(sourceRoot, relativePath);
        const targetPath = path.join(targetRoot, relativePath);
        if (copyFileIfChanged(sourcePath, targetPath)) updated += 1;
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

function main(): void {
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

main();
