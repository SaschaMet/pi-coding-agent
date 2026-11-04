import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

// Fixtures live under the checkout, which inside a `.worktrees/` checkout counts as the main checkout; these suites test other exemptions.
vi.mock("../.pi/extensions/lib/extension-helpers.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../.pi/extensions/lib/extension-helpers.ts")>()),
	isWithinMainCheckout: () => false,
}));

describe("claude tool-results exemption", () => {
	// HOME points at a fixture so os.homedir() resolves ~/.claude inside it.
	let fixturesBase: string;
	let repoCwd: string;
	let projectsDir: string;
	let ownToolResult: string;
	let previousHome: string | undefined;

	const slugOf = (dir: string) =>
		fs.realpathSync(dir).replace(/[^A-Za-z0-9]/g, "-");

	const toolCall = async (toolName: string, input: Record<string, unknown>) => {
		const pi = createFakePi();
		readBoundaryGuardExtension(asExtensionAPI(pi));
		const handlers = pi.handlers.get("tool_call") ?? [];
		return handlers[0]({ toolName, input }, { hasUI: false, cwd: repoCwd });
	};

	const writeFile = (file: string, content: string) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	};

	beforeEach(() => {
		const fixturesDir = path.join(process.cwd(), "test", ".fixtures");
		fs.mkdirSync(fixturesDir, { recursive: true });
		fixturesBase = fs.mkdtempSync(path.join(fixturesDir, "pi-claude-results-"));
		repoCwd = path.join(fixturesBase, "repo");
		fs.mkdirSync(repoCwd, { recursive: true });
		const home = path.join(fixturesBase, "home");
		projectsDir = path.join(home, ".claude", "projects");
		ownToolResult = path.join(
			projectsDir,
			slugOf(repoCwd),
			"session-1",
			"tool-results",
			"toolu_1.json",
		);
		writeFile(ownToolResult, "{}\n");
		previousHome = process.env.HOME;
		process.env.HOME = home;
	});

	afterEach(() => {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		fs.rmSync(fixturesBase, { recursive: true, force: true });
	});

	it("allows read, grep, ls, and find of this project's tool-results file", async () => {
		for (const toolName of ["read", "grep", "ls", "find"]) {
			const result = await toolCall(toolName, { path: ownToolResult });
			expect(result, toolName).toBeUndefined();
		}
	});

	it("allows the same file given as a ~ path and as a path relative to cwd", async () => {
		const fromHome = `~/${path.relative(process.env.HOME as string, ownToolResult)}`;
		const fromCwd = path.relative(repoCwd, ownToolResult);

		expect(await toolCall("read", { path: fromHome })).toBeUndefined();
		expect(await toolCall("read", { path: fromCwd })).toBeUndefined();
	});

	it("prompts for another project's tool-results file", async () => {
		const other = path.join(projectsDir, "-other-project", "session-1", "tool-results", "toolu_2.json");
		writeFile(other, "{}\n");

		const result = await toolCall("read", { path: other });

		expect(result?.block).toBe(true);
	});

	it("prompts for the session transcript next to tool-results", async () => {
		const transcript = path.join(projectsDir, slugOf(repoCwd), "session-1.jsonl");
		writeFile(transcript, "{}\n");

		const result = await toolCall("read", { path: transcript });

		expect(result?.block).toBe(true);
	});

	it("still blocks write and edit to this project's tool-results file", async () => {
		for (const toolName of ["write", "edit"]) {
			const result = await toolCall(toolName, { path: ownToolResult });
			expect(result?.block, toolName).toBe(true);
		}
	});

	it("blocks a tool-results symlink that resolves outside the project folder", async () => {
		const outside = path.join(fixturesBase, "secret.txt");
		writeFile(outside, "secret\n");
		const link = path.join(path.dirname(ownToolResult), "link.json");
		fs.symlinkSync(outside, link);

		const result = await toolCall("read", { path: link });

		expect(result?.block).toBe(true);
	});
});
