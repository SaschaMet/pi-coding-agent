import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import delegationPolicyExtension from "../.pi/extensions/subagent-delegation-policy.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

const CMUX_VARS = ["CMUX_SURFACE_ID", "CMUX_SOCKET_PATH"] as const;
const saved: Record<string, string | undefined> = {};
let socketDir: string;
let socketFile: string;

const enterCmux = (): void => {
    process.env.CMUX_SURFACE_ID = "surface-test";
    process.env.CMUX_SOCKET_PATH = socketFile;
};

describe("subagent delegation policy extension", () => {
    beforeEach(() => {
        for (const key of CMUX_VARS) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
        socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-policy-"));
        socketFile = path.join(socketDir, "cmux.sock");
        fs.writeFileSync(socketFile, "");
    });

    afterEach(() => {
        for (const key of CMUX_VARS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        fs.rmSync(socketDir, { recursive: true, force: true });
    });

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
        expect(result?.message?.content).toContain(
            "Research and look-up subagents are the exception",
        );
        expect(result?.message?.content).toContain(".pi/SYSTEM.md");
        expect(result?.message?.content).toContain("fall back to the current model");
        expect(result?.message?.content).toContain("Repository reconnaissance that feeds a research artifact");
        expect(result?.message?.content).toContain("Do not delegate implementation or edits by default");
        expect(result?.message?.content).toContain("A skill may direct delegation for drafting a document");
        expect(result?.message?.content).not.toContain("High-context repository reconnaissance stays in-session");
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

    const policyText = async (ctx: Record<string, unknown>): Promise<string> => {
        const pi = createFakePi();
        delegationPolicyExtension(pi as any);
        const handlers = pi.handlers.get("before_agent_start") ?? [];
        const result = await handlers[0]({}, ctx);
        return result?.message?.content as string;
    };

    it("adds the cmux pane rule in an interactive cmux session", async () => {
        enterCmux();
        const text = await policyText({ hasUI: true, mode: "tui" });
        expect(text).toContain("cmux pane worker");
        expect(text).toContain("$cmux-orchestration");
        expect(text).toContain("must call `Agent`");
    });

    it("omits the cmux rule outside cmux, without a live socket, or in print mode", async () => {
        expect(await policyText({ mode: "tui" })).not.toContain("cmux pane worker");

        enterCmux();
        expect(await policyText({ mode: "print" })).not.toContain("cmux pane worker");

        fs.rmSync(socketFile);
        expect(await policyText({ mode: "tui" })).not.toContain("cmux pane worker");
    });

    it("keeps spawn phrasing as plain text in an interactive cmux session", async () => {
        enterCmux();
        const pi = createFakePi();
        delegationPolicyExtension(pi as any);
        const handlers = pi.handlers.get("input") ?? [];
        const result = await handlers[0](
            { text: "spawn a sub-agent for fetching this and another one for summarizing it", source: "interactive" },
            { hasUI: true, mode: "tui" },
        );
        expect(result?.action).toBe("continue");
    });
});
