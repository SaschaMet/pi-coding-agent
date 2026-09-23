import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import subagentRulesInjection, { RULES_MARKER } from "../.pi/extensions/subagent-rules-injection.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

const FIXTURE_RULES = [
    "# Role and Communication",
    "",
    "- Act as a precise Senior Software Engineer & Architect.",
    "- Use the fixture rule line.",
].join("\n");

// Replace-mode subagent system prompt shape (pi-subagents buildAgentPrompt):
// active_agent tag, no parent prompt, no rules file content.
const SUBAGENT_PROMPT = '<active_agent name="Explore"/>\n\nYou are a pi coding agent sub-agent.';

function makeFixtureCwd(rulesContent?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "subagent-rules-"));
    if (rulesContent !== undefined) {
        mkdirSync(join(dir, ".pi"), { recursive: true });
        writeFileSync(join(dir, ".pi", "SYSTEM.md"), rulesContent);
    }
    return dir;
}

async function runHandler(cwd: string, systemPrompt: string) {
    const pi = createFakePi();
    subagentRulesInjection(asExtensionAPI(pi));
    const handlers = pi.handlers.get("before_agent_start") ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    try {
        return await handlers[0]({ type: "before_agent_start", systemPrompt }, { hasUI: false });
    } finally {
        cwdSpy.mockRestore();
    }
}

describe("subagent rules injection extension", () => {
    let cleanup: Array<() => void> = [];

    afterEach(() => {
        cleanup.forEach((fn) => fn());
        cleanup = [];
    });

    it("injects .pi/SYSTEM.md into a replace-mode subagent session", async () => {
        const cwd = makeFixtureCwd(FIXTURE_RULES);
        cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));

        const result = await runHandler(cwd, SUBAGENT_PROMPT);
        expect(result?.message?.customType).toBe("subagent-rules-injection");
        expect(result?.message?.content).toContain(RULES_MARKER);
        expect(result?.message?.content).toContain("fixture rule line");
        expect(result?.message?.content).toContain("follow them");
    });

    it("does nothing in a parent session (no subagent tag)", async () => {
        const cwd = makeFixtureCwd(FIXTURE_RULES);
        cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));

        const result = await runHandler(cwd, "You are a pi coding agent.");
        expect(result?.action).toBe("continue");
        expect(result?.message).toBeUndefined();
    });

    it("skips append-mode subagents that already carry the rules via the parent prompt", async () => {
        const cwd = makeFixtureCwd(FIXTURE_RULES);
        cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));

        const appendPrompt = `You are a pi coding agent.\n\n${FIXTURE_RULES}\n\n<active_agent name="generic-worker"/>\n\nsub-agent bridge`;
        const result = await runHandler(cwd, appendPrompt);
        expect(result?.action).toBe("continue");
        expect(result?.message).toBeUndefined();
    });

    it("fails safe when .pi/SYSTEM.md is missing", async () => {
        const cwd = makeFixtureCwd();
        cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));

        const result = await runHandler(cwd, SUBAGENT_PROMPT);
        expect(result?.action).toBe("continue");
        expect(result?.message).toBeUndefined();
    });

    it("keeps the dedupe marker in sync with the real .pi/SYSTEM.md", () => {
        const real = readFileSync(join(process.cwd(), ".pi", "SYSTEM.md"), "utf8");
        expect(real).toContain(RULES_MARKER);
    });
});
