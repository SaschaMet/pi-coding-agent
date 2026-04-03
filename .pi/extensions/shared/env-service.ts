import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

interface EnvServiceConfig {
    envFile?: string;
    useProjectEnv?: boolean;
}

interface PiSettingsShape {
    envService?: EnvServiceConfig;
}

interface LoadedConfig {
    config: EnvServiceConfig;
    baseDir: string;
}

const envCache = new Map<string, Record<string, string>>();

function resolveGlobalConfigDir(): string {
    return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function parseJsonFile<T>(filePath: string): T | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
        return undefined;
    }
}

function parseEnvLine(line: string): [string, string] | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex === -1) return null;

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

    let value = withoutExport.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    } else {
        const inlineCommentIndex = value.indexOf(" #");
        if (inlineCommentIndex !== -1) {
            value = value.slice(0, inlineCommentIndex).trimEnd();
        }
    }

    return [key, value];
}

function parseEnvFile(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) return {};

    const cached = envCache.get(filePath);
    if (cached) return cached;

    const content = fs.readFileSync(filePath, "utf-8");
    const values: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (!parsed) continue;
        const [k, v] = parsed;
        values[k] = v;
    }
    envCache.set(filePath, values);
    return values;
}

function expandTemplatePath(inputPath: string): string {
    const withVars = inputPath.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, key: string) => process.env[key] ?? "");
    if (withVars.startsWith("~/")) {
        return path.join(os.homedir(), withVars.slice(2));
    }
    return withVars;
}

function loadConfiguredEnvService(cwd: string): LoadedConfig | undefined {
    const globalDir = resolveGlobalConfigDir();
    const globalSettingsPath = path.join(globalDir, "settings.json");
    const globalSettings = parseJsonFile<PiSettingsShape>(globalSettingsPath);

    const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
    const projectSettings = parseJsonFile<PiSettingsShape>(projectSettingsPath);

    if (projectSettings?.envService) {
        return { config: projectSettings.envService, baseDir: path.join(cwd, ".pi") };
    }

    if (globalSettings?.envService) {
        return { config: globalSettings.envService, baseDir: globalDir };
    }

    return undefined;
}

function resolveConfiguredEnvFile(cwd: string): string | undefined {
    const loaded = loadConfiguredEnvService(cwd);
    const rawPath = loaded?.config.envFile?.trim();
    if (!rawPath) return undefined;

    const expanded = expandTemplatePath(rawPath);
    return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(loaded!.baseDir, expanded);
}

function shouldUseProjectEnvFallback(cwd: string): boolean {
    const loaded = loadConfiguredEnvService(cwd);
    if (!loaded) return true;
    return loaded.config.useProjectEnv !== false;
}

export function getEnvSecret(cwd: string, key: string): string | undefined {
    if (process.env[key] !== undefined) {
        return process.env[key];
    }

    const configuredEnvFile = resolveConfiguredEnvFile(cwd);
    if (configuredEnvFile) {
        const values = parseEnvFile(configuredEnvFile);
        if (values[key] !== undefined) return values[key];
    }

    if (shouldUseProjectEnvFallback(cwd)) {
        const localEnvPath = path.join(cwd, ".env");
        const values = parseEnvFile(localEnvPath);
        if (values[key] !== undefined) return values[key];
    }

    return undefined;
}

export function clearEnvServiceCache(): void {
    envCache.clear();
}
