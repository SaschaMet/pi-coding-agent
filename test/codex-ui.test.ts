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
});
