// Turns local activity logs into per-project, per-day minutes. Pure: strings in, numbers out.
// Every read of a file or the clock happens in moco.ts behind Deps.

export const IDLE_MS = 20 * 60_000;
export const ROUND_MIN = 30;
export const AGENT_ONLY_MS = 60 * 60_000;
export const DESCRIPTION_MAX = 250;

export interface ActivityEvent {
	at: number;
	cwd: string;
	source: "pi" | "claude" | "git";
	// True only for a message the user typed; tool output, meta lines and spawned-session input are not.
	prompt: boolean;
	// Session title: the only text from a log that may reach a description.
	note?: string;
}

export interface ParsedLog {
	events: ActivityEvent[];
	skipped: number;
}

export interface ProjectEntry {
	project: string;
	task: string;
	meetingTask?: string;
	folders: string[];
	keywords: string[];
}

// A whole-title rule for a meeting keywords cannot place: it books to one configured project, or is skipped.
export interface MeetingRule {
	title: string;
	project?: string;
	skip?: boolean;
}

export interface ProjectMap {
	gitEmails: string[];
	projects: ProjectEntry[];
	meetingRules: MeetingRule[];
}

export interface DayRow {
	date: string;
	entry: ProjectEntry;
	rawMinutes: number;
	bookedMinutes: number;
	description: string;
	lostToUnmappedMinutes: number;
	agentOnlyMinutes: number;
	kind: "work" | "meeting";
	// meetingTask for a meeting row when the project has one, else the normal task.
	task: string;
}

export interface Meeting {
	date: string;
	start: number;
	end: number;
	title: string;
}

// Log time a meeting took from one project, measured on that project's own windows before sharing.
export interface MeetingCut {
	date: string;
	title: string;
	entry: ProjectEntry;
	minutes: number;
}

export interface UnmappedFolder {
	cwd: string;
	events: number;
	minutes: number;
}

export interface BuildInput {
	events: ActivityEvent[];
	map: ProjectMap;
	from: string;
	to: string;
	meetings?: Meeting[];
}

export interface DayReport {
	// Rows that round to at least one step, ready to book.
	rows: DayRow[];
	// Rows with raw time that round to zero.
	dropped: DayRow[];
	unmapped: UnmappedFolder[];
	cuts: MeetingCut[];
	// Meetings no single project claims; they still removed log time.
	unassigned: Meeting[];
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function stringList(value: unknown, label: string, required: boolean): string[] {
	if (value === undefined && !required) return [];
	if (!Array.isArray(value) || (required && value.length === 0) || !value.every(isText)) {
		throw new Error(`${label} must be a ${required ? "non-empty " : ""}list of text`);
	}
	return value.map((v) => v.trim());
}

// macOS tools write "ü" in different Unicode forms (Pi decomposed, Claude Code and typed config composed),
// so every path and title is compared in one form.
const nfc = (text: string) => text.normalize("NFC");

function expandHome(folder: string, home: string): string {
	folder = nfc(folder);
	const base = nfc(home).replace(/\/+$/, "");
	let path = folder;
	if (folder === "~") path = base;
	else if (folder.startsWith("~/")) path = `${base}/${folder.slice(2)}`;
	const trimmed = path.replace(/\/+$/, "");
	if (!trimmed.startsWith("/")) throw new Error(`folder "${folder}" must be an absolute path or start with ~/`);
	return trimmed;
}

export function parseConfig(text: string, home: string): ProjectMap {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("not valid JSON");
	}
	if (!isObject(data)) throw new Error("must be a JSON object");
	if (!Array.isArray(data.projects) || data.projects.length === 0) throw new Error("projects must be a non-empty list");
	const projects = data.projects.map((raw: unknown, i): ProjectEntry => {
		const label = `projects[${i}]`;
		if (!isObject(raw)) throw new Error(`${label} must be an object`);
		if (!isText(raw.project) || !isText(raw.task)) throw new Error(`${label} needs text for project and task`);
		if (raw.meetingTask !== undefined && !isText(raw.meetingTask)) throw new Error(`${label}.meetingTask must be text`);
		const folders = stringList(raw.folders, `${label}.folders`, false).map((f) => expandHome(f, home));
		const keywords = stringList(raw.keywords, `${label}.keywords`, false);
		// An internal project has no code folder and is reached by meeting keywords alone; with neither it can never match.
		if (folders.length === 0 && keywords.length === 0) throw new Error(`${label} needs folders or keywords`);
		return {
			project: raw.project.trim(),
			task: raw.task.trim(),
			meetingTask: raw.meetingTask?.trim(),
			folders,
			keywords,
		};
	});
	return { gitEmails: stringList(data.gitEmails, "gitEmails", false), projects, meetingRules: parseMeetingRules(data.meetingRules, projects) };
}

