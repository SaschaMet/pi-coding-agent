/**
 * Bash Sandbox Extension
 *
 * Provides bash env sanitization and only overrides `bash` when no other
 * extension has registered it yet (e.g. pi-container-sandbox).
 */

import process from "node:process";
import { createBashTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getDefaultBashEnvAllowlist, loadCapabilityConfig, sanitizeEnvWithAllowlist } from "./capability-policy.ts";

const BASH_SANDBOX_REGISTERED = Symbol.for("pi.extensions.bash-sandbox.registered");

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
	const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
	if (guardPi[BASH_SANDBOX_REGISTERED]) return;
	guardPi[BASH_SANDBOX_REGISTERED] = true;

	let registered = false;

	pi.on("session_start", async () => {
		if (registered) return;

		const hasNonBuiltinBash = pi
			.getAllTools()
			.some((tool) => tool.name === "bash" && tool.sourceInfo?.source !== "builtin");
		if (hasNonBuiltinBash) return;

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

		registered = true;
	});
}
