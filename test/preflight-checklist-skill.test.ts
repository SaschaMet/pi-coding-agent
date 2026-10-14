import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "preflight-checklist");
const skillPath = path.join(skillDir, "SKILL.md");
const systemMdPath = path.join(process.cwd(), ".pi", "SYSTEM.md");

function loadSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

describe("preflight-checklist skill", () => {
    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has frontmatter the PI loader can parse", () => {
        const { text, name, description } = loadSkill();
        const frontmatter = parse(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "");
        expect(frontmatter.name).toBe(name);
        expect(frontmatter.description).toBe(description);
    });

    it("has a name the PI loader accepts", () => {
        const { name } = loadSkill();
        expect(name).toBe(path.basename(skillDir));
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^[a-z0-9-]+$/);
        expect(name).not.toMatch(/^-|-$/);
        expect(name).not.toContain("--");
    });

    // PI lists skills to the model inside XML, so tags in a description break that block.
    it("has a third-person description under 1024 chars without XML tags", () => {
        const { description } = loadSkill();
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[a-z][^>]*>/i);
        expect(description).not.toMatch(/^(Use this skill|I |You |Use when)/);
    });

    it("keeps SKILL.md under 500 lines", () => {
        const { text } = loadSkill();
        expect(text.split("\n").length).toBeLessThanOrEqual(500);
    });

    // A broad "before done" trigger would load the skill on every coding turn.
    it("triggers narrowly", () => {
        const { description } = loadSkill();
        expect(description).toContain("before handing open manual checks to the user");
        expect(description).not.toContain("before reporting a coding task as done");
        expect(description).toContain("Not for");
    });

    // Eval runs showed agents offering the preflight, or skipping it in a turn they read as read-only.
    it("runs instead of offering, even in read-only turns", () => {
        const { text, description } = loadSkill();
        expect(description).toContain("Run it instead of offering it");
        expect(text).toMatch(/Read-only means no edits/);
    });

    it("checks only the task's own diff", () => {
        const { text } = loadSkill();
        expect(text).toMatch(/decisions from the conversation/);
        expect(text).toContain("the task's own diff");
        expect(text).toContain("uncommitted files the task owns");
        expect(text).toContain("git merge-base");
        expect(text).toContain("Not checked: outside this task");
    });

    it("reconciles an existing checklist instead of copying it", () => {
        const { text } = loadSkill();
        for (const verdict of ["`kept`", "`fixed`", "`dropped"]) expect(text).toContain(verdict);
        expect(text).toContain("Never edit the plan");
        expect(text).toContain("`gotcha`");
    });

    it("requires fresh, redacted evidence and re-runs after any change", () => {
        const { text } = loadSkill();
        expect(text).toMatch(/exit code/);
        expect(text).toMatch(/from this run/);
        expect(text).toMatch(/redact/i);
        expect(text).toMatch(/re-run the whole preflight/i);
    });

    it("keeps human dry-runs local and read-only", () => {
        const { text } = loadSkill();
        expect(text).toMatch(/`human` only with a reason/);
        expect(text).toMatch(/local and read-only/i);
        expect(text).toMatch(/no network, no credentials/i);
    });

    it("writes one checklist.md, chat only without a plan", () => {
        const { text } = loadSkill();
        expect(text).toContain("`checklist.md`");
        expect(text).toMatch(/No plan or spec → chat only/);
        expect(text).not.toMatch(/checklist-<YYYY/);
    });
});

describe("SYSTEM.md step 7", () => {
    it("runs the preflight", () => {
        const step7 = fs.readFileSync(systemMdPath, "utf-8").match(/^7\. \*\*Validate:\*\*.*$/m)?.[0] ?? "";
        expect(step7).toContain("`$preflight-checklist`");
        expect(step7).toMatch(/tries every manual check itself/);
    });
});
