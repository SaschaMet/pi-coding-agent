import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
