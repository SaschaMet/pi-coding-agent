import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { loadProjectAgentConfig } from "./shared/agent-config.ts";

interface ToolResultPreprocessConfig {
    enabled?: boolean;
    maxChars?: number;
    headChars?: number;
    tailChars?: number;
    tools?: string[];
}

interface TokenEfficiencyConfig {
    logPath?: string;
    toolResultPreprocess?: ToolResultPreprocessConfig;
}

interface TokenEfficiencyAgentConfig {
    tokenEfficiency?: TokenEfficiencyConfig;
}

interface ResolvedToolResultPreprocessConfig {
    enabled: boolean;
    maxChars: number;
    headChars: number;
    tailChars: number;
    tools: Set<string>;
}

const DEFAULT_TOOLS = ["bash", "read", "fetch_web_page"];
const DEFAULT_MAX_CHARS = 2200;
const DEFAULT_HEAD_CHARS = 1400;
const DEFAULT_TAIL_CHARS = 500;

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;
const DEFAULT_TOKEN_LOG_PATH = ".pi/logs/token-efficiency.jsonl";

interface TokenEfficiencyLogRecord {
    timestamp?: string;
    modelId?: string;
    contextPercent?: number | null;
    inputTokens?: number;
    outputTokens?: number;
    costTotal?: number;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
    return Math.floor(value);
}

function loadToolResultPreprocessConfig(cwd: string): ResolvedToolResultPreprocessConfig {
    const parsed = loadProjectAgentConfig<TokenEfficiencyAgentConfig>(cwd);
    const cfg = parsed?.tokenEfficiency?.toolResultPreprocess;

    const maxChars = normalizePositiveInt(cfg?.maxChars, DEFAULT_MAX_CHARS);
    const headChars = normalizePositiveInt(cfg?.headChars, DEFAULT_HEAD_CHARS);
    const tailChars = normalizePositiveInt(cfg?.tailChars, DEFAULT_TAIL_CHARS);
    const resolvedTools = Array.isArray(cfg?.tools)
        ? cfg.tools.map((tool) => tool.trim()).filter((tool) => tool.length > 0)
        : DEFAULT_TOOLS;

    return {
        enabled: cfg?.enabled !== false,
        maxChars,
        headChars,
        tailChars,
        tools: new Set(resolvedTools.length > 0 ? resolvedTools : DEFAULT_TOOLS),
    };
}

function sanitizeOutputText(text: string): string {
    return text.replace(ANSI_ESCAPE_PATTERN, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function truncateMiddle(text: string, config: ResolvedToolResultPreprocessConfig): string {
    if (text.length <= config.maxChars) return text;

    const marker = `\n\n[... output truncated ${text.length - config.maxChars} chars for token efficiency ...]\n\n`;
    const markerBudget = marker.length;
    const available = Math.max(200, config.maxChars - markerBudget);

    let head = Math.min(config.headChars, available);
    let tail = Math.min(config.tailChars, Math.max(0, available - head));
    if (head + tail > available) {
        tail = Math.max(0, available - head);
    }
    if (head + tail < available) {
        tail = Math.min(text.length - head, available - head);
    }

    const headPart = text.slice(0, head);
    const tailPart = tail > 0 ? text.slice(text.length - tail) : "";
    return `${headPart}${marker}${tailPart}`;
}

export function preprocessToolResultText(text: string, config: ResolvedToolResultPreprocessConfig): string {
    const sanitized = sanitizeOutputText(text);
    return truncateMiddle(sanitized, config);
}

function getTokenLogPath(cwd: string): string {
    const configured = loadProjectAgentConfig<TokenEfficiencyAgentConfig>(cwd)?.tokenEfficiency?.logPath;
    if (typeof configured === "string" && configured.trim().length > 0) {
        return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
    }
    return path.join(cwd, DEFAULT_TOKEN_LOG_PATH);
}

function loadTokenEfficiencyRecords(cwd: string): TokenEfficiencyLogRecord[] {
    const logPath = getTokenLogPath(cwd);
    if (!fs.existsSync(logPath)) return [];

    const lines = fs.readFileSync(logPath, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean);
    const records: TokenEfficiencyLogRecord[] = [];
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line) as TokenEfficiencyLogRecord;
            records.push(parsed);
        } catch {
            // Ignore malformed lines; keep summary resilient.
        }
    }
    return records;
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}

export function formatTokenKpiSummary(records: TokenEfficiencyLogRecord[]): string {
    if (records.length === 0) {
        return "Token KPI: no snapshots found.";
    }

    const contextPercents = records
        .map((entry) => (typeof entry.contextPercent === "number" ? entry.contextPercent : null))
        .filter((value): value is number => value !== null);
    const inputTokens = records
        .map((entry) => (typeof entry.inputTokens === "number" ? entry.inputTokens : 0))
        .filter((value) => value > 0);
    const outputTokens = records
        .map((entry) => (typeof entry.outputTokens === "number" ? entry.outputTokens : 0))
        .filter((value) => value > 0);
    const totalCost = records.reduce((sum, entry) => sum + (typeof entry.costTotal === "number" ? entry.costTotal : 0), 0);

    const latestModel = [...records].reverse().find((entry) => typeof entry.modelId === "string" && entry.modelId.length > 0)?.modelId;

    return [
        `Token KPI (${records.length} turns${latestModel ? `, model ${latestModel}` : ""})`,
        `- Avg ctx: ${average(contextPercents).toFixed(1)}%`,
        `- P95 ctx: ${percentile(contextPercents, 95).toFixed(1)}%`,
        `- Avg input: ${Math.round(average(inputTokens))} tokens`,
        `- Avg output: ${Math.round(average(outputTokens))} tokens`,
        `- Total cost: $${totalCost.toFixed(3)}`,
    ].join("\n");
}

export default function tokenEfficiencyExtension(pi: ExtensionAPI): void {
    pi.registerCommand("token-kpi", {
        description: "Show token-efficiency KPI summary from recent JSONL snapshots.",
        handler: async (args, ctx) => {
            const parsedLimit = Number.parseInt(String(args ?? "").trim(), 10);
            const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;
            const records = loadTokenEfficiencyRecords(ctx.cwd);
            const recent = records.slice(-limit);
            const summary = formatTokenKpiSummary(recent);

            if (ctx.hasUI) {
                ctx.ui.notify(summary, "info");
                return;
            }
            console.info(summary);
        },
    });

    pi.on("tool_result", async (event, ctx) => {
        if (event.isError) return;

        const config = loadToolResultPreprocessConfig(ctx.cwd);
        if (!config.enabled || !config.tools.has(event.toolName)) return;

        let changed = false;
        const content = event.content.map((block) => {
            if (block.type !== "text") return block;
            const nextText = preprocessToolResultText(block.text, config);
            if (nextText !== block.text) {
                changed = true;
                return { ...block, text: nextText };
            }
            return block;
        });

        if (!changed) return;
        return { content };
    });
}
