import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePi } from "./helpers/fake-pi.ts";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

import subagentExtension from "../.pi/extensions/subagent/index.ts";

function createMockProcess(lines: string[], exitCode = 0): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    setImmediate(() => proc.emit("close", exitCode));
    return true;
  });

  setImmediate(() => {
    for (const line of lines) {
      proc.stdout.write(`${line}\n`);
    }
    proc.stdout.end();
    proc.stderr.end();
    proc.emit("close", exitCode);
  });

  return proc;
}

describe("subagent chain execution", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("runs a configured skill as a subagent", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-skill-test-"));
    fs.mkdirSync(path.join(tmp, ".pi", "skills", "interactive-planner"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", ".bin", "pi"), "#!/bin/sh\nexit 0\n", "utf-8");
    fs.writeFileSync(
      path.join(tmp, ".pi", "settings.json"),
      JSON.stringify({ enableSkillCommands: false, skills: [".pi/skills"] }, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, ".pi", "skills", "interactive-planner", "SKILL.md"),
      [
        "---",
        "name: interactive-planner",
        "description: Planner skill",
        "---",
        "You are the interactive planner skill.",
      ].join("\n"),
      "utf-8",
    );

    let appendedSystemPrompt = "";
    spawnMock.mockImplementation((command: string, args: string[]) => {
      const promptFlagIndex = args.indexOf("--append-system-prompt");
      expect(promptFlagIndex).toBeGreaterThan(-1);
      appendedSystemPrompt = fs.readFileSync(args[promptFlagIndex + 1], "utf-8");
      expect(args.some((arg) => arg.includes("Task: plan the repo"))).toBe(true);

      const eventLine = JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "skill-plan" }],
          usage: {
            input: 12,
            output: 4,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0.001 },
            totalTokens: 16,
          },
          model: "claude-sonnet-4-5",
          stopReason: "stop",
        },
      });
      return createMockProcess([eventLine], 0);
    });

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      "call-skill-subagent",
      {
        agent: "interactive-planner",
        task: "plan the repo",
        agentScope: "project",
        confirmProjectAgents: false,
      },
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("skill-plan");
    expect(appendedSystemPrompt).toContain("You are the interactive planner skill.");
  });

  it("runs chain mode with previous-output interpolation and mocked subprocesses", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-test-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", ".bin", "pi"), "#!/bin/sh\nexit 0\n", "utf-8");
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "explorer.md"),
      [
        "---",
        "name: explorer",
        "description: Explorer",
        "tools: read, grep, find, ls",
        "model: claude-haiku-4-5",
        "---",
        "You are explorer.",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "planner.md"),
      [
        "---",
        "name: planner",
        "description: Planner",
        "tools: read, grep, find, ls",
        "model: claude-sonnet-4-5",
        "---",
        "You are planner.",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, ".pi", "agent.config.json"),
      JSON.stringify({ security: { strictSubagentLocalRuntime: true } }, null, 2),
      "utf-8",
    );

    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    spawnMock.mockImplementation((command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      const firstCall = spawnCalls.length === 1;
      const assistantText = firstCall ? "scout-output" : "final-plan";
      const eventLine = JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: assistantText }],
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0.001 },
            totalTokens: 15,
          },
          model: "claude-sonnet-4-5",
          stopReason: "stop",
        },
      });
      return createMockProcess([eventLine], 0);
    });

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      "call-subagent",
      {
        chain: [
          { agent: "explorer", task: "gather context" },
          { agent: "planner", task: "plan with {previous}" },
        ],
        agentScope: "project",
        confirmProjectAgents: false,
      },
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).not.toBe(true);
    expect(result.details.mode).toBe("chain");
    expect(result.details.results).toHaveLength(2);
    expect(result.content[0].text).toContain("final-plan");
    expect(spawnCalls[1].args.some((arg) => arg.includes("Task: plan with scout-output"))).toBe(true);
  });

  it("falls back from interactive-planner to planner in single mode", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-unknown-single-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", ".bin", "pi"), "#!/bin/sh\nexit 0\n", "utf-8");
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "planner.md"),
      [
        "---",
        "name: planner",
        "description: Planner",
        "---",
        "You are planner.",
      ].join("\n"),
      "utf-8",
    );

    spawnMock.mockImplementation(() => {
      const eventLine = JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "fallback-plan" }],
          usage: {
            input: 3,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0.001 },
            totalTokens: 5,
          },
          stopReason: "stop",
        },
      });
      return createMockProcess([eventLine], 0);
    });

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");

    const result = await tool!.execute(
      "call-subagent-unknown-single",
      {
        agent: "interactive-planner",
        task: "plan",
        agentScope: "project",
        confirmProjectAgents: false,
      },
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("fallback-plan");
    expect(result.details.results[0].agent).toBe("planner");
  });

  it("resolves underscore aliases for hyphenated agent names", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-unknown-chain-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", ".bin", "pi"), "#!/bin/sh\nexit 0\n", "utf-8");
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "gan-generator.md"),
      [
        "---",
        "name: gan-generator",
        "description: GAN generator",
        "---",
        "You are gan generator.",
      ].join("\n"),
      "utf-8",
    );

    spawnMock.mockImplementation(() => {
      const eventLine = JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "alias-ok" }],
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0.001 },
            totalTokens: 15,
          },
          model: "claude-sonnet-4-5",
          stopReason: "stop",
        },
      });
      return createMockProcess([eventLine], 0);
    });

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");

    const result = await tool!.execute(
      "call-subagent-alias",
      {
        agent: "gan_generator",
        task: "implement this slice",
        agentScope: "project",
        confirmProjectAgents: false,
      },
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("alias-ok");
    expect(result.details.results[0].agent).toBe("gan-generator");
  });

  it("falls back from gan-coder to gan-generator when gan-coder is unavailable", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-gan-fallback-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", ".bin", "pi"), "#!/bin/sh\nexit 0\n", "utf-8");
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "gan-generator.md"),
      ["---", "name: gan-generator", "description: GAN generator", "---", "You are gan generator."].join("\n"),
      "utf-8",
    );

    spawnMock.mockImplementation(() => {
      const eventLine = JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "gan-fallback-ok" }],
          usage: {
            input: 6,
            output: 4,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0.001 },
            totalTokens: 10,
          },
          stopReason: "stop",
        },
      });
      return createMockProcess([eventLine], 0);
    });

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");

    const result = await tool!.execute(
      "call-subagent-gan-fallback",
      {
        agent: "gan-coder",
        task: "implement this",
        agentScope: "project",
        confirmProjectAgents: false,
      },
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("gan-fallback-ok");
    expect(result.details.results[0].agent).toBe("gan-generator");
  });

  it("returns actionable guidance when no alias or fallback can be resolved", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-unknown-guidance-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "explorer.md"),
      ["---", "name: explorer", "description: Explorer", "---", "You are explorer."].join("\n"),
      "utf-8",
    );

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");

    const result = await tool!.execute(
      "call-subagent-unknown-guidance",
      {
        agent: "missing-agent",
        task: "plan",
        agentScope: "project",
        confirmProjectAgents: false,
      },
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Discovered agents (scope: project): explorer (project)');
    expect(result.content[0].text).toContain("configured skill roots");
  });

  it("returns actionable validation guidance for mixed/partial mode payloads", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-invalid-mode-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "planner.md"),
      ["---", "name: planner", "description: Planner", "---", "You are planner."].join("\n"),
      "utf-8",
    );

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");

    const result = await tool!.execute(
      "call-subagent-invalid-mode",
      {
        agent: "planner",
        chain: [{ agent: "planner", task: "plan" }],
        agentScope: "project",
        confirmProjectAgents: false,
      } as any,
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid parameters");
    expect(result.content[0].text).toContain("single mode");
    expect(result.content[0].text).toContain("Examples:");
  });

  it("passes scoped extension args to avoid duplicate extension loading", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-extension-scope-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".pi", "extensions"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", ".bin", "pi"), "#!/bin/sh\nexit 0\n", "utf-8");
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "planner.md"),
      ["---", "name: planner", "description: Planner", "---", "You are planner."].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(path.join(tmp, ".pi", "extensions", "alpha.ts"), "export default () => undefined;", "utf-8");
    fs.writeFileSync(path.join(tmp, ".pi", "extensions", "beta.ts"), "export default () => undefined;", "utf-8");

    spawnMock.mockImplementation((command: string, args: string[]) => {
      expect(command).toContain("node_modules/.bin/pi");
      expect(args).toContain("--no-extensions");
      expect(args).toContain("-e");
      expect(args.some((arg) => arg.endsWith(path.join(".pi", "extensions", "alpha.ts")))).toBe(true);
      expect(args.some((arg) => arg.endsWith(path.join(".pi", "extensions", "beta.ts")))).toBe(true);

      const eventLine = JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0.001 },
            totalTokens: 2,
          },
          stopReason: "stop",
        },
      });
      return createMockProcess([eventLine], 0);
    });

    const pi = createFakePi();
    subagentExtension(pi as any);
    const tool = pi.tools.get("subagent");

    const result = await tool!.execute(
      "call-subagent-extension-scope",
      {
        agent: "planner",
        task: "plan",
        agentScope: "project",
        confirmProjectAgents: false,
      },
      undefined,
      undefined,
      { cwd: tmp, hasUI: false },
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("ok");
  });

  it("fails closed when strict local runtime is enabled and local pi binary is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-strict-test-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "planner.md"),
      [
        "---",
        "name: planner",
        "description: Planner",
        "tools: read, grep, find, ls",
        "---",
        "You are planner.",
      ].join("\n"),
      "utf-8",
    );
    // Create local agent.config.json with strict local runtime enabled
    // to ensure the test isolates the strict mode behavior
    fs.writeFileSync(
      path.join(tmp, ".pi", "agent.config.json"),
      JSON.stringify({
        security: {
          strictSubagentLocalRuntime: true,
        },
      }),
      "utf-8",
    );

    const originalRuntimeAnchorOverride = process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT;
    process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT = path.join(tmp, "no-runtime-anchor");

    try {
      const pi = createFakePi();
      subagentExtension(pi as any);
      const tool = pi.tools.get("subagent");
      expect(tool).toBeDefined();

      const result = await tool!.execute(
        "call-subagent-strict",
        {
          agent: "planner",
          task: "plan",
          agentScope: "project",
          confirmProjectAgents: false,
        },
        undefined,
        undefined,
        { cwd: tmp, hasUI: false },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("strict local runtime");
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      if (originalRuntimeAnchorOverride === undefined) delete process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT;
      else process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT = originalRuntimeAnchorOverride;
    }
  });

  it("uses runtime-anchor local pi in strict mode when target cwd has no local pi", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-strict-runtime-anchor-test-"));
    fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".pi", "agents", "planner.md"),
      [
        "---",
        "name: planner",
        "description: Planner",
        "tools: read, grep, find, ls",
        "---",
        "You are planner.",
      ].join("\n"),
      "utf-8",
    );

    const originalRuntimeAnchorOverride = process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT;
    process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT = process.cwd();

    try {
      const expectedRuntimeAnchorPi = path.join(process.cwd(), "node_modules", ".bin", "pi");
      spawnMock.mockImplementation((command: string) => {
        expect(command).toBe(expectedRuntimeAnchorPi);
        const eventLine = JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "runtime-anchor-ok" }],
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              cost: { total: 0.001 },
              totalTokens: 2,
            },
            stopReason: "stop",
          },
        });
        return createMockProcess([eventLine], 0);
      });

      const pi = createFakePi();
      subagentExtension(pi as any);
      const tool = pi.tools.get("subagent");
      expect(tool).toBeDefined();

      const result = await tool!.execute(
        "call-subagent-strict-runtime-anchor",
        {
          agent: "planner",
          task: "plan",
          agentScope: "project",
          confirmProjectAgents: false,
        },
        undefined,
        undefined,
        { cwd: tmp, hasUI: false },
      );

      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain("runtime-anchor-ok");
    } finally {
      if (originalRuntimeAnchorOverride === undefined) delete process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT;
      else process.env.PI_SUBAGENT_RUNTIME_ANCHOR_ROOT = originalRuntimeAnchorOverride;
    }
  });
});
