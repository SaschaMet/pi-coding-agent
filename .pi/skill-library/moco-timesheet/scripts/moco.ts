// MOCO timesheet CLI: read your own hours and book time after a confirmed preview.
// Usage: node --use-env-proxy moco.ts <projects|list|sum|add|suggest> [options]
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { type ActivityEvent, buildDays, type DayReport, type Meeting, parseClaudeSession, parseConfig, parseGitLog, parseMeetings, parsePiSession, type ProjectMap } from "./activity.ts";

export interface Deps {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	readSecret: (service: string) => Promise<string | undefined>;
	readFile: (path: string) => Promise<string>;
	// Refuses to overwrite, so a file the user already previewed is never replaced.
	writeFile: (path: string, text: string) => Promise<void>;
	listFiles: (dir: string, ext: string) => Promise<{ path: string; mtimeMs: number }[]>;
	git: (repo: string, args: string[]) => Promise<string>;
	exists: (path: string) => Promise<boolean>;
	// Repo roots (directories holding .git) at or under dir, at most maxDepth levels down.
	findRepos: (dir: string, maxDepth: number) => Promise<string[]>;
	home: string;
	now: () => Date;
	out: (text: string) => void;
	err: (text: string) => void;
}

export interface ActivityPayload {
	date: string;
	project_id: number;
	task_id: number;
	seconds: number;
	description: string;
}

interface Task {
	id: number;
	name: string;
	active: boolean;
	billable: boolean;
}

interface Project {
	id: number;
	identifier: string;
	name: string;
	billable: boolean;
	customer?: { name: string };
	tasks: Task[];
}

interface Activity {
	id: number;
	date: string;
	billable?: boolean;
	seconds: number;
	worked_seconds?: number;
	description: string | null;
	project: { id: number; name: string };
	task: { id: number; name: string };
}

interface Entry {
	payload: ActivityPayload;
	project: Project;
	task: Task;
}

const MAX_ROWS = 20;
const TIMEOUT_MS = 15_000;
const ROW_KEYS = new Set(["date", "project", "task", "hours", "description"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOMAIN = /^[a-z0-9-]+$/;

class UsageError extends Error {}

class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

class Moco {
	private readonly deps: Deps;
	private readonly key: string;
	readonly base: string;

	constructor(deps: Deps, domain: string, key: string) {
		this.deps = deps;
		this.key = key;
		this.base = `https://${domain}.mocoapp.com/api/v1`;
	}

	private async request(url: string, init: RequestInit = {}): Promise<Response> {
		const res = await this.deps.fetch(mocoOnly(url), {
			...init,
			headers: { Authorization: `Token token=${this.key}`, "Content-Type": "application/json" },
			// A redirect would carry the key to wherever MOCO points; refuse instead.
			redirect: "error",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) throw new HttpError(res.status, await errorMessage(res));
		return res;
	}

	async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
		const res = await this.request(this.url(path, query));
		return (await res.json()) as T;
	}

	async getAll<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
		const items: T[] = [];
		let next: string | undefined = this.url(path, query);
		while (next) {
			const res = await this.request(next);
			items.push(...((await res.json()) as T[]));
			next = nextLink(res.headers.get("link"), next);
		}
		return items;
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		const res = await this.request(this.url(path), { method: "POST", body: JSON.stringify(body) });
		return (await res.json()) as T;
	}

	private url(path: string, query: Record<string, string> = {}): string {
		const url = URL.parse(this.base + path);
		if (!url) throw new UsageError(`invalid request path ${path}`);
		for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
		return url.href;
	}
}

async function errorMessage(res: Response): Promise<string> {
	const text = await res.text().catch(() => "");
	try {
		const body = JSON.parse(text) as { message?: unknown };
		if (typeof body.message === "string") return body.message;
	} catch {
		// not JSON: fall through to the raw text
	}
	return text.slice(0, 200);
}

// Last line of defence: the key travels only to https://<sub>.mocoapp.com.
function mocoOnly(url: string): string {
	const parsed = URL.parse(url);
	if (parsed?.protocol !== "https:" || !/^[a-z0-9-]+\.mocoapp\.com$/.test(parsed.hostname)) {
		throw new UsageError("refusing a request outside https://<subdomain>.mocoapp.com");
	}
	return parsed.href;
}

// Follow pagination only to the same endpoint, so a Link header cannot steer the key elsewhere.
function nextLink(header: string | null, current: string): string | undefined {
	const match = header?.match(/<([^>]+)>\s*;\s*rel="next"/);
	if (!match) return undefined;
	const next = URL.parse(match[1]);
	const now = URL.parse(current);
	return next && now && next.origin === now.origin && next.pathname === now.pathname ? next.href : undefined;
}

export function confirmCode(entries: ActivityPayload[]): string {
	const canonical = JSON.stringify(entries.map((e) => [e.date, e.project_id, e.task_id, e.seconds, e.description]));
	return createHash("sha256").update(canonical).digest("hex").slice(0, 8);
}

function hm(seconds: number): string {
	const minutes = Math.round(seconds / 60);
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function parseDate(value: unknown, label: string): string {
	if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
		throw new UsageError(`${label} must be a date like 2026-11-03`);
	}
	return value;
}

function parseHours(value: unknown, label: string): number {
	let hours = Number.NaN;
	if (typeof value === "number") hours = value;
	else if (typeof value === "string") {
		const clock = value.match(/^(\d+):([0-5]\d)$/);
		hours = clock ? Number(clock[1]) + Number(clock[2]) / 60 : Number(value);
	}
	const seconds = Math.round(hours * 60) * 60;
	if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 3600) {
		throw new UsageError(`${label} must be between 0:01 and 24:00 (decimal or h:mm)`);
	}
	return seconds;
}

