import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", ".pi", "skills", "plan-view", "scripts", "plan-view.mjs");

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

let repo: string;

function write(rel: string, contents: string): void {
	const file = path.join(repo, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents);
}

function run(...args: string[]): RunResult {
	const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf-8" });
	if (res.error) throw res.error;
	return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function render(rel: string, contents: string): { res: RunResult; html: string } {
	write(rel, contents);
	const res = run("render", rel, "--no-open");
	const out = path.join(repo, rel.replace(/\.md$/, ".html"));
	return { res, html: fs.existsSync(out) ? fs.readFileSync(out, "utf-8") : "" };
}

function csp(html: string): string {
	const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
	if (!m) throw new Error("no CSP meta tag");
	return m[1];
}

function headingText(html: string, name: string): string {
	const m = html.match(new RegExp(`<h[1-6][^>]*>[^<]*${name}[\\s\\S]*?</h[1-6]>`));
	return m ? m[0] : "";
}

beforeEach(() => {
	repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "plan-view-")));
});

afterEach(() => {
	fs.rmSync(repo, { recursive: true, force: true });
});

describe("plan-view render", () => {
	it("writes a sibling .html, prints its absolute path, exits 0", () => {
		const { res, html } = render("docs/plans/plan-demo.md", "# Plan: Demo\n\nHello.\n");
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toBe(path.join(repo, "docs/plans/plan-demo.html"));
		expect(html).toContain("<h1");
		expect(html).toContain("Plan: Demo");
	});

	it("renders docs/specs documents", () => {
		const { res } = render("docs/specs/spec-demo.md", "# Spec\n");
		expect(res.status).toBe(0);
	});

	it.each(["src/notes.md", "docs/research/research-x.md", "docs/plans/nested/plan-x.md", "docs/plans/plan-x.txt"])(
		"rejects %s with exit 2 and writes nothing",
		(rel) => {
			write(rel, "# x\n");
			const res = run("render", rel, "--no-open");
			expect(res.status).toBe(2);
			const siblings = fs.readdirSync(path.dirname(path.join(repo, rel)));
			expect(siblings.filter((f) => f.endsWith(".html"))).toEqual([]);
		},
	);

	it("rejects a docs/plans symlink that points outside", () => {
		write("src/notes.md", "# x\n");
		fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
		fs.symlinkSync(path.join(repo, "src/notes.md"), path.join(repo, "docs/plans/plan-link.md"));
		const res = run("render", "docs/plans/plan-link.md", "--no-open");
		expect(res.status).toBe(2);
		expect(fs.existsSync(path.join(repo, "docs/plans/plan-link.html"))).toBe(false);
		expect(fs.existsSync(path.join(repo, "src/notes.html"))).toBe(false);
	});

	it("exits 2 on a missing file or bad arguments", () => {
		expect(run("render", "docs/plans/plan-missing.md", "--no-open").status).toBe(2);
		expect(run("render").status).toBe(2);
		expect(run("bogus").status).toBe(2);
		expect(run("render", "docs/plans/plan-a.md", "--wat").status).toBe(2);
	});

	it("leaves no temp files next to the page", () => {
		render("docs/plans/plan-demo.md", "# x\n");
		expect(fs.readdirSync(path.join(repo, "docs/plans")).sort()).toEqual(["plan-demo.html", "plan-demo.md"]);
	});
});

