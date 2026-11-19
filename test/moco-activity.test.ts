import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run, type Deps } from "../.pi/skill-library/moco-timesheet/scripts/moco.ts";

// Day arithmetic is local-time by contract; pin the zone so results never depend on the machine.
process.env.TZ = "Europe/Berlin";

const HOME = "/h";
const CONFIG_PATH = `${HOME}/.config/moco/projects.json`;
const MEETINGS_PATH = "/m/meetings.json";
const OUT = "/o/moco";
const D = "2026-11-10";

// Text that must never leave the script.
const PROMPT = "SECRET-PROMPT-TEXT";
const RECAP = "SECRET-RECAP-TEXT";
const OTHER_CUSTOM = "SECRET-OTHER-CUSTOM-TEXT";

const PROJECTS = [
	{
		id: 100,
		identifier: "P001",
		name: "Website Relaunch",
		active: true,
		billable: true,
		customer: { id: 1, name: "Acme" },
		tasks: [
			{ id: 1001, name: "Development", active: true, billable: true },
			{ id: 1002, name: "Meetings", active: true, billable: false },
		],
	},
	{
		id: 200,
		identifier: "P002",
		name: "Website Support",
		active: true,
		billable: false,
		customer: { id: 2, name: "Beta" },
		tasks: [{ id: 2001, name: "Support", active: true, billable: false }],
	},
];

const CONFIG = {
	gitEmails: ["me@example.com"],
	projects: [
		{ project: "Website Relaunch", task: "Development", folders: ["~/work/relaunch"], keywords: ["Relaunch"] },
		{ project: "Website Support", task: "Support", folders: ["~/work/support"] },
	],
};

const A = `${HOME}/work/relaunch`;
const B = `${HOME}/work/support`;
const UNMAPPED = `${HOME}/private/other`;
const UNMAPPED2 = `${HOME}/private/other2`;

const at = (hm: string, day = D) => `${day} ${hm}`;
const iso = (stamp: string) => new Date(`${stamp.replace(" ", "T")}:00`).toISOString();
const localMs = (stamp: string) => new Date(`${stamp.replace(" ", "T")}:00`).getTime();

type PiEv = string | { at: string; role: "user" | "assistant" };

function piSession(cwd: string, evs: PiEv[], opts: { title?: string; recapAt?: string; titleAt?: string; parent?: boolean; extra?: string[] } = {}): string {
	const lines: unknown[] = [
		{ type: "session", version: 3, id: "s", timestamp: iso(typeof evs[0] === "string" ? evs[0] : evs[0].at), cwd, ...(opts.parent ? { parentSession: "/h/.pi/agent/sessions/x/parent.jsonl" } : {}) },
	];
	for (const ev of evs) {
		const e = typeof ev === "string" ? { at: ev, role: "user" as const } : ev;
		lines.push({ type: "message", timestamp: iso(e.at), message: { role: e.role, content: [{ type: "text", text: e.role === "user" ? PROMPT : "assistant text" }] } });
	}
	if (opts.title !== undefined) {
		lines.push({ type: "custom", customType: "title", timestamp: iso(opts.titleAt ?? (typeof evs[0] === "string" ? evs[0] : evs[0].at)), data: { content: opts.title } });
	}
	if (opts.recapAt) lines.push({ type: "custom", customType: "recap", timestamp: iso(opts.recapAt), data: { content: RECAP } });
	for (const stamp of opts.extra ?? []) lines.push({ type: "custom", customType: "other", timestamp: iso(stamp), data: { content: OTHER_CUSTOM } });
	return lines.map((l) => JSON.stringify(l)).join("\n");
}

type ClaudeKind = "prompt" | "assistant" | "tool" | "meta" | "side";
type ClaudeEv = string | { at: string; kind: ClaudeKind };

function claudeSession(cwd: string, evs: ClaudeEv[], opts: { title?: string; noise?: string[] } = {}): string {
	const lines: unknown[] = [];
	for (const ev of evs) {
		const e = typeof ev === "string" ? { at: ev, kind: "prompt" as const } : ev;
		const user = e.kind !== "assistant";
		lines.push({
			type: user ? "user" : "assistant",
			cwd,
			sessionId: "c1",
			timestamp: iso(e.at),
			...(e.kind === "tool" ? { toolUseResult: { stdout: "x" } } : {}),
			...(e.kind === "meta" ? { isMeta: true } : {}),
			...(e.kind === "side" ? { isSidechain: true } : {}),
			message: { role: user ? "user" : "assistant", content: user ? PROMPT : "assistant text" },
		});
	}
	// Title lines carry no cwd and no timestamp in real logs.
	if (opts.title !== undefined) lines.push({ type: "ai-title", aiTitle: opts.title, sessionId: "c1" });
	for (const stamp of opts.noise ?? []) lines.push({ type: "system", cwd, sessionId: "c1", timestamp: iso(stamp) });
	return lines.map((l) => JSON.stringify(l)).join("\n");
}

interface SessionFile {
	path: string;
	text: string;
	mtimeMs?: number;
}

const pi = (name: string, text: string, mtimeMs?: number): SessionFile => ({ path: `${HOME}/.pi/agent/sessions/--x--/${name}.jsonl`, text, mtimeMs });
const claude = (name: string, text: string, mtimeMs?: number, folder = "-h-work"): SessionFile => ({
	path: `${HOME}/.claude/projects/${folder}/${name}.jsonl`,
	text,
	mtimeMs,
});

const FRESH_MTIME = localMs("2026-11-19 12:00");

interface GitCommit {
	repo: string;
	email: string;
	// One full `%aI<TAB>%s` output line; built with commitLine() or hand-written to be malformed.
	line: string;
}

// Berlin is UTC+1 in November, so this is the same instant as at(hm).
const commitLine = (hm: string, subject: string, day = D) => `${day}T${hm}:00+01:00\t${subject}`;

