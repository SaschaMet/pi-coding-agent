import { parseEnvFile } from "./env.ts";

const envCache = new Map<string, Record<string, string>>();

function getCachedEnv(cwd: string): Record<string, string> {
	const cached = envCache.get(cwd);
	if (cached) return cached;
	const parsed = parseEnvFile(cwd);
	envCache.set(cwd, parsed);
	return parsed;
}

export function getScopedSecret(cwd: string, key: string): string | undefined {
	if (process.env[key] !== undefined) {
		return process.env[key];
	}
	const envValues = getCachedEnv(cwd);
	return envValues[key];
}

export function clearSecretCache(cwd?: string): void {
	if (!cwd) {
		envCache.clear();
		return;
	}
	envCache.delete(cwd);
}
