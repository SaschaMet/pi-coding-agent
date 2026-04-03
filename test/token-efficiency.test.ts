import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import tokenEfficiencyExtension, { formatTokenKpiSummary } from "../.pi/extensions/token-efficiency.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

function createTempCwd(): string {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-token-eff-"));
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    fs.writeFileSync(
        path.join(cwd, ".pi", "agent.config.json"),
        JSON.stringify(
            {
                tokenEfficiency: {
                    toolResultPreprocess: {
                        enabled: true,
                        maxChars: 220,
                        headChars: 120,
                        tailChars: 60,
                        tools: ["bash", "read", "fetch_web_page"],
                    },
                },
            },
            null,
            2,
        ),
        "utf-8",
    );
    return cwd;
}

describe("token efficiency extension", () => {
    it("truncates long configured tool outputs in the middle", async () => {
        const pi = createFakePi();
        tokenEfficiencyExtension(pi as any);

        const cwd = createTempCwd();
        const longOutput = `${"A".repeat(200)}${"B".repeat(180)}`;

        const result = await pi.handlers.get("tool_result")?.[0](
            {
                toolName: "bash",
                isError: false,
                content: [{ type: "text", text: longOutput }],
            },
            { cwd },
        );

        expect(result?.content).toBeDefined();
        const output = result.content[0].text as string;
        expect(output.length).toBeLessThan(longOutput.length);
        expect(output).toContain("[... output truncated");
        expect(output.startsWith("A")).toBe(true);
        expect(output.endsWith("B".repeat(60))).toBe(true);
    });

    it("sanitizes ansi sequences from bash output", async () => {
        const pi = createFakePi();
        tokenEfficiencyExtension(pi as any);

        const cwd = createTempCwd();
        const ansiOutput = "\u001b[31mERROR\u001b[0m\n\n\nNext line";

        const result = await pi.handlers.get("tool_result")?.[0](
            {
                toolName: "bash",
                isError: false,
                content: [{ type: "text", text: ansiOutput }],
            },
            { cwd },
        );

        const output = result.content[0].text as string;
        expect(output).toContain("ERROR");
        expect(output).not.toContain("\u001b[");
        expect(output).toContain("\n\nNext line");
    });

    it("does not modify outputs for non-configured tools", async () => {
        const pi = createFakePi();
        tokenEfficiencyExtension(pi as any);

        const cwd = createTempCwd();
        const unchanged = "X".repeat(500);

        const result = await pi.handlers.get("tool_result")?.[0](
            {
                toolName: "grep",
                isError: false,
                content: [{ type: "text", text: unchanged }],
            },
            { cwd },
        );

        expect(result).toBeUndefined();
    });

    it("formats token KPI summary from records", () => {
        const summary = formatTokenKpiSummary([
            {
                modelId: "gpt-5.3-codex",
                contextPercent: 20,
                inputTokens: 1000,
                outputTokens: 200,
                costTotal: 0.01,
            },
            {
                modelId: "gpt-5.3-codex",
                contextPercent: 40,
                inputTokens: 2000,
                outputTokens: 300,
                costTotal: 0.02,
            },
        ]);

        expect(summary).toContain("Token KPI (2 turns, model gpt-5.3-codex)");
        expect(summary).toContain("Avg ctx: 30.0%");
        expect(summary).toContain("P95 ctx: 40.0%");
        expect(summary).toContain("Avg input: 1500 tokens");
        expect(summary).toContain("Avg output: 250 tokens");
        expect(summary).toContain("Total cost: $0.030");
    });
});