function setup(opts: { config?: unknown; rawConfig?: string; sessions?: SessionFile[]; repos?: string[]; commits?: GitCommit[]; meetings?: unknown; existing?: MocoEntry[]; files?: Record<string, string>; secrets?: Record<string, string | undefined>; now?: string } = {}) {
	const gitCalls: { repo: string; args: string[] }[] = [];
	const repoCalls: { dir: string; depth: number }[] = [];
	const out: string[] = [];
	const err: string[] = [];
	const calls: { method: string; path: string; params: URLSearchParams }[] = [];
	const reads: string[] = [];
	const writes: { path: string; text: string }[] = [];
	const files = new Map<string, string>();
	const meta = new Map<string, number>();
	for (const [path, text] of Object.entries(opts.files ?? {})) files.set(path, text);
	if (opts.meetings !== undefined) files.set(MEETINGS_PATH, typeof opts.meetings === "string" ? opts.meetings : JSON.stringify(opts.meetings));
	if (opts.rawConfig !== undefined) files.set(CONFIG_PATH, opts.rawConfig);
	else if (opts.config !== null) files.set(CONFIG_PATH, JSON.stringify(opts.config ?? CONFIG));
	for (const s of opts.sessions ?? []) {
		files.set(s.path, s.text);
		meta.set(s.path, s.mtimeMs ?? FRESH_MTIME);
	}
	const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
	const deps: Deps = {
		fetch: async (input, init = {}) => {
			const url = new URL(String(input));
			calls.push({ method: init.method ?? "GET", path: url.pathname, params: url.searchParams });
			if (url.pathname === "/api/v1/profile") return json({ id: 42 });
			if (url.pathname === "/api/v1/projects/assigned") return json(PROJECTS);
			if (url.pathname === "/api/v1/activities") {
				// Like MOCO: only entries inside the asked range.
				const [lo, hi] = [url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "￿"];
				return json((opts.existing ?? []).filter((a) => a.date >= lo && a.date <= hi));
			}
			return new Response("{}", { status: 404 });
		},
		readSecret: async (service) => ({ "moco-api": "k3y-s3cret-value", "moco-domain": "acme", ...opts.secrets })[service],
		readFile: async (path) => {
			reads.push(path);
			const text = files.get(path);
			if (text === undefined) throw new Error(`ENOENT: ${path}`);
			return text;
		},
		exists: async (path) => files.has(path),
		writeFile: async (path, text) => {
			if (files.has(path)) throw new Error(`EEXIST: ${path}`);
			writes.push({ path, text });
			files.set(path, text);
		},
		listFiles: async (dir, ext) =>
			[...meta].filter(([p]) => p.startsWith(`${dir}/`) && p.endsWith(ext)).map(([path, mtimeMs]) => ({ path, mtimeMs })),
		findRepos: async (dir, depth) => {
			repoCalls.push({ dir, depth });
			return (opts.repos ?? []).filter((r) => r === dir || r.startsWith(`${dir}/`));
		},
		// Like real git, answer only for the --author address asked about.
		git: async (repo, args) => {
			gitCalls.push({ repo, args });
			const author = args.find((a) => a.startsWith("--author="))?.slice("--author=".length);
			return (opts.commits ?? [])
				.filter((c) => c.repo === repo && c.email === author)
				.map((c) => `${c.line}\n`)
				.join("");
		},
		home: HOME,
		now: () => new Date(localMs(opts.now ?? "2026-11-19 12:00")),
		out: (text) => out.push(text),
		err: (text) => err.push(text),
	};
	const t = {
		deps,
		reads,
		writes,
		gitCalls,
		repoCalls,
		calls,
		stdout: () => out.join("\n"),
		stderr: () => err.join("\n"),
		everything: () => [out.join("\n"), err.join("\n"), ...writes.map((w) => w.text)].join("\n"),
		// Raw flags, for runs that leave --from or --to to the script.
		suggestWith: (args: string[]) => run(["suggest", "--out", OUT, ...args], deps),
		suggest: (from = D, to = D) =>
			run(["suggest", "--from", from, "--to", to, "--out", OUT, ...(opts.meetings === undefined ? [] : ["--meetings", MEETINGS_PATH])], deps),
		rows: (): Row[] =>
			writes
				.filter((w) => w.path.startsWith(OUT) && w.path.endsWith(".json"))
				.flatMap((w) => JSON.parse(w.text) as Row[]),
	};
	return t;
}

interface MocoEntry {
	id: number;
	date: string;
	billable: boolean;
	seconds: number;
	worked_seconds: number;
	description: string;
	project: { id: number; name: string };
	task: { id: number; name: string };
}

// seconds is the billable part; worked_seconds is what MOCO shows as the time spent.
function own(id: number, date: string, project: 100 | 200, workedMinutes: number): MocoEntry {
	const p = PROJECTS.find((x) => x.id === project)!;
	return {
		id,
		date,
		billable: true,
		seconds: 600,
		worked_seconds: workedMinutes * 60,
		description: "",
		project: { id: p.id, name: p.name },
		task: { id: p.tasks[0].id, name: p.tasks[0].name },
	};
}

interface Row {
	date: string;
	project: string;
	task: string;
	hours: string | number;
	description?: string;
}

function minutes(row: Row): number {
	if (typeof row.hours === "number") return Math.round(row.hours * 60);
	const clock = row.hours.match(/^(\d+):(\d{2})$/);
	return clock ? Number(clock[1]) * 60 + Number(clock[2]) : Math.round(Number(row.hours) * 60);
}

const summary = (rows: Row[]) => rows.map((r) => `${r.date} ${r.project} ${minutes(r)}`).sort();

function everyFifteen(from: string, to: string, day = D): string[] {
	const out: string[] = [];
	const end = localMs(at(to, day));
	for (let m = localMs(at(from, day)); m <= end; m += 15 * 60_000) {
		const d = new Date(m);
		out.push(at(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, day));
	}
	return out;
}

describe("suggest: time windows and rounding", () => {
	it("counts gaps of 20 minutes or less as work and books the rounded total", async () => {
		const t = setup({ sessions: [pi("a", piSession(A, [at("09:00"), at("09:10"), at("09:25"), at("11:00"), at("11:05")]))] });
		expect(await t.suggest()).toBe(0);
		expect(t.rows()).toHaveLength(1);
		const [row] = t.rows();
		expect(row).toMatchObject({ date: D, project: "Website Relaunch", task: "Development" });
		expect(minutes(row)).toBe(30);
		expect(t.stdout()).toMatch(/Website Relaunch[^\n]*\b30\b/);
	});

	it("counts overlapping sessions of Pi and Claude Code once", async () => {
		const t = setup({
			sessions: [
				pi("a", piSession(A, [at("09:00"), at("09:10")])),
				pi("b", piSession(A, [at("09:05"), at("09:20")])),
				claude("c", claudeSession(A, [at("09:15"), at("09:30")])),
			],
		});
		expect(await t.suggest()).toBe(0);
		// 30 minutes of wall clock; adding the sessions separately would give 40 and round to 30 as well,
		// so the report's raw figure is the check.
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`]);
		expect(t.stdout()).toMatch(/Website Relaunch[^\n]*\b30\b/);
		expect(t.stdout()).not.toMatch(/Website Relaunch[^\n]*\b40\b/);
	});

	it("rounds each row to the nearest 30 minutes, half up, and lists a zero row as dropped", async () => {
		const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
		const shapes = [
			["09:00", "09:14"], // 14
			["09:00", "09:15"], // 15
			["09:00", "09:20", "09:40", "09:44"], // 44
			["09:00", "09:20", "09:40", "09:45"], // 45
		];
		const t = setup({ sessions: days.map((day, i) => pi(`d${i}`, piSession(A, shapes[i].map((hm) => at(hm, day))))) });
		expect(await t.suggest("2026-11-02", "2026-11-05")).toBe(0);
		expect(summary(t.rows())).toEqual([
			"2026-11-03 Website Relaunch 30",
			"2026-11-04 Website Relaunch 30",
			"2026-11-05 Website Relaunch 60",
		]);
		expect(t.stdout()).toMatch(/dropped[^\n]*2026-11-02|2026-11-02[^\n]*dropped/i);
	});

	it("splits minutes over local midnight across both dates", async () => {
		const times = [at("23:30"), at("23:45"), at("00:00", "2026-11-11"), at("00:15", "2026-11-11"), at("00:30", "2026-11-11")];
		const t = setup({ sessions: [pi("a", piSession(A, times))] });
		expect(await t.suggest("2026-11-10", "2026-11-11")).toBe(0);
		expect(summary(t.rows())).toEqual(["2026-11-10 Website Relaunch 30", "2026-11-11 Website Relaunch 30"]);
	});

	it("only message lines are activity; custom and system lines are not", async () => {
		const t = setup({
			sessions: [
				pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")], { recapAt: at("09:45"), title: "T", titleAt: at("09:50"), extra: [at("09:55")] })),
				claude("c", claudeSession(B, [at("14:00"), at("14:15"), at("14:30")], { noise: [at("14:45")] })),
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`, `${D} Website Support 30`]);
	});

	it("ignores events outside the requested range", async () => {
		const t = setup({
			sessions: [pi("a", piSession(A, [at("09:00", "2026-11-09"), at("09:15", "2026-11-09"), at("09:30", "2026-11-09"), at("09:45", "2026-11-09")]))],
		});
		expect(await t.suggest(D, D)).toBe(0);
		expect(t.rows()).toHaveLength(0);
	});

	it("skips unparseable log lines and counts them in the report", async () => {
		const text = `${piSession(A, [at("09:00"), at("09:15"), at("09:30")])}\nnot json {\n{broken`;
		const t = setup({ sessions: [pi("a", text)] });
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`]);
		expect(t.stdout()).toMatch(/(skipped|unparseable)[^\n]*\b2\b/i);
	});
});

describe("suggest: mapping folders to projects", () => {
	const GE_CONFIG = {
		gitEmails: ["me@example.com"],
		projects: [{ project: "Website Relaunch", task: "Development", folders: ["~/Projects/UQ/GrüneErde"] }],
	};

	it("maps a Claude line by its in-line cwd, not the lossy folder name", async () => {
		const cwd = `${HOME}/Projects/UQ/GrüneErde/shopware/.claude/worktrees/x`;
		const t = setup({
			config: GE_CONFIG,
			sessions: [claude("c", claudeSession(cwd, [at("09:00"), at("09:15"), at("09:30"), at("09:45")]), undefined, "-h-Projects-UQ-Gr-neErde-shopware--claude-worktrees-x")],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 60`]);
	});

	it("uses the longest folder prefix and matches whole path segments only", async () => {
		const config = {
			gitEmails: [],
			projects: [
				{ project: "Website Relaunch", task: "Development", folders: ["~/work/relaunch"] },
				{ project: "Website Support", task: "Support", folders: ["~/work/relaunch/support-app"] },
			],
		};
		const t = setup({
			config,
			sessions: [
				pi("a", piSession(`${HOME}/work/relaunch/support-app/src`, [at("09:00"), at("09:15"), at("09:30"), at("09:45")])),
				pi("b", piSession(`${HOME}/work/relaunch-other`, [at("13:00"), at("13:15"), at("13:30"), at("13:45")])),
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Support 60`]);
		expect(t.stdout()).toContain(`${HOME}/work/relaunch-other`);
	});

	it("writes no row for an unmapped folder and reports it with event count and raw minutes", async () => {
		const t = setup({
			sessions: [
				pi("u", piSession(UNMAPPED, [at("09:00"), at("09:10"), at("09:20"), at("09:30"), at("09:40")])),
				pi("a", piSession(A, [at("13:00"), at("13:15"), at("13:30")])),
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`]);
		const line = t.stdout().split("\n").find((l) => l.includes(UNMAPPED));
		expect(line).toBeDefined();
		expect(line).toMatch(/\b5\b/);
		expect(line).toMatch(/\b40\b/);
	});
});

