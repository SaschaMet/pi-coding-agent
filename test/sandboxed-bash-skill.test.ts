import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "sandboxed-bash");
const skillPath = path.join(skillDir, "SKILL.md");

function readSkill(): { text: string; frontmatter: { name?: string; description?: string } } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const raw = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(raw, "SKILL.md has no frontmatter").toBeDefined();
    return { text, frontmatter: parse(raw ?? "") };
}

describe("sandboxed-bash skill", () => {
    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has a name the PI loader accepts", () => {
        const { name } = readSkill().frontmatter;
        expect(name).toBe(path.basename(skillDir));
        expect(name).toMatch(/^[a-z0-9-]+$/);
    });

    it("has a description under 1024 chars without XML tags", () => {
        const { description = "" } = readSkill().frontmatter;
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[a-z][^>]*>/i);
        expect(description).not.toMatch(/^Use this skill/);
    });

    it("uses no /tmp path", () => {
        expect(readSkill().text).not.toContain("/tmp/");
    });

    it("gives workers both stop sentinels and keeps domains inside the sandbox", () => {
        const { text } = readSkill();
        expect(text).toContain("NEEDS_UNSANDBOXED: <command> — <reason>");
        expect(text).toContain("NEEDS_DOMAIN: <host> — <reason>");
        expect(text).toMatch(/domain never qualifies/i);
        expect(text).toContain("~/.pi/agent/sandbox.json");
    });

    // On macOS srt answers a blocked host with a proxy 403, not a resolve error.
    it("names both blocked-host symptoms", () => {
        const { text } = readSkill();
        const subagent = fs.readFileSync(path.join(process.cwd(), ".pi", "SUBAGENT.md"), "utf-8");
        for (const body of [text, subagent]) {
            expect(body).toContain("CONNECT tunnel failed, response 403");
            expect(body).toContain("ENOTFOUND");
        }
    });

    // Workers load SUBAGENT.md, not this skill, so the stop lines must match there.
    it("matches the stop sentinels in the subagent rules", () => {
        const subagent = fs.readFileSync(path.join(process.cwd(), ".pi", "SUBAGENT.md"), "utf-8");
        const whenToStop = subagent.slice(subagent.indexOf("# When to Stop"));
        expect(whenToStop).toContain("NEEDS_UNSANDBOXED: <command> — <reason>");
        expect(whenToStop).toContain("NEEDS_DOMAIN: <host> — <reason>");
    });

    // Models change; the skill follows the cmux skill's worker model rule instead.
    it("names no fixed model", () => {
        expect(readSkill().text).not.toMatch(/[A-Za-z0-9-]+\/[A-Za-z0-9.-]+:(low|medium|high)/);
    });
});
