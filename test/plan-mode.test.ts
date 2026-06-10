import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import planModeExtension from "../.pi/extensions/plan-mode/index.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

function createUi() {
    return {
        theme: {
            fg: (_name: string, value: string) => value,
            strikethrough: (value: string) => value,
        },
        select: vi.fn(async () => "Stay in plan mode"),
        editor: vi.fn(async () => ""),
        setWidget: vi.fn(),
        setStatus: vi.fn(),
        notify: vi.fn(),
    };
}

describe("plan mode behavior", () => {
    it("uses planMode.allowedTools from config when enabling plan mode", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plan-mode-tools-"));
        fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, ".pi", "agent.config.json"),
            JSON.stringify({ planMode: { allowedTools: ["read", "grep", "bash"] } }, null, 2),
            "utf-8",
        );

        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = () => false;

        const ui = createUi();
        const ctx = {
            cwd: tmp,
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);
        await (pi as any).commands.get("plan")?.handler({}, ctx);

        expect((pi as any).activeTools).toEqual(["read", "grep", "bash"]);
    });

    it("keeps subagent out of default plan mode guidance", async () => {
        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = () => false;

        const ui = createUi();
        const ctx = {
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);
        await (pi as any).commands.get("plan")?.handler({}, ctx);

        const result = await pi.handlers.get("before_agent_start")?.[0]({}, ctx);
        const content = result?.message?.content ?? "";

        expect((pi as any).activeTools).not.toContain("subagent");
        expect(content).not.toContain("For research use subagents");
        expect(content).toContain("Create a detailed numbered plan");
    });

    it("does not register todo or widget commands", async () => {
        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = () => false;

        const ui = createUi();
        const ctx = {
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);

        expect(pi.commands.get("todos")).toBeUndefined();
        expect(pi.commands.get("plan-widget")).toBeUndefined();
        expect(pi.shortcuts.some((entry) => entry.shortcut === "ctrl+alt+p")).toBe(true);
    });

    it("prompts for next action after a plan without tracking todos", async () => {
        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = (name: string) => (name === "plan" ? true : undefined);

        const ui = createUi();
        const ctx = {
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);
        await pi.handlers.get("agent_end")?.[0](
            {
                messages: [
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "text",
                                text: "Plan:\n1. A new extension file for the tool, likely .pi/extensions/custom-tool.ts with tests and docs\n2. Define a minimal parameter schema for a single required url string",
                            },
                        ],
                    },
                ],
            },
            ctx,
        );

        expect(ui.select).toHaveBeenCalledWith("Plan mode - what next?", [
            "Execute the plan",
            "Stay in plan mode",
            "Refine the plan",
        ]);
        expect(ui.setWidget).not.toHaveBeenCalled();
    });

    it("clears plan status during session switch", async () => {
        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = () => false;

        const ui = createUi();
        const ctx = {
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);
        await (pi as any).commands.get("plan")?.handler({}, ctx);
        await pi.handlers.get("agent_end")?.[0](
            {
                messages: [
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "text",
                                text: "Plan:\n1. First step\n2. Second step",
                            },
                        ],
                    },
                ],
            },
            ctx,
        );

        await pi.handlers.get("session_before_switch")?.[0]({ reason: "new" }, ctx);

        expect(ui.setWidget).not.toHaveBeenCalled();
        expect(ui.setStatus.mock.calls.some(([key, value]) => key === "plan-mode" && value === undefined)).toBe(true);
    });

    it("restores cleared plan mode state on session_switch", async () => {
        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = () => false;

        const ui = createUi();
        const ctx = {
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);
        await (pi as any).commands.get("plan")?.handler({}, ctx);
        await pi.handlers.get("agent_end")?.[0](
            {
                messages: [
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "text",
                                text: "Plan:\n1. First step\n2. Second step",
                            },
                        ],
                    },
                ],
            },
            ctx,
        );

        await pi.handlers.get("session_switch")?.[0]({}, ctx);

        expect(ui.setStatus.mock.calls.some(([key, value]) => key === "plan-mode" && value === undefined)).toBe(true);
    });

    it("restores cleared plan mode state on session_established", async () => {
        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = () => false;

        const ui = createUi();
        const ctx = {
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);
        await (pi as any).commands.get("plan")?.handler({}, ctx);
        await pi.handlers.get("agent_end")?.[0](
            {
                messages: [
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "text",
                                text: "Plan:\n1. First step\n2. Second step",
                            },
                        ],
                    },
                ],
            },
            ctx,
        );

        await pi.handlers.get("session_established")?.[0]({}, ctx);

        expect(ui.setStatus.mock.calls.some(([key, value]) => key === "plan-mode" && value === undefined)).toBe(true);
    });

    it("does not leak plan execution context into a fresh session", async () => {
        const pi = createFakePi();
        planModeExtension(pi as any);
        pi.getFlag = () => false;

        const ui = createUi();
        const ctx = {
            hasUI: true,
            ui,
            sessionManager: {
                getEntries: () => [],
            },
        };

        await pi.handlers.get("session_start")?.[0]({}, ctx);
        await (pi as any).commands.get("plan")?.handler({}, ctx);
        await pi.handlers.get("agent_end")?.[0](
            {
                messages: [
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "text",
                                text: "Plan:\n1. Keep state for this session\n2. Execute task",
                            },
                        ],
                    },
                ],
            },
            ctx,
        );

        await pi.handlers.get("session_start")?.[0]({ reason: "new" }, ctx);

        expect(ui.setStatus.mock.calls.some(([key, value]) => key === "plan-mode" && value === undefined)).toBe(true);

        const contextResult = await pi.handlers.get("context")?.[0](
            {
                messages: [
                    { role: "user", customType: "plan-execution-context", content: "[EXECUTING PLAN - Full tool access enabled]" },
                ],
            },
            ctx,
        );
        expect(contextResult?.messages ?? []).toHaveLength(0);
    });
});
