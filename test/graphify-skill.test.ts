import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "graphify");
const skillPath = path.join(skillDir, "SKILL.md");
const refDir = path.join(skillDir, "references");

// Vendored upstream skill: it stays above the usual 500 lines on purpose.
const MAX_SKILL_LINES = 580;

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const parsed = parse(frontmatter ?? "") as { name?: string; description?: string };
    return { text, name: parsed.name ?? "", description: parsed.description ?? "" };
}

describe("graphify skill", () => {
    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has frontmatter the PI loader can parse", () => {
        const { text, name, description } = readSkill();
        const frontmatter = parse(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "");
        expect(frontmatter.name).toBe(name);
        expect(frontmatter.description).toBe(description);
        expect(name.length).toBeGreaterThan(0);
        expect(description.length).toBeGreaterThan(0);
    });

    it("has a name the PI loader accepts", () => {
        const { name } = readSkill();
        expect(name).toBe(path.basename(skillDir));
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^[a-z0-9-]+$/);
        expect(name).not.toMatch(/^-|-$/);
        expect(name).not.toContain("--");
    });

    it("has a description under 1024 chars without XML tags", () => {
        const { description } = readSkill();
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[a-z][^>]*>/i);
        expect(description).not.toMatch(/^(Use this skill|I |You )/);
    });

    it(`keeps SKILL.md at or under ${MAX_SKILL_LINES} lines`, () => {
        const { text } = readSkill();
        expect(text.split("\n").length).toBeLessThanOrEqual(MAX_SKILL_LINES);
    });

    it("links only references that exist", () => {
        const { text } = readSkill();
        const refs = [...new Set(text.match(/references\/[\w-]+\.md/g) ?? [])];
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
            expect(fs.existsSync(path.join(skillDir, ref)), `${ref} is missing`).toBe(true);
        }
    });

    it("leaves no reference orphaned", () => {
        const { text } = readSkill();
        for (const file of fs.readdirSync(refDir).filter((f) => f.endsWith(".md"))) {
            expect(text, `references/${file} is not linked from SKILL.md`).toContain(`references/${file}`);
        }
    });

    it("starts every reference over 100 lines with a table of contents", () => {
        for (const file of fs.readdirSync(refDir).filter((f) => f.endsWith(".md"))) {
            const lines = fs.readFileSync(path.join(refDir, file), "utf-8").split("\n");
            if (lines.length <= 100) continue;
            expect(lines.slice(0, 15), `${file} has no ## Contents`).toContain("## Contents");
        }
    });
});
