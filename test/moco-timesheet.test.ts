import { describe, expect, it } from "vitest";
import { confirmCode, run, type Deps } from "../.pi/skill-library/moco-timesheet/scripts/moco.ts";

const KEY = "k3y-s3cret-value";
const BASE = "https://acme.mocoapp.com/api/v1";

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
			{ id: 1003, name: "Legacy", active: false, billable: true },
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

interface Activity {
	id: number;
	date: string;
	billable: boolean;
	seconds: number;
	worked_seconds: number;
	description: string;
	project: { id: number; name: string };
	task: { id: number; name: string };
}

function activity(id: number, date: string, project: 100 | 200, worked: number, billable = worked, description = ""): Activity {
	const p = PROJECTS.find((x) => x.id === project)!;
	return {
		id,
		date,
		billable: billable > 0,
		seconds: billable,
		worked_seconds: worked,
		description,
		project: { id: p.id, name: p.name },
		task: { id: p.tasks[0].id, name: p.tasks[0].name },
	};
}

const ROW = { date: "2026-11-02", project: "Relaunch", task: "Development", hours: 1, description: "API work" };

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

interface Call {
	method: string;
	url: URL;
	init: RequestInit;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function setup(
	opts: {
		routes?: Record<string, Handler>;
		secrets?: Record<string, string | undefined>;
		files?: Record<string, string>;
		existing?: Activity[];
	} = {},
) {
	const calls: Call[] = [];
	const out: string[] = [];
	const err: string[] = [];
	const files = new Map(Object.entries(opts.files ?? {}));
	const secrets = { "moco-api": KEY, "moco-domain": "acme", ...opts.secrets };
	let nextId = 9000;
	const routes: Record<string, Handler> = {
		"GET /api/v1/profile": () => json({ id: 42, firstname: "Test" }),
		"GET /api/v1/projects/assigned": () => json(PROJECTS),
		"GET /api/v1/activities": () => json(opts.existing ?? []),
		"POST /api/v1/activities": (_url, init) => {
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			return json({ id: nextId++, ...body }, 201);
		},
		...opts.routes,
	};
	const deps: Deps = {
		fetch: async (input, init = {}) => {
			const url = new URL(String(input));
			const method = init.method ?? "GET";
			calls.push({ method, url, init });
			const handler = routes[`${method} ${url.pathname}`];
			if (!handler) return json({ message: "not found" }, 404);
			return handler(url, init);
		},
		readSecret: async (service) => secrets[service as keyof typeof secrets],
		readFile: async (path) => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`ENOENT: ${path}`);
			return content;
		},
		out: (text) => out.push(text),
		err: (text) => err.push(text),
	};
	return {
		deps,
		calls,
		files,
		posts: () => calls.filter((c) => c.method === "POST"),
		stdout: () => out.join("\n"),
		stderr: () => err.join("\n"),
	};
}

function codeFrom(stdout: string): string {
	const match = stdout.match(/confirm: ([0-9a-f]{8})/);
	if (!match) throw new Error(`no confirm code in:\n${stdout}`);
	return match[1];
}

async function previewAndConfirm(t: ReturnType<typeof setup>, path: string): Promise<number> {
	expect(await run(["add", "--file", path], t.deps)).toBe(0);
	return run(["add", "--file", path, "--confirm", codeFrom(t.stdout())], t.deps);
}

