import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

type Mode = "pull" | "push";

type SyncEntry = {
    kind: "file" | "dir";
    relativePath: string;
    mergeJson?: boolean;
};

const ENTRIES: SyncEntry[] = [
    { kind: "file", relativePath: "settings.json", mergeJson: true },
    { kind: "file", relativePath: "models.json", mergeJson: true },
    { kind: "file", relativePath: "keybindings.json", mergeJson: true },
    { kind: "file", relativePath: "agent.config.json", mergeJson: true },
    { kind: "dir", relativePath: "extensions" },
    { kind: "dir", relativePath: "skills" },
    { kind: "dir", relativePath: "prompts" },
    { kind: "dir", relativePath: "themes" },
    { kind: "dir", relativePath: "agent" },
    { kind: "dir", relativePath: "security" },
];

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

function listFilesRecursive(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(fullPath);
            if (entry.isFile()) files.push(fullPath);
        }
    };
    walk(root);
    return files.sort();
}

function deepMerge(base: unknown, override: unknown): unknown {
    if (Array.isArray(base) || Array.isArray(override)) {
        return override ?? base;
    }

    if (isObject(base) && isObject(override)) {
        const merged: Record<string, unknown> = { ...base };
        for (const [key, value] of Object.entries(override)) {
            merged[key] = deepMerge((base as Record<string, unknown>)[key], value);
        }
        return merged;
    }

    return override ?? base;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function writeJson(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function copyDirIfChanged(sourceDir: string, targetDir: string): number {
    if (!fs.existsSync(sourceDir)) return 0;

    let changed = 0;
    for (const sourceFile of listFilesRecursive(sourceDir)) {
        const rel = path.relative(sourceDir, sourceFile);
        const targetFile = path.join(targetDir, rel);
        if (copyFileIfChanged(sourceFile, targetFile)) changed += 1;
    }
    return changed;
}

function mergeJsonFile(source: string, target: string): boolean {
    if (!fs.existsSync(source)) return false;
    const sourceJson = readJson(source);
    const targetJson = fs.existsSync(target) ? readJson(target) : {};
    const merged = deepMerge(targetJson, sourceJson);
    const mergedText = `${JSON.stringify(merged, null, 2)}\n`;
    const previousText = fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : "";
    if (mergedText === previousText) return false;
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, mergedText);
    return true;
}

function syncEntry(mode: Mode, localPiDir: string, globalAgentDir: string, entry: SyncEntry): number {
    const sourceRoot = mode === "push" ? localPiDir : globalAgentDir;
    const targetRoot = mode === "push" ? globalAgentDir : localPiDir;

    const sourcePath = path.join(sourceRoot, entry.relativePath);
    const targetPath = path.join(targetRoot, entry.relativePath);

    if (entry.kind === "file") {
        if (entry.mergeJson) {
            return mergeJsonFile(sourcePath, targetPath) ? 1 : 0;
        }
        if (!fs.existsSync(sourcePath)) return 0;
        return copyFileIfChanged(sourcePath, targetPath) ? 1 : 0;
    }

    return copyDirIfChanged(sourcePath, targetPath);
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

    let changes = 0;
    for (const entry of ENTRIES) {
        changes += syncEntry(mode, localPiDir, globalAgentDir, entry);
    }

    console.log(`Mode: ${mode}`);
    console.log(`Local: ${localPiDir}`);
    console.log(`Global: ${globalAgentDir}`);
    console.log(`Updated files: ${changes}`);
}

main();