describe("suggest: sharing minutes between parties", () => {
	it("splits overlapping minutes of two mapped projects equally", async () => {
		const t = setup({
			sessions: [
				pi("a", piSession(A, everyFifteen("10:00", "11:00"))),
				pi("b", piSession(B, everyFifteen("10:30", "11:30"))),
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(t.stdout()).toMatch(/Website Relaunch[^\n]*\b45\b/);
		expect(t.stdout()).toMatch(/Website Support[^\n]*\b45\b/);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 60`, `${D} Website Support 60`]);
	});

	it("gives a share of overlapping time to unmapped activity and reports the dropped minutes", async () => {
		const t = setup({
			sessions: [
				pi("a", piSession(A, everyFifteen("10:00", "11:00"))),
				pi("u", piSession(UNMAPPED, everyFifteen("10:30", "11:30"))),
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(t.stdout()).toMatch(/Website Relaunch[^\n]*\b45\b/);
		const dropped = t
			.stdout()
			.split("\n")
			.find((l) => /unmapped/i.test(l) && l.includes("Website Relaunch") && l.includes(D) && /\b15\b/.test(l));
		expect(dropped).toBeDefined();
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 60`]);
	});

	it("reports only the minutes a project lost to unmapped activity when two mapped projects share too", async () => {
		// 30 minutes, three parties: 10 each. Without the unmapped party each project would get 15, so it lost 5.
		const span = everyFifteen("10:00", "10:30");
		const t = setup({ sessions: [pi("a", piSession(A, span)), pi("b", piSession(B, span)), pi("u", piSession(UNMAPPED, span))] });
		expect(await t.suggest()).toBe(0);
		const lostLines = t
			.stdout()
			.split("\n")
			.filter((l) => /unmapped/i.test(l) && l.includes(D) && /Website (Relaunch|Support)/.test(l));
		expect(lostLines.length).toBeGreaterThan(0);
		for (const line of lostLines) {
			expect(line).toMatch(/\b5 min/);
			expect(line).not.toMatch(/\b10 min/);
		}
	});

	it("counts all unmapped folders together as one party", async () => {
		// 135 minutes: three parties give 45 each (books 1:00); four parties would give 33.75 (books 0:30).
		const span = everyFifteen("10:00", "12:15");
		const t = setup({
			sessions: [
				pi("a", piSession(A, span)),
				pi("b", piSession(B, span)),
				pi("u1", piSession(UNMAPPED, span)),
				pi("u2", piSession(UNMAPPED2, span)),
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 60`, `${D} Website Support 60`]);
		expect(t.stdout()).toMatch(/Website Relaunch[^\n]*\b45\b/);
	});
});

describe("suggest: agent-only flag", () => {
	const flagged = (t: ReturnType<typeof setup>) => t.stdout().split("\n").filter((l) => /agent-only/i.test(l));

	it("flags 60+ minutes of assistant events with no prompt, and still counts the time", async () => {
		const evs: PiEv[] = [{ at: at("09:00"), role: "user" }, ...everyFifteen("09:15", "10:15").map((x) => ({ at: x, role: "assistant" as const }))];
		const t = setup({ sessions: [pi("a", piSession(A, evs))] });
		expect(await t.suggest()).toBe(0);
		expect(flagged(t).some((l) => l.includes("Website Relaunch") && l.includes(D))).toBe(true);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 90`]);
	});

	it("does not flag work with a prompt at least every 30 minutes", async () => {
		const evs: PiEv[] = everyFifteen("09:00", "11:00").map((x, i) => ({ at: x, role: i % 2 === 0 ? "user" : "assistant" }));
		const t = setup({ sessions: [pi("a", piSession(A, evs))] });
		expect(await t.suggest()).toBe(0);
		expect(flagged(t)).toHaveLength(0);
	});

	it("does not treat tool output, meta, or sidechain Claude lines as prompts", async () => {
		const evs: ClaudeEv[] = [
			{ at: at("09:00"), kind: "prompt" },
			{ at: at("09:15"), kind: "assistant" },
			{ at: at("09:30"), kind: "tool" },
			{ at: at("09:45"), kind: "meta" },
			{ at: at("10:00"), kind: "side" },
			{ at: at("10:15"), kind: "assistant" },
		];
		const t = setup({ sessions: [claude("c", claudeSession(A, evs))] });
		expect(await t.suggest()).toBe(0);
		expect(flagged(t).some((l) => l.includes("Website Relaunch"))).toBe(true);
	});

	it("does not flag the same Claude stretch when a real prompt breaks it up", async () => {
		const evs: ClaudeEv[] = [
			{ at: at("09:00"), kind: "prompt" },
			{ at: at("09:15"), kind: "assistant" },
			{ at: at("09:30"), kind: "tool" },
			{ at: at("09:50"), kind: "prompt" },
			{ at: at("10:00"), kind: "side" },
			{ at: at("10:15"), kind: "assistant" },
		];
		const t = setup({ sessions: [claude("c", claudeSession(A, evs))] });
		expect(await t.suggest()).toBe(0);
		expect(flagged(t)).toHaveLength(0);
	});

	it("treats user messages of a session with a parent session as non-prompts", async () => {
		// A subagent session carries parentSession and its user message is the spawner's task text.
		const evs: PiEv[] = everyFifteen("09:00", "11:00").map((x, i) => ({ at: x, role: i % 2 === 0 ? "user" : "assistant" }));
		const t = setup({ sessions: [pi("a", piSession(A, evs, { parent: true }))] });
		expect(await t.suggest()).toBe(0);
		expect(flagged(t).some((l) => l.includes("Website Relaunch"))).toBe(true);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 120`]);
	});
});

describe("suggest: descriptions", () => {
	const lines = (t: ReturnType<typeof setup>) => t.stdout().split("\n");

	it("builds descriptions only from titles, deduplicated, never from prompts or recaps", async () => {
		const t = setup({
			sessions: [
				pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")], { title: "Fix cart bug", recapAt: at("09:40"), extra: [at("09:41")] })),
				pi("b", piSession(A, [at("09:05"), at("09:20")], { title: "Fix cart bug" })),
				claude("c", claudeSession(A, [at("10:00"), at("10:15"), at("10:30")], { title: "Refactor checkout" })),
			],
		});
		expect(await t.suggest()).toBe(0);
		const [row] = t.rows();
		expect(row.description).toContain("Fix cart bug");
		expect(row.description).toContain("Refactor checkout");
		expect(row.description!.split("Fix cart bug")).toHaveLength(2);
		for (const secret of [PROMPT, RECAP, OTHER_CUSTOM]) expect(t.everything()).not.toContain(secret);
	});

	it("caps a description at 250 characters", async () => {
		const sessions = Array.from({ length: 12 }, (_, i) =>
			pi(`s${i}`, piSession(A, [at("09:00"), at("09:15"), at("09:30")], { title: `Title number ${i} ${"x".repeat(40)}` })),
		);
		const t = setup({ sessions });
		expect(await t.suggest()).toBe(0);
		const [row] = t.rows();
		expect(row.description!.length).toBeGreaterThan(0);
		expect(row.description!.length).toBeLessThanOrEqual(250);
	});

	it("writes an empty description and lists the project-day under no description", async () => {
		const t = setup({ sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))] });
		expect(await t.suggest()).toBe(0);
		expect(t.rows()[0].description ?? "").toBe("");
		expect(t.stdout()).toMatch(/no description[\s\S]*Website Relaunch[\s\S]*2026-11-10|no description[\s\S]*2026-11-10[\s\S]*Website Relaunch/i);
	});

	it("does not list a project-day that has a title under no description", async () => {
		const t = setup({ sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")], { title: "Fix cart bug" }))] });
		expect(await t.suggest()).toBe(0);
		expect(t.rows()[0].description).toBe("Fix cart bug");
		expect(lines(t).join("\n")).not.toMatch(/no description[\s\S]*Website Relaunch/i);
	});
});

describe("suggest: config", () => {
	it.each([
		["missing", { config: null }],
		["not JSON", { rawConfig: "{nope" }],
		["without projects", { config: { gitEmails: [] } }],
		["with a project lacking folders", { config: { gitEmails: [], projects: [{ project: "Website Relaunch", task: "Development" }] } }],
		["with a project that has neither folders nor keywords", { config: { gitEmails: [], projects: [{ project: "Website Relaunch", task: "Development", folders: [], keywords: [] }] } }],
	])("exits 1 with a template hint and writes nothing when the file is %s", async (_label, opts) => {
		const t = setup({ ...(opts as object), sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))] });
		expect(await t.suggest()).toBe(1);
		expect(t.stderr()).toMatch(/^Error:/m);
		expect(t.stderr()).toContain(".config/moco/projects.json");
		expect(t.writes).toHaveLength(0);
	});

	it("expands ~ in folders against the injected home", async () => {
		const t = setup({ sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))] });
		expect(await t.suggest()).toBe(0);
		expect(t.rows()).toHaveLength(1);
	});
});

describe("suggest: scanning and output", () => {
	it("does not read session files older than --from, and reads one at the boundary", async () => {
		const old = pi("old", piSession(A, [at("09:00", "2026-11-05"), at("09:15", "2026-11-05")]), localMs("2026-11-05 09:15"));
		const edge = pi("edge", piSession(A, [at("09:00"), at("09:15"), at("09:30")]), localMs("2026-11-10 00:00"));
		const t = setup({ sessions: [old, edge] });
		expect(await t.suggest()).toBe(0);
		expect(t.reads).not.toContain(old.path);
		expect(t.reads).toContain(edge.path);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`]);
	});

	it("makes no MOCO write", async () => {
		const t = setup({ sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))] });
		expect(await t.suggest()).toBe(0);
		expect(t.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
	});

	it("writes rows that add --file accepts unchanged", async () => {
		const t = setup({ sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")], { title: "Fix cart bug" }))] });
		expect(await t.suggest()).toBe(0);
		const file = t.writes.find((w) => w.path.startsWith(OUT) && w.path.endsWith(".json"))!;
		const outBefore = t.stdout().length;
		expect(await run(["add", "--file", file.path], t.deps)).toBe(0);
		expect(t.stdout().slice(outBefore)).toMatch(/confirm: [0-9a-f]{8}/);
	});

	it("leaves the log module free of network code", () => {
		const path = ".pi/skill-library/moco-timesheet/scripts/activity.ts";
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf8")).not.toMatch(/fetch|https?:/);
	});

	it("keeps the log module free of file, process, and network imports", () => {
		const path = ".pi/skill-library/moco-timesheet/scripts/activity.ts";
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf8")).not.toMatch(/node:(fs|child_process|net|http|https|dns)/);
	});
});

