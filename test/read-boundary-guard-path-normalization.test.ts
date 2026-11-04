import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveInputPath } from "../.pi/extensions/lib/extension-helpers.ts";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

// pi's file tools strip a leading `@` and decode `file://` URLs before they open a path,
// so the guard must check that same path, not the literal argument.
function setup() {
	const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-path-norm-")));
	const cwd = path.join(parent, "project");
	fs.mkdirSync(cwd);
	const pi = createFakePi();
	readBoundaryGuardExtension(pi as any);
	const handler = (pi.handlers.get("tool_call") ?? [])[0];
	const call = async (toolName: string, target: string) => {
		const select = vi.fn(async () => "No");
		const result = await handler({ toolName, input: { path: target, content: "x" } }, { hasUI: true, cwd, ui: { select } });
		return { result, select };
	};
	return { parent, cwd, call };
}

describe("guard path normalization", () => {
	it("resolves a leading @ the way pi's tools do", () => {
		const { parent, cwd } = setup();
		expect(resolveInputPath("@../x.md", cwd)).toBe(path.join(parent, "x.md"));
		expect(resolveInputPath("@/etc/hosts", cwd)).toBe(fs.realpathSync("/etc/hosts"));
		expect(resolveInputPath("@notes.md", cwd)).toBe(path.join(cwd, "notes.md"));
	});

	it("decodes file:// URLs the way pi's tools do", () => {
		const { cwd } = setup();
		expect(resolveInputPath("file:///etc/ho%73ts", cwd)).toBe(fs.realpathSync("/etc/hosts"));
		expect(resolveInputPath("@file:///etc/hosts", cwd)).toBe(fs.realpathSync("/etc/hosts"));
	});

	it("asks before reading an @-prefixed path outside the working directory", async () => {
		const { call } = setup();
		const { result, select } = await call("read", "@../x.md");
		expect(select).toHaveBeenCalledTimes(1);
		expect(result?.block).toBe(true);
	});

	it("asks before reading a file:// URL outside the working directory", async () => {
		const { call } = setup();
		const { result, select } = await call("read", "file:///etc/hosts");
		expect(select).toHaveBeenCalledTimes(1);
		expect(result?.block).toBe(true);
	});

	it("keeps the global PI directory read-only behind an @ prefix", async () => {
		const { call } = setup();
		const globalDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
		const { result } = await call("write", `@${path.join(globalDir, "extensions", "evil.ts")}`);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("read-only global PI directory");
	});

	it("still allows an @-prefixed path inside the working directory without asking", async () => {
		const { call } = setup();
		const { result, select } = await call("read", "@notes.md");
		expect(select).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});
});