function match<T>(items: T[], query: string | number, keys: (item: T) => { id: number; names: string[] }, label: string): T {
	const q = String(query).trim().toLowerCase();
	const byId = items.filter((i) => String(keys(i).id) === q);
	if (byId.length === 1) return byId[0];
	const exact = items.filter((i) => keys(i).names.some((n) => n.toLowerCase() === q));
	const hits = exact.length > 0 ? exact : items.filter((i) => keys(i).names.some((n) => n.toLowerCase().includes(q)));
	if (hits.length === 1) return hits[0];
	const list = (hits.length > 0 ? hits : items).map((i) => `  ${keys(i).id} ${keys(i).names.join(" / ")}`).join("\n");
	throw new UsageError(`${hits.length === 0 ? "no" : "several"} ${label} match "${query}". Candidates:\n${list}`);
}

const projectKeys = (p: Project) => ({ id: p.id, names: [p.name, p.identifier].filter(Boolean) });
const taskKeys = (t: Task) => ({ id: t.id, names: [t.name] });

interface Row {
	date: string;
	project: string | number;
	task: string | number;
	seconds: number;
	description: string;
}

function parseRows(text: string): Row[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new UsageError("file is not valid JSON");
	}
	if (!Array.isArray(data) || data.length === 0 || data.length > MAX_ROWS) {
		throw new UsageError(`file must be a JSON array of 1 to ${MAX_ROWS} entries`);
	}
	return data.map((raw: unknown, i) => {
		const label = `row ${i + 1}`;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new UsageError(`${label} must be an object`);
		const row = raw as Record<string, unknown>;
		const unknown = Object.keys(row).filter((k) => !ROW_KEYS.has(k));
		if (unknown.length > 0) throw new UsageError(`${label} has unknown keys: ${unknown.join(", ")}`);
		for (const key of ["project", "task"] as const) {
			if (typeof row[key] !== "string" && typeof row[key] !== "number") throw new UsageError(`${label}: ${key} is required`);
		}
		if (row.description !== undefined && typeof row.description !== "string") {
			throw new UsageError(`${label}: description must be text`);
		}
		return {
			date: parseDate(row.date, `${label}: date`),
			project: row.project as string | number,
			task: row.task as string | number,
			seconds: parseHours(row.hours, `${label}: hours`),
			description: ((row.description as string | undefined) ?? "").trim(),
		};
	});
}

