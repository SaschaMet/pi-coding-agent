import fs from "node:fs";
import path from "node:path";
import {
	expandHomePath,
	resolvePathWithRealAncestor,
} from "./extension-helpers.ts";

/**
 * Loads `.pi/trust.json` from the given working directory and returns a list of
 * resolved, absolute trusted directory paths. On any error (missing file, bad JSON,
 * invalid entries) returns an empty array — fail-safe defaults.
 *
 * Walks up the directory tree from `cwd` to find `.pi/trust.json`, so it works
 * even when the agent is operating in a subdirectory of the project.
 *
 * Expected schema:
 * ```json
 * {
 *   "trustedDirectories": ["/absolute/path", "~/home/path"]
 * }
 * ```
 */
export function loadTrustedDirectories(cwd: string): string[] {
	let cursor = path.resolve(cwd);
	const root = path.parse(cursor).root;

	// Walk up to find .pi/trust.json
	while (true) {
		const trustPath = path.join(cursor, ".pi", "trust.json");
		if (fs.existsSync(trustPath)) {
			return parseTrustFile(trustPath);
		}
		if (cursor === root) break;
		cursor = path.dirname(cursor);
	}

	return [];
}

function parseTrustFile(trustPath: string): string[] {
	let raw: string;
	try {
		raw = fs.readFileSync(trustPath, "utf8");
	} catch {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return [];
	}

	const record = parsed as Record<string, unknown>;
	const entries = record.trustedDirectories;

	if (!Array.isArray(entries)) {
		return [];
	}

	const resolved: string[] = [];

	for (const entry of entries) {
		if (typeof entry !== "string" || entry.trim().length === 0) continue;

		const expanded = expandHomePath(entry);

		// After expansion, the path must be absolute. Relative paths are silently
		// skipped — a user who wants relative trust should use absolute paths.
		if (!path.isAbsolute(expanded)) continue;

		const real = resolvePathWithRealAncestor(expanded);
		resolved.push(real);
	}

	return resolved;
}

/**
 * Checks whether `targetPath` falls under any of the trusted directories.
 * Uses the same containment logic as `isWithinRoot` to avoid duplicating edge-case
 * handling (symlinks, normalization).
 */
export function isWithinTrustedDirectory(
	targetPath: string,
	trustedDirs: string[],
): boolean {
	for (const dir of trustedDirs) {
		const relative = path.relative(dir, targetPath);
		if (
			relative.length === 0 ||
			(!relative.startsWith("..") && !path.isAbsolute(relative))
		) {
			return true;
		}
	}
	return false;
}
