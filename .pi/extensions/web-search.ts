import fs from "node:fs";
import path from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { AgentToolUpdateCallback, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getScopedSecret } from "../../src/secrets.ts";

export type SearchProvider = "brave" | "tavily" | "serper";

export interface SearchResultItem {
    title: string;
    url: string;
    snippet: string;
    content?: string;
}

export interface SearchToolConfig {
    defaultProvider: SearchProvider;
    providers: Record<
        SearchProvider,
        {
            apiKeyEnv: string;
            baseUrl: string;
        }
    >;
}

const DEFAULT_CONFIG: SearchToolConfig = {
    defaultProvider: "brave",
    providers: {
        brave: {
            apiKeyEnv: "BRAVE_API_KEY",
            baseUrl: "https://api.search.brave.com/res/v1/web/search",
        },
        tavily: {
            apiKeyEnv: "TAVILY_API_KEY",
            baseUrl: "https://api.tavily.com/search",
        },
        serper: {
            apiKeyEnv: "SERPER_API_KEY",
            baseUrl: "https://google.serper.dev/search",
        },
    },
};

const SearchParamsSchema = Type.Object({
    query: Type.String({ description: "Search query." }),
    provider: Type.Optional(StringEnum(["brave", "tavily", "serper"] as const, { default: "brave" })),
    topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
    domains: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    recency: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    includeContent: Type.Optional(Type.Boolean({ default: false })),
});

interface SearchParams {
    query: string;
    provider?: SearchProvider;
    topK?: number;
    domains?: string[];
    recency?: number;
    includeContent?: boolean;
}

export function loadSearchConfig(cwd: string): SearchToolConfig {
    const configPath = path.join(cwd, ".pi", "agent.config.json");
    if (!fs.existsSync(configPath)) {
        return DEFAULT_CONFIG;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
            search?: {
                defaultProvider?: SearchProvider;
                providers?: Partial<SearchToolConfig["providers"]>;
            };
        };
        const merged: SearchToolConfig = {
            defaultProvider: parsed.search?.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
            providers: {
                brave: {
                    ...DEFAULT_CONFIG.providers.brave,
                    ...(parsed.search?.providers?.brave ?? {}),
                },
                tavily: {
                    ...DEFAULT_CONFIG.providers.tavily,
                    ...(parsed.search?.providers?.tavily ?? {}),
                },
                serper: {
                    ...DEFAULT_CONFIG.providers.serper,
                    ...(parsed.search?.providers?.serper ?? {}),
                },
            },
        };
        return merged;
    } catch {
        return DEFAULT_CONFIG;
    }
}

function recencyToBraveFreshness(recencyDays?: number): string | undefined {
    if (recencyDays === undefined) {
        return undefined;
    }
    if (recencyDays <= 1) return "pd";
    if (recencyDays <= 7) return "pw";
    if (recencyDays <= 31) return "pm";
    return "py";
}

export function normalizeBraveResults(raw: unknown, includeContent: boolean): SearchResultItem[] {
    const data = raw as {
        web?: {
            results?: Array<{
                title?: string;
                url?: string;
                description?: string;
                extra_snippets?: string[];
            }>;
        };
    };
    const items = data.web?.results ?? [];
    return items
        .filter((item) => item.url && item.title)
        .map((item) => ({
            title: item.title ?? "",
            url: item.url ?? "",
            snippet: item.description ?? "",
            content: includeContent ? item.extra_snippets?.join("\n") : undefined,
        }));
}

export function normalizeTavilyResults(raw: unknown, includeContent: boolean): SearchResultItem[] {
    const data = raw as {
        results?: Array<{
            title?: string;
            url?: string;
            content?: string;
            raw_content?: string;
        }>;
    };
    const items = data.results ?? [];
    return items
        .filter((item) => item.url && item.title)
        .map((item) => ({
            title: item.title ?? "",
            url: item.url ?? "",
            snippet: item.content ?? "",
            content: includeContent ? item.raw_content ?? item.content : undefined,
        }));
}

