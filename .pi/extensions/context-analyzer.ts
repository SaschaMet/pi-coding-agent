/**
 * context-usage — a Pi extension that analyzes current context usage,
 * similar to Claude Code's context meter.
 *
 * Local re-implementation (audited) of pi-context-analyzer@0.1.1.
 *
 * Commands:
 *  - `/context`          overview (tokens / window / percent / compaction
 *                        threshold) + breakdown by section: system prompt,
 *                        messages by role, tools by source
 *  - `/context skills`   scrollable list of loaded skills, sorted by
 *                        estimated prompt footprint
 *  - `/context tools`    scrollable list of registered tools with their
 *                        source, sorted by estimated definition size
 *  - `/context files`    list of loaded context files (AGENTS.md etc.)
 *
 * Structure:
 *  - `.pi/extensions/lib/context-analyzer.ts` — pure logic (breakdown
 *    collectors, lists, report, estimation). No pi imports; unit-tested.
 *  - This file — pi binding: the `/context` command handler, TUI panels
 *    (static panel, scrollable list), and command registration.
 *
 * Only difference vs. upstream: `DynamicBorder` does not exist in the
 * local pi-tui version, so a minimal `HrLine` component renders the same
 * colored horizontal rule.
 */
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import {
	Container,
	matchesKey,
	Text,
	type Component,
} from "@earendil-works/pi-tui";
import {
	type ListRow,
	buildReport,
	fileRows,
	fmt,
	skillRows,
	toolRows,
} from "./lib/context-analyzer.ts";

/* ------------------------------------------------------------------ */
/* ui: panel + scrollable list                                         */
/* ------------------------------------------------------------------ */

/** Horizontal rule colored via an injected fn — stands in for DynamicBorder. */
class HrLine implements Component {
	private readonly color: (s: string) => string;

	constructor(color: (s: string) => string) {
		this.color = color;
	}

	render(width: number): string[] {
		return [this.color("─".repeat(width))];
	}

	invalidate(): void {}
}

/** Static bordered panel, closed with Esc/Enter. No-op outside TUI mode. */
const showPanel = async (
	ctx: ExtensionCommandContext,
	body: string,
	footer = "Press Esc or Enter to close",
): Promise<void> => {
	if (ctx.mode !== "tui") return;

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new HrLine((s: string) => theme.fg("accent", s));

		container.addChild(border);
		container.addChild(new Text(body, 1, 0));
		container.addChild(new Text(theme.fg("dim", footer), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done(undefined);
				}
			},
		};
	});
};

/** Scrollable list panel (↑↓/PgUp/PgDn/Home/End), closed with Esc/Enter. No-op outside TUI mode. */
const showListUi = async (
	ctx: ExtensionCommandContext,
	title: string,
	rows: ListRow[],
): Promise<void> => {
	if (ctx.mode !== "tui") return;

	const sorted = [...rows].sort((a, b) => b.tokens - a.tokens);

	if (sorted.length === 0) {
		await showPanel(
			ctx,
			ctx.ui.theme.fg("dim", `No ${title.toLowerCase()} loaded.`),
		);
		return;
	}

	await ctx.ui.custom((tui, theme, _kb, done) => {
		let offset = 0;

		const pageHeight = () => Math.max(8, tui.terminal.rows - 6);

		const render = (width: number): string[] => {
			const nameCol = 26;
			const tokCol = 8;
			const descCol = Math.max(8, width - nameCol - tokCol - 6);
			const page = pageHeight();

			const out: string[] = [];
			out.push(theme.fg("accent", theme.bold(title)));
			out.push(
				theme.fg(
					"dim",
					`${sorted.length} items, largest first — ↑↓/PgUp/PgDn scroll · Esc/Enter close`,
				),
			);
			out.push("");
			for (let i = offset; i < Math.min(offset + page, sorted.length); i++) {
				const r = sorted[i];
				const name =
					r.name.length > nameCol - 1 ? r.name.slice(0, nameCol - 2) + "…" : r.name;
				const desc =
					r.desc.length > descCol ? r.desc.slice(0, descCol - 1) + "…" : r.desc;
				const highlight = i === offset ? "accent" : "text";
				out.push(
					theme.fg(
						highlight,
						name.padEnd(nameCol) + desc.padEnd(descCol) + " " + fmt(r.tokens),
					),
				);
			}
			out.push("");
			out.push(
				theme.fg(
					"dim",
					`Showing ${offset + 1}–${Math.min(offset + page, sorted.length)} of ${sorted.length}`,
				),
			);
			return out;
		};

		return {
			render,
			invalidate: () => {},
			handleInput: (data: string) => {
				const page = pageHeight();
				if (matchesKey(data, "up")) offset = Math.max(0, offset - 1);
				else if (matchesKey(data, "down"))
					offset = Math.min(sorted.length - 1, offset + 1);
				else if (matchesKey(data, "pageUp")) offset = Math.max(0, offset - page);
				else if (matchesKey(data, "pageDown"))
					offset = Math.min(sorted.length - 1, offset + page);
				else if (matchesKey(data, "home")) offset = 0;
				else if (matchesKey(data, "end")) offset = Math.max(0, sorted.length - 1);
				else if (matchesKey(data, "enter") || matchesKey(data, "escape"))
					done(undefined);
			},
		};
	});
};