describe("suggest: git commits", () => {
	const REPO_A = `${A}/app`;
	const REPO_B = `${B}/api`;
	const ME = "me@example.com";
	const piMorning = () => pi("a", piSession(A, [at("09:00"), at("09:10")]));

	it("asks git once per configured address and repo, with an argument array and no pager", async () => {
		const config = { ...CONFIG, gitEmails: [ME, "me@other.example"] };
		const t = setup({ config, repos: [REPO_A, REPO_B] });
		expect(await t.suggest()).toBe(0);
		expect(t.gitCalls).toHaveLength(4);
		for (const { repo, args } of t.gitCalls) {
			expect([REPO_A, REPO_B]).toContain(repo);
			expect(args.slice(0, 2)).toEqual(["--no-pager", "log"]);
			expect(args).toContain("--all");
			expect(args.some((a) => a.startsWith("--since") || a === "--since")).toBe(true);
			// --until filters on committer date; a rebase moves that past the range and would hide authored commits.
			expect(args.some((a) => a.startsWith("--until"))).toBe(false);
			expect(args.join(" ")).toContain("%aI%x09%s");
			expect(args.join(" ")).toContain(D);
		}
		const authors = t.gitCalls.filter((c) => c.repo === REPO_A).map((c) => c.args.find((a) => a.startsWith("--author=")));
		expect(authors.sort()).toEqual(["--author=me@example.com", "--author=me@other.example"]);
		expect(t.stdout()).not.toContain(ME);
	});

	it("looks for repos under every mapped folder to depth 3 and nowhere else", async () => {
		const t = setup({ repos: [REPO_A, `${UNMAPPED}/secret-repo`] });
		expect(await t.suggest()).toBe(0);
		expect(t.repoCalls.map((c) => c.dir).sort()).toEqual([A, B]);
		expect(t.repoCalls.every((c) => c.depth === 3)).toBe(true);
		expect(t.gitCalls.every((c) => c.repo === REPO_A)).toBe(true);
	});

	it("never calls git when no address is configured", async () => {
		const t = setup({ config: { ...CONFIG, gitEmails: [] }, repos: [REPO_A] });
		expect(await t.suggest()).toBe(0);
		expect(t.gitCalls).toHaveLength(0);
	});

	it("turns the user's commits into events, so a commit near other activity extends the window", async () => {
		// Pi alone is 10 minutes (rounds to 0); the commit at 09:20 makes it 20 (rounds to 30).
		const t = setup({
			sessions: [piMorning()],
			repos: [REPO_A],
			// 13:50 at +05:30 is 09:20 in Berlin: offsets must be honoured.
			commits: [{ repo: REPO_A, email: ME, line: `${D}T13:50:00+05:30\tFix tax rounding` }],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`]);
	});

	it("takes subjects of the user's commits only, and puts them in the description", async () => {
		const t = setup({
			sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")], { title: "Fix cart bug" }))],
			repos: [REPO_A],
			commits: [
				{ repo: REPO_A, email: ME, line: commitLine("09:20", "Fix tax rounding") },
				{ repo: REPO_A, email: "colleague@example.com", line: commitLine("09:25", "Colleague change") },
			],
		});
		expect(await t.suggest()).toBe(0);
		const [row] = t.rows();
		expect(row.description).toContain("Fix cart bug");
		expect(row.description).toContain("Fix tax rounding");
		expect(row.description).not.toContain("Colleague change");
		expect(t.everything()).not.toContain("Colleague change");
	});

	it("deduplicates a subject that appears in several repos or addresses", async () => {
		const config = { ...CONFIG, gitEmails: [ME, "me@other.example"] };
		const t = setup({
			config,
			sessions: [piMorning()],
			repos: [REPO_A, `${A}/lib`],
			commits: [
				{ repo: REPO_A, email: ME, line: commitLine("09:15", "Bump version") },
				{ repo: `${A}/lib`, email: "me@other.example", line: commitLine("09:16", "Bump version") },
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(t.rows()[0].description!.split("Bump version")).toHaveLength(2);
	});

	it("counts a commit with no other event within 20 minutes as zero minutes", async () => {
		const t = setup({
			sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))],
			repos: [REPO_A],
			commits: [{ repo: REPO_A, email: ME, line: commitLine("14:00", "Late fix") }],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`]);
		expect(t.rows()[0].description).toContain("Late fix");
	});

	it("writes no row for a day that holds only a lone commit", async () => {
		const t = setup({ repos: [REPO_A], commits: [{ repo: REPO_A, email: ME, line: commitLine("14:00", "Only commit") }] });
		expect(await t.suggest()).toBe(0);
		expect(t.rows()).toHaveLength(0);
	});

	it("books each repo's commits to the project whose folder holds it", async () => {
		const t = setup({
			repos: [REPO_A, REPO_B],
			commits: [
				{ repo: REPO_A, email: ME, line: commitLine("09:00", "A one") },
				{ repo: REPO_A, email: ME, line: commitLine("09:15", "A two") },
				{ repo: REPO_A, email: ME, line: commitLine("09:30", "A three") },
				{ repo: REPO_B, email: ME, line: commitLine("11:00", "B one") },
				{ repo: REPO_B, email: ME, line: commitLine("11:15", "B two") },
				{ repo: REPO_B, email: ME, line: commitLine("11:30", "B three") },
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`, `${D} Website Support 30`]);
		const byProject = Object.fromEntries(t.rows().map((r) => [r.project, r.description ?? ""]));
		expect(byProject["Website Relaunch"]).toContain("A one");
		expect(byProject["Website Relaunch"]).not.toContain("B one");
		expect(byProject["Website Support"]).toContain("B one");
	});

	it("a commit is not a prompt, so commits do not hide an agent-only stretch", async () => {
		const evs: PiEv[] = [{ at: at("09:00"), role: "user" }, ...everyFifteen("09:15", "10:15").map((x) => ({ at: x, role: "assistant" as const }))];
		const t = setup({
			sessions: [pi("a", piSession(A, evs))],
			repos: [REPO_A],
			commits: [{ repo: REPO_A, email: ME, line: commitLine("09:40", "Mid-run commit") }],
		});
		expect(await t.suggest()).toBe(0);
		expect(t.stdout()).toMatch(/agent-only[^\n]*/i);
	});

	it("skips malformed git lines and counts them in the report", async () => {
		const t = setup({
			sessions: [piMorning()],
			repos: [REPO_A],
			commits: [
				{ repo: REPO_A, email: ME, line: commitLine("09:15", "Good one") },
				{ repo: REPO_A, email: ME, line: "garbage without a tab" },
				{ repo: REPO_A, email: ME, line: "not-a-date\tSubject" },
			],
		});
		expect(await t.suggest()).toBe(0);
		expect(t.rows()[0].description).toContain("Good one");
		expect(t.stdout()).toMatch(/(skipped|unparseable)[^\n]*\b2\b/i);
	});
});

describe("suggest: meetings file", () => {
	const MEET_CONFIG = {
		gitEmails: [],
		projects: [
			{ project: "Website Relaunch", task: "Development", meetingTask: "Meetings", folders: ["~/work/relaunch"], keywords: ["Relaunch"] },
			{ project: "Website Support", task: "Support", folders: ["~/work/support"], keywords: ["Support"] },
		],
	};
	const meet = (start: string, end: string, title: string, date = D) => ({ date, start, end, title });
	const setupM = (meetings: unknown, sessions: SessionFile[] = []) => setup({ config: MEET_CONFIG, meetings, sessions });

	it("books a meeting on the project's meeting task and removes the overlapping log time of another project", async () => {
		const t = setupM([meet("10:00", "11:00", "Relaunch Weekly sync")], [pi("b", piSession(B, everyFifteen("10:00", "11:30")))]);
		expect(await t.suggest()).toBe(0);
		const meeting = t.rows().find((r) => r.project === "Website Relaunch");
		expect(meeting).toMatchObject({ date: D, task: "Meetings" });
		expect(minutes(meeting!)).toBe(60);
		expect(meeting!.description).toBe("Relaunch Weekly sync");
		// B had 90 minutes; the 60 inside the meeting are gone.
		expect(t.rows().filter((r) => r.project === "Website Support").map(minutes)).toEqual([30]);
		expect(t.stdout()).toMatch(/Website Support[^\n]*\b30\b/);
	});

	it("also removes the project's own log time inside its meeting", async () => {
		const t = setupM([meet("10:00", "11:00", "Relaunch kickoff")], [pi("a", piSession(A, everyFifteen("10:00", "11:00")))]);
		expect(await t.suggest()).toBe(0);
		expect(t.rows().map((r) => `${r.project}/${r.task}/${minutes(r)}`)).toEqual(["Website Relaunch/Meetings/60"]);
	});

	it("books on the normal task when the project has no meeting task", async () => {
		const t = setupM([meet("14:00", "15:00", "Support call")]);
		expect(await t.suggest()).toBe(0);
		expect(t.rows().map((r) => `${r.project}/${r.task}/${minutes(r)}`)).toEqual(["Website Support/Support/60"]);
	});

	it("removes log time for a meeting that matches no project, books nothing for it, and reports title and minutes", async () => {
		const t = setupM([meet("10:00", "11:00", "Dentist")], [pi("b", piSession(B, everyFifteen("10:00", "11:30")))]);
		expect(await t.suggest()).toBe(0);
		expect(t.rows().map((r) => `${r.project}/${minutes(r)}`)).toEqual(["Website Support/30"]);
		const line = t.stdout().split("\n").find((l) => l.includes("Dentist"));
		expect(line).toBeDefined();
		expect(line).toContain("Website Support");
		expect(line).toMatch(/\b60\b/);
	});

	it("removes each project's own overlapped time before the rest is shared", async () => {
		// Meeting 10:00-11:00 takes 60 of A (10:00-11:30) and 30 of B (10:30-11:30); 11:00-11:30 is shared 15/15.
		const t = setupM(
			[meet("10:00", "11:00", "Dentist")],
			[pi("a", piSession(A, everyFifteen("10:00", "11:30"))), pi("b", piSession(B, everyFifteen("10:30", "11:30")))],
		);
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 30`, `${D} Website Support 30`]);
		const removed = t.stdout().split("\n").filter((l) => l.includes("Dentist"));
		expect(removed.some((l) => l.includes("Website Relaunch") && /\b60\b/.test(l))).toBe(true);
		expect(removed.some((l) => l.includes("Website Support") && /\b30\b/.test(l))).toBe(true);
	});

	it("merges overlapping meetings of one project and rounds the meeting row on its own", async () => {
		const t = setupM([meet("10:00", "11:00", "Relaunch A"), meet("10:30", "11:30", "Relaunch B"), meet("14:00", "14:20", "Relaunch C")]);
		expect(await t.suggest()).toBe(0);
		// 90 minutes merged, plus 20 = 110 raw, rounds to 120.
		expect(t.rows().map(minutes)).toEqual([120]);
		const description = t.rows()[0].description!;
		for (const title of ["Relaunch A", "Relaunch B", "Relaunch C"]) expect(description).toContain(title);
	});

	it("shares the overlap of two projects' meetings instead of counting it twice", async () => {
		// Both meetings 10:00-11:00: 60 wall-clock minutes, so 30 each, not 60 each.
		const t = setupM([meet("10:00", "11:00", "Relaunch planning"), meet("10:00", "11:00", "Support triage")]);
		expect(await t.suggest()).toBe(0);
		expect(t.rows().map((r) => `${r.project} ${minutes(r)}`).sort()).toEqual(["Website Relaunch 30", "Website Support 30"]);
	});

	it("ignores a meeting on a date outside the range", async () => {
		const t = setupM([meet("10:00", "11:00", "Relaunch kickoff", "2026-11-12")]);
		expect(await t.suggest()).toBe(0);
		expect(t.rows()).toHaveLength(0);
	});

	it("writes meeting rows that add --file accepts unchanged", async () => {
		const t = setupM([meet("10:00", "11:00", "Relaunch kickoff")]);
		expect(await t.suggest()).toBe(0);
		const file = t.writes.find((w) => w.path.startsWith(OUT))!;
		const before = t.stdout().length;
		expect(await run(["add", "--file", file.path], t.deps)).toBe(0);
		expect(t.stdout().slice(before)).toMatch(/Meetings/);
	});
});

describe("suggest: meeting keyword matching", () => {
	const config = {
		gitEmails: [],
		projects: [
			{ project: "Website Relaunch", task: "Development", folders: ["~/work/relaunch"], keywords: ["GE", "Grüne Erde"] },
			{ project: "Website Support", task: "Support", folders: ["~/work/support"], keywords: ["Mate", "Weekly"] },
		],
	};
	const book = async (title: string) => {
		const t = setup({ config, meetings: [{ date: D, start: "10:00", end: "11:00", title }] });
		expect(await t.suggest()).toBe(0);
		return t;
	};

	it.each([
		["GE Weekly standup is two projects", "GE Weekly", undefined],
		["case-insensitive whole word", "ge kickoff", "Website Relaunch"],
		["a keyword inside a longer word does not match", "Change request", undefined],
		["a hyphen ends a word", "Mate-Sync", "Website Support"],
		["a keyword inside another word does not match", "Ultimate goals", undefined],
		["a phrase with non-ASCII letters", "Sync Grüne Erde launch", "Website Relaunch"],
		["a phrase glued to more letters does not match", "Grüne Erdeapfel", undefined],
	])("%s: %s", async (_label, title, project) => {
		const t = await book(title);
		expect(t.rows().map((r) => r.project)).toEqual(project ? [project] : []);
		if (!project) expect(t.stdout()).toContain(title);
	});
});

describe("suggest: meetings file validation", () => {
	const good = { date: D, start: "10:00", end: "11:00", title: "Relaunch kickoff" };
	const logs = () => [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))];

	it.each([
		["an unknown key", [{ ...good, attendees: "x" }]],
		["a missing title", [{ date: D, start: "10:00", end: "11:00" }]],
		["a title that is not text", [{ ...good, title: 7 }]],
		["an empty title", [{ ...good, title: " " }]],
		["a bad start time", [{ ...good, start: "25:00" }]],
		["a bad end time", [{ ...good, end: "10:61" }]],
		["a time that is not a clock time", [{ ...good, start: "noon" }]],
		["an end equal to the start", [{ ...good, end: "10:00" }]],
		["an end before the start", [{ ...good, end: "09:00" }]],
		["a bad date", [{ ...good, date: "2026-13-40" }]],
		["one bad entry among good ones", [good, { ...good, end: "09:00" }]],
		["an entry that is not an object", [good, "meeting"]],
		["a top level that is not a list", { meetings: [good] }],
		["text that is not JSON", "{nope"],
	])("exits 1 and writes nothing for %s", async (_label, meetings) => {
		const t = setup({ config: CONFIG, meetings, sessions: logs() });
		expect(await t.suggest()).toBe(1);
		expect(t.stderr()).toMatch(/^Error:/m);
		expect(t.stderr()).toMatch(/meeting/i);
		// The flag itself must be accepted; only the file's content is at fault.
		expect(t.stderr()).not.toMatch(/unknown option|unexpected argument/i);
		expect(t.writes).toHaveLength(0);
	});

	it("exits 1 and writes nothing when the meetings file cannot be read", async () => {
		const t = setup({ config: CONFIG, sessions: logs() });
		expect(await run(["suggest", "--from", D, "--to", D, "--out", OUT, "--meetings", "/m/missing.json"], t.deps)).toBe(1);
		expect(t.stderr()).toMatch(/^Error:/m);
		expect(t.stderr()).toContain("/m/missing.json");
		expect(t.writes).toHaveLength(0);
	});

	it("accepts a valid file", async () => {
		const t = setup({ config: CONFIG, meetings: [good], sessions: logs() });
		expect(await t.suggest()).toBe(0);
	});
});

