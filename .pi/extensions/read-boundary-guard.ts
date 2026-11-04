import os from "node:os";
import path from "node:path";
import type {
	ExtensionAPI,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import {
	firstNonEmptyString,
	isOutsideWorkingDirectory,
	isShadowedProjectCopy,
	isWithinClaudeToolResults,
	isWithinMainCheckout,
	isWithinRoot,
	isWithinSharedTmp,
	isWithinTempDir,
	isWithinTempReportsDir,
	NO_ANSWER,
	resolveInputPath,
	resolvePathWithRealAncestor,
} from "./lib/extension-helpers.ts";
import {
	loadTrustedDirectories,
	isWithinTrustedDirectory,
} from "./lib/trust-loader.ts";

const READ_BOUNDARY_GUARD_REGISTERED = Symbol.for(
	"pi.extensions.read-boundary-guard.registered",
);
const GUARDED_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const MUTATING_TOOLS = new Set(["write", "edit"]);
const ALLOW_ONCE = "Yes, once";
const ALLOW_FILE = "Yes, this file for the session";
const DENY = "No";

type Access = "read" | "write";

function getToolPathInput(
	toolName: string,
	input: Record<string, unknown>,
): string | undefined {
	if (toolName === "read" || toolName === "write" || toolName === "edit") {
		return firstNonEmptyString(input.path, input.file_path, input.filePath);
	}

	if (toolName === "grep" || toolName === "find" || toolName === "ls") {
		const explicit = firstNonEmptyString(
			input.path,
			input.file_path,
			input.filePath,
		);
		return explicit ?? ".";
	}

	return undefined;
}

function resolveGlobalPiReadOnlyRoot(): string {
	const configuredGlobalAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
	if (configuredGlobalAgentDir) {
		return resolvePathWithRealAncestor(configuredGlobalAgentDir);
	}
	return resolvePathWithRealAncestor(path.join(os.homedir(), ".pi"));
}

export default function readBoundaryGuardExtension(pi: ExtensionAPI): void {
	if (isShadowedProjectCopy(import.meta.url)) return;
	const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
	if (guardPi[READ_BOUNDARY_GUARD_REGISTERED]) return;
	guardPi[READ_BOUNDARY_GUARD_REGISTERED] = true;
	const globalPiReadOnlyRoot = resolveGlobalPiReadOnlyRoot();
	// Grants live in memory only, so a restart or a new session asks again.
	const fileGrants = new Map<string, Access>();
	const dirGrants: string[] = [];
	pi.on("session_start", async () => {
		fileGrants.clear();
		dirGrants.length = 0;
	});

	pi.on(
		"tool_call",
		async (
			event: ToolCallEvent,
			ctx,
		): Promise<ToolCallEventResult | undefined> => {
			if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

			const inputPath = getToolPathInput(
				event.toolName,
				event.input as Record<string, unknown>,
			);
			if (!inputPath) {
				return {
					block: true,
					reason: `Blocked ${event.toolName}: missing or invalid path argument for boundary enforcement.`,
				};
			}

			const currentCwd = ctx.cwd;
			const resolvedTarget = resolveInputPath(inputPath, currentCwd);

			if (isWithinRoot(resolvedTarget, globalPiReadOnlyRoot)) {
				if (READ_ONLY_TOOLS.has(event.toolName)) return undefined;
				if (MUTATING_TOOLS.has(event.toolName)) {
					return {
						block: true,
						reason: `Path '${inputPath}' is under read-only global PI directory '${globalPiReadOnlyRoot}'.`,
					};
				}
			}

			if (!isOutsideWorkingDirectory(inputPath, currentCwd)) return undefined;

			// The system temp directory and the shared /tmp are exempt for read-only tools:
			// scratch space is outside the working directory by design, and the check runs on
			// the resolved path, so a tmp path that symlinks out of the temp directory stays blocked.
			// The current project's Claude Code tool results are exempt too: the model must
			// read back output that Claude Code saved there.
			// A worktree may read its main checkout (reads only); `.git/` keeps the prompt because remote URLs can hold tokens.
			// Mutating tools keep the approval prompt (fail-safe), except inside
			// <temp root>/pi-reports/, where agents are told to write their reports.
			if (
				READ_ONLY_TOOLS.has(event.toolName) &&
				(isWithinTempDir(inputPath, currentCwd) ||
					isWithinSharedTmp(inputPath, currentCwd) ||
					isWithinClaudeToolResults(inputPath, currentCwd) ||
					isWithinMainCheckout(resolvedTarget, currentCwd))
			)
				return undefined;
			if (
				MUTATING_TOOLS.has(event.toolName) &&
				isWithinTempReportsDir(inputPath, currentCwd)
			)
				return undefined;

			// Check .pi/trust.json for whitelisted directories
			const trustedDirs = loadTrustedDirectories(currentCwd);
			if (isWithinTrustedDirectory(resolvedTarget, trustedDirs))
				return undefined;

			// A write grant covers reads of the same file; a read grant never covers writes.
			const access: Access = MUTATING_TOOLS.has(event.toolName) ? "write" : "read";
			if (isWithinTrustedDirectory(resolvedTarget, dirGrants)) return undefined;
			const fileGrant = fileGrants.get(resolvedTarget);
			if (fileGrant === "write" || fileGrant === access) return undefined;

			const reason = `Path '${inputPath}' is outside the current working directory and requires approval.`;
			if (!ctx.hasUI) {
				return { block: true, reason: `${reason} (no UI for approval)` };
			}

			// ls, find and grep target a directory; read, write and edit target a file in one.
			const grantDir =
				event.toolName === "read" || MUTATING_TOOLS.has(event.toolName)
					? path.dirname(resolvedTarget)
					: resolvedTarget;
			// One click must never open the whole home directory or anything above it.
			const dirOption = isWithinRoot(resolvePathWithRealAncestor(os.homedir()), grantDir)
				? undefined
				: `Yes, everything under ${grantDir} for the session`;
			const options = dirOption
				? [ALLOW_ONCE, ALLOW_FILE, dirOption, DENY]
				: [ALLOW_ONCE, ALLOW_FILE, DENY];

			const choice = await ctx.ui.select(
				`Allow ${event.toolName} outside current directory?\n\nPath: ${inputPath}\nCWD: ${currentCwd}`,
				options,
			);
			if (choice === undefined) {
				return { block: true, reason: NO_ANSWER };
			}
			if (choice === ALLOW_FILE) {
				fileGrants.set(resolvedTarget, access);
				return undefined;
			}
			if (dirOption && choice === dirOption) {
				dirGrants.push(grantDir);
				return undefined;
			}
			if (choice !== ALLOW_ONCE) {
				return { block: true, reason: "Blocked by user" };
			}

			return undefined;
		},
	);
}