describe("moco-timesheet reads", () => {
	it("sum totals worked_seconds per project across pages", async () => {
		const t = setup({
			routes: {
				"GET /api/v1/activities": (url) =>
					url.searchParams.get("page") === "2"
						? json([activity(3, "2026-10-02", 200, 1800)])
						: json([activity(1, "2026-10-01", 100, 3600), activity(2, "2026-10-02", 100, 5400)], 200, {
								link: `<${BASE}/activities?page=2>; rel="next"`,
							}),
			},
		});
		expect(await run(["sum", "--from", "2026-10-01", "--to", "2026-10-31", "--by", "project"], t.deps)).toBe(0);
		expect(t.stdout()).toMatch(/Website Relaunch\s+2:30/);
		expect(t.stdout()).toMatch(/Website Support\s+0:30/);
		expect(t.stdout()).toMatch(/Total\s+3:00/);
	});

	it("sum --billable uses billable seconds", async () => {
		const t = setup({ existing: [activity(1, "2026-10-01", 100, 3600, 1800)] });
		expect(await run(["sum", "--from", "2026-10-01", "--to", "2026-10-31", "--billable"], t.deps)).toBe(0);
		expect(t.stdout()).toMatch(/Total\s+0:30/);
	});

	it("sum --billable leaves out entries MOCO marks non-billable", async () => {
		const internal = { ...activity(2, "2026-10-01", 200, 3600), billable: false };
		const t = setup({ existing: [activity(1, "2026-10-01", 100, 1800), internal] });
		expect(await run(["sum", "--from", "2026-10-01", "--to", "2026-10-31", "--billable"], t.deps)).toBe(0);
		expect(t.stdout()).toMatch(/Total\s+0:30/);
	});

	it("sum --by day totals per date", async () => {
		const t = setup({
			existing: [activity(1, "2026-10-01", 100, 3600), activity(2, "2026-10-01", 200, 900), activity(3, "2026-10-02", 100, 1800)],
		});
		expect(await run(["sum", "--from", "2026-10-01", "--to", "2026-10-31", "--by", "day"], t.deps)).toBe(0);
		expect(t.stdout()).toMatch(/2026-10-01\s+1:15/);
		expect(t.stdout()).toMatch(/2026-10-02\s+0:30/);
	});

	it("list always filters on the user id from /profile", async () => {
		const t = setup({ existing: [activity(1, "2026-10-01", 100, 3600, 3600, "Standup")] });
		expect(await run(["list", "--from", "2026-10-01", "--to", "2026-10-31"], t.deps)).toBe(0);
		const get = t.calls.find((c) => c.url.pathname === "/api/v1/activities")!;
		expect(get.url.searchParams.get("user_id")).toBe("42");
		expect(get.url.searchParams.get("from")).toBe("2026-10-01");
		expect(t.stdout()).toContain("Standup");
	});

	it("list --project filters to one matching project", async () => {
		const t = setup({ existing: [activity(1, "2026-10-01", 100, 3600, 3600, "A"), activity(2, "2026-10-01", 200, 900, 900, "B")] });
		expect(await run(["list", "--from", "2026-10-01", "--to", "2026-10-31", "--project", "relaunch"], t.deps)).toBe(0);
		expect(t.stdout()).toContain("A");
		expect(t.stdout()).not.toContain("Website Support");
	});

	it("pagination ignores a next link on another host", async () => {
		const t = setup({
			routes: {
				"GET /api/v1/activities": () =>
					json([activity(1, "2026-10-01", 100, 3600)], 200, { link: `<https://evil.example/api/v1/activities?page=2>; rel="next"` }),
			},
		});
		expect(await run(["sum", "--from", "2026-10-01", "--to", "2026-10-31"], t.deps)).toBe(0);
		expect(t.calls.every((c) => c.url.host === "acme.mocoapp.com")).toBe(true);
	});

	it("pagination ignores a next link to another path on the MOCO host", async () => {
		const t = setup({
			routes: {
				"GET /api/v1/activities": () =>
					json([activity(1, "2026-10-01", 100, 3600)], 200, { link: `<${BASE}/invoices?page=2>; rel="next"` }),
			},
		});
		expect(await run(["sum", "--from", "2026-10-01", "--to", "2026-10-31"], t.deps)).toBe(0);
		expect(t.calls.some((c) => c.url.pathname.includes("invoices"))).toBe(false);
	});

	it("projects lists active projects and only their active tasks", async () => {
		const t = setup();
		expect(await run(["projects"], t.deps)).toBe(0);
		const get = t.calls.find((c) => c.url.pathname === "/api/v1/projects/assigned")!;
		expect(get.url.searchParams.get("active")).toBe("true");
		expect(t.stdout()).toContain("Development");
		expect(t.stdout()).not.toContain("Legacy");
	});

	it("every request refuses redirects and carries a timeout signal", async () => {
		const t = setup();
		await run(["projects"], t.deps);
		for (const c of t.calls) {
			expect(c.init.redirect).toBe("error");
			expect(c.init.signal).toBeInstanceOf(AbortSignal);
		}
	});
});

