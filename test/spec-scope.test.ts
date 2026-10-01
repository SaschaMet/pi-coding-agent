import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchesAny, matchesPattern, parseScopeSection } from "../.pi/extensions/lib/spec-scope.ts";

const SKILLS = path.join(import.meta.dirname, "..", ".pi", "skills");

/** The template body inside its outer ```md fence, with the Scope placeholders filled in. */
function filledTemplate(rel: string): string {
    const text = fs.readFileSync(path.join(SKILLS, rel), "utf-8");
    const start = text.indexOf("```md\n");
    const body = start >= 0 ? text.slice(start + 6, text.lastIndexOf("\n```")) : text;
    return body
        .replace("**Modify:**\n\n- `path/to/file`", "**Modify:**\n\n- `src/**`")
        .replace("**Modify:**\n- `path/to/file`", "**Modify:**\n- `src/**`")
        .replace(/(\*\*Forbid:\*\*\n\n?)- `path\/or\/area`/, "$1- `src/secrets.ts`");
}

const TEMPLATES = ["create-spec/references/spec-template.md", "create-plan/references/plan-template.md"];
const LIVING_SECTIONS = ["Metadata", "Amendments", "AI-Notes"];

function withoutSection(markdown: string, name: string): string {
    return markdown.replace(new RegExp(`\\n## ${name}\\n[\\s\\S]*?(?=\\n## |$)`), "\n");
}

