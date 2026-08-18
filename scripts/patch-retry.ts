// Durable re-application of a small local patch to the PI runtime's LLM API
// retry backoff.
//
// `@earendil-works/pi-ai` computes the retry delay as
// `baseDelayMs * 2 ** (attempt - 1)` with no upper bound. We want the wait to
// cap at 60s starting from the 5th retry onward (settings `retry.baseDelayMs:
// 4000` => 4s, 8s, 16s, 32s, then 60s, 60s, ...). That cap is not a supported
// setting, so this script edits the installed `dist/utils/retry.js` in place.
//
// node_modules is ephemeral (wiped on `npm install` / package upgrades), so this
// script is wired as the package's `postinstall` hook and re-runs it after every
// install. It is idempotent: already-patched files are left untouched.
//
// Covers every reachable copy of pi-ai:
//   1. the project's own node_modules (direct @earendil-works/pi-ai + nested
//      copies under other @earendil-works packages),
//   2. the global `pi` CLI install (resolved from the `pi` executable in PATH),
//      so `pi` run anywhere on this machine gets the same behavior.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type PatchStatus = "missing" | "skipped" | "patched" | "unexpected";

const RETRY_REL = path.join("dist", "utils", "retry.js");
const OLD_LINE =
	"        const delayMs = policy.baseDelayMs * 2 ** (attempt - 1);";
const PATCH_LEAD = [
	"        // pi-coding-agent local patch: cap retry backoff at 60s from the 5th retry onward.",
	"        const delayMs = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), 60_000);",
].join("\n");
export const PATCHED_MARKER =
	"Math.min(policy.baseDelayMs * 2 ** (attempt - 1), 60_000)";

/** Patch a single pi-ai `retry.js` file. Idempotent; never corrupts unknown content. */
export function patchRetryFile(retryJsPath: string): PatchStatus {
	if (!fs.existsSync(retryJsPath)) return "missing";
	const content = fs.readFileSync(retryJsPath, "utf8");
	if (content.includes(PATCHED_MARKER)) return "skipped";
	if (content.includes(OLD_LINE)) {
		fs.writeFileSync(retryJsPath, content.replace(OLD_LINE, PATCH_LEAD), "utf8");
		return "patched";
	}
	return "unexpected";
}

/**
 * Collect every pi-ai retry.js reachable under a `node_modules/@earendil-works`
 * scope: the direct `pi-ai` package plus any nested copy tucked under another
 * `@earendil-works/<pkg>/node_modules` (npm often installs pi-ai nested for
 * `pi-coding-agent` instead of hoisting it).
 */
export function collectScopedRetryCandidates(
	nodeModulesRoot: string,
): string[] {
	const scopedDir = path.join(nodeModulesRoot, "@earendil-works");
	if (!fs.existsSync(scopedDir)) return [];

	const candidates: string[] = [];
	const direct = path.join(scopedDir, "pi-ai", RETRY_REL);
	if (fs.existsSync(direct)) candidates.push(direct);

	let subdirs: string[] = [];
	try {
		subdirs = fs.readdirSync(scopedDir);
	} catch {
		subdirs = [];
	}
	for (const sub of subdirs) {
		if (sub === "pi-ai") continue;
		const nested = path.join(
			scopedDir,
			sub,
			"node_modules",
			"@earendil-works",
			"pi-ai",
			RETRY_REL,
		);
		if (fs.existsSync(nested)) candidates.push(nested);
	}
	return candidates;
}

/** Candidates under the current project's own node_modules. */
export function collectProjectRetryCandidates(projectRoot: string): string[] {
	return collectScopedRetryCandidates(path.join(projectRoot, "node_modules"));
}

/** Candidates under the global `pi` CLI install (resolved via `npm root -g`). */
export function collectGlobalRetryCandidates(): string[] {
	let npmGlobalRoot: string;
	try {
		npmGlobalRoot = execFileSync("npm", ["root", "-g"], {
			encoding: "utf8",
		}).trim();
	} catch {
		return [];
	}
	if (!npmGlobalRoot) return [];

	return collectScopedRetryCandidates(npmGlobalRoot);
}

function main(): void {
	const projectRoot = process.cwd();
	const targets = [
		...collectProjectRetryCandidates(projectRoot),
		...collectGlobalRetryCandidates(),
	];

	if (targets.length === 0) {
		console.log("[patch-retry] no pi-ai copies found; nothing to patch.");
		return;
	}

	let unexpected = false;
	for (const file of targets) {
		const status = patchRetryFile(file);
		if (status === "patched") {
			console.log(`[patch-retry] patched  ${file}`);
		} else if (status === "skipped") {
			console.log(`[patch-retry] already  ${file}`);
		} else if (status === "unexpected") {
			unexpected = true;
			console.error(
				`[patch-retry] WARNING: unexpected content (upstream changed?), not patched: ${file}`,
			);
		}
	}

	if (unexpected) {
		console.error(
			"[patch-retry] One or more retry.js files did not match the expected formula. " +
				"Review the pi-ai upgrade and scripts/patch-retry.ts.",
		);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