/* ------------------------------------------------------------------ */
/* command                                                             */
/* ------------------------------------------------------------------ */

/** Adapter: pi's estimateTokens is typed to AgentMessage; the core expects unknown. */
const estimate: (m: unknown) => number = (m) =>
	estimateTokens(m as Parameters<typeof estimateTokens>[0]);

/**
 * The `/context` command handler — routes subcommands and picks the output
 * sink per mode (tui / json / print / notify).
 */
const contextCommand =
	(pi: ExtensionAPI) =>
	async (
		args: string | undefined,
		ctx: ExtensionCommandContext,
	): Promise<void> => {
		const sub = (args ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

		/* --- list subcommands (skills / tools / files) --- */
		if (sub === "skills" || sub === "tools" || sub === "files") {
			const rows: ListRow[] =
				sub === "skills"
					? skillRows(ctx)
					: sub === "tools"
						? toolRows(pi)
						: fileRows(ctx);
			const title =
				sub === "skills" ? "Skills" : sub === "tools" ? "Tools" : "Context files";

			if (ctx.mode === "tui") {
				await showListUi(ctx, title, rows);
				return;
			}

			// Non-TUI fallback: plain text rows.
			const text = rows
				.sort((a, b) => b.tokens - a.tokens)
				.map((r) => `${r.name}\t${r.desc}\t${fmt(r.tokens)}`)
				.join("\n");
			const payload = `${title}:\n${text || "(none)"}`;
			if (ctx.hasUI) ctx.ui.notify(payload, "info");
			else if (ctx.mode === "json") process.stderr.write(payload + "\n");
			else console.log(payload);
			return;
		}

		if (sub === "help" || sub === "h") {
			const help =
				"Context usage commands:\n" +
				"  /context           overview + section breakdown\n" +
				"  /context skills    list loaded skills by estimated size\n" +
				"  /context tools     list registered tools by estimated size\n" +
				"  /context files     list loaded context files (AGENTS.md etc.)";
			if (ctx.mode === "tui") await showPanel(ctx, help);
			else console.log(help);
			return;
		}

		/* --- default: overview + breakdown --- */
		if (ctx.mode === "tui") {
			await showPanel(ctx, buildReport(pi, ctx, estimate));
			return;
		}

		const report = buildReport(pi, ctx, estimate);
		if (ctx.hasUI) {
			ctx.ui.notify(report, "info");
		} else if (ctx.mode === "json") {
			// JSON mode streams events to stdout — keep the report off the protocol.
			process.stderr.write(report + "\n");
		} else {
			// Print mode: emit the report as plain text.
			console.log(report);
		}
	};

/* ------------------------------------------------------------------ */
/* registration                                                        */
/* ------------------------------------------------------------------ */

export default function (pi: ExtensionAPI) {
	pi.registerCommand("context", {
		description:
			"Show context usage: overview + breakdown, or lists (skills/tools/files)",
		handler: contextCommand(pi),
	});
}
