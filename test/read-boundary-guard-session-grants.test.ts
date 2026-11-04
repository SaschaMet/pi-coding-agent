import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

const ONCE = "Yes, once";
const FILE = "Yes, this file for the session";
const isDirOption = (option: string) => /^Yes, everything under .+ for the session$/.test(option);

// A project dir and a sibling outside it, both under a fresh temp parent so a directory
// grant never reaches the home directory or the filesystem root.
function setup() {
	const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-grants-")));
	const cwd = path.join(parent, "project");
	const outside = path.join(parent, "outside");
	fs.mkdirSync(cwd);
	fs.mkdirSync(outside);
	const pi = createFakePi();
	readBoundaryGuardExtension(pi as any);
	const handler = (pi.handlers.get("tool_call") ?? [])[0];
	const call = async (toolName: string, target: string, answer: (options: string[]) => string | undefined) => {
		const select = vi.fn(async (_title: string, options: string[]) => answer(options));
		const result = await handler({ toolName, input: { path: target, content: "x" } }, { hasUI: true, cwd, ui: { select } });
		return { result, select };
	};
	return { pi, cwd, outside, call };
}

const pick = (label: string) => (options: string[]) => options.find((o) => o === label);
const pickDir = (options: string[]) => options.find(isDirOption);
const no = () => "No";

// The temp-dir exemption switches off when the cwd itself is in the temp dir, so these
// fixtures still reach the prompt.
describe("read boundary guard session grants", () => {
	it("offers once, file, directory and no", async () => {
		const { outside, call } = setup();
		const { select } = await call("read", path.join(outside, "a.md"), no);
		const options = select.mock.calls[0][1] as string[];
		expect(options[0]).toBe(ONCE);
		expect(options[1]).toBe(FILE);
		expect(isDirOption(options[2])).toBe(true);
		expect(options[2]).toContain(outside);
		expect(options[3]).toBe("No");
	});

	it("asks again after Yes, once", async () => {
		const { outside, call } = setup();
		const target = path.join(outside, "a.md");
		expect((await call("read", target, pick(ONCE))).result).toBeUndefined();
		const again = await call("read", target, no);
		expect(again.select).toHaveBeenCalledTimes(1);
		expect(again.result?.block).toBe(true);
	});

	it("remembers a file grant for later calls on the same file", async () => {
		const { outside, call } = setup();
		const target = path.join(outside, "a.md");
		await call("write", target, pick(FILE));
		const read = await call("read", target, no);
		const write = await call("edit", target, no);
		expect(read.select).not.toHaveBeenCalled();
		expect(read.result).toBeUndefined();
		expect(write.select).not.toHaveBeenCalled();
		expect(write.result).toBeUndefined();
	});

	it("keeps asking for writes after a read-only file grant", async () => {
		const { outside, call } = setup();
		const target = path.join(outside, "a.md");
		await call("read", target, pick(FILE));
		expect((await call("read", target, no)).select).not.toHaveBeenCalled();
		const write = await call("write", target, no);
		expect(write.select).toHaveBeenCalledTimes(1);
		expect(write.result?.block).toBe(true);
	});

	it("does not let a file grant cover a sibling file", async () => {
		const { outside, call } = setup();
		await call("write", path.join(outside, "a.md"), pick(FILE));
		const sibling = await call("read", path.join(outside, "b.md"), no);
		expect(sibling.select).toHaveBeenCalledTimes(1);
	});

	it("lets a directory grant cover reads and writes anywhere under it", async () => {
		const { outside, call } = setup();
		await call("read", path.join(outside, "a.md"), pickDir);
		for (const [tool, target] of [
			["write", path.join(outside, "b.md")],
			["edit", path.join(outside, "nested", "c.md")],
			["ls", outside],
		] as const) {
			const { result, select } = await call(tool, target, no);
			expect(select).not.toHaveBeenCalled();
			expect(result).toBeUndefined();
		}
	});

	it("grants the listed directory itself for ls, find and grep", async () => {
		const { outside, call } = setup();
		const { select } = await call("ls", outside, pickDir);
		expect((select.mock.calls[0][1] as string[]).find(isDirOption)).toContain(outside);
		expect((await call("read", path.join(outside, "a.md"), no)).select).not.toHaveBeenCalled();
	});

	it("does not let a directory grant reach its parent", async () => {
		const { cwd, outside, call } = setup();
		await call("read", path.join(outside, "a.md"), pickDir);
		const parent = await call("read", path.join(path.dirname(cwd), "top.md"), no);
		expect(parent.select).toHaveBeenCalledTimes(1);
	});

	it("never offers the directory option for the home directory or the filesystem root", async () => {
		const { call } = setup();
		for (const target of [path.join(os.homedir(), "pi-grants-probe.md"), "/pi-grants-probe.md", "/"]) {
			const { select } = await call(target === "/" ? "ls" : "read", target, no);
			const options = select.mock.calls[0][1] as string[];
			expect(options.some(isDirOption)).toBe(false);
			expect(options).toEqual([ONCE, FILE, "No"]);
		}
	});

	it("clears every grant on session_start", async () => {
		const { pi, outside, call } = setup();
		await call("read", path.join(outside, "a.md"), pickDir);
		await call("read", "/pi-grants-probe.md", pick(FILE));
		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, {});
		expect((await call("read", path.join(outside, "a.md"), no)).select).toHaveBeenCalledTimes(1);
		expect((await call("read", "/pi-grants-probe.md", no)).select).toHaveBeenCalledTimes(1);
	});

	it("keeps the global PI directory read-only whatever was granted", async () => {
		const { call } = setup();
		const globalDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
		const target = path.join(globalDir, "settings.json");
		await call("read", target, pickDir);
		const write = await call("write", target, pick(FILE));
		expect(write.result?.block).toBe(true);
		expect(write.select).not.toHaveBeenCalled();
	});

	it("treats a dismissed prompt as No and grants nothing", async () => {
		const { outside, call } = setup();
		const target = path.join(outside, "a.md");
		expect((await call("read", target, () => undefined)).result?.block).toBe(true);
		expect((await call("read", target, no)).select).toHaveBeenCalledTimes(1);
	});
});
