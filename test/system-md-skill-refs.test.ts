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

const subagentSkillNames = skillNamesIn(subagentMd);

function expectProjectSkill(skillName: string): void {
    const skillPath = path.join(process.cwd(), ".pi", "skills", skillName, "SKILL.md");

    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    expect(fs.readFileSync(skillPath, "utf-8")).toMatch(new RegExp(`^---\\n(?:.*\\n)*?name: ${skillName}\\n`));
}

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

describe("temp write rules", () => {
    it("SYSTEM.md names the reports folder as the only temp write target", () => {
        expect(systemMd).toContain("`$TMPDIR/pi-reports/`");
        expect(systemMd).not.toContain("exempt only `$TMPDIR`");
    });

    it("SUBAGENT.md names the reports folder for scratch and report files", () => {
        expect(subagentMd).toContain("`$TMPDIR/pi-reports/`");
    });
});

describe("artifact folder rules", () => {
    it("SYSTEM.md sends tied artifacts to the document's folder", () => {
        expect(systemMd).toContain("`docs/specs/<name>/`");
        expect(systemMd).toContain("`docs/plans/<name>/`");
    });

    it("SUBAGENT.md keeps workers out of document folders", () => {
        expect(subagentMd).toContain("Never write into `docs/specs/<name>/` or `docs/plans/<name>/`");
    });
});

describe("plain language rule", () => {
    // SYSTEM.md is the only rule text every session loads; the eli5 skill is hidden from the model.
    it("SYSTEM.md carries the high-school ELI5 rule itself", () => {
        expect(systemMd).toContain("high-school level");
        expect(systemMd).toContain("define each once");
        expect(systemMd).not.toMatch(/eli5\/SKILL|`eli5` skill/);
        // "Jargon only when needed" is what made answers too thin to act on.
        expect(systemMd).not.toContain("Use jargon only when");
    });

    it("SYSTEM.md asks every human-facing plan step for what, why, and how we check", () => {
        expect(systemMd).toContain("Every plan and next-steps list a human reads");
        expect(systemMd).toContain("what happens, why, and how we check it");
    });
});