describe("moco-timesheet add", () => {
	it("previews one row and three rows without posting", async () => {
		const rows3 = [ROW, { ...ROW, date: "2026-11-03" }, { ...ROW, date: "2026-11-04", task: "Meetings", hours: "0:15" }];
		const t = setup({ files: { "/t/one.json": JSON.stringify([ROW]), "/t/three.json": JSON.stringify(rows3) } });
		expect(await run(["add", "--file", "/t/one.json"], t.deps)).toBe(0);
		expect(t.stdout()).toMatch(/2026-11-02.*1:00.*Website Relaunch.*Development.*API work/);
		expect(await run(["add", "--file", "/t/three.json"], t.deps)).toBe(0);
		expect(t.stdout()).toMatch(/Total.*2:15 in 3 entries/);
		expect(t.stdout()).toMatch(/billable: no/);
		expect(t.posts()).toHaveLength(0);
	});

	it("posts each entry once with the exact payload after a matching code", async () => {
		const rows = [ROW, { ...ROW, date: "2026-11-03", hours: 1.5, description: "Review" }];
		const t = setup({ files: { "/t/b.json": JSON.stringify(rows) } });
		expect(await previewAndConfirm(t, "/t/b.json")).toBe(0);
		expect(t.posts().map((c) => JSON.parse(String(c.init.body)))).toEqual([
			{ date: "2026-11-02", project_id: 100, task_id: 1001, seconds: 3600, description: "API work" },
			{ date: "2026-11-03", project_id: 100, task_id: 1001, seconds: 5400, description: "Review" },
		]);
		expect(t.stdout()).toContain("9000");
		expect(t.stdout()).toContain("9001");
	});

	it("refuses a stale code when a field changed", async () => {
		const t = setup({ files: { "/t/b.json": JSON.stringify([ROW]) } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(0);
		const code = codeFrom(t.stdout());
		t.files.set("/t/b.json", JSON.stringify([{ ...ROW, hours: 2 }]));
		expect(await run(["add", "--file", "/t/b.json", "--confirm", code], t.deps)).toBe(1);
		expect(t.stderr()).toMatch(/confirm code does not match/);
		expect(t.posts()).toHaveLength(0);
	});

	it("refuses a stale code when a row was added", async () => {
		const t = setup({ files: { "/t/b.json": JSON.stringify([ROW]) } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(0);
		const code = codeFrom(t.stdout());
		t.files.set("/t/b.json", JSON.stringify([ROW, { ...ROW, date: "2026-11-03" }]));
		expect(await run(["add", "--file", "/t/b.json", "--confirm", code], t.deps)).toBe(1);
		expect(t.posts()).toHaveLength(0);
	});

	it("refuses a stale code when a row was removed", async () => {
		const t = setup({ files: { "/t/b.json": JSON.stringify([ROW, { ...ROW, date: "2026-11-03" }]) } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(0);
		const code = codeFrom(t.stdout());
		t.files.set("/t/b.json", JSON.stringify([ROW]));
		expect(await run(["add", "--file", "/t/b.json", "--confirm", code], t.deps)).toBe(1);
		expect(t.posts()).toHaveLength(0);
	});

	it("preview refuses a row that matches an existing entry and prints no code", async () => {
		const existing = [{ ...activity(555, "2026-11-02", 100, 3600, 3600, "API work") }];
		const t = setup({ files: { "/t/b.json": JSON.stringify([ROW]) }, existing });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(1);
		expect(t.stderr()).toMatch(/row 1.*555/);
		expect(t.stdout()).not.toMatch(/confirm:/);
	});

	it("confirm refuses when an identical entry appeared after the preview", async () => {
		let existing: Activity[] = [];
		const t = setup({
			files: { "/t/b.json": JSON.stringify([ROW]) },
			routes: { "GET /api/v1/activities": () => json(existing) },
		});
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(0);
		existing = [activity(777, "2026-11-02", 100, 3600, 3600, "API work")];
		expect(await run(["add", "--file", "/t/b.json", "--confirm", codeFrom(t.stdout())], t.deps)).toBe(1);
		expect(t.stderr()).toContain("777");
		expect(t.posts()).toHaveLength(0);
	});

	it("stops at a failed row and reports landed and unwritten rows", async () => {
		let n = 0;
		const rows = [ROW, { ...ROW, date: "2026-11-03" }, { ...ROW, date: "2026-11-04" }];
		const t = setup({
			files: { "/t/b.json": JSON.stringify(rows) },
			routes: {
				"POST /api/v1/activities": () => (++n === 2 ? json({ message: "Task is locked" }, 422) : json({ id: 8000 + n, date: "x" }, 201)),
			},
		});
		expect(await previewAndConfirm(t, "/t/b.json")).toBe(1);
		expect(t.posts()).toHaveLength(2);
		expect(t.stderr()).toMatch(/landed.*row 1/i);
		expect(t.stderr()).toMatch(/row 2.*422.*Task is locked/i);
		expect(t.stderr()).toMatch(/unwritten.*row 3/i);
	});

	it("reports a timed-out row as unknown and stops", async () => {
		let n = 0;
		const rows = [ROW, { ...ROW, date: "2026-11-03" }, { ...ROW, date: "2026-11-04" }];
		const t = setup({
			files: { "/t/b.json": JSON.stringify(rows) },
			routes: {
				"POST /api/v1/activities": () => {
					if (++n === 2) throw new DOMException("The operation timed out.", "TimeoutError");
					return json({ id: 8000 + n }, 201);
				},
			},
		});
		expect(await previewAndConfirm(t, "/t/b.json")).toBe(1);
		expect(t.posts()).toHaveLength(2);
		expect(t.stderr()).toMatch(/row 2.*unknown.*may have landed/i);
		expect(t.stderr()).toMatch(/unwritten.*row 3/i);
	});

	it.each([
		["an unknown key", JSON.stringify([{ ...ROW, billable: false }])],
		["an empty array", "[]"],
		["a non-array", JSON.stringify(ROW)],
		["invalid JSON", "{"],
		["a bad date", JSON.stringify([{ ...ROW, date: "02.11.2026" }])],
		["zero hours", JSON.stringify([{ ...ROW, hours: 0 }])],
	])("rejects a file with %s before any fetch", async (_label, content) => {
		const t = setup({ files: { "/t/b.json": content } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(1);
		expect(t.calls).toHaveLength(0);
	});

	it("rejects identical rows inside one file before any post", async () => {
		const t = setup({ files: { "/t/b.json": JSON.stringify([ROW, ROW]) } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(1);
		expect(t.posts()).toHaveLength(0);
	});

	it("rejects more than 20 rows before any fetch", async () => {
		const rows = Array.from({ length: 21 }, (_, i) => ({ ...ROW, description: `r${i}` }));
		const t = setup({ files: { "/t/b.json": JSON.stringify(rows) } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(1);
		expect(t.calls).toHaveLength(0);
	});

	it("rejects an ambiguous project name and lists candidates", async () => {
		const t = setup({ files: { "/t/b.json": JSON.stringify([{ ...ROW, project: "website" }]) } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(1);
		expect(t.stderr()).toContain("Website Relaunch");
		expect(t.stderr()).toContain("Website Support");
		expect(t.posts()).toHaveLength(0);
	});

	it("rejects an inactive task", async () => {
		const t = setup({ files: { "/t/b.json": JSON.stringify([{ ...ROW, task: "Legacy" }]) } });
		expect(await run(["add", "--file", "/t/b.json"], t.deps)).toBe(1);
		expect(t.posts()).toHaveLength(0);
	});

	it("rejects the removed flag form", async () => {
		const t = setup();
		expect(await run(["add", "--date", "2026-11-02", "--project", "Relaunch"], t.deps)).toBe(1);
		expect(t.calls).toHaveLength(0);
	});

	it("rounds hours to whole minutes", async () => {
		const t = setup({ files: { "/t/b.json": JSON.stringify([{ ...ROW, hours: 1.33 }]) } });
		expect(await previewAndConfirm(t, "/t/b.json")).toBe(0);
		expect(JSON.parse(String(t.posts()[0].init.body)).seconds).toBe(4800);
	});

	it("confirm code changes with any field", () => {
		const entry = { date: "2026-11-02", project_id: 100, task_id: 1001, seconds: 3600, description: "x" };
		expect(confirmCode([entry])).toMatch(/^[0-9a-f]{8}$/);
		expect(confirmCode([entry])).not.toBe(confirmCode([{ ...entry, seconds: 3660 }]));
		expect(confirmCode([entry])).not.toBe(confirmCode([{ ...entry, description: "y" }]));
	});
});

describe("moco-timesheet safety", () => {
	it("explains setup when the key is missing from the Keychain", async () => {
		const t = setup({ secrets: { "moco-api": undefined } });
		expect(await run(["projects"], t.deps)).toBe(1);
		expect(t.stderr()).toMatch(/security add-generic-password -s moco-api/);
		expect(t.calls).toHaveLength(0);
	});

	it("explains setup when the domain is missing from the Keychain", async () => {
		const t = setup({ secrets: { "moco-domain": undefined } });
		expect(await run(["projects"], t.deps)).toBe(1);
		expect(t.stderr()).toMatch(/security add-generic-password -s moco-domain/);
		expect(t.calls).toHaveLength(0);
	});

	it("never prints the key when a batch stops on a key-echoing error", async () => {
		const t = setup({
			files: { "/t/b.json": JSON.stringify([ROW]) },
			routes: { "POST /api/v1/activities": () => json({ message: `bad token ${KEY}` }, 422) },
		});
		expect(await previewAndConfirm(t, "/t/b.json")).toBe(1);
		expect(t.stderr()).toMatch(/422/);
		expect(t.stdout() + t.stderr()).not.toContain(KEY);
	});

	it("rejects a domain outside [a-z0-9-] before any fetch", async () => {
		const t = setup({ secrets: { "moco-domain": "evil.example/x" } });
		expect(await run(["projects"], t.deps)).toBe(1);
		expect(t.calls).toHaveLength(0);
	});

	it("never prints the key, even when MOCO echoes it on a 401", async () => {
		const t = setup({ routes: { "GET /api/v1/projects/assigned": () => json({ message: `Invalid token ${KEY}` }, 401) } });
		expect(await run(["projects"], t.deps)).toBe(1);
		expect(t.stderr()).toMatch(/401/);
		expect(t.stdout() + t.stderr()).not.toContain(KEY);
	});

	it("sends the key only in the Authorization header", async () => {
		const t = setup();
		await run(["projects"], t.deps);
		const headers = new Headers(t.calls[0].init.headers);
		expect(headers.get("authorization")).toBe(`Token token=${KEY}`);
		expect(t.calls[0].url.href).not.toContain(KEY);
	});

	it.each([["delete"], ["update"], [""]])("rejects unknown command %j", async (cmd) => {
		const t = setup();
		expect(await run(cmd ? [cmd, "123"] : [], t.deps)).toBe(1);
		expect(t.calls).toHaveLength(0);
	});
});
