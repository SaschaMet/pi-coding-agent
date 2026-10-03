import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "code-review");
const rulesDir = path.join(skillDir, "references", "file-rules");
const indexPath = path.join(rulesDir, "index.md");

const MAX_DOC_LINES = 40;
const MAX_TOTAL_LINES = 120;
const STYLE_ONLY = /\bvar\b|nested ternar|===/;

function read(file: string): string {
    return fs.readFileSync(path.join(rulesDir, file), "utf-8");
}

function section(file: string, start: string, end?: string): string {
    const text = fs.readFileSync(path.join(skillDir, file), "utf-8");
    const from = text.indexOf(start);
    expect(from, `${file} has no "${start}"`).toBeGreaterThanOrEqual(0);
    const to = end === undefined ? -1 : text.indexOf(end, from + start.length);
    return text.slice(from, to === -1 ? undefined : to);
}

function lineCount(text: string): number {
    return text.replace(/\n$/, "").split("\n").length;
}

function ruleDocsOnDisk(): string[] {
    expect(fs.existsSync(rulesDir), `${rulesDir} is missing`).toBe(true);
    return fs.readdirSync(rulesDir).filter((file) => file.endsWith(".md") && file !== "index.md").sort();
}

function ruleDocsInIndex(): string[] {
    expect(fs.existsSync(indexPath), `${indexPath} is missing`).toBe(true);
    const names = [...read("index.md").matchAll(/[a-z0-9-]+\.md/g)].map((match) => match[0]);
    return [...new Set(names)].filter((name) => name !== "index.md").sort();
}

describe("code-review file rules", () => {
    it("index names at least one rule doc", () => {
        expect(ruleDocsInIndex().length).toBeGreaterThan(0);
    });

    it("every doc named in the index exists", () => {
        for (const name of ruleDocsInIndex()) {
            expect(fs.existsSync(path.join(rulesDir, name)), `${name} is named in index.md but missing`).toBe(true);
        }
    });

    it("every rule doc on disk is named in the index", () => {
        expect(ruleDocsOnDisk()).toEqual(ruleDocsInIndex());
    });

    it(`each rule doc has at most ${MAX_DOC_LINES} lines and all have at most ${MAX_TOTAL_LINES}`, () => {
        const docs = ruleDocsOnDisk();
        expect(docs.length).toBeGreaterThan(0);
        let total = 0;
        for (const name of docs) {
            const lines = lineCount(read(name));
            expect(lines, `${name} has ${lines} lines`).toBeLessThanOrEqual(MAX_DOC_LINES);
            total += lines;
        }
        expect(total).toBeLessThanOrEqual(MAX_TOTAL_LINES);
    });

    it("ships the Apache License", () => {
        const licensePath = path.join(rulesDir, "LICENSE");
        expect(fs.existsSync(licensePath), `${licensePath} is missing`).toBe(true);
        expect(fs.readFileSync(licensePath, "utf-8").trimStart().startsWith("Apache License")).toBe(true);
    });

    it("contains no style-only rules", () => {
        const docs = [...ruleDocsOnDisk(), "index.md"];
        for (const name of docs) {
            expect(read(name), `${name} contains a style-only rule`).not.toMatch(STYLE_ONLY);
        }
    });
});

describe("code-review dispatch anchors", () => {
    it("reviewer spawn prompt passes matched rule docs", () => {
        expect(section("SKILL.md", "**Reviewer:**", "**Security verification**")).toContain("Rule docs:");
    });

    it("reviewer output carries a per-file coverage ledger", () => {
        expect(section(path.join("references", "reviewer.md"), "## Required output")).toContain("coverage:");
    });

    it("final report carries a Coverage line", () => {
        expect(section("SKILL.md", "## Required Output")).toContain("Coverage:");
    });
});

const skillPath = path.join(skillDir, "SKILL.md");
const refsDir = path.join(skillDir, "references");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

describe("code-review skill metadata", () => {
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
        expect(description).not.toMatch(/<[^>]+>/);
        expect(description).not.toMatch(/^Use this skill/i);
    });

    it("opens every long top-level reference with a Contents list", () => {
        const long = fs
            .readdirSync(refsDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
            .map((entry) => ({
                file: entry.name,
                text: fs.readFileSync(path.join(refsDir, entry.name), "utf-8"),
            }))
            .filter(({ text }) => lineCount(text) > 100);
        expect(long.map(({ file }) => file)).toEqual(expect.arrayContaining(["reviewer.md", "review-context.md"]));
        for (const { file, text } of long) {
            const head = text.split("\n").slice(0, 15).join("\n");
            expect(head, `${file} has no "## Contents" in its first 15 lines`).toContain("## Contents");
        }
    });

    it("describes the one-reviewer design in the launcher prompt", () => {
        const yamlPath = path.join(skillDir, "agents", "openai.yaml");
        expect(fs.existsSync(yamlPath), `${yamlPath} is missing`).toBe(true);
        const prompt: string = parse(fs.readFileSync(yamlPath, "utf-8")).interface.default_prompt;
        expect(prompt).not.toMatch(/dedupe/i);
        expect(prompt).not.toMatch(/passes/i);
    });
});
