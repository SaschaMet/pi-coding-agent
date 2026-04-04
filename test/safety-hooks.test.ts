import { describe, expect, it } from "vitest";
import permissionGateExtension from "../.pi/extensions/permission-gate.ts";
import protectedPathsExtension from "../.pi/extensions/protected-paths.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

describe("safety extensions", () => {
  it("blocks dangerous bash commands without UI", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];
    expect(handlers.length).toBeGreaterThan(0);

    const result = await handlers[0](
      {
        toolName: "bash",
        input: { command: "rm -rf /tmp/foo" },
      },
      { hasUI: false },
    );

    expect(result?.block).toBe(true);
  });

  it("allows repo-standard npm verification commands", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    for (const command of [
      "npm run smoke",
      "npm run typecheck",
      "npm run test:coverage",
      "npm run docs:sync-pi",
    ]) {
      const result = await handlers[0](
        {
          toolName: "bash",
          input: { command },
        },
        { hasUI: false },
      );

      expect(result).toBeUndefined();
    }
  });

  it("blocks disallowed shell operators", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "bash",
        input: { command: "npm run smoke ; printenv" },
      },
      { hasUI: false },
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("Disallowed shell operator");
  });

  it("allows safe command pipelines", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "bash",
        input: { command: "jq 'keys' example-chat.json | head -100" },
      },
      { hasUI: false },
    );

    expect(result).toBeUndefined();
  });

  it("allows safe boolean command chaining", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const resultAnd = await handlers[0](
      {
        toolName: "bash",
        input: { command: "npm run smoke && npm run typecheck" },
      },
      { hasUI: false },
    );
    expect(resultAnd).toBeUndefined();

    const resultOr = await handlers[0](
      {
        toolName: "bash",
        input: { command: "npm run smoke || npm run typecheck" },
      },
      { hasUI: false },
    );
    expect(resultOr).toBeUndefined();
  });

  it("blocks env exfiltration commands", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "bash",
        input: { command: "printenv" },
      },
      { hasUI: false },
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("Sensitive data");
  });

  it("requires confirmation for dangerous git commands without UI", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "bash",
        input: { command: "git pull --rebase" },
      },
      { hasUI: false },
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("no UI for confirmation");
  });

  it("allows dangerous git commands after explicit UI confirmation", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "bash",
        input: { command: "git push origin main" },
      },
      {
        hasUI: true,
        ui: {
          select: async () => "Yes",
        },
      },
    );

    expect(result).toBeUndefined();
  });

  it("does not block safe bash commands", async () => {
    const pi = createFakePi();
    permissionGateExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];
    const result = await handlers[0](
      {
        toolName: "bash",
        input: { command: "ls -la src" },
      },
      { hasUI: false },
    );
    expect(result).toBeUndefined();
  });

  it("blocks write/edit/read on protected paths", async () => {
    const pi = createFakePi();
    protectedPathsExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const writeResult = await handlers[0](
      {
        toolName: "write",
        input: { path: "/repo/.env" },
      },
      { hasUI: false },
    );
    expect(writeResult?.block).toBe(true);

    const readResult = await handlers[0](
      {
        toolName: "read",
        input: { path: ".git/config" },
      },
      { hasUI: false },
    );
    expect(readResult?.block).toBe(true);
  });

  it("allows root grep scope but still blocks explicit protected paths", async () => {
    const pi = createFakePi();
    protectedPathsExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const grepRootResult = await handlers[0](
      {
        toolName: "grep",
        input: { pattern: "foo", path: "." },
      },
      { hasUI: false },
    );
    expect(grepRootResult).toBeUndefined();

    const protectedScopedResult = await handlers[0](
      {
        toolName: "grep",
        input: { pattern: "foo", path: ".git" },
      },
      { hasUI: false },
    );
    expect(protectedScopedResult?.block).toBe(true);

    const safeScopedResult = await handlers[0](
      {
        toolName: "grep",
        input: { pattern: "foo", path: "src" },
      },
      { hasUI: false },
    );
    expect(safeScopedResult).toBeUndefined();
  });
});