export function normalizeSerperResults(raw: unknown, includeContent: boolean): SearchResultItem[] {
    const data = raw as {
        organic?: Array<{
            title?: string;
            link?: string;
            snippet?: string;
        }>;
    };
    const items = data.organic ?? [];
    return items
        .filter((item) => item.link && item.title)
        .map((item) => ({
            title: item.title ?? "",
            url: item.link ?? "",
            snippet: item.snippet ?? "",
            content: includeContent ? item.snippet : undefined,
        }));
}

async function runSearchWithProvider(
    provider: SearchProvider,
    params: Required<Pick<SearchParams, "query" | "topK" | "includeContent">> &
        Pick<SearchParams, "domains" | "recency">,
    config: SearchToolConfig,
    cwd: string,
): Promise<SearchResultItem[]> {
    const providerConfig = config.providers[provider];
    const apiKey = getScopedSecret(cwd, providerConfig.apiKeyEnv);

    if (!apiKey) {
        throw new Error(`Missing API key. Set ${providerConfig.apiKeyEnv}.`);
    }

    if (provider === "brave") {
        const url = new URL(providerConfig.baseUrl);
        url.searchParams.set("q", params.query);
        url.searchParams.set("count", String(params.topK));
        if (params.domains && params.domains.length > 0) {
            url.searchParams.set("site", params.domains.join(","));
        }
        const freshness = recencyToBraveFreshness(params.recency);
        if (freshness) {
            url.searchParams.set("freshness", freshness);
        }

        const response = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "X-Subscription-Token": apiKey,
            },
        });
        if (!response.ok) {
            throw new Error(`Brave API request failed (${response.status}).`);
        }
        const payload = await response.json();
        return normalizeBraveResults(payload, params.includeContent).slice(0, params.topK);
    }

    if (provider === "tavily") {
        const response = await fetch(providerConfig.baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                api_key: apiKey,
                query: params.query,
                max_results: params.topK,
                include_domains: params.domains,
                include_raw_content: params.includeContent,
                days: params.recency,
            }),
        });
        if (!response.ok) {
            throw new Error(`Tavily API request failed (${response.status}).`);
        }
        const payload = await response.json();
        return normalizeTavilyResults(payload, params.includeContent).slice(0, params.topK);
    }

    const response = await fetch(providerConfig.baseUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
            q: params.query,
            num: params.topK,
        }),
    });
    if (!response.ok) {
        throw new Error(`Serper API request failed (${response.status}).`);
    }
    const payload = await response.json();
    return normalizeSerperResults(payload, params.includeContent).slice(0, params.topK);
}

export default function webSearchExtension(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description:
            "Search the web with configurable providers (default: Brave). Use for up-to-date facts and external documentation.",
        parameters: SearchParamsSchema,
        execute: async (
            _toolCallId: string,
            params: SearchParams,
            _signal: AbortSignal | undefined,
            _onUpdate: AgentToolUpdateCallback | undefined,
            ctx: { cwd: string },
        ) => {
            const config = loadSearchConfig(ctx.cwd);
            const provider = params.provider ?? config.defaultProvider;
            const topK = params.topK ?? 5;
            const includeContent = params.includeContent ?? false;

            try {
                const results = await runSearchWithProvider(
                    provider,
                    {
                        query: params.query,
                        topK,
                        includeContent,
                        domains: params.domains,
                        recency: params.recency,
                    },
                    config,
                    ctx.cwd,
                );

                const text =
                    results.length === 0
                        ? `No results found for "${params.query}".`
                        : results
                            .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`.trim())
                            .join("\n\n");

                return {
                    content: [{ type: "text" as const, text }],
                    details: {
                        provider,
                        query: params.query,
                        topK,
                        results,
                    },
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Web search failed (${provider}): ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    details: {
                        provider,
                        query: params.query,
                        topK,
                        results: [] as SearchResultItem[],
                    },
                    isError: true,
                };
            }
        },
    });
}

