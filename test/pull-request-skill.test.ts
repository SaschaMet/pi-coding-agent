import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "pull-request");
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

function section(text: string, n: number): string {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => l.startsWith(`### ${n}.`));
    expect(start, `### ${n}. heading is missing`).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((l, i) => i > start && l.startsWith("### "));
    return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("pull-request skill", () => {
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

    // It pushes and edits remote state, so only the user may invoke it.
    it("stays user-invoked", () => {
        const { text } = readSkill();
        const frontmatter = parse(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "");
        expect(frontmatter["disable-model-invocation"]).toBe(true);
    });

    it("squashes onto the branch point, not the first commit of the log", () => {
        const { text } = readSkill();
        expect(text).toContain("git merge-base");
        expect(text).not.toContain("tail -1");
    });

    // After a merge-base reset HEAD is the base commit, so --amend would rewrite it.
    it("commits after a squash instead of amending", () => {
        const step4 = section(readSkill().text, 4);
        expect(step4).toContain("git commit");
        expect(step4).not.toContain("--amend");
    });

    it("creates the PR once, in Step 5 after the push", () => {
        const { text } = readSkill();
        expect(text.match(/gh pr create/g)?.length).toBe(1);
        const at = text.indexOf("gh pr create");
        const step5 = text.indexOf("### 5.");
        const step6 = text.indexOf("### 6.");
        expect(at).toBeGreaterThan(step5);
        expect(at).toBeLessThan(step6);
    });
});
