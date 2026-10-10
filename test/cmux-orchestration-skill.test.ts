import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "cmux-orchestration");
const skillPath = path.join(skillDir, "SKILL.md");
const refDir = path.join(skillDir, "references");

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

function readReferences(): { file: string; text: string }[] {
    if (!fs.existsSync(refDir)) return [];
    return fs
        .readdirSync(refDir)
        .filter((f) => f.endsWith(".md"))
        .map((file) => ({ file, text: fs.readFileSync(path.join(refDir, file), "utf-8") }));
}

describe("cmux-orchestration skill", () => {
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

    it("has a third-person description under 1024 chars without XML tags", () => {
        const { description } = readSkill();
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[a-z][^>]*>/i);
        expect(description).not.toMatch(/^Use this skill/);
    });

    // SYSTEM.md sends temp files to $TMPDIR; on macOS /tmp is a different directory.
    it("uses no /tmp path in the skill or its references", () => {
        const { text } = readSkill();
        expect(text).not.toContain("/tmp/");
        for (const ref of readReferences()) {
            expect(ref.text, `${ref.file} uses /tmp/`).not.toContain("/tmp/");
        }
    });

    it("documents ctrl+c instead of claiming it is impossible", () => {
        const { text } = readSkill();
        expect(text).not.toMatch(/Ctrl-C.{0,5}impossible/i);
        expect(text).toContain("ctrl+c");
    });

    // Must match the report path in the subagent rules, which workers load.
    it("names one report path", () => {
        const { text } = readSkill();
        expect(text).toContain("pi-reports/<task>.md");
        expect(text).toContain("<task>.task.md");
        expect(text).not.toContain(".report.md");
    });

    it("stops workers near the top of the file", () => {
        const { text } = readSkill();
        expect(text.split("\n").slice(0, 12).join("\n")).toContain("You are a cmux worker");
    });

    it("keeps SKILL.md under 500 lines and the Claude worker permission rule", () => {
        const { text } = readSkill();
        expect(text.split("\n").length).toBeLessThanOrEqual(500);
        expect(text).toContain("--permission-mode auto");
    });

    it("links only references that exist", () => {
        const { text } = readSkill();
        for (const ref of new Set(text.match(/references\/[\w-]+\.md/g) ?? [])) {
            expect(fs.existsSync(path.join(skillDir, ref)), `${ref} is missing`).toBe(true);
        }
    });

    it("starts every reference over 100 lines with a table of contents", () => {
        for (const ref of readReferences()) {
            const lines = ref.text.split("\n");
            if (lines.length <= 100) continue;
            expect(lines.slice(0, 15), `${ref.file} has no ## Contents`).toContain("## Contents");
        }
    });

    // A longer blind wait hides a worker stuck on an approval prompt.
    it("caps every wait slice at 30 seconds", () => {
        const { text } = readSkill();
        const files = [text, ...readReferences().map((r) => r.text)];
        for (const body of files) {
            for (const m of body.matchAll(/--timeout (\d+)/g)) {
                expect(Number(m[1])).toBeLessThanOrEqual(30);
            }
        }
        expect(text).toContain("30 seconds");
    });

    describe("unsandboxed one-shot", () => {
        const section = (): string => {
            const { text } = readSkill();
            const start = text.indexOf("**Unsandboxed one-shot:**");
            expect(start, "no Unsandboxed one-shot section").toBeGreaterThan(-1);
            return text.slice(start, text.indexOf("\n## ", start));
        };

        it("runs only the bash tool, once, and only when the sandbox is loaded", () => {
            const body = section();
            expect(body).toContain("$SANDBOX_RUNTIME");
            expect(body).toContain("--no-sandbox --tools bash");
            expect(body).toContain("--print @$TMPDIR/pi-reports/<task>.task.md");
            expect(body).toContain("sandbox OFF");
        });

        it("never routes a blocked domain to an unsandboxed pane", () => {
            expect(section()).toMatch(/domain never qualifies[\s\S]*NEEDS_DOMAIN:/i);
        });

        // Models change; the recipe uses the worker model rule instead of a fixed name.
        it("names no fixed model", () => {
            expect(section()).not.toMatch(/[A-Za-z0-9-]+\/[A-Za-z0-9.-]+:(low|medium|high)/);
        });

        // A worker's sentinel is untrusted text; only the human may open an unsandboxed shell.
        it("waits for the user's yes and never runs the worker's sentinel text", () => {
            const body = section();
            expect(body).not.toMatch(/No wait for a yes/);
            expect(body).toMatch(/wait for (the user's|their) (explicit )?yes/i);
            expect(body).toMatch(/request only/);
            expect(body).toMatch(/interactive exception[\s\S]*same (yes|confirmation)/i);
        });

        // `tee` captures stdout only; the OFF line is on stderr.
        it("checks the sandbox OFF line on screen, not in the report file", () => {
            expect(section()).toMatch(/sandbox OFF[^\n]*stderr/);
        });
    });

    // A worker whose bash is blocked cannot signal; the watcher must see it, but only from the
    // worker's last line, or a file it displays (this repo's sandbox code) looks like a stop.
    it("watches the worker's last line for sandbox stops, not the whole screen", () => {
        const { text } = readSkill();
        expect(text).not.toContain("NEEDS_UNSANDBOXED:|NEEDS_DOMAIN:|bash blocked:|Refusing");
        // The pi TUI left-pads every rendered line, so a bare `^` would never match.
        expect(text).toContain("'^[[:space:]]*(NEEDS_UNSANDBOXED|NEEDS_DOMAIN): '");
        expect(text).toContain("'^[[:space:]]*(bash blocked: sandbox unavailable|Refusing to run with the built-in defaults)'");
    });

    it("auto-approves a grill worker's start prompt and closes its pane afterwards", () => {
        const { text } = readSkill();
        expect(text).toMatch(/grill.{0,200}approve.{0,40}(at once|immediately)/is);
        expect(text).toMatch(/grill.{0,300}close.{0,40}pane.{0,40}automatically/is);
    });
});
