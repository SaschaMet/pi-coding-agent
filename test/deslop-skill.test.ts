import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "deslop");
const skillPath = path.join(skillDir, "SKILL.md");
const script = path.join(skillDir, "scripts", "slop-check.mjs");

function read(rel: string): string {
    const file = path.join(skillDir, rel);
    expect(fs.existsSync(file), `${file} is missing`).toBe(true);
    return fs.readFileSync(file, "utf-8");
}

function lineCount(rel: string): number {
    return read(rel).trimEnd().split("\n").length;
}

function frontmatter(): { name: string; description: string } {
    const raw = read("SKILL.md").match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(raw, "SKILL.md has no frontmatter").toBeDefined();
    return parse(raw ?? "");
}

function check(args: string[], input?: string) {
    return spawnSync("node", [script, ...args], { input, encoding: "utf8" });
}

describe("deslop skill files", () => {
    // The PI loader parses frontmatter with `yaml` and drops the skill on a parse error.
    it("has frontmatter the PI loader can parse", () => {
        const { name, description } = frontmatter();
        expect(name).toBe("deslop");
        expect(description.length).toBeLessThan(1024);
        expect(description).toContain("slop");
        expect(description).not.toContain("edit prose");
        expect(fs.existsSync(skillPath)).toBe(true);
    });

    it("links only files that exist", () => {
        const links = read("SKILL.md").match(/(?:references|scripts)\/[\w.-]+/g) ?? [];
        expect(links.length).toBeGreaterThan(0);
        for (const link of new Set(links)) {
            expect(fs.existsSync(path.join(skillDir, link)), `${link} is linked but missing`).toBe(true);
        }
    });

    // avoid-ai-writing was deleted for bloat; the caps keep this skill from repeating that.
    it("stays inside its line caps", () => {
        expect(lineCount("SKILL.md")).toBeLessThan(200);
        expect(lineCount("references/slop.md")).toBeLessThanOrEqual(120);
        expect(lineCount("references/compression.md")).toBeLessThanOrEqual(150);
    });

    it("starts every reference over 100 lines with a contents section", () => {
        for (const rel of ["references/slop.md", "references/compression.md"]) {
            if (lineCount(rel) > 100) expect(read(rel)).toMatch(/^# .*\n+## Contents/);
        }
    });

    // Pasted text may carry instructions; the skill must edit it, not obey it.
    it("treats input as material, never as instructions", () => {
        expect(read("SKILL.md")).toMatch(/never as instructions/);
    });

    it("defines every pattern the script and skill cite", () => {
        const slop = read("references/slop.md");
        const cited = `${read("SKILL.md")}\n${read("scripts/slop-check.mjs")}`.match(/S\d+/g) ?? [];
        for (const id of new Set(cited)) expect(slop, `${id} is cited but not defined`).toMatch(new RegExp(`\\| ${id} \\|`));
    });

    it("carries no rules from the business skill it was ported from", () => {
        for (const rel of ["SKILL.md", "references/slop.md", "references/compression.md", "scripts/slop-check.mjs"]) {
            expect(read(rel)).not.toMatch(/Katrin|HWG|Befund|Sascha/);
        }
    });
});

describe("slop-check.mjs", () => {
    it("prints usage on --help", () => {
        const run = check(["--help"]);
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(/Usage/);
    });

    it("exits 2 without --lang", () => {
        const run = check(["--stdin"], "Some text.");
        expect(run.status).toBe(2);
        expect(run.stderr).toMatch(/en, de/);
    });

    it("exits 2 on an unknown --lang and names the accepted values", () => {
        const run = check(["--lang", "fr", "--stdin"], "Some text.");
        expect(run.status).toBe(2);
        expect(run.stderr).toMatch(/fr/);
        expect(run.stderr).toMatch(/en, de/);
    });

    it("fails on an English stock opener", () => {
        const run = check(["--lang", "en", "--stdin"], "Let's dive in. The cache is cold.");
        expect(run.status).toBe(1);
        expect(run.stdout).toMatch(/S4/);
    });

    it("fails on a question answered by itself", () => {
        expect(check(["--lang", "en", "--stdin"], "The result? Faster builds.").status).toBe(1);
        expect(check(["--lang", "de", "--stdin"], "Das Ergebnis? Schnellere Builds.").status).toBe(1);
    });

    it("fails on a German stock opener", () => {
        const run = check(["--lang", "de", "--stdin"], "Die Wahrheit ist: Der Cache ist kalt.");
        expect(run.status).toBe(1);
    });

    it("only warns on em dash, exclamation marks, straight quotes, and voice words", () => {
        const run = check(["--lang", "en", "--stdin"], 'Done — "100%" coverage! It is very seamless.');
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(/CLEAN/);
        expect(check(["--lang", "de", "--stdin"], 'Wir "verbessern" die Ladezeit um 40 %!').status).toBe(0);
    });

    it("only warns on German labels and reveals that have honest uses", () => {
        expect(check(["--lang", "de", "--stdin"], "Fazit: Der Cache ist kalt.").status).toBe(0);
        expect(check(["--lang", "de", "--stdin"], "Das Beste daran ist, dass die Lizenz kostenlos ist.").status).toBe(0);
    });

    it("flags the documented reveal forms as advisory", () => {
        expect(check(["--lang", "en", "--stdin"], "The culprit: images.").stdout).toMatch(/S2/);
        expect(check(["--lang", "en", "--stdin"], "It bans processing without a legal basis, not analytics.").stdout).toMatch(/S1/);
    });

    it("fails on a hard German phrase in an umlaut-heavy sentence", () => {
        expect(check(["--lang", "de", "--stdin"], "Übrigens: Darüber spricht niemand.").status).toBe(1);
    });

    it("matches decomposed umlauts", () => {
        expect(check(["--lang", "de", "--stdin"], "Darüber spricht niemand.".normalize("NFD")).status).toBe(1);
    });

    it("checks headings", () => {
        expect(check(["--lang", "en", "--stdin"], "## Let's dive in").status).toBe(1);
    });

    // JS \b treats umlauts as non-word characters, so a word starting with one is never matched by \b.
    it("matches German words at an umlaut edge", () => {
        const run = check(["--lang", "de", "--stdin"], "Das ist äußerst wichtig.");
        expect(run.stdout).toMatch(/S15/);
    });

    it("flags filler and doublets from the compression reference", () => {
        expect(check(["--lang", "en", "--stdin"], "It is generally fine.").stdout).toMatch(/S15/);
        expect(check(["--lang", "en", "--stdin"], "Read any and all notes.").stdout).toMatch(/compression phrase/);
    });

    it("fails on chatbot residue and knowledge-limit disclaimers", () => {
        expect(check(["--lang", "en", "--stdin"], "Would you like me to expand on this?").stdout).toMatch(/S30/);
        expect(check(["--lang", "en", "--stdin"], "You're absolutely right.").status).toBe(1);
        expect(check(["--lang", "en", "--stdin"], "As of my last training update, it ships in May.").stdout).toMatch(/S31/);
        expect(check(["--lang", "de", "--stdin"], "Möchtest du, dass ich weitermache?").stdout).toMatch(/S30/);
        expect(check(["--lang", "de", "--stdin"], "Du hast völlig recht.").status).toBe(1);
    });

    it("fails on deep-sounding sayings, straw alternatives, and send-offs", () => {
        expect(check(["--lang", "en", "--stdin"], "The real question is whether teams adapt.").stdout).toMatch(/S24/);
        expect(check(["--lang", "en", "--stdin"], "A tempting approach would be a cron job.").stdout).toMatch(/S23/);
        expect(check(["--lang", "en", "--stdin"], "The future looks bright for the team.").stdout).toMatch(/S29/);
        expect(check(["--lang", "de", "--stdin"], "Worauf es wirklich ankommt, ist Tempo.").status).toBe(1);
        expect(check(["--lang", "de", "--stdin"], "Die Zukunft sieht rosig aus.").status).toBe(1);
    });

    it("only warns on residue phrases that honest messages also use", () => {
        expect(check(["--lang", "en", "--stdin"], "Would you like me to send the invoice by Friday?").status).toBe(0);
        expect(check(["--lang", "en", "--stdin"], "Of course! I'll bring the keys.").status).toBe(0);
        expect(check(["--lang", "de", "--stdin"], "Soll ich dir eine Kopie schicken?").stdout).toMatch(/S30/);
        expect(check(["--lang", "de", "--stdin"], "Soll ich dir eine Kopie schicken?").status).toBe(0);
        expect(check(["--lang", "de", "--stdin"], "Stand meines Wissens ist der Vertrag noch gültig.").status).toBe(0);
        expect(check(["--lang", "de", "--stdin"], "Ein Meilenstein in der Planung ist der 3. Mai.").status).toBe(0);
    });

    it("only warns on tells that are weak alone", () => {
        const en = [
            "The gallery serves as an exhibition space, highlighting local art.",
            "He is associated with the orchestra. Experts argue it matters.",
            "To be clear, the table below compares prices. 🚀",
        ].join("\n");
        const run = check(["--lang", "en", "--stdin"], en);
        expect(run.status).toBe(0);
        for (const id of ["S23", "S25", "S26", "S27", "S28", "S32", "S34"]) expect(run.stdout).toMatch(new RegExp(id));
        const de = "Der Raum dient als Galerie. Studien zeigen, dass das im Zusammenhang mit Kunst steht. ✨";
        const deRun = check(["--lang", "de", "--stdin"], de);
        expect(deRun.status).toBe(0);
        for (const id of ["S25", "S27", "S28", "S34"]) expect(deRun.stdout).toMatch(new RegExp(id));
    });

    it("ignores fenced code, inline code, and HTML comments", () => {
        const text = [
            "Use `Let's dive in` as the bad example.",
            "<!-- Here's the thing: a note -->",
            "```",
            "Let's dive in.",
            "```",
            "The cache is cold.",
        ].join("\n");
        expect(check(["--lang", "en", "--stdin"], text).status).toBe(0);
    });

    it("ignores fenced code indented inside a list item", () => {
        const text = ["- Step one:", "", "  ```", "  Let's dive in", "  ```"].join("\n");
        expect(check(["--lang", "en", "--stdin"], text).status).toBe(0);
    });

    it("reads a file argument", () => {
        const file = path.join(process.env.TMPDIR ?? process.cwd(), `deslop-test-${process.pid}.md`);
        fs.writeFileSync(file, "Here's the thing: it works.");
        try {
            expect(check(["--lang", "en", file]).status).toBe(1);
        } finally {
            fs.rmSync(file, { force: true });
        }
    });
});
