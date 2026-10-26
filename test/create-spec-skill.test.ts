import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "create-spec");
const skillPath = path.join(skillDir, "SKILL.md");
const templatePath = path.join(skillDir, "references", "spec-template.md");
const checklistPath = path.join(skillDir, "references", "spec-quality-checklist.md");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

describe("create-spec skill", () => {
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

    // Links like ../research-codebase/... resolve outside the skill's own references folder.
    it("links only files that exist", () => {
        const { text } = readSkill();
        const targets = [...text.matchAll(/\]\(([^)#\s]+)\)/g)]
            .map((m) => m[1])
            .filter((t) => !/^[a-z]+:/i.test(t));
        expect(targets.length).toBeGreaterThan(0);
        for (const target of new Set(targets)) {
            expect(fs.existsSync(path.resolve(skillDir, target)), `${target} is missing`).toBe(true);
        }
    });

    // Humans read the top of the page; the implementer's contract follows below.
    it("puts TLDR and Changes at a Glance before the numbered details", () => {
        const template = fs.readFileSync(templatePath, "utf-8");
        const order = ["## Metadata", "## Grill Status", "## TLDR", "## Changes at a Glance", "## 1. Intent", "## Amendments", "## AI-Notes"];
        const positions = order.map((heading) => template.indexOf(heading));
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(template).not.toContain("## In Plain Words");
    });

    it("keeps diffs and diagrams inside Changes at a Glance", () => {
        const template = fs.readFileSync(templatePath, "utf-8");
        const glance = template.slice(template.indexOf("## Changes at a Glance"), template.indexOf("## 1. Intent"));
        for (const marker of ["```diff", ".assets/"]) {
            expect(glance).toContain(marker);
            expect(template.split(marker).length).toBe(glance.split(marker).length);
        }
        expect(template.slice(template.indexOf("### 6.1"))).toContain("**Changed Flows:**");
    });

    // The user rejected numeric caps on plain-language text.
    it("sets no sentence counts in the TLDR", () => {
        expect(fs.readFileSync(templatePath, "utf-8")).not.toMatch(/\d+(-\d+)? sentences?|20 words/);
    });

    it("checks that the TLDR matches the numbered sections and exempts old documents", () => {
        const checklist = fs.readFileSync(checklistPath, "utf-8");
        expect(checklist).toContain("## TLDR");
        expect(checklist).toContain("## Changes at a Glance");
        expect(checklist).toContain("one to one");
        expect(checklist).toContain("one diff per");
        expect(checklist).toContain("No sentence or word counts in the TLDR");
        expect(checklist).toContain("`## In Plain Words` keeps its layout");
    });
});
