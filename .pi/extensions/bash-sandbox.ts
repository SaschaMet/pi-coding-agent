/**
 * Bash Sandbox Extension
 *
 * Overrides the built-in bash tool and strips most environment variables
 * from spawned commands to reduce secret exposure.
 */

import process from "node:process";
import { createBashTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getDefaultBashEnvAllowlist, loadCapabilityConfig, sanitizeEnvWithAllowlist } from "./capability-policy.ts";

function parseAdditionalAllowlist(raw: string | undefined): Set<string> {
	if (!raw) return new Set();
	return new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

export function sanitizeBashEnv(
	env: NodeJS.ProcessEnv,
	additionalAllowed: Set<string> = parseAdditionalAllowlist(process.env.PI_BASH_ENV_ALLOWLIST),
	cwd: string = process.cwd(),
): NodeJS.ProcessEnv {
	const capabilityConfig = loadCapabilityConfig(cwd);
	const allowlist = getDefaultBashEnvAllowlist(capabilityConfig);
	return sanitizeEnvWithAllowlist(env, allowlist, additionalAllowed);
}

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command,
			cwd,
			env: sanitizeBashEnv(env),
		}),
	});

	pi.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
