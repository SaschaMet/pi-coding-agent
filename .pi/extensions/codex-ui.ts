import os from "node:os";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  CustomEditor,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const DEFAULT_PLACEHOLDER = "Find and fix a bug in @filename";
const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();

function createBuiltInTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
  };
}

function getBuiltInTools(cwd: string) {
  let tools = toolCache.get(cwd);
  if (!tools) {
    tools = createBuiltInTools(cwd);
    toolCache.set(cwd, tools);
  }
  return tools;
}

function padToWidth(line: string, width: number): string {
  const safeLine = truncateToWidth(line, width, "");
  const padding = " ".repeat(Math.max(0, width - visibleWidth(safeLine)));
  return safeLine + padding;
}

function compactText(value: string, limit = 80): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 1))}…`;
}

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatContextInfo(contextUsage: { contextWindow: number; percent: number | null } | undefined): string | undefined {
  if (!contextUsage) return undefined;
  const contextWindow = formatTokens(contextUsage.contextWindow);
  if (contextUsage.percent === null) {
    return `ctx ?/${contextWindow}`;
  }
  return `ctx ${contextUsage.percent.toFixed(1)}%/${contextWindow}`;
}

function wantsToolExpansion(text: string): boolean {
  return /(expand|show|open)\b[\s\S]{0,40}\b(file changes?|changes?|diffs?)\b/i.test(text);
}

function wantsToolCollapse(text: string): boolean {
  return /(collapse|hide|close)\b[\s\S]{0,40}\b(file changes?|changes?|diffs?)\b/i.test(text);
}

export function shortenPath(path: string): string {
  const home = os.homedir();
  if (path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

export function normalizeStatuses(statuses: unknown): string[] {
  if (Array.isArray(statuses)) {
    return statuses.map((status) => (typeof status === "string" ? status.trim() : "")).filter(Boolean);
  }

  if (typeof statuses === "string") {
    const trimmed = statuses.trim();
    return trimmed ? [trimmed] : [];
  }

  if (statuses && typeof statuses === "object") {
    return Object.values(statuses)
      .map((status) => (typeof status === "string" ? status.trim() : ""))
      .filter(Boolean);
  }

  return [];
}

export function formatUsageSummary(entries: unknown[]): string | undefined {
  let input = 0;
  let output = 0;
  let cost = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const maybeType = (entry as { type?: string }).type;
    const maybeMessage = (entry as { message?: AssistantMessage }).message;
    if (maybeType !== "message" || maybeMessage?.role !== "assistant") continue;

    input += maybeMessage.usage?.input ?? 0;
    output += maybeMessage.usage?.output ?? 0;
    cost += maybeMessage.usage?.cost?.total ?? 0;
  }

  if (input === 0 && output === 0 && cost === 0) return undefined;
  const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
  return `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`;
}

export function formatCompactFooter({
  statuses,
  modelId,
  cwd,
  contextLeft,
  usageSummary,
  gitBranch,
}: {
  statuses: unknown;
  modelId?: string;
  cwd: string;
  contextLeft?: string;
  usageSummary?: string;
  gitBranch?: string;
}): string {
  const segments = normalizeStatuses(statuses);

  if (modelId?.trim()) segments.push(modelId.trim());
  if (contextLeft?.trim()) segments.push(contextLeft.trim());
  if (usageSummary?.trim()) segments.push(usageSummary.trim());
  if (gitBranch?.trim()) segments.push(`(${gitBranch.trim()})`);
  if (cwd.trim()) segments.push(shortenPath(cwd.trim()));

  return segments.join(" · ");
}

class CodexEditor extends CustomEditor {
  private blinkVisible = true;
  private readonly dimBorder: (str: string) => string;

  constructor(...args: ConstructorParameters<typeof CustomEditor>) {
    super(...args);
    this.dimBorder = typeof args[1]?.borderColor === "function" ? args[1].borderColor : (str: string) => str;
    const timer = setInterval(() => {
      this.blinkVisible = !this.blinkVisible;
      this.tui.requestRender();
    }, 500);
    timer.unref?.();
  }

  private dim(str: string): string {
    return this.dimBorder(str);
  }

  render(width: number): string[] {
    this.borderColor = (str: string) => this.dim(str);
    const text = this.getText();

    if (text.length === 0) {
      const top = this.dim(padToWidth(`┌${"─".repeat(Math.max(0, width - 2))}┐`, width));
      const blink = this.focused && this.blinkVisible ? "▌" : " ";
      const innerWidth = Math.max(0, width - 2);
      const placeholder = this.dim(padToWidth(` > ${CURSOR_MARKER}${blink} ${DEFAULT_PLACEHOLDER}`, innerWidth));
      const middle = `${this.dim("│")}${placeholder}${this.dim("│")}`;
      const bottom = this.dim(padToWidth(`└${"─".repeat(Math.max(0, width - 2))}┘`, width));
      return [top, middle, bottom];
    }

    return super.render(width);
  }
}

function registerCompactToolRenderers(pi: ExtensionAPI) {
  pi.registerTool({
    name: "read",
    label: "read",
    description: getBuiltInTools(process.cwd()).read.description,
    parameters: getBuiltInTools(process.cwd()).read.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("read ")) + theme.fg("accent", shortenPath(args.path || ""));
      if (args.offset || args.limit) {
        const parts: string[] = [];
        if (args.offset) parts.push(`offset=${args.offset}`);
        if (args.limit) parts.push(`limit=${args.limit}`);
        text += theme.fg("dim", ` (${parts.join(", ")})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Reading…"), 0, 0);
      const textBlock = result.content.find((entry) => entry.type === "text");
      if (!textBlock || textBlock.type !== "text") return new Text(theme.fg("success", "Image loaded"), 0, 0);
      const lineCount = textBlock.text.split("\n").length;
      return new Text(theme.fg("dim", `${lineCount} lines`), 0, 0);
    },
  });

  pi.registerTool({
    name: "write",
    label: "write",
    description: getBuiltInTools(process.cwd()).write.description,
    parameters: getBuiltInTools(process.cwd()).write.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme) {
      const lineCount = typeof args.content === "string" ? args.content.split("\n").length : 0;
      const text =
        theme.fg("toolTitle", theme.bold("write ")) +
        theme.fg("accent", shortenPath(args.path || "")) +
        theme.fg("dim", lineCount > 0 ? ` (${lineCount} lines)` : "");
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Writing…"), 0, 0);
      const textBlock = result.content.find((entry) => entry.type === "text");
      if (textBlock?.type === "text" && /error/i.test(textBlock.text)) {
        return new Text(theme.fg("error", compactText(textBlock.text)), 0, 0);
      }
      return new Text(theme.fg("success", "Written"), 0, 0);
    },
  });

  pi.registerTool({
    name: "edit",
    label: "edit",
    description: getBuiltInTools(process.cwd()).edit.description,
    parameters: getBuiltInTools(process.cwd()).edit.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme) {
      const text = theme.fg("toolTitle", theme.bold("edit ")) + theme.fg("accent", shortenPath(args.path || ""));
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Editing…"), 0, 0);
      const details = result.details as { diff?: string } | undefined;
      if (!details?.diff) return new Text(theme.fg("success", "Applied"), 0, 0);

      let additions = 0;
      let removals = 0;
      for (const line of details.diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) removals++;
      }

      if (!expanded) {
        return new Text(
          `${theme.fg("success", `+${additions}`)}${theme.fg("dim", " / ")}${theme.fg("error", `-${removals}`)}${theme.fg("dim", " (ctrl+o to expand)")}`,
          0,
          0,
        );
      }

      return new Text(details.diff, 0, 0);
    },
  });

  pi.registerTool({
    name: "find",
    label: "find",
    description: getBuiltInTools(process.cwd()).find.description,
    parameters: getBuiltInTools(process.cwd()).find.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme) {
      const text =
        theme.fg("toolTitle", theme.bold("find ")) +
        theme.fg("accent", args.pattern || "") +
        theme.fg("dim", ` in ${shortenPath(args.path || ".")}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Searching…"), 0, 0);
      const textBlock = result.content.find((entry) => entry.type === "text");
      const count = textBlock?.type === "text" ? textBlock.text.split("\n").filter(Boolean).length : 0;
      return new Text(theme.fg("dim", `${count} files`), 0, 0);
    },
  });

  pi.registerTool({
    name: "grep",
    label: "grep",
    description: getBuiltInTools(process.cwd()).grep.description,
    parameters: getBuiltInTools(process.cwd()).grep.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme) {
      const text =
        theme.fg("toolTitle", theme.bold("grep ")) +
        theme.fg("accent", `/${args.pattern || ""}/`) +
        theme.fg("dim", ` in ${shortenPath(args.path || ".")}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Searching…"), 0, 0);
      const textBlock = result.content.find((entry) => entry.type === "text");
      const count = textBlock?.type === "text" ? textBlock.text.split("\n").filter(Boolean).length : 0;
      return new Text(theme.fg("dim", `${count} matches`), 0, 0);
    },
  });

  pi.registerTool({
    name: "ls",
    label: "ls",
    description: getBuiltInTools(process.cwd()).ls.description,
    parameters: getBuiltInTools(process.cwd()).ls.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme) {
      const text = theme.fg("toolTitle", theme.bold("ls ")) + theme.fg("accent", shortenPath(args.path || "."));
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Listing…"), 0, 0);
      const textBlock = result.content.find((entry) => entry.type === "text");
      const count = textBlock?.type === "text" ? textBlock.text.split("\n").filter(Boolean).length : 0;
      return new Text(theme.fg("dim", `${count} entries`), 0, 0);
    },
  });
}

