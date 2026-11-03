// MOCO timesheet CLI: read your own hours and book time after a confirmed preview.
// Usage: node --use-env-proxy moco.ts <projects|list|sum|add> [options]
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

export interface Deps {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	readSecret: (service: string) => Promise<string | undefined>;
	readFile: (path: string) => Promise<string>;
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

export async function run(argv: string[], unsafeDeps: Deps): Promise<number> {
	let key: string | undefined;
	const scrub = (text: string) => (key ? text.replaceAll(key, "***") : text);
	// Every line leaves through scrub, so MOCO text that echoes the key never reaches the transcript.
	const deps: Deps = { ...unsafeDeps, out: (text) => unsafeDeps.out(scrub(text)), err: (text) => unsafeDeps.err(scrub(text)) };
	try {
		const [command, ...rest] = argv;
		if (!command || !Object.hasOwn(COMMANDS, command)) {
			throw new UsageError(`unknown command "${command ?? ""}". Use: projects | list | sum | add`);
		}
		const options = COMMANDS[command as Command];
		const values = parseArgs({ args: rest, options, strict: true, allowPositionals: false }).values as Values;
		let rows: Row[] = [];
		if (command === "add") {
			if (typeof values.file !== "string") throw new UsageError("add needs --file <json>");
			// Validate the file before any request, so a bad file never costs a call.
			rows = parseRows(await deps.readFile(values.file));
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

if (import.meta.main) {
	process.exitCode = await run(process.argv.slice(2), {
		fetch: (url, init) => fetch(mocoOnly(url), init),
		readSecret: readKeychain,
		readFile: (path) => readFile(path, "utf8"),
		out: (text) => console.log(text),
		err: (text) => console.error(text),
	});
}