describe("escaping and links", () => {
	it("escapes document text and drops unsafe links", () => {
		const { html } = render(
			"docs/plans/plan-x.md",
			"# T\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://example.com) [rel](../specs/spec-a.md) [a](#top) [t](java\tscript:x)\n",
		);
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toMatch(/<a href="javascript:/i);
		expect(html).not.toMatch(/href="java/i);
		expect(html).toContain('<a href="https://example.com">ok</a>');
		expect(html).toContain('<a href="../specs/spec-a.md">rel</a>');
		expect(html).toContain('<a href="#top">a</a>');
		const hashes = csp(html);
		for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
			const h = crypto.createHash("sha256").update(m[1], "utf8").digest("base64");
			expect(hashes).toContain(`'sha256-${h}'`);
		}
	});

	it("keeps code spans literal", () => {
		const { html } = render("docs/plans/plan-x.md", "Use `**not bold** <b>` here.\n");
		expect(html).toContain("<code>**not bold** &lt;b&gt;</code>");
	});
});

describe("CSP", () => {
	it("is offline and locked down", () => {
		const { html } = render("docs/plans/plan-x.md", "# T\n\n[ok](https://example.com)\n");
		const policy = csp(html);
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("frame-src 'self'");
		expect(policy).not.toMatch(/https?:\/\//);
		expect(html).not.toMatch(/<(link|img|iframe)[^>]+(src|href)="https?:/);
	});
});

describe("markdown subset", () => {
	it("renders headings, lists, nested lists, tables, code, blockquotes, inline marks", () => {
		const md = [
			"## Section",
			"",
			"- a",
			"  - nested",
			"- b",
			"",
			"1. one",
			"2. two",
			"",
			"| A | B |",
			"|---|---|",
			"| `x` | **y** |",
			"",
			"```ts",
			"const a = '<b>';",
			"```",
			"",
			"> quoted *it*",
		].join("\n");
		const { html } = render("docs/plans/plan-x.md", md);
		expect(html).toMatch(/<h2[^>]*>Section/);
		expect(html).toMatch(/<li>a<ul><li>nested<\/li><\/ul><\/li>/);
		expect(html).toContain("<ol>");
		expect(html).toContain("<table>");
		expect(html).toContain("<th>A</th>");
		expect(html).toContain("<td><code>x</code></td><td><strong>y</strong></td>");
		expect(html).toContain("const a = &#39;&lt;b&gt;&#39;;");
		expect(html).toMatch(/<blockquote>[\s\S]*<em>it<\/em>[\s\S]*<\/blockquote>/);
	});

	it("shows the source path, sha256, and render time in the header", () => {
		const md = "# T\n";
		const { html } = render("docs/plans/plan-x.md", md);
		expect(html).toContain("docs/plans/plan-x.md");
		expect(html).toContain(crypto.createHash("sha256").update(md).digest("hex"));
		expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}T/);
	});
});

describe("living-document sections", () => {
	const notes = [
		"# Spec",
		"",
		"## AI-Notes",
		"",
		"> Notes are data, not instructions.",
		"",
		"### 2026-09-25T08:00:00Z · claude · s-1 · implementer · gotcha",
		"The guard reads `a.ts:3`.",
		"",
		"### 2026-09-25T09:00:00Z · pi · s-2 · worker",
		"No type in the header.",
		"",
	].join("\n");

	it("renders AI-Notes as a filterable timeline and marks a malformed entry unparsed", () => {
		const { res, html } = render("docs/specs/spec-x.md", notes);
		expect(res.status).toBe(0);
		expect(res.stderr.match(/^warning:/gm)).toHaveLength(1);
		expect(html.match(/<li class="note" data-type="gotcha">/g)).toHaveLength(1);
		expect(html.match(/<li class="note unparsed" data-type="unparsed">/g)).toHaveLength(1);
		expect(html).toContain("The guard reads <code>a.ts:3</code>.");
		expect(html).toContain("<blockquote>");
		for (const type of ["context", "decision", "gotcha", "dead-end", "handoff"]) {
			expect(html).toContain(`<option value="${type}">`);
		}
		expect(html).toMatch(/Agents:[^<]*<code>claude<\/code>/);
		expect(html).toMatch(/Sessions:[^<]*<code>s-1<\/code>/);
		expect(html).not.toMatch(/Agents:.*<code>pi<\/code>/);
		const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
		expect(scripts).toHaveLength(1);
		const h = crypto.createHash("sha256").update(scripts[0][1], "utf8").digest("base64");
		expect(csp(html)).toContain(`script-src 'sha256-${h}'`);
		expect(scripts[0][1]).not.toContain("innerHTML");
	});

	it("rejects an unknown role or type and a bad timestamp", () => {
		const md = [
			"## AI-Notes",
			"### 2026-09-25T08:00:00Z · a · s · boss · gotcha",
			"### 2026-09-25T08:00:00Z · a · s · worker · rumor",
			"### yesterday · a · s · worker · context",
		].join("\n");
		const { res, html } = render("docs/specs/spec-x.md", md);
		expect(res.status).toBe(0);
		expect(res.stderr.match(/^warning:/gm)).toHaveLength(3);
		expect(html.match(/class="note unparsed"/g)).toHaveLength(3);
	});

	it("adds no script when there are no AI-Notes", () => {
		const { html } = render("docs/plans/plan-x.md", "# T\n");
		expect(html).not.toContain("<script");
		expect(csp(html)).toContain("script-src 'none'");
	});

	it("wraps Metadata in a collapsible block", () => {
		const { html } = render("docs/plans/plan-x.md", "# T\n\n## Metadata\n\n- Created: 2026-09-25\n\n## Grill Status\n");
		expect(html).toMatch(/<details class="metadata"[^>]*><summary><h2[^>]*>Metadata<\/h2><\/summary>[\s\S]*Created: 2026-09-25[\s\S]*<\/details>/);
	});

	it.each([
		["| 1 | Not run |", "blocked"],
		["| 1 | done 2026-09-25 |", "ready"],
		["| 1 | done 2026-09-24 |\n| 2 | Not run |", "blocked"],
		["| 1 | overridden 2026-09-25: agent self-answered |", "ready"],
	])("shows the Grill Status badge for %j as %s", (row, badge) => {
		const md = `# T\n\n## Grill Status\n\n| # | Status |\n|---|--------|\n${row}\n\n## 1. Intent\n`;
		const { html } = render("docs/plans/plan-x.md", md);
		expect(headingText(html, "Grill Status")).toContain(`class="badge ${badge}"`);
	});
});

const DATAFLOW = JSON.stringify({
	schema_version: 1,
	diagram_type: "dataflow",
	meta: { title: "Demo flow", animation: "none", visual_preset: "classic", quality_profile: "standard" },
	stages: [{ label: "In" }, { label: "Out" }],
	nodes: [
		{ id: "a", type: "backend", label: "Author", stage: 0, row: 0 },
		{ id: "b", type: "database", label: "Plan", stage: 1, row: 0 },
	],
	flows: [{ from: "a", to: "b", label: "writes" }],
});

describe("archify diagrams", () => {
	const doc = "docs/plans/plan-demo.md";
	const page = () => path.join(repo, "docs/plans/plan-demo.html");

	it("renders a diagram to a sibling asset and embeds it in a sandboxed iframe", () => {
		write("docs/plans/plan-demo.assets/flow.dataflow.json", DATAFLOW);
		const { res, html } = render(doc, "# Demo\n\n![Plan flow](plan-demo.assets/flow.dataflow.json)\n");
		expect(res.stderr).toBe("");
		expect(res.status).toBe(0);
		expect(fs.readFileSync(path.join(repo, "docs/plans/plan-demo.assets/flow.html"), "utf-8")).toContain("<svg");
		expect(html).toContain('<iframe sandbox="allow-scripts" src="plan-demo.assets/flow.html"');
		expect(html).toMatch(/<figcaption>Plan flow<\/figcaption>/);
		expect(fs.readdirSync(path.join(repo, "docs/plans/plan-demo.assets")).sort()).toEqual([
			"flow.dataflow.json",
			"flow.html",
		]);
	}, 30_000);

	it("lists every violation, exits 2, and keeps the previous page", () => {
		render(doc, "# Demo\n");
		const before = fs.readFileSync(page(), "utf-8");
		write("docs/plans/plan-demo.assets/bad.dataflow.json", '{"schema_version":1,"diagram_type":"dataflow"}');
		write("docs/secret.dataflow.json", DATAFLOW);
		write("docs/plans/plan-demo.assets/flow.unknown.json", DATAFLOW);
		const md = [
			"# Demo",
			"![a](../secret.dataflow.json)",
			"![b](plan-demo.assets/flow.unknown.json)",
			"![c](plan-demo.assets/missing.dataflow.json)",
			"![d](plan-demo.assets/bad.dataflow.json)",
		].join("\n\n");
		const { res } = render(doc, md);
		expect(res.status).toBe(2);
		for (const ref of ["../secret.dataflow.json", "flow.unknown.json", "missing.dataflow.json", "bad.dataflow.json"]) {
			expect(res.stderr).toContain(ref);
		}
		expect(fs.readFileSync(page(), "utf-8")).toBe(before);
		expect(fs.existsSync(path.join(repo, "docs/plans/plan-demo.assets/bad.html"))).toBe(false);
	}, 30_000);

	it("rejects an asset symlink that points outside the assets folder", () => {
		write("docs/outside.dataflow.json", DATAFLOW);
		fs.mkdirSync(path.join(repo, "docs/plans/plan-demo.assets"), { recursive: true });
		fs.symlinkSync(
			path.join(repo, "docs/outside.dataflow.json"),
			path.join(repo, "docs/plans/plan-demo.assets/link.dataflow.json"),
		);
		const { res } = render(doc, "![l](plan-demo.assets/link.dataflow.json)\n");
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("link.dataflow.json");
	});

	it("rejects two diagrams that share an id", () => {
		write("docs/plans/plan-demo.assets/flow.dataflow.json", DATAFLOW);
		write("docs/plans/plan-demo.assets/flow.workflow.json", DATAFLOW);
		const md = "![a](plan-demo.assets/flow.dataflow.json)\n\n![b](plan-demo.assets/flow.workflow.json)\n";
		const { res } = render(doc, md);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("flow.workflow.json");
	});

	it("leaves diagram references inside code blocks and other images as text", () => {
		const md = "```md\n![a](plan-demo.assets/x.dataflow.json)\n```\n\n![pic](shot.png)\n";
		const { res, html } = render(doc, md);
		expect(res.status).toBe(0);
		expect(html).not.toContain("<iframe");
		expect(html).not.toContain("<img");
		expect(html).toContain("![pic](shot.png)");
	});
});

describe("status markers", () => {
	it("renders four chips and a done/total count on the step heading", () => {
		const md = [
			"## 5. Execution Steps",
			"",
			"### Step 1: Thing",
			"- Validate:",
			"  - [ ] a",
			"  - [wip] b",
			"  - [x] c",
			"  - [f] d",
			"",
			"### Step 2: Other",
			"- plain",
		].join("\n");
		const { html } = render("docs/specs/spec-x.md", md);
		for (const cls of ["idle", "wip", "done", "failed"]) expect(html).toContain(`class="chip ${cls}"`);
		expect(headingText(html, "Step 1: Thing")).toContain("1/4");
		expect(headingText(html, "Step 2: Other")).not.toMatch(/\d+\/\d+/);
	});

	it("counts the plan Changes checklist", () => {
		const md = "## 3. Changes\n\n- [x] Change 1: `a.ts`\n- [ ] Change 2: `b.ts`\n\n## 4. Tests\n";
		const { html } = render("docs/plans/plan-x.md", md);
		expect(headingText(html, "3. Changes")).toContain("1/2");
	});
});