function h2Names(markdown: string): string[] {
    return [...markdown.matchAll(/^## (?:\d+\.\s*)?(.+)$/gm)].map((m) => m[1].trim());
}

describe("templates", () => {
    it.each(TEMPLATES)("%s parses to the lists of its Scope section", (rel) => {
        expect(parseScopeSection(filledTemplate(rel))).toEqual({
            lists: { modify: ["src/**"], forbid: ["src/secrets.ts"] },
        });
    });

    it.each(TEMPLATES)("%s has the living-document sections, AI-Notes last", (rel) => {
        const names = h2Names(filledTemplate(rel));
        for (const name of LIVING_SECTIONS) expect(names).toContain(name);
        expect(names.indexOf("Metadata")).toBeLessThan(names.indexOf("Grill Status"));
        expect(names.at(-1)).toBe("AI-Notes");
    });

    it.each(TEMPLATES)("%s keeps Metadata to Created, Commits, Back refs", (rel) => {
        const metadata = filledTemplate(rel).match(/\n## Metadata\n([\s\S]*?)\n## /)?.[1] ?? "";
        for (const field of ["Created", "Commits", "Back refs"]) expect(metadata).toContain(`- ${field}:`);
        for (const field of ["Modified", "Agents", "Sessions", "Forward refs"]) expect(metadata).not.toContain(field);
        expect(metadata).not.toMatch(/\*\*(Modify|Forbid):\*\*/);
    });

    it.each(TEMPLATES)("%s explains all four status markers", (rel) => {
        const body = filledTemplate(rel);
        for (const marker of ["`[ ]`", "`[wip]`", "`[x]`", "`[f]`"]) expect(body).toContain(marker);
    });

    it("keeps the spec template's outer fence longer than its inner diff fences", () => {
        const text = fs.readFileSync(path.join(SKILLS, TEMPLATES[0]), "utf-8");
        const outer = text.match(/^(`{3,})md$/m)?.[1].length ?? 0;
        const inner = [...text.matchAll(/^\s+(`{3,})diff$/gm)].map((m) => m[1].length);
        expect(inner.length).toBeGreaterThan(0);
        for (const len of inner) expect(len).toBeLessThan(outer);
    });

    it("gives only the spec template a per-step Validate list", () => {
        expect(filledTemplate(TEMPLATES[0])).toMatch(/^- Validate:\n {2}- \[ \] /m);
        expect(filledTemplate(TEMPLATES[1])).not.toContain("Validate:");
    });

    it.each(TEMPLATES)("%s parses the same with or without the living-document sections", (rel) => {
        const full = filledTemplate(rel);
        const bare = LIVING_SECTIONS.reduce(withoutSection, full);
        expect(h2Names(bare)).not.toContain("AI-Notes");
        expect(parseScopeSection(bare)).toEqual(parseScopeSection(full));
    });

    it.each(TEMPLATES)("%s ignores Scope-like text inside an AI-Note", (rel) => {
        const note = [
            "",
            "### 2026-09-25T08:00:00Z · pi · s-1 · worker · gotcha",
            "**Modify:**",
            "- `src/evil.ts`",
            "### Scope",
            "**Forbid:**",
            "- `nothing`",
            "",
        ].join("\n");
        expect(parseScopeSection(filledTemplate(rel) + note)).toEqual({
            lists: { modify: ["src/**"], forbid: ["src/secrets.ts"] },
        });
    });
});

describe("parseScopeSection", () => {
    it("reads the Modify and Forbid lists from the spec template shape", () => {
        const parsed = parseScopeSection(
            "# Spec\n\n## 2. Scope\n\n**Modify:**\n- `src/**`\n- `package.json`\n\n**Forbid:**\n- `src/secrets.ts`\n\n## 3. Next\n",
        );

        expect(parsed).toEqual({ lists: { modify: ["src/**", "package.json"], forbid: ["src/secrets.ts"] } });
    });

    it("reports a missing Scope section", () => {
        expect(parseScopeSection("# Spec\n\n## 1. Intent\nNothing.\n")).toHaveProperty("error");
    });

    it("reports a Modify list holding only template placeholders", () => {
        expect(
            parseScopeSection("# Spec\n\n## 2. Scope\n\n**Modify:**\n- `path/to/file`\n- ...\n"),
        ).toHaveProperty("error");
    });

    it("returns an empty Forbid list when the spec omits it", () => {
        const parsed = parseScopeSection("# Spec\n\n## 2. Scope\n\n**Modify:**\n- `src/**`\n");
        expect(parsed).toEqual({ lists: { modify: ["src/**"], forbid: [] } });
    });
});

describe("matchesPattern", () => {
    it("matches an exact path", () => {
        expect(matchesPattern("package.json", "package.json")).toBe(true);
        expect(matchesPattern("package-lock.json", "package.json")).toBe(false);
    });

    it("treats a wildcard-free pattern as a directory prefix", () => {
        expect(matchesPattern("src/env.ts", "src")).toBe(true);
        expect(matchesPattern("src/env.ts", "src/")).toBe(true);
        expect(matchesPattern("srcx/env.ts", "src")).toBe(false);
    });

    it("keeps a single star inside one segment", () => {
        expect(matchesPattern("src/env.ts", "src/*.ts")).toBe(true);
        expect(matchesPattern("src/deep/env.ts", "src/*.ts")).toBe(false);
    });

    it("spans zero or more segments with a double star", () => {
        expect(matchesPattern("src/index.ts", "src/**/*.ts")).toBe(true);
        expect(matchesPattern("src/a/b.ts", "src/**/*.ts")).toBe(true);
        expect(matchesPattern("smoke.test.ts", "**/*.test.ts")).toBe(true);
        expect(matchesPattern("test/a.test.ts", "**/*.test.ts")).toBe(true);
    });

    it("matches everything under a trailing double star", () => {
        expect(matchesPattern("src/a.ts", "src/**")).toBe(true);
        expect(matchesPattern("src/a/b/c.ts", "src/**")).toBe(true);
        expect(matchesPattern("other/a.ts", "src/**")).toBe(false);
    });

    it("treats a question mark as one literal character, not a quantifier", () => {
        expect(matchesPattern("src/secret1.ts", "src/secret?.ts")).toBe(true);
        expect(matchesPattern("src/secret.ts", "src/secret?.ts")).toBe(false);
        expect(matchesPattern("src/secret12.ts", "src/secret?.ts")).toBe(false);
    });

    // `..` is an ordinary segment to a glob, so a `../` path can match `**`. Containment is
    // the guard's job, not the matcher's — see the outside-cwd case in write-boundary-guard.
    it("has no opinion about paths that escaped the working directory", () => {
        expect(matchesPattern("../other/config.ts", "**/*.ts")).toBe(true);
    });

    it("returns false for an empty pattern instead of matching everything", () => {
        expect(matchesPattern("src/env.ts", "   ")).toBe(false);
        expect(matchesAny("src/env.ts", [])).toBe(false);
    });

    it("stays fast on a pathological pattern", () => {
        const started = process.hrtime.bigint();
        expect(matchesPattern("src/a/b/c/d/e/f/g/h/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ts", "a**a**a**a**a**a**a**a**b")).toBe(false);
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        expect(elapsedMs).toBeLessThan(100);
    });
});
