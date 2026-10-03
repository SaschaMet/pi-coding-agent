import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillPath = path.join(process.cwd(), ".pi", "skills", "to-slm", "SKILL.md");

const BRIEF_SECTIONS = [
    "Goal",
    "Hard rules",
    "Steps",
    "Defaults",
    "Output format",
    "Out of scope",
    "Open questions",
    "Too hard for me",
];

function readSkill(): { description: string; body: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    expect(match, "SKILL.md has no frontmatter").not.toBeNull();
    const [, frontmatter, body] = match as RegExpMatchArray;
    expect(frontmatter).toMatch(/^name: to-slm$/m);
    const description = frontmatter.match(/^description: (.*)$/m)?.[1] ?? "";
    return { description, body };
}

describe("to-slm skill", () => {
    it("has a name matching its folder and a description under 1024 chars", () => {
        const { description } = readSkill();
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThan(1024);
    });

    // The keyword is the only trigger: PI never tells a model its own name.
    it("triggers on the toSlm keyword, not on self-identification", () => {
        const { description } = readSkill();
        expect(description).toContain("toSlm");
        expect(description).not.toMatch(/you are a (small|frontier) model/i);
    });

    it.each(BRIEF_SECTIONS)("brief template has a %s section", (section) => {
        const { body } = readSkill();
        expect(body).toMatch(new RegExp(`^#+ ${section}$`, "m"));
    });

    it("names the approval words that start work", () => {
        const { body } = readSkill();
        for (const word of ["yes", "approved", "go"]) {
            expect(body).toContain(`\`${word}\``);
        }
    });
});

describe("to-slm skill loader rules", () => {
    function frontmatterText(): string {
        const text = fs.readFileSync(skillPath, "utf-8");
        return text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    }

    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has frontmatter the PI loader can parse", () => {
        const parsed = parse(frontmatterText());
        expect(parsed.name).toBe("to-slm");
        expect(typeof parsed.description).toBe("string");
        expect(parsed.description).toContain("toSlm");
    });

    // Mirrors the PI loader's name validation, which warns on any violation.
    it("has a name the PI loader accepts", () => {
        const name = parse(frontmatterText()).name as string;
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^[a-z0-9-]+$/);
        expect(name).not.toMatch(/^-|-$/);
        expect(name).not.toContain("--");
    });

    it("keeps SKILL.md under 500 lines", () => {
        expect(fs.readFileSync(skillPath, "utf-8").split("\n").length).toBeLessThanOrEqual(500);
    });

    it("has a third-person description", () => {
        const { description } = readSkill();
        expect(description).not.toMatch(/^'?Use this skill/);
    });

    // PI lists skills to the model inside XML, so tags in a description break that block.
    it("has a description without XML tags that keeps both triggers", () => {
        const { description } = readSkill();
        expect(description).not.toMatch(/<[a-z][^>]*>/i);
        expect(description).toContain("toSlm");
        expect(description).toContain("/to-slm");
    });
});
