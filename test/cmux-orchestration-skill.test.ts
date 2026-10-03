import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "cmux-orchestration");
const skillPath = path.join(skillDir, "SKILL.md");
const refDir = path.join(skillDir, "references");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

function readReferences(): { file: string; text: string }[] {
    if (!fs.existsSync(refDir)) return [];
    return fs
        .readdirSync(refDir)
        .filter((f) => f.endsWith(".md"))
        .map((file) => ({ file, text: fs.readFileSync(path.join(refDir, file), "utf-8") }));
}

describe("cmux-orchestration skill", () => {
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

    // SYSTEM.md sends temp files to $TMPDIR; on macOS /tmp is a different directory.
    it("uses no /tmp path in the skill or its references", () => {
        const { text } = readSkill();
        expect(text).not.toContain("/tmp/");
        for (const ref of readReferences()) {
            expect(ref.text, `${ref.file} uses /tmp/`).not.toContain("/tmp/");
        }
    });

    it("documents ctrl+c instead of claiming it is impossible", () => {
        const { text } = readSkill();
        expect(text).not.toMatch(/Ctrl-C.{0,5}impossible/i);
        expect(text).toContain("ctrl+c");
    });

    // Must match the report path in the subagent rules, which workers load.
    it("names one report path", () => {
        const { text } = readSkill();
        expect(text).toContain("pi-reports/<task>.md");
        expect(text).toContain("<task>.task.md");
        expect(text).not.toContain(".report.md");
    });

    it("stops workers near the top of the file", () => {
        const { text } = readSkill();
        expect(text.split("\n").slice(0, 12).join("\n")).toContain("You are a cmux worker");
    });

    it("keeps SKILL.md under 500 lines and the Claude worker permission rule", () => {
        const { text } = readSkill();
        expect(text.split("\n").length).toBeLessThanOrEqual(500);
        expect(text).toContain("--permission-mode auto");
    });

    it("links only references that exist", () => {
        const { text } = readSkill();
        for (const ref of new Set(text.match(/references\/[\w-]+\.md/g) ?? [])) {
            expect(fs.existsSync(path.join(skillDir, ref)), `${ref} is missing`).toBe(true);
        }
    });

    it("starts every reference over 100 lines with a table of contents", () => {
        for (const ref of readReferences()) {
            const lines = ref.text.split("\n");
            if (lines.length <= 100) continue;
            expect(lines.slice(0, 15), `${ref.file} has no ## Contents`).toContain("## Contents");
        }
    });
});
