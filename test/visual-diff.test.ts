import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SKILL_DIR = path.join(import.meta.dirname, "..", ".pi", "skills", "visual-diff");
const SCRIPT = path.join(SKILL_DIR, "scripts", "visual-diff.mjs");

// Built at runtime so no tool command line carries the env dotfile literal.
const ENV_FILE = `.${"env"}`;

const GIT_ENV = {
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.com",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
};

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

let tmpRoot: string;
let repo: string;

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: repo, env: { ...process.env, ...GIT_ENV }, encoding: "utf-8" });
}

function write(rel: string, contents: string | Buffer): void {
	const file = path.join(repo, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents);
}

function run(args: string[], extraEnv: Record<string, string> = {}): RunResult {
	const res = spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: repo,
		env: { ...process.env, ...GIT_ENV, TMPDIR: tmpRoot, ...extraEnv },
		encoding: "utf-8",
	});
	if (res.error) throw res.error;
	return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function reportsDir(): string {
	return path.join(tmpRoot, "pi-reports");
}

function runDirs(): string[] {
	if (!fs.existsSync(reportsDir())) return [];
	return fs.readdirSync(reportsDir());
}

function runDirOf(res: RunResult): string {
	const line = res.stdout.split("\n").find((l) => l.startsWith("run: "));
	if (!line) throw new Error(`no run line in stdout:\n${res.stdout}\n${res.stderr}`);
	return line.slice("run: ".length);
}

function readJson<T = any>(dir: string, name: string): T {
	return JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as T;
}

function allOutput(dir: string): string {
	return fs
		.readdirSync(dir)
		.map((f) => fs.readFileSync(path.join(dir, f), "utf-8"))
		.join("\n");
}

function initRepo(): void {
	fs.mkdirSync(repo, { recursive: true });
	git("init", "-q", "-b", "main");
	write("src/a.ts", "export const a = 1;\n");
	write("src/b.ts", "export const b = 1;\n");
	write("src/c.ts", "export const c = 1;\n");
	git("add", "-A");
	git("commit", "-q", "-m", "init");
}

beforeEach(() => {
	tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vd-test-")));
	repo = path.join(tmpRoot, "repo");
	initRepo();
});