function resolve(rows: Row[], projects: Project[]): Entry[] {
	const entries = rows.map((row, i) => {
		const project = match(projects, row.project, projectKeys, `row ${i + 1}: projects`);
		const tasks = project.tasks.filter((t) => t.active);
		const task = match(tasks, row.task, taskKeys, `row ${i + 1}: active tasks of ${project.name}`);
		const payload = { date: row.date, project_id: project.id, task_id: task.id, seconds: row.seconds, description: row.description };
		return { payload, project, task };
	});
	const seen = new Map<string, number>();
	entries.forEach((e, i) => {
		const key = JSON.stringify(e.payload);
		const first = seen.get(key);
		if (first !== undefined) throw new UsageError(`rows ${first + 1} and ${i + 1} are identical. Book a true duplicate in the MOCO web UI.`);
		seen.set(key, i);
	});
	return entries;
}

function sameEntry(a: Activity, p: ActivityPayload): boolean {
	return (
		a.date === p.date &&
		a.project.id === p.project_id &&
		a.task.id === p.task_id &&
		(a.worked_seconds ?? a.seconds) === p.seconds &&
		(a.description ?? "").trim() === p.description
	);
}

async function findIdentical(moco: Moco, userId: number, entries: Entry[]): Promise<string[]> {
	const dates = entries.map((e) => e.payload.date).sort();
	const existing = await moco.getAll<Activity>("/activities", {
		from: dates[0],
		to: dates[dates.length - 1],
		user_id: String(userId),
	});
	return entries.flatMap((e, i) => {
		const hit = existing.find((a) => sameEntry(a, e.payload));
		return hit ? [`row ${i + 1} matches existing entry ${hit.id}`] : [];
	});
}

function formatEntry(e: Entry, n: number): string {
	const p = e.payload;
	const billable = e.project.billable && e.task.billable ? "yes" : "no";
	return `${n}. ${p.date}  ${hm(p.seconds)} (${p.seconds} s)  ${e.project.name} / ${e.task.name}  "${p.description}"  billable: ${billable}`;
}

function formatActivity(a: Partial<Activity>): string {
	const seconds = a.worked_seconds ?? a.seconds ?? 0;
	const where = a.project && a.task ? `  ${a.project.name} / ${a.task.name}` : "";
	return `${a.date}  ${hm(seconds)}${where}  "${a.description ?? ""}"  [id ${a.id}]`;
}

const COMMANDS = {
	projects: {},
	list: { from: { type: "string" }, to: { type: "string" }, project: { type: "string" } },
	sum: {
		from: { type: "string" },
		to: { type: "string" },
		project: { type: "string" },
		by: { type: "string" },
		billable: { type: "boolean" },
	},
	add: { file: { type: "string" }, confirm: { type: "string" } },
	suggest: { from: { type: "string" }, to: { type: "string" }, out: { type: "string" }, meetings: { type: "string" } },
} as const;

type Command = keyof typeof COMMANDS;

interface Values {
	from?: string;
	to?: string;
	project?: string;
	by?: string;
	billable?: boolean;
	file?: string;
	confirm?: string;
	out?: string;
	meetings?: string;
}

