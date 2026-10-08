import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const CHECK_COMMAND = "node ~/.pi/agent/security/check-install.ts";

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	expect(from, `missing "${start}"`).toBeGreaterThan(-1);
	const to = text.indexOf(end, from + start.length);
	return text.slice(from, to === -1 ? undefined : to);
}

describe.each([
	[".pi/skill-library/init-project/SKILL.md", "1. Inspect before writing:", "\n2. "],
	[".pi/skill-library/add-coding-standard/SKILL.md", "1. Inspect before proposing:", "\n2. "],
])("%s runs the global guard check", (file, stepStart, stepEnd) => {
	const text = read(file);

	it("runs the read-only check in Step 1", () => {
		const step = between(text, stepStart, stepEnd);
		expect(step).toContain(CHECK_COMMAND);
		expect(step).toMatch(/guard is not installed/);
		expect(step).toMatch(/never run the install commands/i);
	});

	it("reports the check result in its Definition of Done", () => {
		expect(between(text, "## Definition of Done", "\n## ")).toMatch(/global guard check result is reported/i);
	});
});

describe("graphify hook instructions", () => {
	const text = read(".pi/skills/graphify/references/hooks.md");

	it("hides the global hook path and leaves the command to a human", () => {
		for (const action of ["install", "uninstall", "status"]) {
			expect(text).toContain(`GIT_CONFIG_GLOBAL=/dev/null graphify hook ${action}`);
		}
		expect(text).toMatch(/a human runs these commands/i);
		expect(text).not.toMatch(/^graphify hook install/m);
	});
});
