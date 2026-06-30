import fs from "node:fs";
import path from "node:path";
import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

/**
 * Pre-Compaction Scratch File
 *
 * Before pi compacts the session, snapshot the high-signal, low-level facts from
 * the slice about to be summarized into a markdown scratch file. An LLM summary
 * tends to drop precise details (exact paths, commands, numbers, error strings);
 * this scratchpad is a deterministic safety net, optionally enriched by the
 * currently selected model.
 *
 * The hook is non-destructive: it writes the file and returns undefined so pi's
 * normal compaction proceeds untouched.
 *
 * Output: <cwd>/.pi/scratch/precompact-<sessionId>-<timestamp>.md (gitignored)
 */

const REGISTERED = Symbol.for("pi.extensions.precompact-scratch.registered");
const SCRATCH_DIR = path.join(".pi", "scratch");
const LLM_MAX_TOKENS = 2048;
const MAX_IDENTIFIERS = 60;
const MAX_LIST_ITEMS = 40;
const ERROR_SNIPPET_CHARS = 400;

interface ContentBlock {
	type?: string;
	text?: string;
	thinking?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

interface LooseMessage {
	role?: string;
	content?: unknown;
	command?: string;
	output?: string;
	toolName?: string;
	isError?: boolean;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const raw of content) {
		if (!raw || typeof raw !== "object") continue;
		const block = raw as ContentBlock;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		else if (block.type === "thinking" && typeof block.thinking === "string") parts.push(block.thinking);
	}
	return parts.join("\n");
}

function toolCallsFromMessage(message: LooseMessage): ContentBlock[] {
	if (!Array.isArray(message.content)) return [];
	return message.content.filter(
		(raw): raw is ContentBlock => !!raw && typeof raw === "object" && (raw as ContentBlock).type === "toolCall",
	);
}

function truncate(text: string, max: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max)}… [+${trimmed.length - max} chars]`;
}

function bulletList(items: string[], emptyNote: string): string {
	if (items.length === 0) return `_${emptyNote}_`;
	const shown = items.slice(0, MAX_LIST_ITEMS).map((item) => `- ${item}`);
	if (items.length > MAX_LIST_ITEMS) shown.push(`- …and ${items.length - MAX_LIST_ITEMS} more`);
	return shown.join("\n");
}

function dedupe(values: Iterable<string>): string[] {
	return Array.from(new Set(Array.from(values, (v) => v.trim()).filter((v) => v.length > 0)));
}

const IDENTIFIER_PATTERNS: RegExp[] = [
	/#\d+/g, // issue / PR references
	/(?<![\d.])v?\d+\.\d+\.\d+(?:[-+][\w.]+)?(?!\.?\d)/g, // semver-ish versions (skips IPs)
	/\b(?:localhost|127\.0\.0\.1):\d{2,5}\b/g, // local hosts with ports
	/\b[0-9a-f]{7,40}\b/g, // commit-hash-like tokens
	/\bhttps?:\/\/[^\s)\]}"']+/g, // URLs
];

function extractIdentifiers(text: string): string[] {
	const found: string[] = [];
	for (const pattern of IDENTIFIER_PATTERNS) {
		const matches = text.match(pattern);
		if (matches) found.push(...matches);
	}
	return found;
}

interface Scrape {
	userRequests: string[];
	commands: string[];
	errors: string[];
	identifiers: string[];
}

function scrapeMessages(messages: LooseMessage[]): Scrape {
	const userRequests: string[] = [];
	const commands: string[] = [];
	const errors: string[] = [];
	const identifierBag: string[] = [];

	for (const message of messages) {
		switch (message.role) {
			case "user": {
				const text = textFromContent(message.content);
				if (text.trim()) userRequests.push(truncate(text, 300));
				identifierBag.push(...extractIdentifiers(text));
				break;
			}
			case "assistant": {
				const text = textFromContent(message.content);
				identifierBag.push(...extractIdentifiers(text));
				for (const call of toolCallsFromMessage(message)) {
					const args = call.arguments ?? {};
					if (call.name === "bash" && typeof args.command === "string") {
						commands.push(truncate(args.command, 200));
						identifierBag.push(...extractIdentifiers(args.command));
					}
				}
				break;
			}
			case "bashExecution": {
				if (typeof message.command === "string") {
					commands.push(truncate(message.command, 200));
					identifierBag.push(...extractIdentifiers(message.command));
				}
				break;
			}
			case "toolResult": {
				const text = textFromContent(message.content);
				if (message.isError) {
					const label = message.toolName ? `${message.toolName}: ` : "";
					errors.push(truncate(`${label}${text}`, ERROR_SNIPPET_CHARS));
				}
				identifierBag.push(...extractIdentifiers(text));
				break;
			}
			default:
				break;
		}
	}

	return {
		userRequests: dedupe(userRequests),
		commands: dedupe(commands),
		errors: dedupe(errors),
		identifiers: dedupe(identifierBag).slice(0, MAX_IDENTIFIERS),
	};
}

interface FileOps {
	read?: Set<string>;
	written?: Set<string>;
	edited?: Set<string>;
}

function fileSection(fileOps: FileOps | undefined): string {
	const written = new Set<string>([...(fileOps?.written ?? []), ...(fileOps?.edited ?? [])]);
	const readOnly = Array.from(fileOps?.read ?? []).filter((file) => !written.has(file));
	const modified = Array.from(written);
	return [
		"### Modified",
		bulletList(modified.sort(), "none"),
		"",
		"### Read (not modified)",
		bulletList(readOnly.sort(), "none"),
	].join("\n");
}

/** Best-effort enrichment using the CURRENTLY SELECTED model. Never throws. */
async function buildLlmDigest(
	messages: LooseMessage[],
	ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
	signal: AbortSignal,
): Promise<string | undefined> {
	const model = ctx.model;
	if (!model) return undefined;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return undefined;

	const conversationText = serializeConversation(convertToLlm(messages as never));
	const prompt = `You are extracting a durable scratchpad from a coding session that is about to be compacted.

