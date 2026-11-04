import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_ANSWER } from "../.pi/extensions/lib/extension-helpers.ts";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

async function askOutsideRead(answer: string | undefined) {
	const tmp = fs.mkdtempSync(
		path.join(os.tmpdir(), "pi-read-boundary-no-answer-"),
	);
	const pi = createFakePi();
	readBoundaryGuardExtension(pi as any);
	const handlers = pi.handlers.get("tool_call") ?? [];

	return handlers[0](
		{ toolName: "read", input: { path: "../secrets.txt" } },
		{
			hasUI: true,
			cwd: tmp,
			ui: {
				select: async () => answer,
			},
		},
	);
}

describe("read boundary guard approval answers", () => {
	it("blocks with the no-answer reason when the dialog closes without a choice", async () => {
		const result = await askOutsideRead(undefined);

		expect(result?.block).toBe(true);
		expect(result?.reason).toBe(NO_ANSWER);
		expect(result?.reason).not.toContain("Blocked by user");
	});

	it("keeps 'Blocked by user' for an explicit No", async () => {
		const result = await askOutsideRead("No");

		expect(result?.block).toBe(true);
		expect(result?.reason).toBe("Blocked by user");
	});
});
