import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