async function connect(deps: Deps): Promise<{ moco: Moco; key: string }> {
	const key = (await deps.readSecret("moco-api"))?.trim();
	const domain = (await deps.readSecret("moco-domain"))?.trim();
	if (!key) throw new UsageError('Keychain item "moco-api" not found. Setup: security add-generic-password -s moco-api -a "$USER" -w');
	if (!domain) {
		throw new UsageError('Keychain item "moco-domain" not found. Setup: security add-generic-password -s moco-domain -a "$USER" -w <subdomain>');
	}
	if (!DOMAIN.test(domain)) throw new UsageError('Keychain item "moco-domain" must be the bare subdomain, e.g. "acme" for acme.mocoapp.com');
	return { moco: new Moco(deps, domain, key), key };
}

async function myActivities(moco: Moco, values: Values): Promise<Activity[]> {
	const from = parseDate(values.from, "--from");
	const to = parseDate(values.to, "--to");
	if (from > to) throw new UsageError("--from must not be after --to");
	const profile = await moco.get<{ id: number }>("/profile");
	const all = await moco.getAll<Activity>("/activities", { from, to, user_id: String(profile.id) });
	if (values.project === undefined) return all;
	const projects = [...new Map(all.map((a) => [a.project.id, a.project])).values()];
	const project = match(projects, values.project, (p) => ({ id: p.id, names: [p.name] }), "projects in this range");
	return all.filter((a) => a.project.id === project.id);
}

async function projectsCommand(moco: Moco, deps: Deps): Promise<number> {
	const projects = await moco.get<Project[]>("/projects/assigned", { active: "true" });
	for (const p of projects) {
		deps.out(`${p.id}  ${p.identifier ?? ""}  ${p.name}${p.customer ? ` (${p.customer.name})` : ""}`);
		for (const t of p.tasks.filter((x) => x.active)) {
			deps.out(`    task ${t.id}  ${t.name}${t.billable && p.billable ? "" : "  [not billable]"}`);
		}
	}
	return 0;
}

async function listCommand(moco: Moco, deps: Deps, values: Values): Promise<number> {
	const activities = await myActivities(moco, values);
	for (const a of activities) deps.out(formatActivity(a));
	deps.out(`${activities.length} entries`);
	return 0;
}

async function sumCommand(moco: Moco, deps: Deps, values: Values): Promise<number> {
	if (values.by !== undefined && values.by !== "project" && values.by !== "day") throw new UsageError("--by must be project or day");
	const activities = await myActivities(moco, values);
	// MOCO keeps `seconds` filled on non-billable entries, so --billable must also check the flag.
	const seconds = (a: Activity) => (values.billable ? (a.billable ? a.seconds : 0) : (a.worked_seconds ?? a.seconds));
	if (values.by) {
		const groups = new Map<string, number>();
		for (const a of activities) {
			const group = values.by === "day" ? a.date : a.project.name;
			groups.set(group, (groups.get(group) ?? 0) + seconds(a));
		}
		for (const [group, total] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
			deps.out(`${group}  ${hm(total)}  (${(total / 3600).toFixed(2)} h)`);
		}
	}
	const total = activities.reduce((s, a) => s + seconds(a), 0);
	deps.out(`Total  ${hm(total)}  (${(total / 3600).toFixed(2)} h, ${values.billable ? "billable" : "worked"})`);
	return 0;
}

async function addCommand(moco: Moco, deps: Deps, values: Values, rows: Row[]): Promise<number> {
	const projects = await moco.get<Project[]>("/projects/assigned", { active: "true" });
	const entries = resolve(rows, projects);
	const profile = await moco.get<{ id: number }>("/profile");
	// Checked at preview too, so the user never approves a booking the script will refuse.
	const before = await findIdentical(moco, profile.id, entries);
	if (before.length > 0) throw new UsageError(`${before.join("; ")}. Book a true duplicate in the MOCO web UI.`);
	const code = confirmCode(entries.map((e) => e.payload));
	if (values.confirm === undefined) {
		entries.forEach((e, i) => deps.out(formatEntry(e, i + 1)));
		deps.out(`Total: ${hm(entries.reduce((s, e) => s + e.payload.seconds, 0))} in ${entries.length} entries`);
		deps.out(`confirm: ${code}`);
		deps.out("Nothing written yet.");
		return 0;
	}
	if (values.confirm !== code) throw new UsageError("confirm code does not match these entries. Preview again.");
	for (const [i, entry] of entries.entries()) {
		try {
			deps.out(formatActivity(await moco.post<Activity>("/activities", entry.payload)));
		} catch (error) {
			const why =
				error instanceof HttpError ? `failed: ${error.status} ${error.message}` : "unknown — may have landed (no answer from MOCO)";
			const rows = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => `row ${from + k + 1}`).join(", ") || "none";
			deps.err(`Error: stopped at row ${i + 1}: ${why}`);
			deps.err(`Landed: ${rows(0, i)}`);
			deps.err(`Unwritten: ${rows(i + 1, entries.length)}`);
			return 1;
		}
	}
	return 0;
}