const titleKey = (title: string) => nfc(title).replace(/\s+/g, " ").trim().toLowerCase();

function parseMeetingRules(value: unknown, projects: ProjectEntry[]): MeetingRule[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("meetingRules must be a list");
	const seen = new Set<string>();
	return value.map((raw: unknown, i): MeetingRule => {
		const label = `meetingRules[${i}]`;
		if (!isObject(raw)) throw new Error(`${label} must be an object`);
		const unknown = Object.keys(raw).filter((k) => !(["title", "project", "skip"] as string[]).includes(k));
		if (unknown.length > 0) throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
		if (!isText(raw.title)) throw new Error(`${label}.title must be text`);
		const key = titleKey(raw.title);
		if (seen.has(key)) throw new Error(`${label}.title "${raw.title}" is a duplicate`);
		seen.add(key);
		const skip = raw.skip === true;
		if (raw.skip !== undefined && typeof raw.skip !== "boolean") throw new Error(`${label}.skip must be true or false`);
		if (skip === (raw.project !== undefined)) throw new Error(`${label} needs exactly one of project or skip: true`);
		if (skip) return { title: raw.title.trim(), skip: true };
		const same = isText(raw.project) ? projects.filter((p) => nfc(p.project) === nfc((raw.project as string).trim())) : [];
		if (same.length !== 1) throw new Error(`${label}.project must be the project of exactly one configured entry`);
		return { title: raw.title.trim(), project: same[0].project };
	});
}

function meetingRule(title: string, map: ProjectMap): MeetingRule | undefined {
	const key = titleKey(title);
	return map.meetingRules.find((r) => titleKey(r.title) === key);
}

export function meetingSkipped(title: string, map: ProjectMap): boolean {
	return meetingRule(title, map)?.skip === true;
}

function parseTime(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const at = Date.parse(value);
	return Number.isNaN(at) ? undefined : at;
}

function jsonLines(text: string): { lines: Json[]; skipped: number } {
	const lines: Json[] = [];
	let skipped = 0;
	for (const raw of text.split("\n")) {
		if (raw.trim() === "") continue;
		try {
			const line: unknown = JSON.parse(raw);
			if (isObject(line)) lines.push(line);
			else skipped++;
		} catch {
			skipped++;
		}
	}
	return { lines, skipped };
}

function withTitle(events: ActivityEvent[], title: string | undefined): ActivityEvent[] {
	return title === undefined ? events : events.map((e) => ({ ...e, note: title }));
}

const cleanTitle = (value: unknown): string | undefined => (isText(value) ? value.replace(/\s+/g, " ").trim() : undefined);

export function parsePiSession(text: string): ParsedLog {
	const { lines, skipped: bad } = jsonLines(text);
	let skipped = bad;
	let cwd: string | undefined;
	let spawned = false;
	let title: string | undefined;
	const events: ActivityEvent[] = [];
	for (const line of lines) {
		if (line.type === "session") {
			if (isText(line.cwd)) cwd = nfc(line.cwd);
			spawned = line.parentSession !== undefined;
		} else if (line.type === "custom" && line.customType === "title" && isObject(line.data)) {
			title = cleanTitle(line.data.content) ?? title;
		} else if (line.type === "message" && isObject(line.message)) {
			const role = line.message.role;
			if (role === "system") continue;
			const at = parseTime(line.timestamp);
			if (at === undefined) {
				skipped++;
				continue;
			}
			if (cwd === undefined) continue;
			// A session another session started carries that session's task text as "user" input.
			events.push({ at, cwd, source: "pi", prompt: role === "user" && !spawned });
		}
	}
	return { events: withTitle(events, title), skipped };
}

export function parseClaudeSession(text: string): ParsedLog {
	const { lines, skipped: bad } = jsonLines(text);
	let skipped = bad;
	let title: string | undefined;
	const events: ActivityEvent[] = [];
	for (const line of lines) {
		if (line.type === "ai-title") {
			title = cleanTitle(line.aiTitle) ?? title;
		} else if ((line.type === "user" || line.type === "assistant") && isText(line.cwd)) {
			const at = parseTime(line.timestamp);
			if (at === undefined) {
				skipped++;
				continue;
			}
			const typed = line.type === "user" && line.toolUseResult === undefined && line.isMeta !== true && line.isSidechain !== true;
			events.push({ at, cwd: nfc(line.cwd), source: "claude", prompt: typed });
		}
	}
	return { events: withTitle(events, title), skipped };
}

