import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The forwarding filter lives in a local patch on the installed pi-subagents copy.
const runnerPath = path.resolve(
	import.meta.dirname,
	"../.pi/npm/node_modules/@tintinweb/pi-subagents/src/agent-runner.ts",
);
const installed = fs.existsSync(runnerPath);
// A skip is not a pass: the reason is printed so a skipped run is visible in the gate output.
if (!installed) process.stderr.write("\nSKIPPED: subagent prompt forwarding (pi-subagents not installed under .pi/npm)\n");

const GUARD_TITLE = "Allow read outside current directory?\n\nPath: /elsewhere/notes.md\nCWD: /work";
const NAME = "general-purpose#0f6e0dba";
const MINUTES_10 = 10 * 60_000;

type PromptOnlyUI = (parent: any, name: string, isParentIdle: () => boolean, signal?: AbortSignal) => any;

// A parent UI whose select answers `answer`, or waits until its signal aborts.
function fakeParent(answer?: string) {
	const select = vi.fn(
		(_title: string, _options: string[], opts?: { signal?: AbortSignal }) =>
			new Promise<string | undefined>((resolve) => {
				if (answer !== undefined) resolve(answer);
				opts?.signal?.addEventListener("abort", () => resolve(undefined));
			}),
	);
	return {
		select,
		confirm: vi.fn(async () => true),
		input: vi.fn(async () => "typed"),
		editor: vi.fn(async () => "edited"),
		custom: vi.fn(async () => "custom"),
		notify: vi.fn(),
		setStatus: vi.fn(),
		setWidget: vi.fn(),
		setFooter: vi.fn(),
		setTitle: vi.fn(),
		setEditorText: vi.fn(),
		theme: { name: "parent-theme" },
	};
}