const SESSION_DIRS = [
	{ dir: ".pi/agent/sessions", parse: parsePiSession },
	{ dir: ".claude/projects", parse: parseClaudeSession },
] as const;

async function loadConfig(deps: Deps): Promise<ProjectMap> {
	const path = `${deps.home}/.config/moco/projects.json`;
	try {
		return parseConfig(await deps.readFile(path), deps.home);
	} catch (error) {
		const why = error instanceof Error ? error.message : "unreadable";
		throw new UsageError(`cannot use ${path}: ${why}. Create it from the template in SKILL.md ("One-time setup for log hours").`);
	}
}

const REPO_DEPTH = 3;

async function readCommits(deps: Deps, map: ProjectMap, from: string): Promise<{ events: ActivityEvent[]; skipped: number }> {
	const events: ActivityEvent[] = [];
	let skipped = 0;
	if (map.gitEmails.length === 0) return { events, skipped };
	const repos = new Set<string>();
	for (const folder of new Set(map.projects.flatMap((p) => p.folders))) {
		for (const repo of await deps.findRepos(folder, REPO_DEPTH)) repos.add(repo);
	}
	for (const repo of repos) {
		for (const email of map.gitEmails) {
			// An argument array, never a shell line: the address comes from a config file.
			const text = await deps.git(repo, [
				"--no-pager",
				"log",
				"--all",
				`--author=${email}`,
				// No --until: git filters on committer date, which a rebase moves past the range; the day filter
				// on author dates happens later. --since stays safe because committer date is never before author date.
				`--since=${from}T00:00:00`,
				"--format=%aI%x09%s",
			]);
			const parsed = parseGitLog(text, repo);
			events.push(...parsed.events);
			skipped += parsed.skipped;
		}
	}
	return { events, skipped };
}

async function readEvents(deps: Deps, from: string): Promise<{ events: ActivityEvent[]; skipped: number }> {
	// Sessions untouched since before the range cannot hold events inside it; skipping them avoids most of the scan.
	const since = new Date(`${from}T00:00:00`).getTime();
	const events: ActivityEvent[] = [];
	let skipped = 0;
	for (const { dir, parse } of SESSION_DIRS) {
		for (const file of await deps.listFiles(`${deps.home}/${dir}`, ".jsonl")) {
			if (file.mtimeMs < since) continue;
			const parsed = parse(await deps.readFile(file.path));
			for (const e of parsed.events) events.push(e);
			skipped += parsed.skipped;
		}
	}
	return { events, skipped };
}