export default function codexUiExtension(pi: ExtensionAPI): void {
  registerCompactToolRenderers(pi);

  pi.on("input", (event, ctx) => {
    if (!ctx.hasUI || event.source !== "interactive") return;
    const text = event.text || "";
    if (wantsToolExpansion(text)) {
      ctx.ui.setToolsExpanded(true);
      return;
    }
    if (wantsToolCollapse(text)) {
      ctx.ui.setToolsExpanded(false);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader(() => ({
      render: () => [],
      invalidate() {},
    }));

    ctx.ui.setFooter((tui, theme, footerData: any) => {
      const dispose = typeof footerData?.onBranchChange === "function" ? footerData.onBranchChange(() => tui.requestRender()) : undefined;

      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          const statuses = typeof footerData?.getExtensionStatuses === "function" ? footerData.getExtensionStatuses() : [];
          const gitBranch = typeof footerData?.getGitBranch === "function" ? footerData.getGitBranch() : undefined;
          const usageSummary = formatUsageSummary(
            typeof ctx.sessionManager?.getBranch === "function" ? ctx.sessionManager.getBranch() : [],
          );
          const contextUsage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
          const contextInfo = formatContextInfo(contextUsage);
          const thinkingLevel = ctx.model?.reasoning ? `thinking ${pi.getThinkingLevel()}` : undefined;
          const line = formatCompactFooter({
            statuses,
            modelId: ctx.model?.id,
            contextLeft: [thinkingLevel, contextInfo].filter(Boolean).join(" · "),
            usageSummary,
            gitBranch,
            cwd: ctx.cwd,
          });
          const dim = typeof theme?.fg === "function" ? theme.fg("dim", truncateToWidth(line, width)) : truncateToWidth(line, width);
          return [dim];
        },
      };
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => new CodexEditor(tui, theme, keybindings));
  });
}
