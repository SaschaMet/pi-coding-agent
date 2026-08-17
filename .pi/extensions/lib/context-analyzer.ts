/**
 * context-usage — pure core of the `/context` extension.
 *
 * Local re-implementation (audited) of pi-context-analyzer@0.1.1.
 * No pi runtime imports: everything runs against structural types
 * (ContextLike / PiLike / ThemeLike) so the logic is unit-testable
 * without a live PI session. The registration stub lives in
 * `.pi/extensions/context-analyzer.ts`.
 */

/* ------------------------------------------------------------------ */
/* Structural pi types (kept pi-free for testability)                  */
/* ------------------------------------------------------------------ */

/** Theme colors actually used by this extension. */
export type ThemeColor =
	| "success"
	| "error"
	| "warning"
	| "accent"
	| "muted"
	| "dim"
	| "text";

/** Minimal theme surface used for rendering. */
export interface ThemeLike {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
}

/** Context usage as reported by the runtime. */
export interface ContextUsageLike {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

/** Pre-loaded skill as exposed by the runtime. */
export interface PromptSkill {
	name: string;
	description: string;
	filePath: string;
}

/** Pre-loaded context file (AGENTS.md etc.). */
export interface ContextFileLike {
	path: string;
	content: string;
}

/** Base system-prompt construction options (subset used here). */
export interface BuildPromptOptionsLike {
	customPrompt?: string;
	toolSnippets?: Record<string, string>;
	promptGuidelines?: string[];
	appendSystemPrompt?: string;
	contextFiles?: ContextFileLike[];
	skills?: PromptSkill[];
}

/** Tool info as exposed by the runtime (subset used here). */
export interface ToolLike {
	name: string;
	description?: string;
	parameters?: unknown;
	sourceInfo?: { source: string };
}

/** Session entries the message collector understands. */
export interface MessageEntryLike {
	type: "message";
	message: { role: string; [key: string]: unknown };
}
export interface CompactionEntryLike {
	type: "compaction";
	summary?: string;
}
export type SessionEntryLike =
	| MessageEntryLike
	| CompactionEntryLike
	| { type: Exclude<string, "message" | "compaction"> };

/** The command context surface used by this extension. */
export interface ContextLike {
	getSystemPrompt(): string;
	getSystemPromptOptions(): BuildPromptOptionsLike;
	getContextUsage(): ContextUsageLike | undefined;
	model: { provider: string; id: string } | undefined;
	ui: { theme: ThemeLike };
	sessionManager: { buildContextEntries(): SessionEntryLike[] };
}

/** The extension API surface used by this extension. */
export interface PiLike {
	getAllTools(): ToolLike[];
}

/* ------------------------------------------------------------------ */
/* node imports                                                        */
/* ------------------------------------------------------------------ */

import { basename } from "node:path";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

/* --- types --- */
/** One row of a breakdown section. */
export interface Line {
	label: string;
	tokens: number;
	detail?: string;
}

/** A named group of lines with a summed total. */
export interface Section {
	title: string;
	total: number;
	lines: Line[];
}

/** The three top-level sections of the context breakdown. */
export interface Breakdown {
	system: Section;
	messages: Section;
	tools: Section;
}

/** One row of the /context skills|tools|files lists. */
export interface ListRow {
	name: string;
	desc: string;
	tokens: number;
}

/* --- estimate --- */
/**
 * Token estimation.
 *
 * Today this is a chars/4 heuristic (same as pi's `estimateTokens`). Keeping
 * every estimate behind this module is the seam for a future real tokenizer —
 * swap the implementation here and every collector picks it up.
 */

/** Estimate tokens for arbitrary text (chars/4, same heuristic as pi's estimateTokens). */
export const textTokens = (s: string | undefined | null): number =>
	s && s.trim().length > 0 ? Math.max(1, Math.ceil(s.trim().length / 4)) : 0;

/**
 * Skills appear in the prompt as name/description/location blocks; full
 * SKILL.md content is loaded on demand, not inlined. The flat pad keeps the
 * estimate above zero.
 */
const SKILL_PROMPT_PAD = 30;

export const skillPromptTokens = (
	name: string,
	description: string,
	filePath: string,
): number =>
	textTokens(`${name} ${description} ${filePath}`) + SKILL_PROMPT_PAD;

/**
 * Interface for message estimators — pi's `estimateTokens` conforms to it;
 * tests inject a fake. Keeps `messagesSection` free of pi runtime imports so
 * it runs under any TS runner.
 */
export type MessageEstimator = (message: unknown) => number;

/* --- format --- */
/** Cap on sub-items listed per section in the overview. */
export const MAX_LISTED = 5;

/** Compact number formatting: 1.50M / 12.3k / 42. */
export const fmt = (n: number): string => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${Math.round(n)}`;
};

/** Token count as a percentage of the window (0 when window is unknown). */
export const percent = (tokens: number, window: number): number =>
	window > 0 ? (tokens / window) * 100 : 0;

/** Theme color for a token count relative to the window + compaction threshold. */
export const themeColorFor = (
	tokens: number,
	window: number,
	threshold: number,
): ThemeColor => {
	const p = percent(tokens, window);
	if (tokens >= threshold || p >= 95) return "error";
	if (p >= 75) return "warning";
	if (p >= 50) return "accent";
	return "success";
};

/** ASCII progress bar with a `┃` marker at the compaction threshold. */
export const bar = (
	tokens: number,
	window: number,
	threshold: number,
	width = 20,
): string => {
	const p = percent(tokens, window);
	const filled = Math.round((p / 100) * width);
	const thresholdPos = Math.min(
		Math.round((Math.min(threshold, window) / window) * width),
		width - 1,
	);
	const cells: string[] = Array.from({ length: width }, (_, i) =>
		i < filled ? "█" : "░",
	);
	if (thresholdPos >= 0) cells[thresholdPos] = "┃";
	return cells.join("");
};

/** Compact "a 2.1k · b 1.1k · +3 more" list, largest first, capped. */
export const compactList = (
	items: { label: string; tokens: number }[],
	cap = MAX_LISTED,
): string => {
	const sorted = [...items].sort((a, b) => b.tokens - a.tokens);
	const shown = sorted.slice(0, cap);
	const rest = sorted.length - shown.length;
	const parts = shown.map((i) => `${i.label} ${fmt(i.tokens)}`);
	if (rest > 0) parts.push(`+${rest} more`);
	return parts.join(" · ");
};

/* --- breakdown: system-prompt --- */
/** System prompt breakdown from the structured prompt options. */
export const systemPromptSection = (ctx: ContextLike): Section => {
	const opts = ctx.getSystemPromptOptions();
	const fullText = ctx.getSystemPrompt() ?? "";
	const fullTokens = textTokens(fullText);

	const lines: Line[] = [];

	const custom = textTokens(opts?.customPrompt);
	if (custom > 0) lines.push({ label: "custom prompt", tokens: custom });

	const guidelines = textTokens(opts?.promptGuidelines?.join("\n"));
	if (guidelines > 0) lines.push({ label: "guidelines", tokens: guidelines });

	const snippets = textTokens(
		opts?.toolSnippets ? Object.values(opts.toolSnippets).join("\n") : undefined,
	);
	if (snippets > 0) lines.push({ label: "tool snippets", tokens: snippets });

	const appended = textTokens(opts?.appendSystemPrompt);
	if (appended > 0) lines.push({ label: "appended prompt", tokens: appended });

	const files = opts?.contextFiles ?? [];
	const fileLines = files.map((f) => ({
		label: basename(f.path),
		tokens: textTokens(f.content),
	}));
	if (files.length > 0) {
		lines.push({
			label: `context files (${files.length})`,
			tokens: fileLines.reduce((a, b) => a + b.tokens, 0),
			detail: compactList(fileLines),
		});
	}

	const skills = opts?.skills ?? [];
	const skillLines = skills.map((s) => ({
		label: s.name,
		tokens: skillPromptTokens(s.name, s.description, s.filePath),
	}));
	if (skills.length > 0) {
		lines.push({
			label: `skills (${skills.length})`,
			tokens: skillLines.reduce((a, b) => a + b.tokens, 0),
			detail: compactList(skillLines),
		});
	}

	const partsSum = lines.reduce((a, b) => a + b.tokens, 0);
	const rest = Math.max(0, fullTokens - partsSum);
	if (rest > 0) lines.push({ label: "base prompt / other", tokens: rest });

	return {
		title: "System prompt",
		total: Math.max(fullTokens, partsSum),
		lines,
	};
};

/* --- breakdown: messages --- */
/**
 * Conversation breakdown by role, using the injected estimator — pi's
 * `estimateTokens` in production (see `breakdown/index.ts`), a fake in tests.
 */
export const messagesSection = (
	ctx: ContextLike,
	estimate: MessageEstimator,
): Section => {
	const entries = ctx.sessionManager.buildContextEntries();
	const byRole = new Map<string, number>();
	let compactionTokens = 0;

	for (const entry of entries) {
		if (entry.type === "message" && "message" in entry && entry.message) {
			const t = estimate(entry.message);
			const role = entry.message.role;
			byRole.set(role, (byRole.get(role) ?? 0) + t);
		} else if (
			entry.type === "compaction" &&
			"summary" in entry &&
			entry.summary
		) {
			// Compaction summaries are part of what the LLM sees.
			compactionTokens += textTokens(entry.summary);
		}
	}

	const lines: Line[] = [];
	const total =
		[...byRole.values()].reduce((a, b) => a + b, 0) + compactionTokens;

	if (compactionTokens > 0) {
		lines.push({ label: "compaction summary", tokens: compactionTokens });
	}
	for (const role of ["assistant", "toolResult", "user"] as const) {
		const t = byRole.get(role);
		if (t && t > 0) {
			lines.push({ label: role, tokens: t });
		}
	}

	return { title: "Messages", total, lines };
};

/* --- breakdown: tools --- */
/** Tool definitions breakdown, grouped by source (builtin / sdk / extension). */
export const toolsSection = (pi: PiLike): Section => {
	const tools = pi.getAllTools();
	const groups = new Map<
		string,
		{ count: number; tokens: number; biggest: Line[] }
	>();

	for (const tool of tools) {
		let group: string;
		switch (tool.sourceInfo?.source) {
			case "builtin":
				group = "builtin";
				break;
			case "sdk":
				group = "sdk";
				break;
			default:
				// Extensions — incl. any MCP tools registered via an extension
				// (pi has no built-in MCP support).
				group = "extension (incl. MCP)";
		}
		const serialized = JSON.stringify({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		});
		const t = textTokens(serialized);
		const g = groups.get(group) ?? { count: 0, tokens: 0, biggest: [] };
		g.count += 1;
		g.tokens += t;
		g.biggest.push({ label: tool.name, tokens: t });
		groups.set(group, g);
	}

	const lines: Line[] = [];
	let total = 0;
	for (const [group, g] of [...groups.entries()].sort(
		(a, b) => b[1].tokens - a[1].tokens,
	)) {
		total += g.tokens;
		lines.push({
			label: `${group} (${g.count})`,
			tokens: g.tokens,
			detail: compactList(g.biggest, 3),
		});
	}

	return { title: "Tools", total, lines };
};

/* --- collectBreakdown --- */

/**
 * Collects the full three-section breakdown. The estimator is injected
 * (pi's `estimateTokens` in production) so this file stays pi-free.
 */
export const collectBreakdown = (
	pi: PiLike,
	ctx: ContextLike,
	estimate: MessageEstimator,
): Breakdown => ({
	system: systemPromptSection(ctx),
	messages: messagesSection(ctx, estimate),
	tools: toolsSection(pi),
});

/* --- lists --- */
export const skillRows = (ctx: ContextLike): ListRow[] =>
	(ctx.getSystemPromptOptions()?.skills ?? []).map((s) => ({
		name: s.name,
		desc: s.description,
		tokens: skillPromptTokens(s.name, s.description, s.filePath),
	}));

export const toolRows = (pi: PiLike): ListRow[] =>
	pi.getAllTools().map((t) => ({
		name: t.name,
		desc: t.sourceInfo?.source ?? "unknown",
		tokens: textTokens(
			JSON.stringify({
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			}),
		),
	}));

export const fileRows = (ctx: ContextLike): ListRow[] =>
	(ctx.getSystemPromptOptions()?.contextFiles ?? []).map((f) => ({
		name: f.path,
		desc: "",
		tokens: textTokens(f.content),
	}));

/* --- report --- */
/** pi's default compaction reserveTokens (settings.json `compaction.reserveTokens`). */
const RESERVE_TOKENS = 16_384;

/** Renders the context overview + breakdown as a plain-text report. */
export const buildReport = (
	pi: PiLike,
	ctx: ContextLike,
	estimate: MessageEstimator = (m) => textTokens(JSON.stringify(m)),
): string => {
	const usage = ctx.getContextUsage();
	const model = ctx.model;
	const theme = ctx.ui.theme;

	const lines: string[] = [];
	lines.push(theme.fg("accent", theme.bold("Context Usage")));
	lines.push("");

	if (!usage) {
		lines.push(theme.fg("dim", "No active model or session yet."));
		return lines.join("\n");
	}

	const { tokens, contextWindow, percent: rawPercent } = usage;
	const threshold = contextWindow - RESERVE_TOKENS;
	const color = themeColorFor(tokens ?? 0, contextWindow, threshold);

	lines.push(
		`${theme.fg("muted", "Model:")}          ${theme.bold(`${model?.provider ?? "?"}/${model?.id ?? "?"}`)}`,
	);
	lines.push(
		`${theme.fg("muted", "Context window:")}   ${theme.bold(fmt(contextWindow))} tokens`,
	);
	lines.push(
		`${theme.fg("muted", "Used:")}             ${theme.fg(color, `${fmt(tokens ?? 0)} tokens (${rawPercent?.toFixed(1) ?? "?"}%)`)}`,
	);
	if (tokens !== null) {
		lines.push(
			`${theme.fg("muted", "Remaining:")}        ${theme.bold(fmt(Math.max(0, contextWindow - tokens)))} tokens`,
		);
	}
	lines.push("");
	lines.push(`  ${theme.fg(color, bar(tokens ?? 0, contextWindow, threshold))}`);
	lines.push(
		theme.fg(
			"dim",
			`  ┃ = auto-compaction threshold (window − reserve ${fmt(RESERVE_TOKENS)} = ${fmt(threshold)})`,
		),
	);

	if (tokens === null || rawPercent === null) {
		lines.push(theme.fg("dim", "Breakdown unavailable (tokens unknown)."));
		return lines.join("\n");
	}

	const hasReportedUsage = tokens > 0;

	/* --- section breakdown (estimates) --- */
	lines.push("");
	lines.push(theme.fg("accent", theme.bold("Section breakdown (estimated)")));
	if (!hasReportedUsage) {
		lines.push(
			theme.fg(
				"dim",
				"No provider usage yet — sizes below are chars/4 estimates from your session.",
			),
		);
	}

	const breakdown = collectBreakdown(pi, ctx, estimate);
	const sections: Section[] = [
		breakdown.system,
		breakdown.messages,
		breakdown.tools,
	];

	for (const section of sections) {
		const sColor = themeColorFor(section.total, tokens, threshold);
		lines.push("");
		const pctLabel = hasReportedUsage
			? ` ${theme.fg("dim", `(${percent(section.total, tokens).toFixed(1)}%)`)}`
			: "";
		lines.push(
			`${theme.bold(section.title)}${" ".repeat(Math.max(1, 16 - section.title.length))}` +
				`${theme.fg("muted", fmt(section.total))} ` +
				`${theme.fg(sColor, bar(section.total, tokens, threshold, 12))} ` +
				pctLabel,
		);
		for (const item of section.lines) {
			const detail = item.detail ? `  ${theme.fg("dim", item.detail)}` : "";
			lines.push(
				`  ${theme.fg("dim", "├")} ${item.label}${" ".repeat(Math.max(1, 22 - item.label.length))}${theme.fg("muted", fmt(item.tokens))}${detail}`,
			);
		}
	}

	if (hasReportedUsage) {
		/* --- reconciliation vs provider-reported total --- */
		const accounted = sections.reduce((a, s) => a + s.total, 0);
		const ratio = (accounted / tokens) * 100;
		const diff = tokens - accounted;
		lines.push("");
		lines.push(
			ratio >= 90
				? theme.fg(
						"success",
						`✓ Breakdown accounts for ${fmt(accounted)} of ${fmt(tokens)} tokens (${ratio.toFixed(0)}%)`,
					)
				: theme.fg(
						"warning",
						`Breakdown accounts for ${fmt(accounted)} of ${fmt(tokens)} tokens (${ratio.toFixed(0)}%); ` +
							`${fmt(diff)} unaccounted (cache markers, encodings, overhead)`,
					),
		);
	}

	lines.push("");
	lines.push(
		theme.fg(
			"dim",
			"Sizes are chars/4 estimates — the provider's own tokenizer may differ.  Subcommands: /context skills · tools · files",
		),
	);

	return lines.join("\n");
};