function suggestReport(report: DayReport, from: string, to: string, skipped: number, booked: string[]): string[] {
	const lines = [`Range: ${from} to ${to}`];
	const mins = (m: number) => Math.round(m);
	const section = (title: string, items: string[]) => {
		if (items.length > 0) lines.push("", title, ...items.map((i) => `  ${i}`));
	};
	const who = (r: DayReport["rows"][number]) => `${r.date}  ${r.entry.project} / ${r.task}`;
	section("Work:", report.rows.map((r) => `${who(r)}  raw ${mins(r.rawMinutes)} min  booked ${hm(r.bookedMinutes * 60)}`));
	section("Skipped, MOCO already has an own entry that day:", booked);
	section("Left out (rounds to 0):", report.dropped.map((r) => `${who(r)}  raw ${mins(r.rawMinutes)} min  dropped`));
	section(
		"Shared with unmapped folders:",
		report.rows
			.concat(report.dropped)
			.filter((r) => r.lostToUnmappedMinutes > 0)
			.map((r) => `${r.date}  ${r.entry.project}  ${mins(r.lostToUnmappedMinutes)} min went to unmapped activity`),
	);
	section(
		"Meeting time removed from log time:",
		report.cuts.map((c) => `${c.date}  ${c.title}  ${c.entry.project}  ${mins(c.minutes)} min`),
	);
	section(
		"Meetings no project claims (keyword matched none or several):",
		report.unassigned.map((m) => `${m.date}  ${m.title}`),
	);
	section(
		"Unmapped folders:",
		report.unmapped.map((u) => `${u.cwd}  ${u.events} events  ${mins(u.minutes)} min`),
	);
	section(
		"Flags:",
		report.rows.filter((r) => r.agentOnlyMinutes > 0).map((r) => `${r.date}  ${r.entry.project}  agent-only ${hm(r.agentOnlyMinutes * 60)}`),
	);
	section(
		"No description:",
		report.rows.filter((r) => r.description === "").map((r) => `${r.date}  ${r.entry.project}`),
	);
	if (skipped > 0) lines.push("", `Skipped ${skipped} unparseable log lines`);
	return lines;
}

async function loadMeetings(deps: Deps, path: string): Promise<Meeting[]> {
	try {
		return parseMeetings(await deps.readFile(path));
	} catch (error) {
		const why = error instanceof Error ? error.message : "unreadable";
		throw new UsageError(`cannot use meetings file ${path}: ${why}`);
	}
}

const LOOKBACK_DAYS = 31;

