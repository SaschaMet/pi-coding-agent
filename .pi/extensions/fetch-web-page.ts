import type { AgentToolUpdateCallback, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 12_000;

const FetchWebPageParams = Type.Object({
	url: Type.String({ description: "URL to fetch." }),
});

export interface FetchWebPageParams {
	url: string;
}

export interface FetchWebPageDetails {
	url: string;
	finalUrl: string;
	status: number;
	contentType: string;
	title?: string;
	text: string;
	truncated: boolean;
}

function normalizeWhitespace(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n[ \t\f\v]+/g, "\n")
		.replace(/[ \t\f\v]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function decodeHtmlEntities(text: string): string {
	const namedEntities: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
	};

	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity: string) => {
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const codePoint = Number.parseInt(entity.slice(2), 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
		}
		if (entity.startsWith("#")) {
			const codePoint = Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
		}
		return namedEntities[entity.toLowerCase()] ?? _match;
	});
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) return undefined;
	const title = normalizeWhitespace(decodeHtmlEntities(match[1] ?? ""));
	return title || undefined;
}

function stripHtmlToText(fragment: string): string {
	const withoutNoise = fragment
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
		.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ");

	const withBreaks = withoutNoise
		.replace(/<\/(p|div|section|article|main|header|footer|aside|nav|li|tr|h[1-6]|blockquote|pre|figure|figcaption|table)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<li\b[^>]*>/gi, "- ")
		.replace(/<\/(td|th)>/gi, "\t");

	return normalizeWhitespace(
		decodeHtmlEntities(
			withBreaks
				.replace(/<[^>]+>/g, " ")
				.replace(/\u00a0/g, " "),
		),
	);
}

function chooseReadableFragment(html: string): string {
	const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
	const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);

	for (const candidate of [articleMatch?.[1], mainMatch?.[1], bodyMatch?.[1], html]) {
		if (!candidate) continue;
		if (stripHtmlToText(candidate).length > 0) {
			return candidate;
		}
	}

	return html;
}

function getContentType(response: { headers?: { get: (name: string) => string | null } }): string {
	return response.headers?.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isHtmlContentType(contentType: string): boolean {
	return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

function buildSummary(details: FetchWebPageDetails): string {
	const lines = [`Fetched ${details.finalUrl} (${details.status})`];
	if (details.title) {
		lines.push(`Title: ${details.title}`);
	}
	if (details.text) {
		lines.push("");
		lines.push(details.text);
	}
	return lines.join("\n");
}

async function fetchReadablePage(url: string): Promise<FetchWebPageDetails> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(parsed.href, {
			method: "GET",
			redirect: "follow",
			signal: controller.signal,
			headers: {
				Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
				"User-Agent": "Mozilla/5.0 (compatible; pi-coding-agent/1.0)",
			},
		});

		const finalUrl = response.url || parsed.href;
		const status = response.status ?? 0;
		const contentType = getContentType(response);
		const body = await response.text();

		if (!response.ok) {
			throw new Error(`Request failed with status ${status}.`);
		}

		let title: string | undefined;
		let text = body.replace(/\r\n?/g, "\n");

		if (isHtmlContentType(contentType) || /<html\b|<!doctype html/i.test(body)) {
			const readableHtml = chooseReadableFragment(body);
			title = extractTitle(body);
			text = stripHtmlToText(readableHtml);
		} else {
			text = normalizeWhitespace(text);
		}

		let truncated = false;
		if (text.length > MAX_TEXT_CHARS) {
			text = `${text.slice(0, MAX_TEXT_CHARS)}\n[truncated]`;
			truncated = true;
		}

		return {
			url: parsed.href,
			finalUrl,
			status,
			contentType,
			title,
			text,
			truncated,
		};
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Request timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s.`);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

export default function fetchWebPageExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "fetch_web_page",
		label: "Fetch Web Page",
		description:
			"Fetch a URL and return readable text extracted from the page. Use for inspecting specific web pages.",
		parameters: FetchWebPageParams,
		execute: async (
			_toolCallId: string,
			params: FetchWebPageParams,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<FetchWebPageDetails> | undefined,
			_ctx: { cwd: string },
		) => {
			try {
				const details = await fetchReadablePage(params.url);
				return {
					content: [{ type: "text" as const, text: buildSummary(details) }],
					details,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Fetch web page failed: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: {
						url: params.url,
						finalUrl: params.url,
						status: 0,
						contentType: "",
						text: "",
						truncated: false,
					} satisfies FetchWebPageDetails,
					isError: true,
				};
			}
		},
	});
}