describe("suggest: MOCO reads", () => {
	const logs = (cwd = A) => [pi("a", piSession(cwd, [at("09:00"), at("09:15"), at("09:30")]))];

	it("connects, reads profile, assigned projects and own entries for the range, and only reads", async () => {
		const t = setup({ sessions: logs() });
		expect(await t.suggest()).toBe(0);
		const paths = t.calls.map((c) => c.path);
		expect(paths).toContain("/api/v1/profile");
		expect(paths).toContain("/api/v1/projects/assigned");
		const entries = t.calls.find((c) => c.path === "/api/v1/activities")!;
		expect(entries.params.get("user_id")).toBe("42");
		expect(entries.params.get("from")).toBe(D);
		expect(entries.params.get("to")).toBe(D);
		expect(t.calls.every((c) => c.method === "GET")).toBe(true);
	});

	it("exits 1 with the Keychain hint and writes nothing when the API key is missing", async () => {
		const t = setup({ sessions: logs(), secrets: { "moco-api": undefined } });
		expect(await t.suggest()).toBe(1);
		expect(t.stderr()).toMatch(/^Error:/m);
		expect(t.stderr()).toContain("moco-api");
		expect(t.writes).toHaveLength(0);
	});

	it("never prints the API key", async () => {
		const t = setup({ sessions: logs() });
		await t.suggest();
		expect(t.everything()).not.toContain("k3y-s3cret-value");
	});
});

