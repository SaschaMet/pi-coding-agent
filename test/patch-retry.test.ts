import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	PATCHED_MARKER,
	collectProjectRetryCandidates,
	patchRetryFile,
} from "../scripts/patch-retry.ts";

const UNPATCHED_LINE =
	"        const delayMs = policy.baseDelayMs * 2 ** (attempt - 1);\n";

describe("patchRetryFile", () => {
	let tmp: string;
	afterEach(() => {
		if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("patches an unpatched retry.js and changes the backoff to cap at 60s", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-"));
		const file = path.join(tmp, "retry.js");
		fs.writeFileSync(file, `// some code\n${UNPATCHED_LINE}// more\n`, "utf8");

		expect(patchRetryFile(file)).toBe("patched");
		const out = fs.readFileSync(file, "utf8");
		expect(out).toContain(PATCHED_MARKER);
		expect(out).not.toContain(UNPATCHED_LINE);
	});

	it("skips an already-patched file (idempotent, byte-identical)", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-"));
		const file = path.join(tmp, "retry.js");
		fs.writeFileSync(file, UNPATCHED_LINE, "utf8");

		expect(patchRetryFile(file)).toBe("patched");
		const afterFirst = fs.readFileSync(file, "utf8");
		expect(patchRetryFile(file)).toBe("skipped");
		expect(fs.readFileSync(file, "utf8")).toBe(afterFirst);
	});

	it("never corrupts unexpected content", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-"));
		const file = path.join(tmp, "retry.js");
		const content = "const x = 1;\n";
		fs.writeFileSync(file, content, "utf8");

		expect(patchRetryFile(file)).toBe("unexpected");
		expect(fs.readFileSync(file, "utf8")).toBe(content);
	});

	it("reports missing files", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-"));
		expect(patchRetryFile(path.join(tmp, "nope.js"))).toBe("missing");
	});
});

describe("collectProjectRetryCandidates", () => {
	let tmp: string;
	afterEach(() => {
		if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("finds the direct and nested pi-ai copies under node_modules", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-"));
		const scoped = path.join(tmp, "node_modules", "@earendil-works");

		// direct copy
		const direct = path.join(scoped, "pi-ai", "dist", "utils");
		fs.mkdirSync(direct, { recursive: true });
		fs.writeFileSync(path.join(direct, "retry.js"), UNPATCHED_LINE, "utf8");

		// nested copy under pi-coding-agent
		const nested = path.join(
			scoped,
			"pi-coding-agent",
			"node_modules",
			"@earendil-works",
			"pi-ai",
			"dist",
			"utils",
		);
		fs.mkdirSync(nested, { recursive: true });
		fs.writeFileSync(path.join(nested, "retry.js"), UNPATCHED_LINE, "utf8");

		// unrelated package must not be picked up
		const other = path.join(scoped, "pi-tui", "dist");
		fs.mkdirSync(other, { recursive: true });
		fs.writeFileSync(path.join(other, "retry.js"), UNPATCHED_LINE, "utf8");

		const candidates = collectProjectRetryCandidates(tmp);
		expect(candidates).toHaveLength(2);
		expect(
			candidates.some((c) => c.includes(path.join("pi-ai", "dist", "utils"))),
		).toBe(true);
	});

	it("returns an empty list when there is no @earendil-works scope", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-"));
		expect(collectProjectRetryCandidates(tmp)).toHaveLength(0);
	});
});