describe.skipIf(!installed)("subagent prompt forwarding", () => {
	let promptOnlyUI: PromptOnlyUI;

	beforeAll(async () => {
		promptOnlyUI = (await import(runnerPath)).promptOnlyUI;
	});

	it("is exported by the patched package", () => {
		expect(typeof promptOnlyUI).toBe("function");
	});

	it("forwards the read guard's question with the subagent's name and a 10-minute timeout", async () => {
		const parent = fakeParent("Yes");
		const ui = promptOnlyUI(parent, NAME, () => false);
		await expect(ui.select(GUARD_TITLE, ["Yes", "No"])).resolves.toBe("Yes");
		expect(parent.select).toHaveBeenCalledWith(
			`[${NAME}] ${GUARD_TITLE}`,
			["Yes", "No"],
			expect.objectContaining({ timeout: MINUTES_10 }),
		);
	});

	it("forwards a nested subagent's question that already carries a name", async () => {
		const parent = fakeParent("No");
		const ui = promptOnlyUI(parent, "lead#11111111", () => false);
		await expect(ui.select(`[worker#22222222] ${GUARD_TITLE}`, ["Yes", "No"])).resolves.toBe("No");
		expect(parent.select.mock.calls[0][0]).toBe(`[lead#11111111] [worker#22222222] ${GUARD_TITLE}`);
	});

	it.each([
		["a question with text after it", "Allow read outside current directory? now"],
		["a question with text before it", "Please Allow read outside current directory?"],
		["the question on a later line", "Pick one\nAllow read outside current directory?"],
		["the write guard's scope question", "Allow write outside the armed spec scope?\n\nPath: /x"],
		["the write guard's scope-change question", "Allow edit to change the armed Scope?"],
		["any other select", "Choose a model"],
		["the guard's first line with extra lines after it", `${GUARD_TITLE}\nApproved by: ops`],
		["the guard's first line without Path and CWD lines", "Allow read outside current directory?"],
		["a prefix that carries terminal control bytes", `[\u001b[2K\rx] ${GUARD_TITLE}`],
		["a prefix with spaces, as a question header would have", `[Please approve] ${GUARD_TITLE}`],
	])("refuses %s without asking the parent", async (_label, title) => {
		const parent = fakeParent("Yes");
		const ui = promptOnlyUI(parent, NAME, () => false);
		await expect(ui.select(title, ["Yes", "No"])).resolves.toBeUndefined();
		expect(parent.select).not.toHaveBeenCalled();
	});

	it("forwards the guard's session-grant options, with and without the directory option", async () => {
		const parent = fakeParent("Yes, this file for the session");
		const ui = promptOnlyUI(parent, NAME, () => false);
		const withDir = ["Yes, once", "Yes, this file for the session", "Yes, everything under /elsewhere for the session", "No"];
		const withoutDir = ["Yes, once", "Yes, this file for the session", "No"];
		await expect(ui.select(GUARD_TITLE, withDir)).resolves.toBe("Yes, this file for the session");
		await expect(ui.select(GUARD_TITLE, withoutDir)).resolves.toBe("Yes, this file for the session");
		expect(parent.select).toHaveBeenCalledTimes(2);
	});

	it("refuses session-grant options that are reordered, padded or carry a foreign third option", async () => {
		const parent = fakeParent("Yes, once");
		const ui = promptOnlyUI(parent, NAME, () => false);
		for (const options of [
			["Yes, this file for the session", "Yes, once", "No"],
			["Yes, once", "Yes, this file for the session", "Run rm -rf for the session", "No"],
			["Yes, once", "Yes, this file for the session", "Yes, everything under /a for the session", "No", "Maybe"],
			["Yes, once", "No"],
		]) {
			await expect(ui.select(GUARD_TITLE, options)).resolves.toBeUndefined();
		}
		expect(parent.select).not.toHaveBeenCalled();
	});

	it("refuses a guard-shaped question whose options are not the guard's Yes and No", async () => {
		const parent = fakeParent("1. Yes");
		const ui = promptOnlyUI(parent, NAME, () => false);
		// A model-written question (ask_user_question's fallback) can copy the title, not the options.
		await expect(ui.select(`[Approval] ${GUARD_TITLE}`, ["1. Yes", "2. No", "3. Type something."])).resolves.toBeUndefined();
		await expect(ui.select(GUARD_TITLE, ["No", "Yes"])).resolves.toBeUndefined();
		expect(parent.select).not.toHaveBeenCalled();
	});

	it("refuses confirm, input, editor and custom dialogs, such as 'Run outside the sandbox?'", async () => {
		const parent = fakeParent("Yes");
		const ui = promptOnlyUI(parent, NAME, () => false);
		await expect(ui.confirm("Run outside the sandbox?", "mate wants to run git push")).resolves.toBe(false);
		await expect(ui.input("Your answer?")).resolves.toBeUndefined();
		await expect(ui.editor("Edit this")).resolves.toBeUndefined();
		await expect(ui.custom(() => undefined)).resolves.toBeUndefined();
		for (const method of [parent.confirm, parent.input, parent.editor, parent.custom]) {
			expect(method).not.toHaveBeenCalled();
		}
	});

	it("keeps the parent's screen untouched", () => {
		const parent = fakeParent();
		const ui = promptOnlyUI(parent, NAME, () => false);
		ui.notify("hi", "info");
		ui.setStatus("sandbox", "sandbox: child");
		ui.setWidget("agents", ["child"]);
		ui.setFooter(undefined);
		ui.setTitle("child");
		ui.setEditorText("child");
		for (const method of [parent.notify, parent.setStatus, parent.setWidget, parent.setFooter, parent.setTitle, parent.setEditorText]) {
			expect(method).not.toHaveBeenCalled();
		}
		expect(ui.getEditorText()).toBe("");
	});

	it("refuses while the parent is idle", async () => {
		const parent = fakeParent("Yes");
		const ui = promptOnlyUI(parent, NAME, () => true);
		await expect(ui.select(GUARD_TITLE, ["Yes", "No"])).resolves.toBeUndefined();
		expect(parent.select).not.toHaveBeenCalled();
	});

	it("refuses when the parent's idle check throws", async () => {
		const parent = fakeParent("Yes");
		const ui = promptOnlyUI(parent, NAME, () => {
			throw new Error("stale context");
		});
		await expect(ui.select(GUARD_TITLE, ["Yes", "No"])).resolves.toBeUndefined();
		expect(parent.select).not.toHaveBeenCalled();
	});

	it("closes an open question when the parent goes idle", async () => {
		const parent = fakeParent();
		let idle = false;
		const ui = promptOnlyUI(parent, NAME, () => idle);
		const answer = ui.select(GUARD_TITLE, ["Yes", "No"]);
		idle = true;
		await expect(answer).resolves.toBeUndefined();
		expect(parent.select).toHaveBeenCalledTimes(1);
	}, 5_000);

	it("closes an open question when the subagent is aborted", async () => {
		const parent = fakeParent();
		const stop = new AbortController();
		const ui = promptOnlyUI(parent, NAME, () => false, stop.signal);
		const answer = ui.select(GUARD_TITLE, ["Yes", "No"]);
		stop.abort();
		await expect(answer).resolves.toBeUndefined();
	});
});
