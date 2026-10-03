import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "eli5");
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

describe("eli5 skill", () => {
    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has frontmatter the PI loader can parse", () => {
        const { text, name, description } = readSkill();
        const frontmatter = parse(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "");
        expect(frontmatter.name).toBe(name);
        expect(frontmatter.description).toBe(description);
        expect(frontmatter["disable-model-invocation"]).toBe(true);
    });

    it("drops the no-op opening line", () => {
        expect(readSkill().text).not.toContain("The user lost the thread");
    });

    it("says how the agent knows a re-pitch did not land", () => {
        expect(readSkill().text).toContain("A second ELI5 request");
    });

    // Other skills link to these headings by name.
    it("keeps the headings other skills link to", () => {
        const { text } = readSkill();
        expect(text).toContain("## Style rules");
        expect(text).toContain("## Hard bans");
        expect(text).toContain("## Used by other skills");
    });
});