function isoDay(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(day: string, n: number): string {
	const [y, m, d] = day.split("-").map(Number);
	return isoDay(new Date(y, m - 1, d + n));
}

// Each config project must exist in MOCO with active tasks, or nothing is written.
function resolveConfig(map: ProjectMap, projects: Project[]): Map<ProjectMap["projects"][number], number> {
	const ids = new Map<ProjectMap["projects"][number], number>();
	map.projects.forEach((entry, i) => {
		const where = `config entry ${i + 1}`;
		const project = match(projects, entry.project, projectKeys, `${where}: projects`);
		const tasks = project.tasks.filter((t) => t.active);
		for (const task of [entry.task, entry.meetingTask]) {
			if (task !== undefined) match(tasks, task, taskKeys, `${where}: active tasks of ${project.name}`);
		}
		ids.set(entry, project.id);
	});
	return ids;
}

// One start for all projects: a lagging project must not lose days because another was booked recently.
function defaultStart(own: Activity[], mapped: Set<number>, lookback: string): string {
	const starts = [...mapped].map((id) => {
		const last = own
			.filter((a) => a.project.id === id)
			.map((a) => a.date)
			.sort()
			.pop();
		return last === undefined ? lookback : addDays(last, 1);
	});
	return starts.sort()[0];
}

// Any own entry on a project and date blocks every row of that project-day; returns the report lines.
function skipBooked(report: DayReport, own: Activity[], ids: Map<ProjectMap["projects"][number], number>): string[] {
	const mocoSeconds = new Map<string, number>();
	for (const a of own) {
		const key = `${a.project.id}|${a.date}`;
		mocoSeconds.set(key, (mocoSeconds.get(key) ?? 0) + (a.worked_seconds ?? a.seconds));
	}
	const keyOf = (r: DayReport["rows"][number]) => `${ids.get(r.entry)}|${r.date}`;
	const logMinutes = new Map<string, { minutes: number; first: DayReport["rows"][number] }>();
	for (const r of report.rows.filter((x) => mocoSeconds.has(keyOf(x)))) {
		const seen = logMinutes.get(keyOf(r));
		logMinutes.set(keyOf(r), { minutes: (seen?.minutes ?? 0) + r.bookedMinutes, first: seen?.first ?? r });
	}
	report.rows = report.rows.filter((r) => !mocoSeconds.has(keyOf(r)));
	return [...logMinutes].map(
		([key, { minutes, first }]) =>
			`${first.date}  ${first.entry.project}  already booked  MOCO ${hm(mocoSeconds.get(key) ?? 0)}  logs ${hm(minutes * 60)}`,
	);
}

async function suggestCommand(deps: Deps, values: Values, connectToMoco: () => Promise<Moco>): Promise<number> {
	if (values.out === undefined) throw new UsageError("suggest needs --out <path prefix>");
	const given = {
		from: values.from === undefined ? undefined : parseDate(values.from, "--from"),
		to: values.to === undefined ? undefined : parseDate(values.to, "--to"),
	};
	const map = await loadConfig(deps);
	const meetings = values.meetings === undefined ? [] : await loadMeetings(deps, values.meetings);
	const moco = await connectToMoco();
	const projects = await moco.get<Project[]>("/projects/assigned", { active: "true" });
	const ids = resolveConfig(map, projects);
	const profile = await moco.get<{ id: number }>("/profile");

	const today = isoDay(deps.now());
	const lookback = addDays(today, -LOOKBACK_DAYS);
	const to = given.to ?? addDays(today, -1);
	const readFrom = given.from ?? lookback;
	if (readFrom > to) throw new UsageError("--from must not be after --to");
	const entries = await moco.getAll<Activity>("/activities", { from: readFrom, to, user_id: String(profile.id) });
	const mapped = new Set(ids.values());
	const own = entries.filter((a) => mapped.has(a.project.id));

	const from = given.from ?? defaultStart(own, mapped, lookback);
	if (from > to) {
		deps.out(`Range: ${from} to ${to}`);
		deps.out("Nothing to suggest: every mapped project is booked through the end of the range.");
		return 0;
	}
	const logs = await readEvents(deps, from);
	const commits = await readCommits(deps, map, from);
	const events = [...logs.events, ...commits.events];
	const skipped = logs.skipped + commits.skipped;
	const report = buildDays({ events, map, from, to, meetings });

	const booked = skipBooked(report, own, ids);

	const rows = report.rows.map((r) => ({
		date: r.date,
		project: r.entry.project,
		task: r.task,
		hours: hm(r.bookedMinutes * 60),
		description: r.description,
	}));
	const written: string[] = [];
	const targets = Array.from({ length: Math.ceil(rows.length / MAX_ROWS) }, (_, i) => `${values.out}.${i + 1}.json`);
	// All targets are checked first, so a refusal never leaves a partial set behind.
	for (const path of targets) {
		if (await deps.exists(path)) throw new UsageError(`${path} already exists. Pick another --out or remove it.`);
	}
	for (const [i, path] of targets.entries()) {
		await deps.writeFile(path, `${JSON.stringify(rows.slice(i * MAX_ROWS, (i + 1) * MAX_ROWS), null, 2)}\n`);
		written.push(path);
	}
	for (const line of suggestReport(report, from, to, skipped, booked)) deps.out(line);
	deps.out("");
	deps.out(written.length > 0 ? `Wrote ${rows.length} rows: ${written.join(", ")}` : "No rows to write.");
	return 0;
}

export async function run(argv: string[], unsafeDeps: Deps): Promise<number> {
	let key: string | undefined;
	const scrub = (text: string) => (key ? text.replaceAll(key, "***") : text);
	// Every line leaves through scrub, so MOCO text that echoes the key never reaches the transcript.
	const deps: Deps = { ...unsafeDeps, out: (text) => unsafeDeps.out(scrub(text)), err: (text) => unsafeDeps.err(scrub(text)) };
	try {
		const [command, ...rest] = argv;
		if (!command || !Object.hasOwn(COMMANDS, command)) {
			throw new UsageError(`unknown command "${command ?? ""}". Use: projects | list | sum | add | suggest`);
		}
		const options = COMMANDS[command as Command];
		const values = parseArgs({ args: rest, options, strict: true, allowPositionals: false }).values as Values;
		let rows: Row[] = [];
		if (command === "add") {
			if (typeof values.file !== "string") throw new UsageError("add needs --file <json>");
			// Validate the file before any request, so a bad file never costs a call.
			rows = parseRows(await deps.readFile(values.file));
		}
		if (command === "suggest") {
			return await suggestCommand(deps, values, async () => {
				const connection = await connect(deps);
				key = connection.key;
				return connection.moco;
			});
		}
		const connection = await connect(deps);
		key = connection.key;
		const { moco } = connection;
		if (command === "projects") return await projectsCommand(moco, deps);
		if (command === "list") return await listCommand(moco, deps, values);
		if (command === "sum") return await sumCommand(moco, deps, values);
		return await addCommand(moco, deps, values, rows);
	} catch (error) {
		if (error instanceof HttpError) deps.err(`Error: ${error.status} ${error.message}`);
		else if (error instanceof Error) deps.err(`Error: ${error.message}`);
		else deps.err("Error: unexpected failure");
		return 1;
	}
}

function readKeychain(service: string): Promise<string | undefined> {
	return new Promise((done) => {
		execFile("security", ["find-generic-password", "-s", service, "-w"], (error, stdout) => done(error ? undefined : stdout.trim()));
	});
}

async function listJsonFiles(dir: string, ext: string): Promise<{ path: string; mtimeMs: number }[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { recursive: true, withFileTypes: true });
	} catch {
		return [];
	}
	const files = entries.filter((e) => e.isFile() && e.name.endsWith(ext));
	return Promise.all(
		files.map(async (e) => {
			const path = `${e.parentPath}/${e.name}`;
			return { path, mtimeMs: (await stat(path)).mtimeMs };
		}),
	);
}

