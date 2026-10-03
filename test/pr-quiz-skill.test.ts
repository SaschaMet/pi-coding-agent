import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "pr-quiz");
const skillPath = path.join(skillDir, "SKILL.md");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

describe("pr-quiz skill", () => {
    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has frontmatter the PI loader can parse", () => {
        const { text, name, description } = readSkill();
        const frontmatter = parse(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "");
        expect(frontmatter.name).toBe(name);
        expect(frontmatter.description).toBe(description);
    });

    // Mirrors the PI loader's name validation, which warns on any violation.
    it("has a name the PI loader accepts", () => {
        const { name } = readSkill();
        expect(name).toBe(path.basename(skillDir));
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^[a-z0-9-]+$/);
        expect(name).not.toMatch(/^-|-$/);
        expect(name).not.toContain("--");
    });

    // PI lists skills to the model inside XML, so tags in a description break that block.
    it("has a third-person description under 1024 chars without XML tags", () => {
        const { description } = readSkill();
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[a-z][^>]*>/i);
        expect(description).not.toMatch(/^(Use this skill|I |You )/);
    });

    it("keeps SKILL.md under 500 lines", () => {
        const { text } = readSkill();
        expect(text.split("\n").length).toBeLessThanOrEqual(500);
    });

    it("keeps the grading table contiguous through the Gap row", () => {
        const { text } = readSkill();
        const lines = text.split("\n");
        const start = lines.findIndex((l) => l.startsWith("| Grade"));
        const end = lines.findIndex((l) => l.startsWith("| Gap"));
        expect(start, "no grade header").toBeGreaterThanOrEqual(0);
        expect(end, "no Gap row").toBeGreaterThan(start);
        for (const line of lines.slice(start, end + 1)) {
            expect(line.startsWith("|"), `non-table line in grading table: ${line}`).toBe(true);
        }
    });

    it("keeps the follow-up rule outside the table and the key rules in place", () => {
        const { text } = readSkill();
        const lines = text.split("\n");
        const follow = lines.find((l) => l.includes("**Follow-up: <Category>**"));
        expect(follow, "no follow-up rule").toBeDefined();
        expect(follow?.startsWith("|")).toBe(false);
        expect(text).toContain("undocumented");
        expect(text).toMatch(/capped at 15\. Do not pad a small change/);
    });
});
