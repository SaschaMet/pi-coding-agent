import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import codexUiExtension, { formatCompactFooter, formatUsageSummary, normalizeStatuses, shortenPath } from "../.pi/extensions/codex-ui.ts";
import { createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

describe("codex ui extension", () => {
    it("registers header, footer, and editor overrides on session start", async () => {
        const pi = createFakePi();
        codexUiExtension(pi as any);

        const ui = createFakeUi();
        const ctx = {
            cwd: "/Users/saschametzger/Projects/pi-coding-agent",
            hasUI: true,
            ui,
            model: { id: "gpt-5.4 high" },
            sessionManager: {
                getBranch: () => [],
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);

        expect(ui.setHeader).toHaveBeenCalledTimes(1);
        expect(ui.setFooter).toHaveBeenCalledTimes(1);
        expect(ui.setEditorComponent).toHaveBeenCalledTimes(1);

        const editorFactory = ui.setEditorComponent.mock.calls[0]?.[0];
        expect(editorFactory).toBeTypeOf("function");

        const editor = editorFactory({ requestRender: vi.fn() }, {}, {});
        expect(editor.render(80)).toHaveLength(3);
    });

    it("skips ui overrides when interactive ui is unavailable", async () => {
        const pi = createFakePi();
        codexUiExtension(pi as any);

        const ui = createFakeUi();
        const ctx = {
            cwd: "/Users/saschametzger/Projects/pi-coding-agent",
            hasUI: false,
            ui,
            model: { id: "gpt-5.4 high" },
            sessionManager: {
                getBranch: () => [],
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);

        expect(ui.setHeader).not.toHaveBeenCalled();
        expect(ui.setFooter).not.toHaveBeenCalled();
        expect(ui.setEditorComponent).not.toHaveBeenCalled();
    });

    it("formats a compact footer with statuses, model, usage, and cwd", () => {
        expect(
            formatCompactFooter({
                statuses: ["Plan ready (2)", "Review pending"],
                modelId: "gpt-5.4 high",
                usageSummary: "↑1.0k ↓120 $0.012",
                gitBranch: "main",
                cwd: "/Users/saschametzger/Projects/pi-coding-agent",
            }),
        ).toBe("Plan ready (2) · Review pending · gpt-5.4 high · ↑1.0k ↓120 $0.012 · (main) · ~/Projects/pi-coding-agent");
    });

    it("formats usage summary from assistant message entries", () => {
        const usage = formatUsageSummary([
            {
                type: "message",
                message: {
                    role: "assistant",
                    usage: {
                        input: 1800,
                        output: 240,
                        cost: { total: 0.015 },
                    },
                },
            },
        ]);
        expect(usage).toBe("↑1.8k ↓240 $0.015");
    });

    it("formats a compact footer with statuses, model, and cwd", () => {
        expect(
            formatCompactFooter({
                statuses: ["Plan ready (2)", "Review pending"],
                modelId: "gpt-5.4 high",
                cwd: "/Users/saschametzger/Projects/pi-coding-agent",
            }),
        ).toBe("Plan ready (2) · Review pending · gpt-5.4 high · ~/Projects/pi-coding-agent");
    });

    it("omits empty footer segments and shortens cwd", () => {
        expect(
            formatCompactFooter({
                statuses: [],
                modelId: undefined,
                cwd: "/Users/saschametzger/Projects/pi-coding-agent",
            }),
        ).toBe("~/Projects/pi-coding-agent");
        expect(shortenPath("/tmp/pi-coding-agent")).toBe("/tmp/pi-coding-agent");
    });

    it("normalizes extension statuses from arrays, strings, and keyed objects", () => {
        expect(normalizeStatuses([" One ", undefined, "Two"])).toEqual(["One", "Two"]);
        expect(normalizeStatuses(" Ready ")).toEqual(["Ready"]);
        expect(normalizeStatuses({ plan: " Plan ready ", other: "" })).toEqual(["Plan ready"]);
    });

    it("renders footer output using statuses, usage, model, branch, and cwd", async () => {
        const pi = createFakePi();
        codexUiExtension(pi as any);

        const ui = createFakeUi();
        const ctx = {
            cwd: "/Users/saschametzger/Projects/pi-coding-agent",
            hasUI: true,
            ui,
            model: { id: "gpt-5.4 high" },
            sessionManager: {
                getBranch: () => [
                    {
                        type: "message",
                        message: {
                            role: "assistant",
                            usage: { input: 1200, output: 220, cost: { total: 0.01 } },
                        },
                    },
                ],
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);

        const footerFactory = ui.setFooter.mock.calls[0]?.[0];
        expect(footerFactory).toBeTypeOf("function");

        const requestRender = vi.fn();
        const footer = footerFactory(
            { requestRender },
            ui.theme,
            {
                getExtensionStatuses: () => ({ plan: "Plan ready (2)" }),
                getGitBranch: () => "main",
                onBranchChange: () => () => undefined,
            },
        );

        expect(footer.render(120)).toEqual([
            "Plan ready (2) · gpt-5.4 high · ↑1.2k ↓220 $0.010 · (main) · ~/Projects/pi-coding-agent",
        ]);
    });

    it("writes a token efficiency log snapshot on assistant turn end", async () => {
        const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as any);
        const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => undefined);

        try {
            const pi = createFakePi();
            codexUiExtension(pi as any);

            const ctx = {
                cwd: "/Users/saschametzger/Projects/pi-coding-agent",
                hasUI: false,
                ui: createFakeUi(),
                model: { id: "gpt-5.3-codex" },
                getContextUsage: () => ({ contextWindow: 200000, percent: 37.5 }),
                sessionManager: {
                    getBranch: () => [],
                    getEntries: () => [],
                },
            };

            await pi.handlers.get("turn_end")?.[0](
                {
                    message: {
                        role: "assistant",
                        usage: {
                            input: 1530,
                            output: 210,
                            cost: { total: 0.012 },
                        },
                    },
                },
                ctx,
            );

            expect(mkdirSpy).toHaveBeenCalledWith("/Users/saschametzger/Projects/pi-coding-agent/.pi/logs", {
                recursive: true,
            });
            expect(appendSpy).toHaveBeenCalledTimes(1);

            const [logPath, payload] = appendSpy.mock.calls[0] as [string, string];
            expect(logPath).toBe("/Users/saschametzger/Projects/pi-coding-agent/.pi/logs/token-efficiency.jsonl");
            expect(typeof payload).toBe("string");
            expect(payload.endsWith("\n")).toBe(true);

            const parsed = JSON.parse(payload.trim()) as Record<string, unknown>;
            expect(parsed.modelId).toBe("gpt-5.3-codex");
            expect(parsed.contextWindow).toBe(200000);
            expect(parsed.contextPercent).toBe(37.5);
            expect(parsed.inputTokens).toBe(1530);
            expect(parsed.outputTokens).toBe(210);
            expect(parsed.costTotal).toBe(0.012);
            expect(typeof parsed.timestamp).toBe("string");
        } finally {
            mkdirSpy.mockRestore();
            appendSpy.mockRestore();
        }
    });
});
