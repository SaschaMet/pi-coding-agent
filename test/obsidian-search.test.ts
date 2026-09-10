import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(
	import.meta.dirname,
	"..",
	".pi",
	"skills",
	"obsidian-search",
	"scripts",
	"obsidian_search.py",
);

const PYTHON = process.env.PYTHON ?? "python3";

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

function run(args: string[]): RunResult {
	const res = spawnSync(PYTHON, [SCRIPT, ...args], { encoding: "utf-8" });
	if (res.error) {
		throw new Error(`failed to start ${PYTHON}: ${res.error.message}`);
	}
	return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function runJson(args: string[]): Record<string, unknown> {
	const res = run(["--json", ...args]);
	const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
	return { ...parsed, __status: res.status, __stderr: res.stderr };
}

function makeVault(root: string): string {
	const vault = path.join(root, "vault");
	fs.mkdirSync(path.join(vault, "Business"), { recursive: true });
	fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
	fs.mkdirSync(path.join(vault, "_attachments"), { recursive: true });
	fs.mkdirSync(path.join(vault, "node_modules", "pkg"), { recursive: true });
	fs.writeFileSync(
		path.join(vault, "Note One.md"),
		"The quick brown fox jumps over the lazy dog. Fuzzy matching works well here.",
	);
	fs.writeFileSync(
		path.join(vault, "Business", "Plan.md"),
		"Quarterly planning for the growth team. Budget review and forecasting.",
	);
	fs.writeFileSync(
		path.join(vault, "German Notes.md"),
		"Die Strategie für das Quartal. Budget und Planung.",
	);
	fs.writeFileSync(path.join(vault, "Repeat.md"), "delta delta delta");
	fs.writeFileSync(
		path.join(vault, "Target Early.md"),
		`targetword ${"x".repeat(1200)}`,
	);
	fs.writeFileSync(
		path.join(vault, "Target Late.md"),
		`${"x".repeat(1200)} targetword`,
	);
	fs.writeFileSync(
		path.join(vault, ".obsidian", "config.md"),
		"obsidianconfig should never match",
	);
	fs.writeFileSync(
		path.join(vault, "_attachments", "a.md"),
		"attachmentword should never match",
	);
	fs.writeFileSync(
		path.join(vault, "node_modules", "pkg", "readme.md"),
		"nodemodword should never match",
	);
	return vault;
}

describe("obsidian-search script", () => {
	const tmpRoots: string[] = [];

	afterEach(() => {
		for (const root of tmpRoots) {
			fs.rmSync(root, { recursive: true, force: true });
		}
		tmpRoots.length = 0;
	});

	function tmpVault(): string {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		return makeVault(root);
	}

	it("finds an exact keyword match with score 125 (100 + exact 20 + early 5)", () => {
		const vault = tmpVault();
		const res = run(["--vault", vault, "--keywords", "fuzzy"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain("Note One.md");
		expect(res.stdout).toContain("score 125.0");
		expect(res.stdout).toContain('keyword "fuzzy"');
		expect(res.stdout).toContain(
			"obsidian://open?vault=Documents&file=Note%20One",
		);

		const json = runJson(["--vault", vault, "--keywords", "fuzzy"]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].score).toBe(125);
		expect(matches[0].similarity).toBe(100);
		expect(matches[0].path).toBe("Note One.md");
		expect(matches[0].matched_word).toBe("fuzzy");
		expect(matches[0].obsidian_link).toBe(
			"obsidian://open?vault=Documents&file=Note%20One",
		);
	});

	it("matches multi-word phrases with score 125", () => {
		const vault = tmpVault();
		const json = runJson(["--vault", vault, "--keywords", "brown fox"]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].score).toBe(125);
		expect(matches[0].matched_word).toBe("brown fox");
		expect(matches[0].path).toBe("Note One.md");
	});

	it("matches keywords found in the file path with score 130", () => {
		const vault = tmpVault();
		const json = runJson(["--vault", vault, "--keywords", "business"]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].score).toBe(130);
		expect(matches[0].path).toBe("Business/Plan.md");
		expect(matches[0].matched_word).toBe("Business/Plan.md");
	});

	it("fuzzy-matches near words above the default threshold 80", () => {
		const vault = tmpVault();
		const json = runJson(["--vault", vault, "--keywords", "fuzzzy"]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].similarity).toBeCloseTo(90.9, 1);
		expect(matches[0].score).toBeCloseTo(95.9, 1);
		expect(matches[0].matched_word).toBe("fuzzy");
	});

	it("uses rapidfuzz indel semantics: a substitution costs 2", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		const vault = path.join(root, "vault");
		fs.mkdirSync(vault);
		fs.writeFileSync(path.join(vault, "German.md"), "dein platz");

		// mein vs dein: indel 2, ratio 1 - 2/8 = 75.0
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"mein",
			"--threshold",
			"70",
		]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].similarity).toBe(75);
		expect(matches[0].matched_word).toBe("dein");

		// plane vs platz: indel 4, ratio 1 - 4/10 = 60.0
		const json2 = runJson([
			"--vault",
			vault,
			"--keywords",
			"plane",
			"--threshold",
			"50",
		]);
		const matches2 = json2.matches as Array<Record<string, unknown>>;
		expect(matches2).toHaveLength(1);
		expect(matches2[0].similarity).toBe(60);
		expect(matches2[0].matched_word).toBe("platz");

		// at the default threshold 80 neither pair qualifies
		const res = run(["--vault", vault, "--keywords", "mein,plane"]);
		expect(res.status).toBe(1);
	});

	it("keeps pairs scoring exactly the threshold (integer arithmetic)", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		const vault = path.join(root, "vault");
		fs.mkdirSync(vault);
		fs.writeFileSync(path.join(vault, "Exact.md"), "abcdef");

		// abcd vs abcdef: indel 2, ratio 1 - 2/10 = 80.0 == default threshold
		const json = runJson(["--vault", vault, "--keywords", "abcd"]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].similarity).toBe(80);
	});

	it("returns no matches above a raised threshold and exits 1", () => {
		const vault = tmpVault();
		const res = run([
			"--vault",
			vault,
			"--keywords",
			"fuzzzy",
			"--threshold",
			"95",
		]);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain("No matches");
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"fuzzzy",
			"--threshold",
			"95",
		]);
		expect(json.__status).toBe(1);
		expect(json.total_matches).toBe(0);
	});

	it("exits 1 with a stderr diagnostic when nothing matches", () => {
		const vault = tmpVault();
		const res = run(["--vault", vault, "--keywords", "zzqqxx"]);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain("No matches");
	});

	it("exits 2 when the vault does not exist", () => {
		const res = run([
			"--vault",
			"/nonexistent-obsidian-vault-xyz",
			"--keywords",
			"a",
		]);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("Vault not found");
	});

	it("exits 2 when the vault has no markdown files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		const res = run(["--vault", root, "--keywords", "alpha"]);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("No markdown files");
	});

	it("exits 3 on invalid input with actionable messages", () => {
		const vault = tmpVault();
		const badSort = run(["--vault", vault, "--keywords", "a", "--sort", "bogus"]);
		expect(badSort.status).toBe(3);
		expect(badSort.stderr).toContain("score");
		expect(badSort.stderr).toContain("similarity");

		const badThreshold = run([
			"--vault",
			vault,
			"--keywords",
			"a",
			"--threshold",
			"150",
		]);
		expect(badThreshold.status).toBe(3);

		const badMax = run([
			"--vault",
			vault,
			"--keywords",
			"a",
			"--max-results",
			"0",
		]);
		expect(badMax.status).toBe(3);

		const noInput = run(["--vault", vault]);
		expect(noInput.status).toBe(3);
		expect(noInput.stderr).toContain("--query");
		expect(noInput.stderr).toContain("--keywords");
	});

	it("--help exits 0 and documents the flags", () => {
		const res = run(["--help"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain("--keywords");
		expect(res.stdout).toContain("--vault");
		expect(res.stdout).toContain("--json");
	});

	it("dedupes matches that share the same context window", () => {
		const vault = tmpVault();
		const json = runJson(["--vault", vault, "--keywords", "delta"]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].path).toBe("Repeat.md");
		expect(matches[0].context).toBe("delta delta delta");
	});

	it("sorts by file name when requested", () => {
		const vault = tmpVault();
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"budget",
			"--sort",
			"file_name",
		]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches.map((m) => m.file)).toEqual(["German Notes.md", "Plan.md"]);
	});

	it("sorts by position within path when requested", () => {
		const vault = tmpVault();
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"targetword",
			"--sort",
			"position",
		]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches.map((m) => m.path)).toEqual([
			"Target Early.md",
			"Target Late.md",
		]);
		expect(matches[0].position).toBe(0);
		expect(matches[1].position).toBe(1201);
	});

	it("sorts by similarity descending when requested", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		const vault = path.join(root, "vault");
		fs.mkdirSync(vault);
		fs.writeFileSync(path.join(vault, "Alpha.md"), "fuzzy");
		fs.writeFileSync(path.join(vault, "Beta.md"), "fuzzzy");
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"fuzzy",
			"--sort",
			"similarity",
		]);
		const sims = (json.matches as Array<Record<string, unknown>>).map(
			(m) => m.similarity as number,
		);
		expect(sims).toHaveLength(2);
		expect(sims).toEqual([100, 90.9]);
	});

	it("sorts by matches per file when requested", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		const vault = path.join(root, "vault");
		fs.mkdirSync(vault);
		fs.writeFileSync(path.join(vault, "Single.md"), "budget review");
		fs.writeFileSync(
			path.join(vault, "Twice.md"),
			`budget ${"y ".repeat(50)}budget`,
		);
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"budget",
			"--context",
			"50",
			"--sort",
			"matches_count",
		]);
		const paths = (json.matches as Array<Record<string, unknown>>).map(
			(m) => m.path,
		);
		expect(paths[0]).toBe("Twice.md");
		expect(paths).toHaveLength(3);
	});

	it("honors --max-results as a hard bound", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		const vault = path.join(root, "vault");
		fs.mkdirSync(vault);
		for (const name of ["a", "b", "c", "d", "e"]) {
			fs.writeFileSync(
				path.join(vault, `${name}.md`),
				`the commonword lives here`,
			);
		}
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"commonword",
			"--max-results",
			"2",
		]);
		expect(json.total_matches).toBe(5);
		expect(json.shown).toBe(2);
		expect(json.matches).toHaveLength(2);
	});

	it("extracts keywords from --query alone, dropping English stopwords", () => {
		const vault = tmpVault();
		const res = run(["--vault", vault, "--query", "the quick brown fox"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain("Note One.md");
	});

	it("extracts keywords from German queries, dropping German stopwords", () => {
		const vault = tmpVault();
		const res = run([
			"--vault",
			vault,
			"--query",
			"die strategie für das quartalsbudget",
		]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain("German Notes.md");
	});

	it("prefers explicit --keywords over --query", () => {
		const vault = tmpVault();
		const res = run([
			"--vault",
			vault,
			"--query",
			"zzqqxx",
			"--keywords",
			"fuzzy",
		]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain("Note One.md");
	});

	it("exits 3 when --query yields no usable keywords", () => {
		const vault = tmpVault();
		const res = run(["--vault", vault, "--query", "the and of"]);
		expect(res.status).toBe(3);
		expect(res.stderr).toContain("--keywords");
	});

	it("ignores .obsidian, _attachments, and node_modules directories", () => {
		const vault = tmpVault();
		for (const kw of ["obsidianconfig", "attachmentword", "nodemodword"]) {
			const res = run(["--vault", vault, "--keywords", kw]);
			expect(res.status, kw).toBe(1);
		}
	});

	it("returns only the matched word as context with --context 0", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-search-"));
		tmpRoots.push(root);
		const vault = path.join(root, "vault");
		fs.mkdirSync(vault);
		fs.writeFileSync(path.join(vault, "Solo.md"), "targetword");
		const json = runJson([
			"--vault",
			vault,
			"--keywords",
			"targetword",
			"--context",
			"0",
		]);
		const matches = json.matches as Array<Record<string, unknown>>;
		expect(matches).toHaveLength(1);
		expect(matches[0].context).toBe("targetword");
	});

	it("adds the early-position bonus only for matches before char 1000", () => {
		const vault = tmpVault();
		const json = runJson(["--vault", vault, "--keywords", "targetword"]);
		const byPath = Object.fromEntries(
			(json.matches as Array<Record<string, unknown>>).map((m) => [
				m.path,
				m.score,
			]),
		);
		expect(byPath["Target Early.md"]).toBe(125);
		expect(byPath["Target Late.md"]).toBe(120);
	});

	it("emits a bounded, deterministic report header in markdown mode", () => {
		const vault = tmpVault();
		const res = run([
			"--vault",
			vault,
			"--keywords",
			"budget",
			"--max-results",
			"10",
		]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain("Vault:");
		expect(res.stdout).toContain("Keywords: budget");
		expect(res.stdout).toContain("Matches: 2 (showing top 2)");
	});
});
