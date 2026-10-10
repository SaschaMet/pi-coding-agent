import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import subagentRulesInjection from "../.pi/extensions/subagent-rules-injection.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

const FIXTURE_RULES = [
    "# Communication",
    "",
    "- Act as a precise Senior Software Engineer & Architect.",
    "- Use the fixture rule line.",
].join("\n");

const FIXTURE_AGENTS = ["# AGENTS.md — fixture", "", "- Use the fixture agents line."].join("\n");

// Replace-mode subagent system prompt shape (pi-subagents buildAgentPrompt):
// active_agent tag, no parent prompt, no rules file content.
const SUBAGENT_PROMPT = '<active_agent name="Explore"/>\n\nYou are a pi coding agent sub-agent.';

// `agentsContent: null` creates a directory named AGENTS.md (unreadable as a file).
function makeFixtureCwd(rulesContent?: string, agentsContent?: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), "subagent-rules-"));
    if (rulesContent !== undefined) {
        mkdirSync(join(dir, ".pi"), { recursive: true });
        writeFileSync(join(dir, ".pi", "SYSTEM.md"), rulesContent);
    }
    if (agentsContent === null) mkdirSync(join(dir, "AGENTS.md"));
    else if (agentsContent !== undefined) writeFileSync(join(dir, "AGENTS.md"), agentsContent);
    return dir;
}

async function runHandler(cwd: string, systemPrompt: string, ctxCwd?: string) {
    const pi = createFakePi();
    subagentRulesInjection(asExtensionAPI(pi));
    const handlers = pi.handlers.get("before_agent_start") ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    try {
        const ctx = ctxCwd === undefined ? { hasUI: false } : { hasUI: false, cwd: ctxCwd };
        return await handlers[0]({ type: "before_agent_start", systemPrompt }, ctx);
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
        expect(result?.message?.content).toContain(FIXTURE_RULES);
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

    it("still injects when the prompt holds only the rules heading, not the rules", async () => {
        const cwd = makeFixtureCwd(FIXTURE_RULES);
        cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));

        const headingOnlyPrompt = `# Communication\n\n${SUBAGENT_PROMPT}`;

        const result = await runHandler(cwd, headingOnlyPrompt);
        expect(result?.message?.customType).toBe("subagent-rules-injection");
    });

    it("fails safe when .pi/SYSTEM.md is missing", async () => {
        const cwd = makeFixtureCwd();
        cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));

        const result = await runHandler(cwd, SUBAGENT_PROMPT);
        expect(result?.action).toBe("continue");
        expect(result?.message).toBeUndefined();
    });

    describe("root AGENTS.md", () => {
        function fixture(rules?: string, agents?: string | null): string {
            const cwd = makeFixtureCwd(rules, agents);
            cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
            return cwd;
        }

        it("injects SYSTEM.md and AGENTS.md into a replace-mode subagent, SYSTEM.md first", async () => {
            const result = await runHandler(fixture(FIXTURE_RULES, FIXTURE_AGENTS), SUBAGENT_PROMPT);
            const content = String(result?.message?.content);
            expect(content).toContain(FIXTURE_RULES);
            expect(content).toContain(FIXTURE_AGENTS);
            expect(content.indexOf(FIXTURE_RULES)).toBeLessThan(content.indexOf(FIXTURE_AGENTS));
        });

        it("injects nothing when the prompt already holds both files", async () => {
            const prompt = `${FIXTURE_RULES}\n\n${FIXTURE_AGENTS}\n\n${SUBAGENT_PROMPT}`;
            const result = await runHandler(fixture(FIXTURE_RULES, FIXTURE_AGENTS), prompt);
            expect(result?.action).toBe("continue");
            expect(result?.message).toBeUndefined();
        });

        it("injects only AGENTS.md when the prompt already holds SYSTEM.md", async () => {
            const prompt = `${FIXTURE_RULES}\n\n${SUBAGENT_PROMPT}`;
            const content = String((await runHandler(fixture(FIXTURE_RULES, FIXTURE_AGENTS), prompt))?.message?.content);
            expect(content).toContain(FIXTURE_AGENTS);
            expect(content).not.toContain(FIXTURE_RULES);
        });

        it("injects only SYSTEM.md when AGENTS.md is missing or is a directory", async () => {
            for (const agents of [undefined, null]) {
                const content = String((await runHandler(fixture(FIXTURE_RULES, agents), SUBAGENT_PROMPT))?.message?.content);
                expect(content).toContain(FIXTURE_RULES);
                expect(content).not.toContain("AGENTS.md");
            }
        });

        it("injects only AGENTS.md when SYSTEM.md is missing", async () => {
            const content = String((await runHandler(fixture(undefined, FIXTURE_AGENTS), SUBAGENT_PROMPT))?.message?.content);
            expect(content).toContain(FIXTURE_AGENTS);
            expect(content).not.toContain("SYSTEM.md");
        });

        it("does nothing when both files are empty", async () => {
            const result = await runHandler(fixture("  \n", "\n"), SUBAGENT_PROMPT);
            expect(result?.action).toBe("continue");
            expect(result?.message).toBeUndefined();
        });

        it("reads from the subagent's session folder before the process folder", async () => {
            const parent = fixture("# parent rules", "# parent agents");
            const child = fixture(FIXTURE_RULES, FIXTURE_AGENTS);
            const content = String((await runHandler(parent, SUBAGENT_PROMPT, child))?.message?.content);
            expect(content).toContain(FIXTURE_AGENTS);
            expect(content).not.toContain("parent");
        });

        it("falls back to the process folder when the context has no cwd", async () => {
            const content = String((await runHandler(fixture(FIXTURE_RULES, FIXTURE_AGENTS), SUBAGENT_PROMPT))?.message?.content);
            expect(content).toContain(FIXTURE_AGENTS);
        });
    });

});
