import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const libraryDir = path.join(process.cwd(), ".pi", "skill-library");
const skillDir = path.join(libraryDir, "sales-psychology-audit");
const skillPath = path.join(skillDir, "SKILL.md");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const parsed = parse(frontmatter ?? "") as { name?: string; description?: string };
    return { text, name: parsed.name ?? "", description: parsed.description ?? "" };
}

function relativeLinks(text: string): string[] {
    return [...text.matchAll(/\]\(([^)#][^)]*)\)/g)]
        .map((m) => m[1] ?? "")
        .filter((l) => !/^(https?:|mailto:)/.test(l));
}

describe("sales-psychology-audit skill", () => {
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

    // The report format and the scoring depend on exactly these eight lenses.
    it("defines all eight lenses in one table", () => {
        const { text } = readSkill();
        const lenses = [
            "Motive fit",
            "Comparability",
            "Hook",
            "Motives over features",
            "Specificity",
            "Proof first",
            "Framing",
            "Named method",
        ];
        for (const [i, lens] of lenses.entries()) {
            expect(text, `lens ${i + 1} missing`).toMatch(new RegExp(`^\\| ${i + 1} \\| ${lens} \\|`, "m"));
        }
    });

    // The library is copied as a folder; a link outside it breaks after the sync.
    it("links only to files inside its own folder that exist", () => {
        const files = [skillPath, ...fs.readdirSync(path.join(skillDir, "references")).map((f) => path.join(skillDir, "references", f))];
        for (const file of files) {
            for (const link of relativeLinks(fs.readFileSync(file, "utf-8"))) {
                const target = path.resolve(path.dirname(file), link);
                expect(target.startsWith(skillDir + path.sep), `${file} links outside the skill: ${link}`).toBe(true);
                expect(fs.existsSync(target), `${file} -> ${link} is dangling`).toBe(true);
            }
        }
    });

    // Rule from the library contract: references over 100 lines start with a contents list.
    it("starts every long reference with a Contents section", () => {
        for (const f of fs.readdirSync(path.join(skillDir, "references"))) {
            const text = fs.readFileSync(path.join(skillDir, "references", f), "utf-8");
            if (text.split("\n").length > 100) expect(text, `${f} lacks ## Contents`).toContain("## Contents");
        }
    });

    // A skill absent from the index is invisible to use-skill-library.
    it("is listed in the library index", () => {
        const index = fs.readFileSync(path.join(libraryDir, "AGENTS.md"), "utf-8");
        expect(index).toMatch(/^\| `sales-psychology-audit` +\|/m);
    });

    // Guards the hard rules: no invented proof, no edits to the audited site,
    // no claim to the proprietary method, no pressure tactics by default.
    it("keeps the hard rules", () => {
        const { text } = readSkill();
        expect(text).toMatch(/Never invent numbers/);
        expect(text).toMatch(/Audit only/);
        expect(text).toMatch(/Do not call the audit "Neuroprofiling"/);
        expect(text).toMatch(/Urgency and scarcity are not default fixes/);
    });
});
