import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const systemMd = fs.readFileSync(path.join(process.cwd(), ".pi", "SYSTEM.md"), "utf-8");
// Lowercase only: `$TMPDIR` and other env vars are not skill references.
const skillNames = [...new Set([...systemMd.matchAll(/`\$([a-z][a-z0-9-]*)`/g)].map((match) => match[1]))];

describe("SYSTEM.md skill references", () => {
    it("references at least one skill", () => {
        expect(skillNames.length).toBeGreaterThan(0);
    });

    it.each(skillNames)("$%s resolves to a project skill with a matching name", (skillName) => {
        const skillPath = path.join(process.cwd(), ".pi", "skills", skillName, "SKILL.md");

        expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
        expect(fs.readFileSync(skillPath, "utf-8")).toMatch(new RegExp(`^---\\n(?:.*\\n)*?name: ${skillName}\\n`));
    });
});
