import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const skillDir = path.join(process.cwd(), ".pi", "skills", "youtube-transcript");
const skillPath = path.join(skillDir, "SKILL.md");
const scriptsDir = path.join(skillDir, "scripts");
const script = path.join(scriptsDir, "fetch_transcript.py");
const PYTHON = process.env.PYTHON ?? "python3";

function readSkill(): { text: string; name: string; description: string } {
    expect(fs.existsSync(skillPath), `${skillPath} is missing`).toBe(true);
    const text = fs.readFileSync(skillPath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    expect(frontmatter, "SKILL.md has no frontmatter").toBeDefined();
    const name = frontmatter?.match(/^name: (.*)$/m)?.[1] ?? "";
    const description = frontmatter?.match(/^description: (.*)$/m)?.[1] ?? "";
    return { text, name, description };
}

// -B keeps __pycache__ out of the skill dir, which is neither git-ignored nor sync-excluded.
function python(args: string[]): { status: number; stdout: string; stderr: string } {
    const res = spawnSync(PYTHON, ["-B", ...args], { encoding: "utf-8", timeout: 20_000 });
    if (res.error) throw new Error(`failed to start ${PYTHON}: ${res.error.message}`);
    return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

// Imports the module with the transcript library blocked, so the lazy-import contract is proven.
function inModule(body: string): unknown {
    const code = [
        "import json, sys, types",
        `sys.path.insert(0, ${JSON.stringify(scriptsDir)})`,
        "sys.modules['youtube_transcript_api'] = None",
        "sys.modules['requests'] = None",
        "import fetch_transcript as m",
        body,
    ].join("\n");
    const res = python(["-c", code]);
    expect(res.status, res.stderr).toBe(0);
    return JSON.parse(res.stdout);
}

describe("youtube-transcript skill", () => {
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
        expect(description).not.toMatch(/^(Use this skill|I |You )/);
    });

    it("keeps SKILL.md under 500 lines", () => {
        expect(readSkill().text.split("\n").length).toBeLessThanOrEqual(500);
    });

    it("references only scripts that exist", () => {
        const scripts = [...new Set(readSkill().text.match(/[\w-]+\.py/g) ?? [])];
        expect(scripts.length).toBeGreaterThan(0);
        for (const name of scripts) {
            expect(fs.existsSync(path.join(scriptsDir, name)), `${name} is missing`).toBe(true);
        }
    });

    it("pins the library, single-quotes the URL, and marks the transcript untrusted", () => {
        const { text } = readSkill();
        expect(text).toContain("--timestamps");
        expect(text).toMatch(/youtube-transcript-api==\d+\.\d+\.\d+/);
        expect(text).toMatch(/fetch_transcript\.py '<URL>'/);
        expect(text).not.toMatch(/fetch_transcript\.py "<URL>"/);
        expect(text.toLowerCase()).toContain("untrusted");
    });
});

describe("fetch_transcript.py (offline)", () => {
    it("extracts the same 11-char ID from every URL shape", () => {
        const id = "dQw4w9WgXcQ";
        const urls = [
            `https://www.youtube.com/watch?v=${id}&list=WL`,
            `https://youtu.be/${id}`,
            `https://www.youtube.com/shorts/${id}`,
            `https://www.youtube.com/live/${id}`,
            `https://www.youtube.com/embed/${id}`,
            id,
        ];
        const got = inModule(
            `print(json.dumps([m.parse_video_id(u) for u in ${JSON.stringify(urls)}]))`,
        );
        expect(got).toEqual(urls.map(() => id));
    });

    it("rejects input without a video ID", () => {
        const got = inModule(
            [
                "try:",
                "    m.parse_video_id('not a url')",
                "    print(json.dumps('no error'))",
                "except ValueError:",
                "    print(json.dumps('ValueError'))",
            ].join("\n"),
        );
        expect(got).toBe("ValueError");
    });

    it("renders timestamps and skips empty snippets", () => {
        const got = inModule(
            [
                "S = types.SimpleNamespace",
                "snips = [S(text='hello', start=65.0), S(text='  ', start=70.0), S(text='world', start=3725.9)]",
                "print(json.dumps([m.render(snips, True), m.render(snips, False)]))",
            ].join("\n"),
        );
        expect(got).toEqual(["[00:01:05] hello\n[01:02:05] world", "hello\nworld"]);
    });

    it("returns no title when the oembed call fails", () => {
        const got = inModule(
            [
                "def boom(*a, **k): raise OSError('offline')",
                "m.urllib.request.urlopen = boom",
                "print(json.dumps(m.fetch_title('dQw4w9WgXcQ')))",
            ].join("\n"),
        );
        expect(got).toBeNull();
    });

    it("exits 1 with an Error line on a bad URL, without touching the network", () => {
        const res = python([script, "not a url"]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("Error:");
        expect(res.stdout).toBe("");
    });

    it("leaves no __pycache__ in the skill", () => {
        expect(fs.existsSync(path.join(scriptsDir, "__pycache__"))).toBe(false);
    });
});
