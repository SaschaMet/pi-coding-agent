import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "vision-offload");
const skillPath = path.join(skillDir, "SKILL.md");
const promptPath = path.join(skillDir, "references", "subagent-prompt.md");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

describe("vision-offload skill", () => {
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
        expect(name).not.toMatch(/--/);
    });

    it("has a short description that states intent, not setup", () => {
        const { description } = readSkill();
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[^>]+>/);
        expect(description).not.toMatch(/^Use this skill/i);
    });

    it("keeps the port out of the description", () => {
        const { description } = readSkill();
        expect(description).not.toContain("1331");
    });

    it("states the URL once and never says 'local Ornith'", () => {
        const { text } = readSkill();
        expect(text.split("http://localhost:1331").length - 1).toBe(1);
        expect(text).not.toContain("local Ornith");
    });

    it("links only reference files that exist", () => {
        const { text } = readSkill();
        const links = [...text.matchAll(/\]\((references\/[^)]+\.md)\)/g)].map((m) => m[1]);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
            expect(fs.existsSync(path.join(skillDir, link)), `${link} is missing`).toBe(true);
        }
    });

    it("treats an empty vision answer as a failure in the subagent prompt", () => {
        const prompt = fs.readFileSync(promptPath, "utf-8");
        const returnSection = prompt.split("## 3. Return")[1] ?? "";
        expect(returnSection).toMatch(/empty/i);
        expect(returnSection).toContain("Vision offload failed");
    });
});