describe("suggest: resolving config projects in MOCO", () => {
	const logs = () => [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))];
	const withProjects = (projects: object[]) => ({ gitEmails: [], projects });
	const valid = { project: "Website Relaunch", task: "Development", folders: ["~/work/relaunch"] };

	it.each([
		["an unknown project", { project: "Nonexistent", task: "Development", folders: ["~/work/other"] }, "Nonexistent", "Website Relaunch"],
		["an ambiguous project name", { project: "Website", task: "Development", folders: ["~/work/other"] }, "Website", "Website Support"],
		["an unknown task", { project: "Website Relaunch", task: "Nope", folders: ["~/work/other"] }, "Nope", "Development"],
		["an unknown meeting task", { project: "Website Relaunch", task: "Development", meetingTask: "Standups", folders: ["~/work/other"] }, "Standups", "Meetings"],
	])("exits 1 listing candidates for %s, even when the project has no activity", async (_label, bad, query, candidate) => {
		const t = setup({ config: withProjects([valid, bad]), sessions: logs() });
		expect(await t.suggest()).toBe(1);
		expect(t.stderr()).toMatch(/^Error:/m);
		expect(t.stderr()).toContain(query);
		expect(t.stderr()).toContain(candidate);
		expect(t.stderr()).toMatch(/candidates/i);
		expect(t.writes).toHaveLength(0);
	});

	it("accepts a project written as a unique part of its name", async () => {
		const t = setup({ config: withProjects([{ project: "Relaunch", task: "Development", folders: ["~/work/relaunch"] }]), sessions: logs() });
		expect(await t.suggest()).toBe(0);
		expect(t.rows()).toHaveLength(1);
	});
});

