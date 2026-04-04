import { describe, expect, it } from "vitest";
import capabilityEnforcerExtension from "../.pi/extensions/capability-enforcer.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

describe("capability enforcer extension", () => {
  it("registers capability enforcer only once per runtime", async () => {
    const pi = createFakePi();
    capabilityEnforcerExtension(pi as any);
    capabilityEnforcerExtension(pi as any);

    const sessionHandlers = pi.handlers.get("session_start") ?? [];
    const toolHandlers = pi.handlers.get("tool_call") ?? [];
    expect(sessionHandlers).toHaveLength(1);
    expect(toolHandlers).toHaveLength(1);
  });

  it("blocks tool calls that do not have capability entries", async () => {
    const pi = createFakePi();
    capabilityEnforcerExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "unknown_tool",
        input: {},
      },
      { hasUI: false },
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("no capability entry");
  });

  it("allows tool calls with capability entries", async () => {
    const pi = createFakePi();
    capabilityEnforcerExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "read",
        input: { path: "src/main.ts" },
      },
      { hasUI: false },
    );

    expect(result).toBeUndefined();
  });

  it("requires confirmation for confirmation-gated tools without UI", async () => {
    const pi = createFakePi();
    capabilityEnforcerExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "web_search",
        input: { query: "vitest docs" },
      },
      { hasUI: false },
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("requires confirmation");
  });

  it("allows confirmation-gated tools after explicit UI confirmation", async () => {
    const pi = createFakePi();
    capabilityEnforcerExtension(pi as any);
    const handlers = pi.handlers.get("tool_call") ?? [];

    const result = await handlers[0](
      {
        toolName: "fetch_web_page",
        input: { url: "https://example.com" },
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
});