// Lines are `%aI<TAB>%s`. A subject is data from a commit message; it only ever becomes a description.
export function parseGitLog(text: string, repo: string): ParsedLog {
	const events: ActivityEvent[] = [];
	let skipped = 0;
	for (const raw of text.split("\n")) {
		if (raw.trim() === "") continue;
		const tab = raw.indexOf("\t");
		const at = tab < 0 ? undefined : parseTime(raw.slice(0, tab));
		if (at === undefined) {
			skipped++;
			continue;
		}
		const note = cleanTitle(raw.slice(tab + 1));
		events.push({ at, cwd: nfc(repo), source: "git", prompt: false, ...(note === undefined ? {} : { note }) });
	}
	return { events, skipped };
}

// Longest folder wins; a folder matches whole path segments only.
export function projectFor(cwd: string, map: ProjectMap): ProjectEntry | undefined {
	cwd = nfc(cwd);
	let best: ProjectEntry | undefined;
	let bestLength = -1;
	for (const entry of map.projects) {
		for (const folder of entry.folders) {
			if ((cwd === folder || cwd.startsWith(`${folder}/`)) && folder.length > bestLength) {
				best = entry;
				bestLength = folder.length;
			}
		}
	}
	return best;
}

export function windows(times: number[], idleMs = IDLE_MS): [number, number][] {
	const sorted = [...times].sort((a, b) => a - b);
	const out: [number, number][] = [];
	for (const t of sorted) {
		const last = out[out.length - 1];
		if (last && t - last[1] <= idleMs) last[1] = t;
		else out.push([t, t]);
	}
	return out;
}

export function roundMinutes(minutes: number, step = ROUND_MIN): number {
	// The 1e-6 guard keeps a share such as 45.000000001 from tipping across a half step.
	return Math.floor(Math.round(minutes * 1e6) / 1e6 / step + 0.5) * step;
}