describe("suggest: project-days already booked in MOCO", () => {
	const dayLogs = (extra: SessionFile[] = []) => [
		pi("a", piSession(A, everyFifteen("09:00", "10:00"))),
		pi("b", piSession(B, everyFifteen("13:00", "14:00"))),
		...extra,
	];
	const bookedLine = (t: ReturnType<typeof setup>, project: string) =>
		t.stdout().split("\n").find((l) => /already booked/i.test(l) && l.includes(project) && l.includes(D));

	it("writes no row for a project-day with an own entry and reports MOCO's and the logs' durations", async () => {
		const t = setup({ sessions: dayLogs(), existing: [own(1, D, 100, 120)] });
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Support 60`]);
		const line = bookedLine(t, "Website Relaunch");
		expect(line).toBeDefined();
		expect(line).toContain("2:00");
		expect(line).toContain("1:00");
	});

	it("sums several own entries of the day, and blocks the project's meeting row too", async () => {
		const meetings = [{ date: D, start: "11:00", end: "12:00", title: "Relaunch kickoff" }];
		const config = { ...CONFIG, projects: [{ ...CONFIG.projects[0], meetingTask: "Meetings" }, CONFIG.projects[1]] };
		const t = setup({ config, meetings, sessions: dayLogs(), existing: [own(1, D, 100, 60), own(2, D, 100, 30)] });
		expect(await t.suggest()).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Support 60`]);
		const line = bookedLine(t, "Website Relaunch");
		expect(line).toContain("1:30");
		// Logs: one hour of work plus a one-hour meeting.
		expect(line).toContain("2:00");
	});

	it("does not let an entry on another day or another project block the day", async () => {
		const t = setup({ sessions: dayLogs(), existing: [own(1, "2026-11-09", 100, 60), own(2, D, 200, 30)] });
		expect(await t.suggest("2026-11-09", D)).toBe(0);
		expect(summary(t.rows())).toEqual([`${D} Website Relaunch 60`]);
		expect(bookedLine(t, "Website Support")).toBeDefined();
		expect(bookedLine(t, "Website Relaunch")).toBeUndefined();
	});

	it("lists nothing as already booked when MOCO holds no entry", async () => {
		const t = setup({ sessions: dayLogs() });
		expect(await t.suggest()).toBe(0);
		expect(t.stdout()).not.toMatch(/already booked/i);
		expect(t.rows()).toHaveLength(2);
	});
});

describe("suggest: default range", () => {
	const dayLogs = (cwd: string, ...days: string[]) => days.map((day, i) => pi(`${cwd.slice(-4)}${i}`, piSession(cwd, [at("09:00", day), at("09:15", day), at("09:30", day)])));
	const rangeOf = (t: ReturnType<typeof setup>) => t.stdout().match(/Range: (\S+) to (\S+)/)?.slice(1);

	it("starts 31 days back for a project without entries and ends yesterday, skipping booked days", async () => {
		const t = setup({
			sessions: [
				...dayLogs(A, "2026-11-10", "2026-11-12", "2026-11-14", "2026-11-19"),
				...dayLogs(B, "2026-10-20"),
			],
			existing: [own(1, "2026-11-12", 100, 60)],
		});
		expect(await t.suggestWith([])).toBe(0);
		expect(rangeOf(t)).toEqual(["2026-10-19", "2026-11-18"]);
		const entries = t.calls.find((c) => c.path === "/api/v1/activities")!;
		expect(entries.params.get("from")).toBe("2026-10-19");
		expect(entries.params.get("to")).toBe("2026-11-18");
		// The booked day is skipped; today is outside the range; earlier days of the lagging project stay in.
		expect(summary(t.rows())).toEqual([
			"2026-10-20 Website Support 30",
			"2026-11-10 Website Relaunch 30",
			"2026-11-14 Website Relaunch 30",
		]);
		expect(t.stdout()).toMatch(/already booked[^\n]*2026-11-12|2026-11-12[^\n]*already booked/i);
	});

	it("starts at the earliest day after any mapped project's last entry", async () => {
		const t = setup({
			sessions: dayLogs(A, "2026-11-14"),
			existing: [own(1, "2026-11-01", 100, 60), own(2, "2026-11-12", 100, 60), own(3, "2026-10-25", 200, 60)],
		});
		expect(await t.suggestWith([])).toBe(0);
		expect(rangeOf(t)).toEqual(["2026-10-26", "2026-11-18"]);
	});

	it("ignores an entry older than 31 days when working out the start", async () => {
		const t = setup({ sessions: dayLogs(A, "2026-11-14"), existing: [own(1, "2026-09-01", 100, 60), own(2, "2026-09-02", 200, 60)] });
		expect(await t.suggestWith([])).toBe(0);
		expect(rangeOf(t)).toEqual(["2026-10-19", "2026-11-18"]);
	});

	it("keeps a given --from and ends yesterday", async () => {
		const t = setup({ sessions: [...dayLogs(A, "2026-11-10", "2026-11-14", "2026-11-19")] });
		expect(await t.suggestWith(["--from", "2026-11-13"])).toBe(0);
		expect(rangeOf(t)).toEqual(["2026-11-13", "2026-11-18"]);
		expect(summary(t.rows())).toEqual(["2026-11-14 Website Relaunch 30"]);
	});

	it("keeps a given --to and works out the start", async () => {
		const t = setup({
			sessions: dayLogs(A, "2026-11-14", "2026-11-16"),
			existing: [own(2, "2026-11-12", 100, 60), own(3, "2026-11-11", 200, 60)],
		});
		expect(await t.suggestWith(["--to", "2026-11-15"])).toBe(0);
		// B was last booked on the 11th, so the earliest day after a last entry is the 12th.
		expect(rangeOf(t)).toEqual(["2026-11-12", "2026-11-15"]);
		expect(summary(t.rows())).toEqual(["2026-11-14 Website Relaunch 30"]);
	});
});