const SKIP_DIRS = new Set(["node_modules", ".cache", "Library"]);

async function findGitRepos(dir: string, maxDepth: number): Promise<string[]> {
	const repos: string[] = [];
	const walk = async (path: string, depth: number): Promise<void> => {
		let entries: Dirent[];
		try {
			entries = await readdir(path, { withFileTypes: true });
		} catch {
			return;
		}
		if (entries.some((e) => e.name === ".git")) repos.push(path);
		if (depth >= maxDepth) return;
		// Symlinks are not followed, so a link cannot lead the scan out of the mapped folder.
		for (const e of entries) {
			if (e.isDirectory() && e.name !== ".git" && !SKIP_DIRS.has(e.name)) await walk(`${path}/${e.name}`, depth + 1);
		}
	};
	await walk(dir, 0);
	return repos;
}

function runGit(repo: string, args: string[]): Promise<string> {
	return new Promise((done, fail) => {
		execFile("git", args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? fail(error) : done(stdout)));
	});
}

if (import.meta.main) {
	process.exitCode = await run(process.argv.slice(2), {
		fetch: (url, init) => fetch(mocoOnly(url), init),
		readSecret: readKeychain,
		readFile: (path) => readFile(path, "utf8"),
		writeFile: (path, text) => writeFile(path, text, { flag: "wx" }),
		listFiles: listJsonFiles,
		git: runGit,
		exists: (path) => access(path).then(
			() => true,
			() => false,
		),
		findRepos: findGitRepos,
		home: homedir(),
		now: () => new Date(),
		out: (text) => console.log(text),
		err: (text) => console.error(text),
	});
}
