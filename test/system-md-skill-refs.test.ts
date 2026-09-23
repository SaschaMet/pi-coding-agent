import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const systemMdPath = path.join(process.cwd(), ".pi", "SYSTEM.md");
const subagentMdPath = path.join(process.cwd(), ".pi", "SUBAGENT.md");
const systemMd = fs.readFileSync(systemMdPath, "utf-8");
const subagentMd = fs.existsSync(subagentMdPath) ? fs.readFileSync(subagentMdPath, "utf-8") : "";

// Lowercase only: `$TMPDIR` and other env vars are not skill references.
function skillNamesIn(markdown: string): string[] {
    return [...new Set([...markdown.matchAll(/`\$([a-z][a-z0-9-]*)`/g)].map((match) => match[1]))];
}

const skillNames = skillNamesIn(systemMd);
const subagentSkillNames = skillNamesIn(subagentMd);

function expectProjectSkill(skillName: string): void {
    const skillPath = path.join(process.cwd(), ".pi", "skills", skillName, "SKILL.md");

    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    expect(fs.readFileSync(skillPath, "utf-8")).toMatch(new RegExp(`^---\\n(?:.*\\n)*?name: ${skillName}\\n`));
}

describe("SYSTEM.md skill references", () => {
    it("references at least one skill", () => {
        expect(skillNames.length).toBeGreaterThan(0);
    });

    it.each(skillNames)("$%s resolves to a project skill with a matching name", expectProjectSkill);
});

describe("SUBAGENT.md", () => {
    it("is referenced from SYSTEM.md", () => {
        expect(systemMd).toContain("`.pi/SUBAGENT.md`");
    });

    it("exists and starts with the subagent rules heading", () => {
        expect(fs.existsSync(subagentMdPath), `${subagentMdPath} is missing`).toBe(true);
        expect(subagentMd.startsWith("# Subagent Rules\n")).toBe(true);
    });

    it("references at least one skill", () => {
        expect(subagentSkillNames.length).toBeGreaterThan(0);
    });

    it.each(subagentSkillNames)("$%s resolves to a project skill with a matching name", expectProjectSkill);
});
