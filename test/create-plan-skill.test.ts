import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "create-plan");
const skillPath = path.join(skillDir, "SKILL.md");
const checklistPath = path.join(skillDir, "references", "plan-quality-checklist.md");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

describe("create-plan skill", () => {
    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has frontmatter the PI loader can parse", () => {
        const { text, name, description } = readSkill();
        const frontmatter = parse(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "");
        expect(frontmatter.name).toBe(name);
        expect(frontmatter.description).toBe(description);
    });

    it("has a name the PI loader accepts", () => {
        const { name } = readSkill();
        expect(name).toBe(path.basename(skillDir));
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^[a-z0-9-]+$/);
        expect(name).not.toMatch(/^-|-$/);
        expect(name).not.toContain("--");
    });

    it("has a third-person description under 1024 chars without XML tags", () => {
        const { description } = readSkill();
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[a-z][^>]*>/i);
        expect(description).not.toMatch(/^Use this skill/);
    });

    it("keeps SKILL.md under 500 lines", () => {
        const { text } = readSkill();
        expect(text.split("\n").length).toBeLessThan(500);
    });

    it("links files that exist", () => {
        const targets = [
            "references/plan-template.md",
            "references/plan-quality-checklist.md",
            "../create-spec/SKILL.md",
            "../eli5/SKILL.md",
            "../plan-view/scripts/plan-view.mjs",
        ];
        for (const target of targets) {
            expect(fs.existsSync(path.join(skillDir, target)), `${target} is missing`).toBe(true);
        }
    });

    // Two different limits made the agent guess which one applied.
    it("states the same plan size limit as the quality checklist", () => {
        const { text } = readSkill();
        const checklist = fs.readFileSync(checklistPath, "utf-8");
        const skillLimit = text.match(/under (\d+) lines/)?.[1];
        const checklistLimit = checklist.match(/under (\d+) lines/)?.[1];
        expect(skillLimit).toBeDefined();
        expect(skillLimit).toBe(checklistLimit);
    });

    // A forced deep graph build is too heavy for a 1-3 file change.
    it("does not force a deep graphify build", () => {
        const { text } = readSkill();
        expect(text).not.toContain("--mode deep");
    });

    it("keeps the graphify gate before Step 2", () => {
        const { text } = readSkill();
        expect(text).toContain("Do not proceed to Step 2");
    });
});
