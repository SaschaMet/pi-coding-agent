import { describe, expect, it } from "vitest";
import delegationPolicyExtension from "../.pi/extensions/subagent-delegation-policy.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

describe("subagent delegation policy extension", () => {
  it("injects delegation policy in before_agent_start", async () => {
    const pi = createFakePi();
    delegationPolicyExtension(pi as any);

    const handlers = pi.handlers.get("before_agent_start") ?? [];
    expect(handlers.length).toBeGreaterThan(0);

    const result = await handlers[0]({}, { hasUI: false });
    expect(result?.message?.customType).toBe("subagent-delegation-policy");
    expect(result?.message?.content).toContain("Explicit user delegation request");
    expect(result?.message?.content).toContain("Skill execution requests stay in the current session");
    expect(result?.message?.content).toContain("delegated `fetch_web_page`");
  });

  it("normalizes explicit spawn phrasing", async () => {
    const pi = createFakePi();
    delegationPolicyExtension(pi as any);

    const handlers = pi.handlers.get("input") ?? [];
    const result = await handlers[0](
      {
        text: "spawn a sub-agent for fetching this website and another one for summarizing it",
        source: "interactive",
      },
      { hasUI: false },
    );

    expect(result?.action).toBe("transform");
    expect(result?.text).toContain("subagent");
    expect(result?.text).toContain("chain");
    expect(result?.text).toContain("agent: generic-readonly");
    expect(result?.text).toContain("{previous}");
  });

  it("routes direct webpage fetch requests through a readonly subagent", async () => {
    const pi = createFakePi();
    delegationPolicyExtension(pi as any);

    const handlers = pi.handlers.get("input") ?? [];
    const result = await handlers[0](
      {
        text: "fetch https://example.com/article",
        source: "interactive",
      },
      { hasUI: false },
    );

    expect(result?.action).toBe("transform");
    expect(result?.text).toContain("single");
    expect(result?.text).toContain("agent: generic-readonly");
    expect(result?.text).toContain("fetch_web_page");
  });

  it("keeps /skill input in-session by default", async () => {
    const pi = createFakePi();
    delegationPolicyExtension(pi as any);

    const handlers = pi.handlers.get("input") ?? [];
    const result = await handlers[0](
      {
        text: "/skill:tdd-coder implement auth bugfix",
        source: "interactive",
      },
      { hasUI: false },
    );

    expect(result?.action).toBe("continue");
  });

  it("keeps localhost browser skill requests in-session", async () => {
    const pi = createFakePi();
    delegationPolicyExtension(pi as any);

    const handlers = pi.handlers.get("input") ?? [];
    const result = await handlers[0](
      {
        text: "/skill:browser-desktop open http://localhost:3000",
        source: "interactive",
      },
      { hasUI: false },
    );

    expect(result?.action).toBe("continue");
  });

  it("normalizes fetch-and-summarize webpage requests to generic chain flow", async () => {
    const pi = createFakePi();
    delegationPolicyExtension(pi as any);

    const handlers = pi.handlers.get("input") ?? [];
    const result = await handlers[0](
      {
        text: "use sub agents to fetch and summarize this webpage: https://www.aihero.dev/skills-changelog-ubiquitous-language-grill-with-docs",
        source: "interactive",
      },
      { hasUI: false },
    );

    expect(result?.action).toBe("transform");
    expect(result?.text).toContain("chain");
    expect(result?.text).toContain("agent: generic-readonly");
    expect(result?.text).toContain("{previous}");
  });
});
