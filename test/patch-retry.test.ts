import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	PATCHED_MARKER,
	collectProjectRetryCandidates,
	patchRetryFile,
} from "../scripts/patch-retry.ts";

const UNPATCHED_LINE =
	"        const delayMs = policy.baseDelayMs * 2 ** (attempt - 1);\n";

// Verbatim excerpt from `@earendil-works/pi-ai@0.87.1` `dist/utils/retry.js`. The
// delay formula moved into a standalone exported `retryDelayMs`, with 4-space
// indent, a `delay`/`safeDelay` variable pair, `Math.max(0, attempt - 1)`
// instead of a bare `attempt - 1`, and its own default cap via
// `DEFAULT_MAX_AGENT_RETRY_DELAY_MS`. That cap is what the 0.82 patch added, so
// `patchRetryFile` reports this shape as "upstream" and leaves it untouched.
const UNPATCHED_087_RETRY_JS = `export const DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000;
export function retryDelayMs(policy, attempt) {
    const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
    const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
    return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);
}
`;

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

describe("patchRetryFile (pi-ai 0.87.1 shape)", () => {
	let tmp: string;
	afterEach(() => {
		if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("recognizes the 0.87.1 shape as already capping natively and leaves it untouched", async () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-087-"));
		const file = path.join(tmp, "retry.js");
		fs.writeFileSync(file, UNPATCHED_087_RETRY_JS, "utf8");

		expect(patchRetryFile(file)).toBe("upstream");
		expect(fs.readFileSync(file, "utf8")).toBe(UNPATCHED_087_RETRY_JS);

		// Behavior, not just status: the (untouched) module must still produce the
		// same capped backoff the 0.82 patch produced — 4s, 8s, 16s, 32s, then
		// 60s from the 5th retry onward, for the documented `baseDelayMs: 4000`
		// setting (script header comment) — because pi-ai now caps natively.
		const mod = await import(pathToFileURL(file).href);
		const policy = { baseDelayMs: 4000 };
		const delays = [1, 2, 3, 4, 5, 6].map((attempt) => mod.retryDelayMs(policy, attempt));
		expect(delays).toEqual([4000, 8000, 16000, 32000, 60000, 60000]);
	});

	it("reports upstream again on a second call, byte-identical (idempotent)", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-087-"));
		const file = path.join(tmp, "retry.js");
		fs.writeFileSync(file, UNPATCHED_087_RETRY_JS, "utf8");

		expect(patchRetryFile(file)).toBe("upstream");
		const afterFirst = fs.readFileSync(file, "utf8");
		expect(patchRetryFile(file)).toBe("upstream");
		expect(fs.readFileSync(file, "utf8")).toBe(afterFirst);
	});

	it("still warns on content resembling neither the 0.82 nor the 0.87.1 shape", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-087-"));
		const file = path.join(tmp, "retry.js");
		fs.writeFileSync(
			file,
			"export function retryDelayMs(policy, attempt) {\n    return policy.baseDelayMs * attempt;\n}\n",
			"utf8",
		);

		expect(patchRetryFile(file)).toBe("unexpected");
		expect(fs.readFileSync(file, "utf8")).toContain("policy.baseDelayMs * attempt");
	});

	it("still warns when the upstream cap constant is not exactly 60_000", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-retry-087-"));
		const file = path.join(tmp, "retry.js");
		const content = UNPATCHED_087_RETRY_JS.replace("60_000", "120_000");
		fs.writeFileSync(file, content, "utf8");

		expect(patchRetryFile(file)).toBe("unexpected");
		expect(fs.readFileSync(file, "utf8")).toBe(content);
	});
});
