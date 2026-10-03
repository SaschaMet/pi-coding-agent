import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "research-codebase");
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

function section(text: string, from: string, to?: string): string {
    const start = text.indexOf(from);
    expect(start, `${from} not found`).toBeGreaterThanOrEqual(0);
    const end = to ? text.indexOf(to, start) : -1;
    return end === -1 ? text.slice(start) : text.slice(start, end);
}

describe("research-codebase skill", () => {
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

    it("links only references that exist", () => {
        const { text } = readSkill();
        const refs = [...new Set(text.match(/references\/[\w-]+\.md/g) ?? [])];
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
            expect(fs.existsSync(path.join(skillDir, ref)), `${ref} is missing`).toBe(true);
        }
    });

    it("starts every reference over 100 lines with a table of contents", () => {
        const refDir = path.join(skillDir, "references");
        for (const file of fs.readdirSync(refDir).filter((f) => f.endsWith(".md"))) {
            const lines = fs.readFileSync(path.join(refDir, file), "utf-8").split("\n");
            if (lines.length <= 100) continue;
            expect(lines.slice(0, 15), `${file} has no ## Contents`).toContain("## Contents");
        }
    });

    // A subagent that delegates again is a wrong action: the parent already scoped the search.
    it("tells a subagent to search directly in Step 2", () => {
        const { text } = readSkill();
        expect(section(text, "## Step 2", "## Step 3")).toContain("do not spawn another");
    });

    it("gives each of Steps 1-3 a completion criterion", () => {
        const { text } = readSkill();
        expect(section(text, "## Step 1", "## Step 2")).toContain("Done when");
        expect(section(text, "## Step 2", "## Step 3")).toContain("Done when");
        expect(section(text, "## Step 3", "## Step 4")).toContain("Done when");
    });
});