Output a dense markdown bullet list of CONCRETE, low-level facts that a high-level summary would likely lose:
- exact file paths, function/class/symbol names
- exact command invocations and their key flags
- numeric values, ports, IDs, versions, counts
- config keys and env var names
- error messages and their cause
- decisions made and the precise rationale

Rules: bullets only, no prose narrative, no preamble, no headings. Skip anything you are unsure about rather than guessing.

<conversation>
${conversationText}
</conversation>`;

	try {
		const response = await complete(
			model,
			{ messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
			{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: LLM_MAX_TOKENS, signal },
		);
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
		return text.length > 0 ? text : undefined;
	} catch {
		return undefined;
	}
}

export default function precompactScratchExtension(pi: ExtensionAPI): void {
	const guard = pi as ExtensionAPI & Record<PropertyKey, unknown>;
	if (guard[REGISTERED]) return;
	guard[REGISTERED] = true;

	pi.on("session_before_compact", async (event, ctx) => {
		try {
			const { preparation, signal } = event;
			const messages = [
				...(preparation.messagesToSummarize ?? []),
				...(preparation.turnPrefixMessages ?? []),
			] as LooseMessage[];

			const scrape = scrapeMessages(messages);
			const digest = await buildLlmDigest(messages, ctx, signal);

			const sessionId = ctx.sessionManager.getSessionId() ?? "ephemeral";
			const now = new Date();
			const stamp = now.toISOString().replace(/[:.]/g, "-");
			const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";

			const lines = [
				`# Pre-Compaction Scratchpad`,
				"",
				`- **Session:** ${sessionId}`,
				`- **Captured:** ${now.toISOString()}`,
				`- **Tokens before compaction:** ${preparation.tokensBefore?.toLocaleString() ?? "?"}`,
				`- **Messages snapshotted:** ${messages.length}`,
				`- **Model:** ${modelLabel}`,
				"",
				"## Files",
				fileSection(preparation.fileOps as FileOps | undefined),
				"",
				"## Commands run",
				bulletList(
					scrape.commands.map((c) => `\`${c}\``),
					"none captured",
				),
				"",
				"## Errors / failures",
				bulletList(scrape.errors, "none captured"),
				"",
				"## Identifiers & numbers",
				bulletList(
					scrape.identifiers.map((i) => `\`${i}\``),
					"none captured",
				),
				"",
				"## Recent user requests",
				bulletList(scrape.userRequests, "none captured"),
				"",
				"## Detail digest (current model)",
				digest ?? "_Skipped — no model/API key available or generation failed._",
				"",
			];

			const dir = path.resolve(ctx.cwd, SCRATCH_DIR);
			fs.mkdirSync(dir, { recursive: true });
			const file = path.join(dir, `precompact-${sessionId}-${stamp}.md`);
			fs.writeFileSync(file, lines.join("\n"), "utf8");

			const rel = path.relative(ctx.cwd, file);
			ctx.ui.notify(`Pre-compaction scratch saved → ${rel}`, "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Pre-compaction scratch failed: ${message}`, "warning");
		}

		// Non-destructive: let pi's default compaction proceed.
		return undefined;
	});
}