describe("suggest: batches of at most 20 rows", () => {
	const days = Array.from({ length: 25 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
	const manyDays = () => [pi("m", piSession(A, days.flatMap((day) => [at("09:00", day), at("09:15", day), at("09:30", day)])))];
	const rowsIn = (t: ReturnType<typeof setup>, path: string) => JSON.parse(t.writes.find((w) => w.path === path)!.text) as Row[];

	it("splits 25 rows into a file of 20 and a file of 5, in date order, each accepted by add", async () => {
		const t = setup({ sessions: manyDays() });
		expect(await t.suggest("2026-10-01", "2026-10-25")).toBe(0);
		expect(t.writes.map((w) => w.path)).toEqual([`${OUT}.1.json`, `${OUT}.2.json`]);
		const [first, second] = [rowsIn(t, `${OUT}.1.json`), rowsIn(t, `${OUT}.2.json`)];
		expect(first).toHaveLength(20);
		expect(second).toHaveLength(5);
		expect(first.map((r) => r.date)).toEqual(days.slice(0, 20));
		expect(second.map((r) => r.date)).toEqual(days.slice(20));
		for (const path of [`${OUT}.1.json`, `${OUT}.2.json`]) {
			const before = t.stdout().length;
			expect(await run(["add", "--file", path], t.deps)).toBe(0);
			expect(t.stdout().slice(before)).toMatch(/confirm: [0-9a-f]{8}/);
		}
	});

	it("refuses when the first target exists and writes nothing", async () => {
		const t = setup({ sessions: manyDays(), files: { [`${OUT}.1.json`]: "[]" } });
		expect(await t.suggest("2026-10-01", "2026-10-25")).toBe(1);
		expect(t.stderr()).toMatch(/^Error:/m);
		expect(t.stderr()).toContain(`${OUT}.1.json`);
		expect(t.writes).toHaveLength(0);
	});

	it("refuses when only a later target exists, so no partial set is written", async () => {
		const t = setup({ sessions: manyDays(), files: { [`${OUT}.2.json`]: "[]" } });
		expect(await t.suggest("2026-10-01", "2026-10-25")).toBe(1);
		expect(t.stderr()).toContain(`${OUT}.2.json`);
		expect(t.writes).toHaveLength(0);
	});

	it("does not check targets it will not write", async () => {
		const t = setup({ sessions: [pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")]))], files: { [`${OUT}.2.json`]: "[]" } });
		expect(await t.suggest()).toBe(0);
		expect(t.writes.map((w) => w.path)).toEqual([`${OUT}.1.json`]);
	});
});

describe("suggest: Unicode forms of folder names and titles", () => {
	// macOS tools disagree on the form of "ü": Pi logs decomposed paths, Claude Code and typed config use composed ones.
	const composed = "/h/UQ/GrüneErde";
	const decomposed = "/h/UQ/GrüneErde";

	it("maps a decomposed log path to a composed config folder", async () => {
		const { parseConfig, projectFor } = await import("../.pi/skill-library/moco-timesheet/scripts/activity.ts");
		const map = parseConfig(JSON.stringify({ projects: [{ project: "GE", task: "Dev", folders: [composed] }] }), "/h");
		expect(projectFor(`${decomposed}/shopware`, map)?.project).toBe("GE");
	});

	it("maps a composed log path to a decomposed config folder", async () => {
		const { parseConfig, projectFor } = await import("../.pi/skill-library/moco-timesheet/scripts/activity.ts");
		const map = parseConfig(JSON.stringify({ projects: [{ project: "GE", task: "Dev", folders: [decomposed] }] }), "/h");
		expect(projectFor(composed, map)?.project).toBe("GE");
	});

	it("gives events of both forms one composed folder, so unmapped folders are not listed twice", async () => {
		const { parsePiSession, parseClaudeSession } = await import("../.pi/skill-library/moco-timesheet/scripts/activity.ts");
		const ts = "2026-11-10T09:00:00.000Z";
		const pi = parsePiSession(
			[JSON.stringify({ type: "session", timestamp: ts, cwd: decomposed }), JSON.stringify({ type: "message", timestamp: ts, message: { role: "user" } })].join("\n"),
		);
		const claude = parseClaudeSession(JSON.stringify({ type: "user", timestamp: ts, cwd: decomposed, message: { role: "user", content: "x" } }));
		expect(pi.events.map((e) => e.cwd)).toEqual([composed]);
		expect(claude.events.map((e) => e.cwd)).toEqual([composed]);
	});

	it("matches a meeting keyword whatever form the title uses", async () => {
		const { parseConfig, meetingProject } = await import("../.pi/skill-library/moco-timesheet/scripts/activity.ts");
		const map = parseConfig(JSON.stringify({ projects: [{ project: "GE", task: "Dev", folders: ["/h/ge"], keywords: ["Grüne Erde"] }] }), "/h");
		expect(meetingProject("Grüne Erde Weekly", map)?.project).toBe("GE");
	});
});

describe("suggest: comma separator in descriptions", () => {
	it("joins several titles of one project-day with a comma, never a semicolon", async () => {
		const t = setup({
			sessions: [
				pi("a", piSession(A, [at("09:00"), at("09:15"), at("09:30")], { title: "Fix cart bug" })),
				claude("c", claudeSession(A, [at("10:00"), at("10:15"), at("10:30")], { title: "Refactor checkout" })),
			],
		});
		expect(await t.suggest()).toBe(0);
		const [row] = t.rows();
		expect(row.description).toBe("Fix cart bug, Refactor checkout");
		expect(row.description).not.toContain(";");
	});
});

describe("suggest: projects without folders", () => {
	const WORKSHOP_CONFIG = (project: Record<string, unknown>) => ({
		gitEmails: [],
		projects: [{ project: "Website Relaunch", task: "Development", folders: ["~/work/relaunch"], keywords: ["Relaunch"] }, project],
	});
	const meeting = [{ date: D, start: "15:30", end: "17:00", title: "Update / Workshop" }];

	it.each([
		["an empty folders list", { project: "Website Support", task: "Support", folders: [], keywords: ["Workshop"] }],
		["no folders key", { project: "Website Support", task: "Support", keywords: ["Workshop"] }],
	])("books a keyword-matched meeting to a project with %s", async (_label, project) => {
		const t = setup({ config: WORKSHOP_CONFIG(project), meetings: meeting });
		expect(await t.suggest()).toBe(0);
		expect(t.rows().map((r) => `${r.project}/${r.task}/${minutes(r)}`)).toEqual(["Website Support/Support/90"]);
	});
});

describe("suggest: meeting rules", () => {
	const RULE_CONFIG = (rules: unknown) => ({
		gitEmails: [],
		meetingRules: rules,
		projects: [
			{ project: "Website Relaunch", task: "Development", folders: ["~/work/relaunch"], keywords: ["Nosto"] },
			{ project: "Website Support", task: "Support", folders: [], keywords: ["Workshop"] },
		],
	});
	const meet = (title: string, start = "10:00", end = "11:00") => ({ date: D, start, end, title });
	const book = async (rules: unknown, meetings: unknown[], sessions: SessionFile[] = []) => {
		const t = setup({ config: RULE_CONFIG(rules), meetings, sessions });
		expect(await t.suggest()).toBe(0);
		return t;
	};
	const SUPPORT = [{ title: "Abstimmung", project: "Website Support" }];

	it("an exact title rule books the meeting to its project", async () => {
		const t = await book(SUPPORT, [meet("Abstimmung")]);
		expect(t.rows().map((r) => `${r.project}/${minutes(r)}`)).toEqual(["Website Support/60"]);
	});

	it("matches the whole title only, ignoring case and surrounding spaces", async () => {
		const t = await book(SUPPORT, [meet("  abstimmung ", "10:00", "10:30"), meet("Abstimmung Release", "11:00", "11:30")]);
		expect(t.rows().map((r) => `${r.project}/${minutes(r)}`)).toEqual(["Website Support/30"]);
		expect(t.stdout()).toContain("Abstimmung Release");
	});

	it("a rule wins over a keyword clash, and other titles still use keywords", async () => {
		const t = await book([{ title: "Nosto Workshop", project: "Website Support" }], [meet("Nosto Workshop", "10:00", "10:30"), meet("Nosto sync", "11:00", "11:30")]);
		expect(t.rows().map((r) => `${r.project}/${minutes(r)}`).sort()).toEqual(["Website Relaunch/30", "Website Support/30"]);
	});

	it("a skip rule books nothing, reports nothing as unclaimed, and keeps the log time", async () => {
		const t = await book([{ title: "Weekly: eCommerce", skip: true }], [meet("Weekly: eCommerce")], [pi("a", piSession(A, everyFifteen("10:00", "11:00")))]);
		expect(t.rows().map((r) => `${r.project}/${minutes(r)}`)).toEqual(["Website Relaunch/60"]);
		expect(t.stdout()).not.toContain("Weekly: eCommerce");
	});

	it("rejects a rule whose project is configured twice, since the task would be a guess", async () => {
		const config = {
			gitEmails: [],
			meetingRules: [{ title: "Abstimmung", project: "Website Support" }],
			projects: [
				{ project: "Website Support", task: "Support", folders: ["~/work/support"] },
				{ project: "Website Support", task: "Other", folders: [], keywords: ["Workshop"] },
			],
		};
		const t = setup({ config, meetings: [meet("Abstimmung")] });
		expect(await t.suggest()).toBe(1);
		expect(t.stderr()).toMatch(/meetingRules/);
		expect(t.writes).toHaveLength(0);
	});

	it.each([
		["not a list", {}],
		["an empty title", [{ title: " ", project: "Website Support" }]],
		["an unknown project", [{ title: "Abstimmung", project: "Nope" }]],
		["both project and skip", [{ title: "Abstimmung", project: "Website Support", skip: true }]],
		["neither project nor skip", [{ title: "Abstimmung" }]],
		["a duplicate title", [{ title: "Abstimmung", skip: true }, { title: "ABSTIMMUNG", project: "Website Support" }]],
		["an unknown key", [{ title: "Abstimmung", skip: true, extra: 1 }]],
	])("exits 1 and writes nothing for %s", async (_label, rules) => {
		const t = setup({ config: RULE_CONFIG(rules), meetings: [meet("Abstimmung")] });
		expect(await t.suggest()).toBe(1);
		expect(t.stderr()).toMatch(/meetingRules/);
		expect(t.writes).toHaveLength(0);
	});
});