function dayKey(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function midnightAfter(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

const UNMAPPED = -1;

interface Point {
	at: number;
	party: number;
	delta: 1 | -1;
}

// Wall-clock time is handed out once: each stretch where several parties are active is split equally.
function share(parties: Map<number, [number, number][]>): { raw: Map<string, number>; lost: Map<string, number> } {
	const points: Point[] = [];
	for (const [party, spans] of parties) {
		for (const [start, end] of spans) {
			if (end > start) points.push({ at: start, party, delta: 1 }, { at: end, party, delta: -1 });
		}
	}
	points.sort((a, b) => a.at - b.at);
	const raw = new Map<string, number>();
	const lost = new Map<string, number>();
	const active = new Set<number>();
	const add = (map: Map<string, number>, party: number, day: string, ms: number) => {
		const key = `${party}|${day}`;
		map.set(key, (map.get(key) ?? 0) + ms);
	};
	let i = 0;
	let cursor = points.length > 0 ? points[0].at : 0;
	while (i < points.length) {
		const now = points[i].at;
		// Split the stretch [cursor, now) at local midnights so each part belongs to one date.
		while (active.size > 0 && cursor < now) {
			const end = Math.min(now, midnightAfter(cursor));
			const each = (end - cursor) / active.size;
			const day = dayKey(cursor);
			for (const party of active) {
				add(raw, party, day, each);
				// Loss is the gap to the share the party would have had without the unmapped party: T/(n-1) - T/n.
				if (party !== UNMAPPED && active.has(UNMAPPED)) add(lost, party, day, each / (active.size - 1));
			}
			cursor = end;
		}
		cursor = now;
		while (i < points.length && points[i].at === now) {
			const p = points[i++];
			if (p.delta === 1) active.add(p.party);
			else active.delete(p.party);
		}
	}
	return { raw, lost };
}

// Longest stretch, per window, between a typed prompt and the next one (or the window's end).
function agentOnly(events: ActivityEvent[]): Map<string, number> {
	const longest = new Map<string, number>();
	const sorted = [...events].sort((a, b) => a.at - b.at);
	let start = 0;
	let prev = 0;
	let open = false;
	const close = () => {
		if (!open) return;
		const length = prev - start;
		const day = dayKey(start);
		if (length >= AGENT_ONLY_MS && length > (longest.get(day) ?? 0)) longest.set(day, length);
	};
	for (const e of sorted) {
		if (open && e.at - prev > IDLE_MS) {
			close();
			open = false;
		}
		if (!open) {
			start = e.at;
			open = true;
		} else if (e.prompt) {
			close();
			start = e.at;
		}
		prev = e.at;
	}
	close();
	return longest;
}

function describe(events: ActivityEvent[]): string {
	return joinTitles([...events].sort((a, b) => a.at - b.at).flatMap((e) => (e.note === undefined ? [] : [e.note])));
}

function joinTitles(all: string[]): string {
	const titles = [...new Set(all)];
	let text = "";
	for (const title of titles) {
		const next = text === "" ? title : `${text}, ${title}`;
		if (next.length > DESCRIPTION_MAX) {
			if (text === "") text = title.slice(0, DESCRIPTION_MAX).trimEnd();
			break;
		}
		text = next;
	}
	return text;
}

const WORD_CHAR = "[\\p{L}\\p{N}_]";

// Whole words only, so a keyword such as "GE" never matches "Change". A title matching two projects is unassigned.
export function meetingProject(title: string, map: ProjectMap): ProjectEntry | undefined {
	const rule = meetingRule(title, map);
	if (rule) return rule.project === undefined ? undefined : map.projects.find((p) => p.project === rule.project);
	title = nfc(title);
	const matches = (keyword: string) => {
		const escaped = nfc(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`, "iu").test(title);
	};
	const hits = map.projects.filter((entry) => entry.keywords.some(matches));
	return hits.length === 1 ? hits[0] : undefined;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MEETING_KEYS = new Set(["date", "start", "end", "title"]);

function localDate(value: unknown, label: string): [number, number, number] {
	const parts = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").map(Number) : undefined;
	if (parts) {
		const real = new Date(parts[0], parts[1] - 1, parts[2]);
		if (real.getMonth() === parts[1] - 1 && real.getDate() === parts[2]) return [parts[0], parts[1], parts[2]];
	}
	throw new Error(`${label}: date must be a date like 2026-11-03`);
}

function localMs([y, mo, d]: [number, number, number], clock: unknown, label: string): number {
	const m = typeof clock === "string" ? CLOCK.exec(clock) : null;
	if (!m) throw new Error(`${label} must be a time like 09:30`);
	return new Date(y, mo - 1, d, Number(m[1]), Number(m[2])).getTime();
}

export function parseMeetings(text: string): Meeting[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("not valid JSON");
	}
	if (!Array.isArray(data)) throw new Error("must be a JSON list of meetings");
	return data.map((raw: unknown, i): Meeting => {
		const label = `meeting ${i + 1}`;
		if (!isObject(raw)) throw new Error(`${label} must be an object`);
		const unknown = Object.keys(raw).filter((k) => !MEETING_KEYS.has(k));
		if (unknown.length > 0) throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
		const day = localDate(raw.date, label);
		if (!isText(raw.title)) throw new Error(`${label}: title must be text`);
		const start = localMs(day, raw.start, `${label}: start`);
		const end = localMs(day, raw.end, `${label}: end`);
		if (end <= start) throw new Error(`${label}: end must be after start`);
		return { date: raw.date as string, start, end, title: raw.title.replace(/\s+/g, " ").trim() };
	});
}

type Span = [number, number];

function union(spans: Span[]): Span[] {
	const out: Span[] = [];
	for (const [s, e] of [...spans].sort((x, y) => x[0] - y[0])) {
		const last = out[out.length - 1];
		if (last && s <= last[1]) last[1] = Math.max(last[1], e);
		else out.push([s, e]);
	}
	return out;
}

const overlap = (spans: Span[], a: number, b: number) => spans.reduce((sum, [s, e]) => sum + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);

function cutOut(spans: Span[], a: number, b: number): Span[] {
	const out: Span[] = [];
	for (const [s, e] of spans) {
		if (e <= a || s >= b) out.push([s, e]);
		else {
			if (s < a) out.push([s, a]);
			if (e > b) out.push([b, e]);
		}
	}
	return out.filter(([s, e]) => e > s);
}

// A meeting beats log time: it is cut from every party's windows before the rest is shared.
function cutMeetings(spans: Map<number, Span[]>, meetings: Meeting[], map: ProjectMap): MeetingCut[] {
	const cuts: MeetingCut[] = [];
	for (const m of meetings) {
		for (const [party, list] of spans) {
			const removed = overlap(list, m.start, m.end) / 60_000;
			if (removed > 0 && party !== UNMAPPED) cuts.push({ date: m.date, title: m.title, entry: map.projects[party], minutes: removed });
			spans.set(party, cutOut(list, m.start, m.end));
		}
	}
	return cuts;
}

function meetingRows(meetings: Meeting[], map: ProjectMap, unassigned: Meeting[]): DayRow[] {
	const groups = new Map<string, { entry: ProjectEntry; date: string; list: Meeting[] }>();
	for (const m of meetings) {
		const entry = meetingProject(m.title, map);
		if (!entry) {
			unassigned.push(m);
			continue;
		}
		const key = `${map.projects.indexOf(entry)}|${m.date}`;
		const group = groups.get(key);
		if (group) group.list.push(m);
		else groups.set(key, { entry, date: m.date, list: [m] });
	}
	// Overlapping meetings of one project count once; meetings of different projects share their overlap,
	// so no wall-clock minute is booked twice.
	const parties = new Map<number, Span[]>();
	const partyOf = new Map<string, number>();
	[...groups.keys()].forEach((key, party) => {
		partyOf.set(key, party);
		parties.set(party, union(groups.get(key)!.list.map((m): Span => [m.start, m.end])));
	});
	const { raw } = share(parties);
	return [...groups.entries()].map(([key, { entry, date, list }]): DayRow => {
		const rawMinutes = (raw.get(`${partyOf.get(key)}|${date}`) ?? 0) / 60_000;
		return {
			date,
			entry,
			rawMinutes,
			bookedMinutes: roundMinutes(rawMinutes),
			description: joinTitles(list.map((m) => m.title)),
			lostToUnmappedMinutes: 0,
			agentOnlyMinutes: 0,
			kind: "meeting",
			task: entry.meetingTask ?? entry.task,
		};
	});
}

export function buildDays(input: BuildInput): DayReport {
	const { map, from, to } = input;
	const inRange = (day: string) => day >= from && day <= to;
	const byParty = new Map<number, ActivityEvent[]>();
	const folderEvents = new Map<string, ActivityEvent[]>();
	for (const e of input.events) {
		const entry = projectFor(e.cwd, map);
		const party = entry ? map.projects.indexOf(entry) : UNMAPPED;
		const list = byParty.get(party);
		if (list) list.push(e);
		else byParty.set(party, [e]);
		if (!entry && inRange(dayKey(e.at))) {
			const f = folderEvents.get(e.cwd);
			if (f) f.push(e);
			else folderEvents.set(e.cwd, [e]);
		}
	}

	const spans = new Map<number, [number, number][]>();
	for (const [party, events] of byParty) spans.set(party, windows(events.map((e) => e.at)));
	// A skipped meeting is ignored whole: it books nothing, is not reported, and takes no log time away.
	const meetings = (input.meetings ?? []).filter((m) => inRange(m.date) && !meetingSkipped(m.title, map)).sort((a, b) => a.start - b.start);
	const cuts = cutMeetings(spans, meetings, map);
	const { raw, lost } = share(spans);

	const rows: DayRow[] = [];
	const dropped: DayRow[] = [];
	for (const [party, events] of byParty) {
		if (party === UNMAPPED) continue;
		const flags = agentOnly(events);
		const days = new Set([...raw.keys()].filter((k) => k.startsWith(`${party}|`)).map((k) => k.slice(String(party).length + 1)));
		for (const day of [...days].filter(inRange)) {
			const rawMinutes = (raw.get(`${party}|${day}`) ?? 0) / 60_000;
			const row: DayRow = {
				date: day,
				entry: map.projects[party],
				rawMinutes,
				bookedMinutes: roundMinutes(rawMinutes),
				description: describe(events.filter((e) => dayKey(e.at) === day)),
				lostToUnmappedMinutes: (lost.get(`${party}|${day}`) ?? 0) / 60_000,
				agentOnlyMinutes: (flags.get(day) ?? 0) / 60_000,
				kind: "work",
				task: map.projects[party].task,
			};
			if (row.bookedMinutes > 0) rows.push(row);
			else if (rawMinutes > 0) dropped.push(row);
		}
	}
	const unassigned: Meeting[] = [];
	for (const row of meetingRows(meetings, map, unassigned)) {
		if (row.bookedMinutes > 0) rows.push(row);
		else if (row.rawMinutes > 0) dropped.push(row);
	}
	const order = (a: DayRow, b: DayRow) =>
		a.date.localeCompare(b.date) || a.entry.project.localeCompare(b.entry.project) || a.kind.localeCompare(b.kind);
	rows.sort(order);
	dropped.sort(order);

	const unmapped = [...folderEvents].map(([cwd, events]): UnmappedFolder => {
		const minutes = windows(events.map((e) => e.at)).reduce((sum, [a, b]) => sum + (b - a), 0) / 60_000;
		return { cwd, events: events.length, minutes };
	});
	unmapped.sort((a, b) => b.minutes - a.minutes || a.cwd.localeCompare(b.cwd));
	return { rows, dropped, unmapped, cuts, unassigned };
}
