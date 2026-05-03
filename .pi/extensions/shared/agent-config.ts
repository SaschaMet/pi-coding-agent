import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function readAndParseConfig(configPath: string): unknown {
    if (!fs.existsSync(configPath)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
        return undefined;
    }
}

export function loadProjectAgentConfig<T>(cwd: string): T | undefined {
    // 1. Local config takes priority
    const localConfigPath = path.join(cwd, ".pi", "agent.config.json");
    if (fs.existsSync(localConfigPath)) {
        const localResult = readAndParseConfig(localConfigPath);
        if (localResult) return localResult as T;
        // Local file exists but is invalid JSON or empty; don't fall back
        return undefined;
    }

    // 2. Fallback: PI_CODING_AGENT_DIR env var
    const envDir = process.env.PI_CODING_AGENT_DIR;
    if (envDir) {
        const envConfigPath = path.join(envDir, "agent.config.json");
        const envResult = readAndParseConfig(envConfigPath);
        if (envResult) return envResult as T;
    }

    // 3. Fallback: ~/.pi/agent
    const defaultGlobalDir = path.join(os.homedir(), ".pi", "agent");
    const defaultConfigPath = path.join(defaultGlobalDir, "agent.config.json");
    const defaultResult = readAndParseConfig(defaultConfigPath);
    if (defaultResult) return defaultResult as T;

    return undefined;
}