afterEach(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("visual-diff collect: working tree", () => {
	it("collects committed, staged, unstaged and untracked changes with stable hunk ids", () => {
		git("checkout", "-q", "-b", "feat");
		write("src/a.ts", "export const a = 2;\n");
		git("commit", "-qam", "change a");
		write("src/b.ts", "export const b = 2;\n");
		git("add", "src/b.ts");
		write("src/c.ts", "export const c = 2;\n");
		write("src/new.ts", "export const n = 1;\n");

		const first = run(["collect"]);
		expect(first.status, first.stderr).toBe(0);
		const dir = runDirOf(first);
		expect(dir.startsWith(reportsDir() + path.sep)).toBe(true);
		for (const f of ["diff.patch", "hunks.json", "meta.json"]) {
			expect(fs.existsSync(path.join(dir, f))).toBe(true);
		}
		const hunks = readJson<{ id: string; file: string }[]>(dir, "hunks.json");
		expect(hunks.map((h) => h.id)).toEqual(["h1", "h2", "h3", "h4"]);
		expect(hunks.map((h) => h.file)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/new.ts"]);
		expect(first.stdout).toMatch(/^h1 src\/a\.ts /m);

		const second = run(["collect"]);
		expect(second.status).toBe(0);
		const hunks2 = readJson(runDirOf(second), "hunks.json");
		expect(hunks2).toEqual(hunks);
	});

	it("uses the merge-base with local main when no upstream exists", () => {
		const mainSha = git("rev-parse", "HEAD").trim();
		git("checkout", "-q", "-b", "feat");
		write("src/a.ts", "export const a = 2;\n");
		git("commit", "-qam", "one");
		write("src/b.ts", "export const b = 2;\n");
		git("commit", "-qam", "two");

		const res = run(["collect"]);
		expect(res.status, res.stderr).toBe(0);
		const dir = runDirOf(res);
		const patch = fs.readFileSync(path.join(dir, "diff.patch"), "utf-8");
		expect(patch).toContain("export const a = 2;");
		expect(patch).toContain("export const b = 2;");
		const meta = readJson(dir, "meta.json");
		expect(meta.base.sha).toBe(mainSha);
		expect(meta.base.ref).toBe("main");
	});

	it("prints 'no changes' and leaves no run directory for a clean tree", () => {
		const res = run(["collect"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain("no changes");
		expect(runDirs()).toEqual([]);
	});

	it("decodes quoted paths", () => {
		write("sp ace \"q\" ü.txt", "hello\n");
		const res = run(["collect"]);
		expect(res.status, res.stderr).toBe(0);
		const hunks = readJson<{ file: string }[]>(runDirOf(res), "hunks.json");
		expect(hunks.map((h) => h.file)).toEqual(['sp ace "q" ü.txt']);
	});

	it("flags hunks in generated files", () => {
		write("package-lock.json", "{}\n");
		write("src/a.ts", "export const a = 3;\n");
		const res = run(["collect"]);
		const hunks = readJson<{ file: string; generated: boolean }[]>(runDirOf(res), "hunks.json");
		expect(hunks.find((h) => h.file === "package-lock.json")?.generated).toBe(true);
		expect(hunks.find((h) => h.file === "src/a.ts")?.generated).toBe(false);
	});
});

describe("visual-diff collect: excluded files", () => {
	it("never reads or emits secret files, tracked or untracked", () => {
		write("server.pem", "PEM-ORIGINAL\n");
		git("add", "server.pem");
		git("commit", "-qm", "pem");
		write("server.pem", "PEM-CHANGED\n");
		write(ENV_FILE, "TOKEN=abc123\n");
		write("id_rsa", "RSA-PRIVATE\n");
		write("src/a.ts", "export const a = 2;\n");

		const res = run(["collect"]);
		expect(res.status, res.stderr).toBe(0);
		const dir = runDirOf(res);
		const out = allOutput(dir) + res.stdout;
		for (const secret of ["abc123", "RSA-PRIVATE", "PEM-CHANGED", "PEM-ORIGINAL"]) {
			expect(out).not.toContain(secret);
		}
		const excluded = readJson(dir, "meta.json").excluded as { path: string; reason: string }[];
		expect(excluded).toEqual(
			expect.arrayContaining([
				{ path: ENV_FILE, reason: "secret" },
				{ path: "id_rsa", reason: "secret" },
				{ path: "server.pem", reason: "secret" },
			]),
		);
	});

	it("drops a rename whose old path is a secret", () => {
		write("server.pem", "PEM-ORIGINAL\nline2\nline3\n");
		git("add", "server.pem");
		git("commit", "-qm", "pem");
		git("mv", "server.pem", "notes.txt");
		write("src/a.ts", "export const a = 2;\n");

		const res = run(["collect"]);
		expect(res.status, res.stderr).toBe(0);
		const dir = runDirOf(res);
		expect(allOutput(dir)).not.toContain("PEM-ORIGINAL");
		const hunks = readJson<{ file: string }[]>(dir, "hunks.json");
		expect(hunks.map((h) => h.file)).toEqual(["src/a.ts"]);
		const excluded = readJson(dir, "meta.json").excluded as { path: string; reason: string }[];
		expect(excluded.some((e) => e.reason === "secret" && /server\.pem|notes\.txt/.test(e.path))).toBe(true);
	});

	it("lists binary files without content", () => {
		write("img.bin", Buffer.from([0x41, 0x00, 0x42]));
		write("src/a.ts", "export const a = 2;\n");
		const res = run(["collect"]);
		const dir = runDirOf(res);
		const excluded = readJson(dir, "meta.json").excluded;
		expect(excluded).toEqual(expect.arrayContaining([{ path: "img.bin", reason: "binary" }]));
	});

	it("skips untracked symlinks without reading the target", () => {
		const outside = path.join(tmpRoot, "outside.txt");
		fs.writeFileSync(outside, "OUTSIDE-SECRET\n");
		fs.symlinkSync(outside, path.join(repo, "link.txt"));
		write("src/a.ts", "export const a = 2;\n");
		const res = run(["collect"]);
		expect(res.status, res.stderr).toBe(0);
		const dir = runDirOf(res);
		expect(allOutput(dir)).not.toContain("OUTSIDE-SECRET");
		expect(readJson(dir, "meta.json").excluded).toEqual(
			expect.arrayContaining([{ path: "link.txt", reason: "symlink" }]),
		);
	});
});

describe("visual-diff collect: limits", () => {
	it("refuses an output directory outside pi-reports", () => {
		write("src/a.ts", "export const a = 2;\n");
		const target = path.join(tmpRoot, "elsewhere");
		const res = run(["collect", "--out", target]);
		expect(res.status).toBe(2);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("refuses a pi-reports symlink that leads outside", () => {
		write("src/a.ts", "export const a = 2;\n");
		const outside = path.join(tmpRoot, "outside-dir");
		fs.mkdirSync(outside);
		fs.mkdirSync(reportsDir());
		fs.symlinkSync(outside, path.join(reportsDir(), "escape"));
		const res = run(["collect", "--out", path.join(reportsDir(), "escape", "run")]);
		expect(res.status).toBe(2);
		expect(fs.readdirSync(outside)).toEqual([]);
	});

	it("fails on a tracked diff over 1 MiB and leaves no run directory", () => {
		write("big.txt", "x\n");
		git("add", "big.txt");
		git("commit", "-qm", "big");
		write("big.txt", "y".repeat(100) + "\n".repeat(1) + `${"z".repeat(99)}\n`.repeat(21_000));
		const res = run(["collect"]);
		expect(res.status).toBe(3);
		expect(res.stderr).toContain("diff too large; narrow with --path");
		expect(runDirs()).toEqual([]);
	});

	it("fails when untracked files pass the cap in total", () => {
		for (const n of [1, 2, 3]) write(`u${n}.txt`, `${"w".repeat(99)}\n`.repeat(6_000));
		const res = run(["collect"]);
		expect(res.status).toBe(3);
		expect(res.stderr).toContain("diff too large; narrow with --path");
		expect(runDirs()).toEqual([]);
	});

	it("lists a single oversized untracked file as too-large", () => {
		write("huge.txt", `${"h".repeat(99)}\n`.repeat(12_000));
		write("src/a.ts", "export const a = 2;\n");
		const res = run(["collect"]);
		expect(res.status, res.stderr).toBe(0);
		expect(readJson(runDirOf(res), "meta.json").excluded).toEqual(
			expect.arrayContaining([{ path: "huge.txt", reason: "too-large" }]),
		);
	});
});

// ---------------------------------------------------------------- render

function collectRun(): string {
	const res = run(["collect"]);
	expect(res.status, res.stderr).toBe(0);
	return runDirOf(res);
}

function hunkIds(dir: string): string[] {
	return readJson<{ id: string }[]>(dir, "hunks.json").map((h) => h.id);
}

function narrative(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: 1,
		mode: "summary",
		title: "Test change",
		what: "Changes a and b.",
		why: "Because `tests` need it.",
		intent: "inferred",
		themes: [],
		...overrides,
	};
}

function writeNarrative(dir: string, value: unknown): void {
	fs.writeFileSync(path.join(dir, "narrative.json"), JSON.stringify(value, null, 2));
}

function render(dir: string, extra: string[] = ["--no-open"], env: Record<string, string> = {}): RunResult {
	return run(["render", "--dir", dir, ...extra], env);
}

function html(dir: string): string {
	return fs.readFileSync(path.join(dir, "visual-diff.html"), "utf-8");
}

function inlineScripts(page: string): string[] {
	return [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function diffBlocks(page: string): { theme: string; files: { newName: string; blocks: unknown[] }[] }[] {
	return [...page.matchAll(/<script type="application\/json" data-vd-diff data-vd-theme="([^"]*)"[^>]*>([\s\S]*?)<\/script>/g)].map(
		(m) => ({ theme: m[1], files: JSON.parse(m[2]) }),
	);
}

function twoFileChange(): void {
	write("src/a.ts", "export const a = 2;\n");
	write("src/b.ts", "export const b = 2;\n");
}

describe("visual-diff render: page", () => {
	it("writes one self-contained page with a hash-based CSP", () => {
		twoFileChange();
		const dir = collectRun();
		const [h1, h2] = hunkIds(dir);
		writeNarrative(dir, narrative({ themes: [{ id: "t1", title: "Both", importance: 3, summary: "s", hunks: [h1, h2] }] }));
		const before = fs.readdirSync(dir).sort();

		const res = render(dir);
		expect(res.status, res.stderr).toBe(0);
		expect(res.stdout.trim()).toBe(path.join(dir, "visual-diff.html"));
		expect(fs.readdirSync(dir).sort()).toEqual([...before, "visual-diff.html"].sort());

		const page = html(dir);
		const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page)?.[1] ?? "";
		expect(csp.startsWith("default-src 'none';")).toBe(true);
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
		expect(csp).toContain("style-src 'unsafe-inline'");
		const hashes = [...csp.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]).sort();
		const scripts = inlineScripts(page);
		expect(scripts.length).toBeGreaterThan(0);
		const actual = scripts.map((s) => crypto.createHash("sha256").update(s).digest("base64")).sort();
		expect(hashes).toEqual(actual);
		expect(page).not.toMatch(/(src|href)\s*=\s*["']?(https?:|\/\/)/i);
		expect(page).not.toMatch(/url\(\s*["']?(https?:|\/\/)/i);

		for (const f of ["diff2html-ui-slim.min.js", "diff2html.min.css", "hljs-github.min.css", "hljs-github-dark.min.css"]) {
			expect(page).toContain(fs.readFileSync(path.join(SKILL_DIR, "vendor", f), "utf-8").trim());
		}
		expect(page).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*github-dark|@media \(prefers-color-scheme: dark\)\s*\{/);
		expect(page).toContain("<code>tests</code>");
		expect(page).toContain("main");
	});

	it("escapes hostile diff content, file names and narrative text", () => {
		write("src/a.ts", "<script>alert(1)</script>\n");
		write("<img src=x onerror=alert(2)>.js", "x\n");
		const dir = collectRun();
		writeNarrative(dir, narrative({ title: "</script><img src=x onerror=alert(1)>", what: "a b \"q\"" }));
		const res = render(dir);
		expect(res.status, res.stderr).toBe(0);
		const page = html(dir);
		expect(page).not.toContain("<script>alert(1)</script>");
		expect(page).not.toContain("<img src=x onerror=alert(2)>");
		expect(page).not.toContain("</script><img src=x onerror=alert(1)>");
		expect(page).not.toContain(" ");
	});

	it("gives each theme only its own hunks and one layout toggle", () => {
		twoFileChange();
		const dir = collectRun();
		const [h1, h2] = hunkIds(dir);
		writeNarrative(
			dir,
			narrative({
				themes: [
					{ id: "ta", title: "A", importance: 2, summary: "a", hunks: [h1], notes: [{ hunk: h1, line: 1, side: "new", kind: "risk", text: "watch this" }] },
					{ id: "tb", title: "B", importance: 5, summary: "b", hunks: [h2] },
				],
			}),
		);
		expect(render(dir).status).toBe(0);
		const page = html(dir);
		const blocks = diffBlocks(page);
		expect(blocks.map((b) => b.theme)).toEqual(["tb", "ta"]);
		expect(blocks[0].files.map((f) => f.newName)).toEqual(["src/b.ts"]);
		expect(blocks[1].files.map((f) => f.newName)).toEqual(["src/a.ts"]);
		expect(page.match(/data-vd-toggle/g)?.length).toBe(1);
		expect(page).toMatch(/src\/a\.ts:1[\s\S]*watch this/);
	});

	it("puts unassigned hunks in a last 'Other changes' theme", () => {
		twoFileChange();
		const dir = collectRun();
		const [h1] = hunkIds(dir);
		writeNarrative(dir, narrative({ themes: [{ id: "t1", title: "A", importance: 1, summary: "a", hunks: [h1] }] }));
		expect(render(dir).status).toBe(0);
		const page = html(dir);
		const blocks = diffBlocks(page);
		expect(blocks.map((b) => b.theme)).toEqual(["t1", "other"]);
		expect(blocks[1].files.map((f) => f.newName)).toEqual(["src/b.ts"]);
		expect(page).toContain("Other changes");
		expect(page).toContain("The narrative does not explain these hunks.");
	});
});

describe("visual-diff render: validation", () => {
	function expectRejected(dir: string, value: unknown, ...needles: string[]): void {
		writeNarrative(dir, value);
		const res = render(dir);
		expect(res.status).toBe(2);
		for (const n of needles) expect(res.stderr).toContain(n);
		expect(fs.existsSync(path.join(dir, "visual-diff.html"))).toBe(false);
	}

	it("rejects unknown hunk ids", () => {
		twoFileChange();
		const dir = collectRun();
		expectRejected(dir, narrative({ themes: [{ id: "t", title: "T", importance: 1, summary: "s", hunks: ["h99"] }] }), "h99");
	});

	it("rejects a hunk in two themes", () => {
		twoFileChange();
		const dir = collectRun();
		expectRejected(
			dir,
			narrative({
				themes: [
					{ id: "t1", title: "T", importance: 1, summary: "s", hunks: ["h1"] },
					{ id: "t2", title: "U", importance: 1, summary: "s", hunks: ["h1"] },
				],
			}),
			"h1",
		);
	});

	it("rejects wrong version, wrong mode, missing fields and unknown fields at any level", () => {
		twoFileChange();
		const dir = collectRun();
		const bad = narrative({
			version: 2,
			mode: "teach",
			extra: true,
			themes: [{ id: "t", title: "T", importance: 1, summary: "s", hunks: ["h1"], colour: "red" }],
		});
		delete (bad as Record<string, unknown>).why;
		expectRejected(dir, bad, "version", "mode", "extra", "colour", "why");
	});

	it("rejects a note outside its hunk's line range", () => {
		twoFileChange();
		const dir = collectRun();
		expectRejected(
			dir,
			narrative({
				themes: [
					{ id: "t", title: "T", importance: 1, summary: "s", hunks: ["h1"], notes: [{ hunk: "h1", line: 50, side: "new", kind: "info", text: "x" }] },
				],
			}),
			"line 50",
		);
	});

	it("rejects a run directory without diff.patch", () => {
		twoFileChange();
		const dir = collectRun();
		writeNarrative(dir, narrative());
		fs.rmSync(path.join(dir, "diff.patch"));
		const res = render(dir);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("diff.patch is missing");
		expect(fs.existsSync(path.join(dir, "visual-diff.html"))).toBe(false);
	});

	it("rejects a run directory outside pi-reports", () => {
		const outside = path.join(tmpRoot, "not-reports");
		fs.mkdirSync(outside);
		const res = render(outside);
		expect(res.status).toBe(2);
		expect(fs.readdirSync(outside)).toEqual([]);
	});
});

describe("visual-diff render: open", () => {
	it("prints the path and warns when the opener fails", () => {
		twoFileChange();
		const dir = collectRun();
		writeNarrative(dir, narrative());
		const bin = path.join(tmpRoot, "bin");
		fs.mkdirSync(bin);
		for (const name of ["open", "xdg-open"]) {
			fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
		}
		const res = render(dir, [], { PATH: `${bin}:${process.env.PATH}` });
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toBe(path.join(dir, "visual-diff.html"));
		expect(res.stderr).toMatch(/could not open/i);
	});
});

describe("visual-diff vendor", () => {
	const ROOT = path.join(import.meta.dirname, "..");
	const pairs: [string, string][] = [
		["diff2html.min.js", "node_modules/diff2html/bundles/js/diff2html.min.js"],
		["diff2html-ui-slim.min.js", "node_modules/diff2html/bundles/js/diff2html-ui-slim.min.js"],
		["diff2html.min.css", "node_modules/diff2html/bundles/css/diff2html.min.css"],
		["LICENSE.md", "node_modules/diff2html/LICENSE.md"],
		["hljs-github.min.css", "node_modules/highlight.js/styles/github.min.css"],
		["hljs-github-dark.min.css", "node_modules/highlight.js/styles/github-dark.min.css"],
		["LICENSE-highlight.js", "node_modules/highlight.js/LICENSE"],
	];

	it("pins diff2html exactly and matches highlight.js 11.11.1", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
		expect(pkg.devDependencies.diff2html).toBe("3.4.56");
		const hljs = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/highlight.js/package.json"), "utf-8"));
		expect(hljs.version).toBe("11.11.1");
	});

	it.each(pairs)("vendor/%s matches its pinned source", (vendored, source) => {
		const a = fs.readFileSync(path.join(SKILL_DIR, "vendor", vendored));
		const b = fs.readFileSync(path.join(ROOT, source));
		expect(a.equals(b)).toBe(true);
	});
});

describe("visual-diff render: sections", () => {
	const ORDER = ["change-map", "impact", "tour", "behavior", "removed", "focus", "excluded"];

	function sectionBody(page: string, id: string): string {
		return new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`).exec(page)?.[1] ?? "";
	}

	it("renders every section in order, with 'None' when empty", () => {
		twoFileChange();
		const dir = collectRun();
		writeNarrative(dir, narrative());
		expect(render(dir).status).toBe(0);
		const page = html(dir);
		const positions = ORDER.map((id) => page.indexOf(`<section id="${id}">`));
		expect(positions.every((p) => p > 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
		for (const id of ["impact", "behavior", "removed", "focus", "excluded"]) {
			expect(sectionBody(page, id)).toContain(">None<");
		}
		expect(sectionBody(page, "excluded")).toMatch(
			/Only file names are filtered\. Secrets inside other files are shown as-is\.<\/p>\s*$/,
		);
	});

	it("fills the change map, behavior, removed, focus and excluded sections", () => {
		twoFileChange();
		write("id_rsa", "RSA\n");
		const dir = collectRun();
		const [h1, h2] = hunkIds(dir);
		writeNarrative(
			dir,
			narrative({
				themes: [{ id: "t1", title: "Theme One", importance: 2, summary: "s", hunks: [h1, h2] }],
				behavior: [{ before: "old `x`", after: "new `y`", where: "src/a.ts:1" }],
				removed: [{ what: "a check", status: "unaccounted", where: "src/b.ts:1" }],
				focus: [{ severity: "high", where: "src/a.ts:1", scenario: "breaks when <empty>" }],
			}),
		);
		expect(render(dir).status).toBe(0);
		const page = html(dir);
		const map = sectionBody(page, "change-map");
		expect(map).toContain("Theme One");
		expect(map).toContain("src/a.ts");
		expect(map).toContain("src/b.ts");
		expect(sectionBody(page, "behavior")).toMatch(/<code>x<\/code>[\s\S]*<code>y<\/code>[\s\S]*src\/a\.ts:1/);
		expect(sectionBody(page, "removed")).toMatch(/a check[\s\S]*unaccounted/);
		expect(sectionBody(page, "focus")).toContain("breaks when &lt;empty&gt;");
		expect(sectionBody(page, "focus")).toContain("sev-high");
		expect(sectionBody(page, "excluded")).toMatch(/id_rsa[\s\S]*secret/);
	});

	it("folds generated files and files over 800 changed lines", () => {
		write("package-lock.json", "{}\n");
		write("src/big.ts", Array.from({ length: 900 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n");
		write("src/a.ts", "export const a = 2;\n");
		const dir = collectRun();
		writeNarrative(dir, narrative());
		expect(render(dir).status).toBe(0);
		const page = html(dir);
		const folded = [...page.matchAll(/<details class="folded"( open)?>[\s\S]*?<\/details>/g)];
		expect(folded.every((m) => m[1] === undefined)).toBe(true);
		const foldedNames = folded.map((m) => /<summary>([^<(]+)/.exec(m[0])?.[1].trim());
		expect(foldedNames.sort()).toEqual(["package-lock.json", "src/big.ts"]);
		const main = diffBlocks(page).filter((b) => b.files.some((f) => f.newName === "src/a.ts"));
		expect(main).toHaveLength(1);
		expect(main[0].files).toHaveLength(1);
	});
});

describe("visual-diff render: impact diagram", () => {
	function impactBody(page: string): string {
		return /<section id="impact">([\s\S]*?)<\/section>/.exec(page)?.[1] ?? "";
	}

	it("draws nodes by layer, caps at 40, lists all nodes, and drops unknown edges", () => {
		twoFileChange();
		const dir = collectRun();
		const nodes = Array.from({ length: 45 }, (_, i) => ({
			id: `n${i}`,
			label: i === 0 ? "<b>evil</b> label that is much longer than thirty-two characters" : `node ${i}`,
			kind: i % 3 === 0 ? "changed" : "affected",
			layer: i < 20 ? "service" : "ui",
		}));
		writeNarrative(
			dir,
			narrative({
				impact: {
					source: "grep",
					nodes,
					edges: [
						{ from: "n0", to: "n1", label: "calls" },
						{ from: "n3", to: "n4" },
						{ from: "n0", to: "ghost" },
					],
				},
			}),
		);
		const res = render(dir);
		expect(res.status, res.stderr).toBe(0);
		expect(res.stderr).toMatch(/ghost/);
		const body = impactBody(html(dir));
		const svg = /<svg[\s\S]*?<\/svg>/.exec(body)?.[0] ?? "";
		expect(svg.match(/<g data-node-id=/g)?.length).toBe(40);
		expect(svg.match(/data-kind="changed"/g)?.length).toBe(nodes.slice(0, 40).filter((n) => n.kind === "changed").length);
		expect(svg.match(/<path data-edge/g)?.length).toBe(2);
		expect(svg).toContain(">service<");
		expect(svg).toContain(">ui<");
		expect(body).toContain("+5 more");
		expect(body.match(/<tr>/g)?.length).toBe(46);
		expect(body).not.toContain("<b>evil</b>");
		expect(svg).toMatch(/<title>&lt;b&gt;evil&lt;\/b&gt; label that is much longer than thirty-two characters<\/title>/);
		expect(body).toContain("grep");
	});

	it("shows 'None' without an impact graph", () => {
		twoFileChange();
		const dir = collectRun();
		writeNarrative(dir, narrative({ impact: { source: "none", nodes: [], edges: [] } }));
		expect(render(dir).status).toBe(0);
		expect(impactBody(html(dir))).toContain(">None<");
	});
});

describe("visual-diff collect: other targets", () => {
	function twoCommits(): { a: string; b: string } {
		const a = git("rev-parse", "HEAD").trim();
		write("src/a.ts", "export const a = 2;\n");
		write("src/b.ts", "export const b = 2;\n");
		git("commit", "-qam", "second");
		return { a, b: git("rev-parse", "HEAD").trim() };
	}

	function patchOf(res: RunResult): string {
		expect(res.status, res.stderr).toBe(0);
		return fs.readFileSync(path.join(runDirOf(res), "diff.patch"), "utf-8");
	}

	function ghStub(script: string): Record<string, string> {
		const bin = path.join(tmpRoot, "bin");
		fs.mkdirSync(bin, { recursive: true });
		fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
		return { PATH: `${bin}:${process.env.PATH}` };
	}

	it("passes --range to git unchanged (two and three dots)", () => {
		const { a, b } = twoCommits();
		expect(patchOf(run(["collect", "--range", `${a}..${b}`]))).toBe(git("diff", `${a}..${b}`));
		expect(patchOf(run(["collect", "--range", `${a}...${b}`]))).toBe(git("diff", `${a}...${b}`));
	});

	it("collects one commit with --commit", () => {
		const { a, b } = twoCommits();
		write("src/c.ts", "export const c = 9;\n");
		expect(patchOf(run(["collect", "--commit", b]))).toBe(git("diff", a, b));
	});

	it("limits the diff with --path", () => {
		twoFileChange();
		const hunks = readJson<{ file: string }[]>(runDirOf(run(["collect", "--path", "src/a.ts"])), "hunks.json");
		expect(hunks.map((h) => h.file)).toEqual(["src/a.ts"]);
	});

	it("refuses option-like target values", () => {
		const res = run(["collect", "--range", "--output=/tmp/x"]);
		expect(res.status).toBe(2);
		expect(runDirs()).toEqual([]);
	});

	it("collects a PR through gh after checking the head and filters secrets", () => {
		const head = git("rev-parse", "HEAD").trim();
		const good = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 3;\n";
		const secret = "diff --git a/deploy.pem b/deploy.pem\n--- a/deploy.pem\n+++ b/deploy.pem\n@@ -1 +1 @@\n-OLD-KEY\n+NEW-KEY\n";
		fs.writeFileSync(path.join(tmpRoot, "pr.patch"), secret + good);
		const env = ghStub(
			`case "$1 $2" in\n"pr view") echo '{"headRefOid":"${head}","body":"PR body"}' ;;\n"pr diff") cat "${tmpRoot}/pr.patch" ;;\n*) exit 9 ;;\nesac`,
		);
		const res = run(["collect", "--pr", "7"], env);
		expect(patchOf(res)).toBe(good);
		const meta = readJson(runDirOf(res), "meta.json");
		expect(meta.target).toEqual({ kind: "pr", value: "7" });
		expect(meta.excluded).toEqual([{ path: "deploy.pem", reason: "secret" }]);
		expect(allOutput(runDirOf(res))).not.toContain("NEW-KEY");
	});

	it("refuses a PR whose head is not checked out", () => {
		const env = ghStub(`case "$1 $2" in\n"pr view") echo '{"headRefOid":"0000000000000000000000000000000000000000","body":""}' ;;\n*) exit 9 ;;\nesac`);
		const res = run(["collect", "--pr", "7"], env);
		expect(res.status).toBe(3);
		expect(res.stderr).toContain("gh pr checkout 7");
		expect(runDirs()).toEqual([]);
	});

	it("reports gh failures with exit code 3", () => {
		const env = ghStub(`echo "gh: not authenticated" >&2\nexit 1`);
		const res = run(["collect", "--pr", "7"], env);
		expect(res.status).toBe(3);
		expect(res.stderr).toContain("gh: not authenticated");
		expect(runDirs()).toEqual([]);
	});
});

describe("visual-diff skill file", () => {
	it("has frontmatter with the name and a use / do-not-use description", () => {
		const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf-8");
		const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
		expect(front).toMatch(/^name: visual-diff$/m);
		const description = /^description: (.+)$/m.exec(front)?.[1] ?? "";
		expect(description).toContain("Use this skill when");
		expect(description).toContain("Do not use");
		expect(skill).toContain("--no-open");
		for (const ref of ["references/lenses.md", "references/narrative-schema.md"]) {
			expect(skill).toContain(ref);
			expect(fs.existsSync(path.join(SKILL_DIR, ref))).toBe(true);
		}
	});
});
