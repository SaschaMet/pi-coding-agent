import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

describe("tmp directory exemption", () => {
	// The exemption only makes sense for a working directory outside the system tmp
	// directory, so this block uses a fixture cwd under the repo (not os.tmpdir()).
	let fixturesBase: string;
	let repoCwd: string;

	const repoCtx = () => ({ hasUI: false, cwd: repoCwd });

	const guardInRepo = () => {
		const pi = createFakePi();
		readBoundaryGuardExtension(asExtensionAPI(pi));
		return pi;
	};

	const toolCall = async (
		pi: ReturnType<typeof createFakePi>,
		toolName: string,
		input: Record<string, unknown>,
	) => {
		const handlers = pi.handlers.get("tool_call") ?? [];
		return handlers[0]({ toolName, input }, repoCtx());
	};

	beforeEach(() => {
		const fixturesDir = path.join(process.cwd(), "test", ".fixtures");
		fs.mkdirSync(fixturesDir, { recursive: true });
		fixturesBase = fs.mkdtempSync(path.join(fixturesDir, "pi-read-guard-"));
		repoCwd = path.join(fixturesBase, "repo");
		fs.mkdirSync(repoCwd, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(fixturesBase, { recursive: true, force: true });
	});

	it("allows a read from the tmp directory without approval", async () => {
		const pi = guardInRepo();

		const result = await toolCall(
			pi,
			"read",
			{ path: path.join(os.tmpdir(), "pi-scratch", "scratch.txt") },
		);

		expect(result).toBeUndefined();
	});

	it("allows grep, ls, and find with a path inside the tmp directory", async () => {
		const pi = guardInRepo();

		for (const toolName of ["grep", "ls", "find"]) {
			const result = await toolCall(
				pi,
				toolName,
				{ path: path.join(os.tmpdir(), "pi-scratch") },
			);
			expect(result, toolName).toBeUndefined();
		}
	});

	it("still blocks write and edit to the tmp directory", async () => {
		const pi = guardInRepo();

		for (const toolName of ["write", "edit"]) {
			const result = await toolCall(
				pi,
				toolName,
				{ path: path.join(os.tmpdir(), "pi-scratch", "scratch.txt") },
			);
			expect(result?.block, toolName).toBe(true);
		}
	});

	it("blocks a path that escapes the tmp directory via ..", async () => {
		const pi = guardInRepo();

		const result = await toolCall(
			pi,
			"read",
			{ path: path.join(os.tmpdir(), "..", "outside-tmp.txt") },
		);

		expect(result?.block).toBe(true);
	});

	it("prompts (blocks with no UI) for a read from the /tmp POSIX alias outside os.tmpdir()", async () => {
		const pi = guardInRepo();

		const result = await toolCall(pi, "read", {
			path: path.join("/tmp", `pi-read-guard-alias-${process.pid}.txt`),
		});

		expect(result?.block).toBe(true);
	});

	it("prompts (blocks with no UI) for a read from the /var/tmp POSIX alias", async () => {
		const pi = guardInRepo();

		const result = await toolCall(pi, "read", {
			path: path.join("/var/tmp", `pi-read-guard-alias-${process.pid}.txt`),
		});

		expect(result?.block).toBe(true);
	});

	it("blocks a symlink inside /tmp whose real target leaves the temp aliases", async () => {
		const pi = guardInRepo();
		const realTarget = path.join(fixturesBase, "alias-real-target.txt");
		fs.writeFileSync(realTarget, "// real file\n");
		const link = path.join("/tmp", `pi-read-guard-alias-link-${process.pid}.txt`);
		fs.symlinkSync(realTarget, link);

		try {
			const result = await toolCall(pi, "read", { path: link });
			expect(result?.block).toBe(true);
		} finally {
			fs.rmSync(link, { force: true });
		}
	});

	it("blocks a symlink inside the tmp directory whose real target leaves it", async () => {
		const pi = guardInRepo();
		const realTarget = path.join(fixturesBase, "real-target.txt");
		fs.writeFileSync(realTarget, "// real file\n");
		const link = path.join(
			os.tmpdir(),
			`pi-read-guard-scratch-link-${process.pid}.txt`,
		);
		fs.symlinkSync(realTarget, link);

		try {
			const result = await toolCall(pi, "read", { path: link });
			expect(result?.block).toBe(true);
		} finally {
			fs.rmSync(link, { force: true });
		}
	});
});

describe("tmp reports folder write exemption", () => {
	// Mutating tools may write into <os.tmpdir()>/pi-reports/ without approval; the
	// rest of tmp keeps the prompt. Uses a fixture cwd under the repo, outside tmp.
	let fixturesBase: string;
	let repoCwd: string;
	const reportsDir = path.join(os.tmpdir(), "pi-reports");
	const tag = `${process.pid}-${Date.now()}`;

	const guardAt = (cwd: string) => {
		const pi = createFakePi();
		readBoundaryGuardExtension(asExtensionAPI(pi));
		return (toolName: string, input: Record<string, unknown>) =>
			(pi.handlers.get("tool_call") ?? [])[0]({ toolName, input }, { hasUI: false, cwd });
	};

	beforeEach(() => {
		const fixturesDir = path.join(process.cwd(), "test", ".fixtures");
		fs.mkdirSync(fixturesDir, { recursive: true });
		fixturesBase = fs.mkdtempSync(path.join(fixturesDir, "pi-reports-guard-"));
		repoCwd = path.join(fixturesBase, "repo");
		fs.mkdirSync(repoCwd, { recursive: true });
		fs.mkdirSync(reportsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(fixturesBase, { recursive: true, force: true });
	});

	it("allows write into the tmp reports folder without approval", async () => {
		const call = guardAt(repoCwd);
		expect(await call("write", { path: path.join(reportsDir, `report-${tag}.md`) })).toBeUndefined();
	});

	it("allows edit in the tmp reports folder without approval", async () => {
		const call = guardAt(repoCwd);
		expect(await call("edit", { path: path.join(reportsDir, `report-${tag}.md`) })).toBeUndefined();
	});

	it("still blocks write elsewhere in tmp (no UI)", async () => {
		const call = guardAt(repoCwd);
		const result = await call("write", { path: path.join(os.tmpdir(), `other-${tag}.md`) });
		expect(result?.block).toBe(true);
	});

	it("blocks write through a symlink in the reports folder that points outside tmp", async () => {
		const link = path.join(reportsDir, `link-out-${tag}`);
		fs.symlinkSync(fixturesBase, link);
		try {
			const call = guardAt(repoCwd);
			const result = await call("write", { path: path.join(link, "escape.md") });
			expect(result?.block).toBe(true);
		} finally {
			fs.rmSync(link, { force: true });
		}
	});

	it("blocks a .. escape out of the reports folder", async () => {
		const call = guardAt(repoCwd);
		const result = await call("write", { path: path.join(reportsDir, "..", `escape-${tag}.md`) });
		expect(result?.block).toBe(true);
	});

	it("keeps the exemption inactive when cwd is inside tmp (fail-safe)", async () => {
		const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cwd-in-tmp-"));
		try {
			const call = guardAt(tmpCwd);
			const result = await call("write", { path: path.join(reportsDir, `report-${tag}.md`) });
			expect(result?.block).toBe(true);
		} finally {
			fs.rmSync(tmpCwd, { recursive: true, force: true });
		}
	});
});
