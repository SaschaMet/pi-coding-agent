import fs from "node:fs";
import path from "node:path";

export function loadProjectAgentConfig<T>(cwd: string): T | undefined {
    const configPath = path.join(cwd, ".pi", "agent.config.json");
    if (!fs.existsSync(configPath)) return undefined;

    try {
        return JSON.parse(fs.readFileSync(configPath, "utf-8")) as T;
    } catch {
        return undefined;
    }
}