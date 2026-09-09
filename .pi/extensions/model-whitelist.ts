import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const MODEL_WHITELIST_REGISTERED = Symbol.for(
	"pi.extensions.model-whitelist.registered",
);

/**
 * Filters the OpenRouter model dropdown to only show models listed in models.json.
 *
 * Reads ~/.pi/agent/models.json, extracts the openRouter.models array, and
 * replaces the built-in 276-model catalog via pi.registerProvider().
 *
 * Requires /reload to pick up models.json changes.
 */
export default function modelWhitelist(pi: ExtensionAPI): void {
	const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
	if (guardPi[MODEL_WHITELIST_REGISTERED]) return;
	guardPi[MODEL_WHITELIST_REGISTERED] = true;

	const modelsPath = join(getAgentDir(), "models.json");

	let parsed: {
		providers?: Record<
			string,
			{
				models?: (Partial<ProviderModelConfig> & { id: string })[];
				baseUrl?: string;
				apiKey?: string;
				api?: string;
			}
		>;
	};
	try {
		parsed = JSON.parse(readFileSync(modelsPath, "utf-8"));
	} catch {
		// Missing or invalid models.json — no-op
		return;
	}

	const openRouterConfig =
		parsed.providers?.openRouter ?? parsed.providers?.openrouter;
	if (!openRouterConfig?.models?.length) return;

	// Pass through every field declared on the whitelist entry (reasoning,
	// contextWindow, maxTokens, input, cost, thinkingLevelMap, headers, compat,
	// api, baseUrl); defaults apply only to fields models.json omits.
	const models: ProviderModelConfig[] = openRouterConfig.models.map((m) => ({
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
		...m,
		id: m.id,
		name: m.name ?? m.id,
	}));

	// Replace the built-in OpenRouter catalog with the whitelist.
	// Must use lowercase "openrouter" to match the built-in provider ID.
	pi.registerProvider("openrouter", {
		baseUrl: openRouterConfig.baseUrl,
		apiKey: openRouterConfig.apiKey,
		api: openRouterConfig.api,
		models,
	});
}
