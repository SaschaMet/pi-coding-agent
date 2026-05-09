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
        expect(result?.message?.content).toContain("must call `Agent`");
        expect(result?.message?.content).toContain("Retrieve background results with `get_subagent_result`");
        expect(result?.message?.content).toContain("Subagents must inherit the parent model");
        expect(result?.message?.content).toContain("High-context repository reconnaissance stays in-session");
        expect(result?.message?.content).not.toContain("High-context reconnaissance tasks: prefer");
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
        expect(result?.text).toContain("Agent");
        expect(result?.text).toContain('subagent_type: "generic-readonly"');
        expect(result?.text).toContain("first delegated step");
        expect(result?.text).toContain("second delegated step");
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
});
