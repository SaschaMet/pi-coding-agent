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
  it("registers a configurable shortcut for toggling the plan widget", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plan-mode-shortcut-"));
    fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".pi", "agent.config.json"),
      JSON.stringify({ planMode: { toggleWidgetShortcut: "ctrl+shift+w" } }, null, 2),
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

    expect(pi.shortcuts.some((entry) => entry.shortcut === "ctrl+shift+w")).toBe(true);
    expect(pi.commands.get("plan-widget")).toBeDefined();
  });

  it("keeps the plan collapsed by default and reveals it on demand", async () => {
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
                text: "Plan:\n1. A new extension file for the tool, likely .pi/extensions/fetch-web-page.ts with tests and docs\n2. Define a minimal parameter schema for a single required url string",
              },
            ],
          },
        ],
      },
      ctx,
    );

    const visibleWidgetCalls = ui.setWidget.mock.calls.filter(([key, content]) => key === "plan-todos" && content !== undefined);
    expect(visibleWidgetCalls).toHaveLength(0);
    expect(ui.setStatus.mock.calls.some(([key, value]) => key === "plan-mode" && String(value).includes("Plan ready"))).toBe(true);

    const toggleCommand = (pi as any).commands.get("plan-widget");
    expect(toggleCommand).toBeDefined();
    await toggleCommand.handler({}, ctx);

    const revealedWidgetCalls = ui.setWidget.mock.calls.filter(([key, content]) => key === "plan-todos" && content !== undefined);
    expect(revealedWidgetCalls.length).toBeGreaterThan(0);
    const latestWidgetUpdate = revealedWidgetCalls.at(-1);
    expect(latestWidgetUpdate?.[1]).toEqual([
      "☐ A new extension file for the tool, likely .pi/extensions/fetch-web-page.ts with tests and docs",
      "☐ Define a minimal parameter schema for a single required url string",
    ]);
  });

  it("clears plan widget/status during session switch", async () => {
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

    await (pi as any).commands.get("plan-widget")?.handler({}, ctx);
    expect(ui.setWidget.mock.calls.some(([key, content]) => key === "plan-todos" && content !== undefined)).toBe(true);

    await pi.handlers.get("session_before_switch")?.[0]({ reason: "new" }, ctx);

    expect(ui.setWidget.mock.calls.some(([key, content]) => key === "plan-todos" && content === undefined)).toBe(true);
    expect(ui.setStatus.mock.calls.some(([key, value]) => key === "plan-mode" && value === undefined)).toBe(true);
  });

  it("does not leak todos into a fresh session without persisted plan state", async () => {
    const pi = createFakePi();
    planModeExtension(pi as any);
    pi.getFlag = () => false;

    let entries: any[] = [];
    const ui = createUi();
    const ctx = {
      hasUI: true,
      ui,
      sessionManager: {
        getEntries: () => entries,
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

    await (pi as any).commands.get("todos")?.handler({}, ctx);
    expect(ui.notify.mock.calls.some(([message]) => String(message).includes("Plan Progress"))).toBe(true);

    // Simulate creating/switching to a brand-new session in the same process.
    entries = [];
    await pi.handlers.get("session_switch")?.[0]({ reason: "new" }, ctx);

    await (pi as any).commands.get("todos")?.handler({}, ctx);
    expect(ui.notify.mock.calls.some(([message]) => String(message).includes("No todos"))).toBe(true);
    expect(ui.setWidget.mock.calls.some(([key, content]) => key === "plan-todos" && content === undefined)).toBe(true);
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
