import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
	type BashOperations,
	type BashSpawnHook,
	createBashToolDefinition,
	createLocalBashOperations,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";
import { runGitWorktree } from "./lib/git-worktree.ts";
import {
	type ActiveGrant,
	applyGrants,
	buildSrtSettings,
	canonicalPath,
	checkCwd,
	findBinary,
	findSrt,
	gitMaintenanceOff,
	gitPointerLiterals,
	gitTreeDenies,
	globalGitConfigDenies,
	checkGrantPreset,
	linkedWorktreeGitWrites,
	loadSandboxConfig,
	nonRepoDenies,
	parseGrantNames,
	resolveGrants,
	resolvePaths,
	SRT_VERSION,
	sameRealPath,
	type SrtSettings,
	secretEnvNames,
	currentConfigValue,
	submoduleConfigNeeded,
	wrapCommand,
} from "./lib/sandbox-bash.ts";

const SANDBOX_BASH_REGISTERED = Symbol.for("pi.extensions.sandbox-bash.registered");
const STATUS_KEY = "sandbox";
const PROBE_TIMEOUT_MS = 10_000;
// A tool call that arrives before any session_start must not wait forever.
const READY_TIMEOUT_MS = 30_000;
const GUIDELINE =
	"bash runs in an OS sandbox; a permission error, a blocked host (proxy 403 or ENOTFOUND), or a 'bash blocked' message is the sandbox — do not retry or work around it; follow the `sandboxed-bash` skill.";
// The `sandbox OFF` prefix is a contract: the cmux one-shot recipe verifies a pane by it.
const OFF_MESSAGE = "sandbox OFF: bash runs unsandboxed this session (--no-sandbox)";

type State =
	| { kind: "pending" }
	| { kind: "off" }
	| { kind: "blocked"; reason: string }
	| {
			kind: "active";
			srtPath: string;
			settingsPath: string;
			settings: SrtSettings;
			envNames: string[];
			common: string | undefined;
			literals: string[];
			linkedWorktree: boolean;
			presets: Record<string, Record<string, unknown>>;
			grants: ActiveGrant[];
	  };

// A preset nobody requested is only listed; a broken one shows its reason instead of blocking bash.
function presetLines(presets: Record<string, Record<string, unknown>>): string[] {
	const file = path.join(getAgentDir(), "sandbox.json");
	const lines = [`Grant presets: ${Object.keys(presets).join(", ") || "(none)"}`];
	for (const [name, raw] of Object.entries(presets)) {
		try {
			checkGrantPreset(name, raw, file);
		} catch (error) {
			lines.push(`invalid: ${name}: ${errorMessage(error)}`);
		}
	}
	return lines;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function blockedMessage(reason: string): string {
	return `bash blocked: sandbox unavailable (${reason})`;
}

type Report = {
	status: string;
	notice?: string;
	level: "warning" | "error";
	extraNotices?: string[];
};

// Grants widen the sandbox, so each one is announced where the human sees it.
function grantNotices(grants: readonly ActiveGrant[]): string[] {
	const notices: string[] = [];
	for (const grant of grants) {
		for (const socket of grant.allowUnixSockets) {
			notices.push(`Unix socket ${socket}: a process behind it can act outside the sandbox`);
		}
		for (const socket of grant.missingSockets) {
			notices.push(`Unix socket ${socket}: socket not present yet; start Docker Desktop`);
		}
		if (grant.allowedDomains.length > 0) {
			notices.push(`grant ${grant.name}: the session can use stored credentials for ${grant.allowedDomains.join(", ")}`);
		}
	}
	return notices;
}

function describeState(state: State): Report | undefined {
	if (state.kind === "off") return { status: "sandbox OFF", notice: OFF_MESSAGE, level: "warning" };
	if (state.kind === "blocked") {
		return { status: "bash blocked: sandbox unavailable", notice: blockedMessage(state.reason), level: "error" };
	}
	if (state.kind !== "active") return undefined;
	const { network, filesystem } = applyGrants(state.settings, state.grants);
	const suffix = state.grants.length > 0 ? `, grants: ${state.grants.map((g) => g.name).join(", ")}` : "";
	return {
		status: `sandbox: ${network.allowedDomains.length} domains, ${filesystem.allowWrite.length} write paths, ${state.envNames.length} env removed${suffix}`,
		level: "warning",
		extraNotices: grantNotices(state.grants),
	};
}

// CLAUDE_CODE_TMPDIR keeps $TMPDIR the same path inside and outside srt.
// SANDBOX_GRANTS lets a sandboxed agent see what this session may do; srt enforces the real rules.
// An inherited value is dropped so a child session never claims grants its own flag did not give.
function sandboxEnv(
	env: NodeJS.ProcessEnv | undefined,
	linkedWorktree: boolean,
	grants: readonly ActiveGrant[],
): NodeJS.ProcessEnv {
	const base: NodeJS.ProcessEnv = { ...(env ?? process.env), CLAUDE_CODE_TMPDIR: os.tmpdir() };
	delete base.SANDBOX_GRANTS;
	if (grants.length > 0) base.SANDBOX_GRANTS = grants.map((g) => g.name).join(",");
	return linkedWorktree ? gitMaintenanceOff(base) : base;
}

export default function sandboxBashExtension(pi: ExtensionAPI): void {
	if (isShadowedProjectCopy(import.meta.url)) return;
	const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
	if (guardPi[SANDBOX_BASH_REGISTERED]) return;
	guardPi[SANDBOX_BASH_REGISTERED] = true;

	pi.registerFlag("no-sandbox", {
		description: "Run bash without the OS sandbox for this session",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("sandbox-grant", {
		description: "Comma-separated grant presets from ~/.pi/agent/sandbox.json for this session",
		// No default: "not passed" must stay distinguishable from "passed empty".
		type: "string",
	});

	let state: State = { kind: "pending" };
	let markReady: () => void = () => undefined;
	let ready = new Promise<void>((resolve) => {
		markReady = resolve;
	});

	async function currentState(): Promise<State> {
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, READY_TIMEOUT_MS);
		});
		await Promise.race([ready, timeout]);
		clearTimeout(timer);
		return state.kind === "pending" ? { kind: "blocked", reason: "sandbox did not start" } : state;
	}

	const spawnHook: BashSpawnHook = (context) => {
		if (state.kind === "off") return context;
		if (state.kind !== "active") {
			throw new Error(blockedMessage(state.kind === "blocked" ? state.reason : "sandbox not ready"));
		}
		return {
			...context,
			command: wrapCommand(context.command, state.settingsPath, state.srtPath),
			env: sandboxEnv(context.env, state.linkedWorktree, state.grants),
		};
	};

	// The git_worktree tool runs outside the sandbox, so it must not overlap a sandboxed command that could be swapping paths under it.
	let bashRunning = 0;
	const counted = async <T>(run: () => Promise<T>): Promise<T> => {
		bashRunning++;
		try {
			return await run();
		} finally {
			bashRunning--;
		}
	};

	const inner = createBashToolDefinition(process.cwd(), { spawnHook });
	pi.registerTool({
		...inner,
		label: "bash (sandboxed)",
		promptGuidelines: [...(inner.promptGuidelines ?? []), GUIDELINE],
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const current = refreshPointerLiterals(checkSettingsFile(await currentState(), ctx), ctx);
			if (current.kind === "blocked") throw new Error(blockedMessage(current.reason));
			return counted(() => inner.execute(toolCallId, params, signal, onUpdate, ctx));
		},
	});

	pi.registerTool({
		name: "git_worktree",
		label: "git worktree (trusted)",
		executionMode: "sequential",
		description:
			"Create or remove a git worktree under a checkout's .worktrees/ folder on a handsoff/ or hill-climb/ branch. Use it because bash cannot write git pointer files in the sandbox.",
		parameters: Type.Object(
			{
				action: Type.Union([Type.Literal("add"), Type.Literal("remove")]),
				path: Type.String(),
				branch: Type.Optional(Type.String()),
				base: Type.Optional(Type.String()),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (bashRunning > 0) throw new Error("git_worktree refused: a sandboxed bash command is running");
			const writable = resolvePaths(loadSandboxConfig(getAgentDir()).filesystem.allowWrite, {
				cwd: ctx.cwd,
				home: os.homedir(),
				tmpdir: os.tmpdir(),
			});
			const realGit = findBinary("git", process.env.PATH ?? "", writable);
			if (!realGit) throw new Error("git_worktree: git not found on PATH outside writable folders");
			const result = runGitWorktree(params, { cwd: ctx.cwd, realGit });
			if (result.refused) throw new Error(`git_worktree refused:\n${result.refused.join("\n")}`);
			if (!result.ok) throw new Error(`git exited ${result.exitCode}\n${result.stderr}`);
			return {
				content: [{ type: "text", text: `exit 0\n${result.stdout}${result.stderr}` }],
				details: { exitCode: result.exitCode, gitArgs: result.gitArgs },
			};
		},
	});

	function sandboxedOperations(active: Extract<State, { kind: "active" }>): BashOperations {
		const local = createLocalBashOperations();
		return {
			exec: (command, cwd, options) =>
				counted(() =>
					local.exec(wrapCommand(command, active.settingsPath, active.srtPath), cwd, {
						...options,
						env: sandboxEnv(options.env, active.linkedWorktree, active.grants),
					}),
				),
		};
	}

	pi.on("user_bash", async (_event, ctx) => {
		const current = refreshPointerLiterals(checkSettingsFile(await currentState(), ctx), ctx);
		if (current.kind === "off") return undefined;
		if (current.kind === "active") return { operations: sandboxedOperations(current) };
		const reason = current.kind === "blocked" ? current.reason : "sandbox not ready";
		return {
			result: { output: blockedMessage(reason), exitCode: 1, cancelled: false, truncated: false },
		};
	});

	async function start(ctx: ExtensionContext): Promise<State> {
		// Only this process's own flag may name grants; a value inherited from a parent pi must not leak into bash.
		delete process.env.SANDBOX_GRANTS;
		const grantFlag = pi.getFlag("sandbox-grant");
		if (pi.getFlag("no-sandbox") === true) {
			if (grantFlag !== undefined) return { kind: "blocked", reason: "--no-sandbox and --sandbox-grant conflict; pass one" };
			return { kind: "off" };
		}
		const home = os.homedir();
		const cwdProblem = checkCwd(ctx.cwd, home);
		if (cwdProblem) return { kind: "blocked", reason: cwdProblem };

		// pi resolves a tool name to its last registration; another bash would bypass the sandbox.
		const owner = pi.getAllTools().find((tool) => tool.name === "bash")?.sourceInfo.path;
		if (!owner || !sameRealPath(owner, fileURLToPath(import.meta.url))) {
			return { kind: "blocked", reason: `the active bash tool comes from ${owner ?? "nowhere"}, not the sandbox` };
		}

		const config = loadSandboxConfig(getAgentDir());
		const revParse = await pi.exec(
			"git",
			["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"],
			{ cwd: ctx.cwd, timeout: PROBE_TIMEOUT_MS },
		);
		// A killed rev-parse reports exit 0 with partial output.
		const git =
			revParse.code === 0 && !revParse.killed
				? linkedWorktreeGitWrites(revParse.stdout, { cwd: ctx.cwd, home, tmpdir: os.tmpdir() })
				: { allowWrite: [], denyWrite: [] };
		const settingsDir = path.join(getAgentDir(), "sandbox-run");
		fs.mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
		const envNames = secretEnvNames(process.env);
		const settings = buildSrtSettings(config, {
			cwd: ctx.cwd,
			home,
			tmpdir: os.tmpdir(),
			settingsDir: fs.realpathSync(settingsDir),
			uid: process.getuid?.() ?? 0,
			cmuxSocket: process.env.CMUX_SOCKET_PATH || undefined,
			envNames,
		});
		// Already canonical: resolving them again would follow a symlink swapped in since the check.
		settings.filesystem.allowWrite.push(...git.allowWrite);
		settings.filesystem.denyWrite.push(...git.denyWrite);

		let common: string | undefined;
		let repoTop: string | undefined;
		let literals: string[] = [];
		if (revParse.code === 0 && !revParse.killed) {
			const tree = gitTreeDenies(revParse.stdout);
			if (!tree) {
				return { kind: "blocked", reason: "a git path holds a glob character (*?[]{}), so srt cannot deny it by name; use a checkout path without one" };
			}
			if (tree.length > 0) {
				const lines = revParse.stdout.trim().split("\n");
				common = canonicalPath(lines[1]);
				repoTop = canonicalPath(lines[2]);
				const found = gitPointerLiterals(common);
				if (!found) return { kind: "blocked", reason: `cannot list the git pointer files under ${common}` };
				literals = found;
				settings.filesystem.denyWrite.push(...tree, ...literals);
			}
		} else {
			const tmpRoots = resolvePaths(["$TMPDIR", "/tmp", "~/.npm"], { cwd: ctx.cwd, home, tmpdir: os.tmpdir() });
			settings.filesystem.denyWrite.push(...nonRepoDenies(canonicalPath(ctx.cwd), settings.filesystem.allowWrite, tmpRoots));
		}

		const globalGit = globalGitConfigDenies({
			home,
			xdgConfigHome: process.env.XDG_CONFIG_HOME || undefined,
			writableRoots: settings.filesystem.allowWrite,
			repoTop,
			gitConfigGlobal: process.env.GIT_CONFIG_GLOBAL || undefined,
			extraFiles: common ? [path.join(common, "config")] : [],
		});
		if ("blocked" in globalGit) return { kind: "blocked", reason: globalGit.blocked };
		settings.filesystem.denyWrite.push(...globalGit.denyWrite);

		if (common) {
			// Git status then never enters a nested repo a session staged as a gitlink, whose config could run a command outside the sandbox.
			const problem = setSubmoduleConfig(common, settings.filesystem.allowWrite, ctx);
			if (problem) return { kind: "blocked", reason: problem };
		}

		// allowWrite is final here, so a granted socket is checked against every writable root.
		const names = parseGrantNames(grantFlag as boolean | string | undefined);
		if ("blocked" in names) return { kind: "blocked", reason: names.blocked };
		const grants = resolveGrants(names, config.grants, settings.filesystem.allowWrite, home, path.join(getAgentDir(), "sandbox.json"));
		if ("blocked" in grants) return { kind: "blocked", reason: grants.blocked };

		const srtPath = findSrt(process.env.PATH ?? "", settings.filesystem.allowWrite);
		if (!srtPath) {
			return {
				kind: "blocked",
				reason: `srt not found on PATH outside writable folders; install @anthropic-ai/sandbox-runtime@${SRT_VERSION}`,
			};
		}
		const version = await pi.exec(srtPath, ["--version"], { timeout: PROBE_TIMEOUT_MS });
		const found = version.stdout.trim();
		if (version.code !== 0 || found !== SRT_VERSION) {
			return { kind: "blocked", reason: `srt version ${found || "unknown"} is not the pinned ${SRT_VERSION}` };
		}

		const settingsPath = path.join(settingsDir, `${process.pid}-${randomBytes(6).toString("hex")}.json`);
		fs.writeFileSync(settingsPath, JSON.stringify(applyGrants(settings, grants), null, 2), { mode: 0o600 });

		const probe = await pi.exec("/bin/bash", ["-c", wrapCommand("true", settingsPath, srtPath)], {
			cwd: ctx.cwd,
			timeout: PROBE_TIMEOUT_MS,
		});
		if (probe.code !== 0) {
			fs.rmSync(settingsPath, { force: true });
			return { kind: "blocked", reason: `srt probe failed (exit ${probe.code}): ${probe.stderr.trim().slice(0, 200)}` };
		}
		return { kind: "active", srtPath, settingsPath, settings, envNames, common, literals, linkedWorktree: git.allowWrite.length > 0, presets: config.grants, grants };
	}

	function setSubmoduleConfig(common: string, writableRoots: readonly string[], ctx: ExtensionContext): string | undefined {
		const file = path.join(common, "config");
		try {
			if (!fs.lstatSync(file).isFile()) return `${file} is not a regular file`;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return `cannot inspect ${file}: ${errorMessage(error)}`;
		}
		let text = "";
		try {
			text = fs.readFileSync(file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return `cannot read ${file}: ${errorMessage(error)}`;
		}
		const needed = submoduleConfigNeeded(text);
		if (needed.length === 0) return undefined;
		// git swaps the file through a lock, so a read-only config would be replaced without error.
		try {
			fs.accessSync(file, fs.constants.W_OK);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return `cannot set ${needed[0][0]} in ${file}: not writable`;
		}
		const realGit = findBinary("git", process.env.PATH ?? "", writableRoots);
		if (!realGit) return `git not found outside writable folders; cannot set ${needed[0][0]} in ${file}`;
		for (const [key, value] of needed) {
			const result = spawnSync(realGit, ["config", "--file", file, key, value], {
				env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
				encoding: "utf8",
				timeout: PROBE_TIMEOUT_MS,
			});
			if (result.error || result.status !== 0) {
				return `cannot set ${key} in ${file}: ${(result.error?.message ?? result.stderr ?? "").trim().slice(0, 200)}`;
			}
		}
		const changes = needed.map(([key, value]) => `${key} ${currentConfigValue(text, key) ?? "unset"} -> ${value}`);
		const notice = `sandbox: set git config in ${file}: ${changes.join(", ")} (git status then never enters a nested repo)`;
		ctx.ui?.notify(notice, "info");
		if (!ctx.hasUI) process.stderr.write(`${notice}\n`);
		return undefined;
	}

	// A worktree created mid-session (by git_worktree or another session) gets the same rename
	// protection before the next command runs.
	function refreshPointerLiterals(snapshot: State, ctx: ExtensionContext | undefined): State {
		if (snapshot.kind !== "active" || !snapshot.common) return snapshot;
		let current = snapshot;
		let common = snapshot.common;
		if (state !== snapshot) {
			// A parallel command may already have refreshed the literals; only a different settings
			// file or a non-active state means a real restart.
			if (state.kind !== "active" || state.settingsPath !== snapshot.settingsPath || !state.common) {
				return { kind: "blocked", reason: "sandbox is restarting" };
			}
			current = state;
			common = state.common;
		}
		try {
			const found = gitPointerLiterals(common);
			if (!found) {
				state = { kind: "blocked", reason: `cannot list the git pointer files under ${common}` };
				if (ctx) report(ctx);
				return state;
			}
			// A removed worktree's folder may still hold its pointer file, so literals are never dropped.
			const old = new Set(current.literals);
			const next = [...new Set([...current.literals, ...found])].sort();
			if (next.length === old.size) return current;
			const settings: SrtSettings = {
				...current.settings,
				filesystem: {
					...current.settings.filesystem,
					denyWrite: [...current.settings.filesystem.denyWrite.filter((entry) => !old.has(entry)), ...next],
				},
			};
			const temp = `${current.settingsPath}.tmp`;
			fs.writeFileSync(temp, JSON.stringify(applyGrants(settings, current.grants), null, 2), { mode: 0o600 });
			fs.renameSync(temp, current.settingsPath);
			state = { ...current, settings, literals: next };
			return state;
		} catch (error) {
			state = { kind: "blocked", reason: `cannot refresh git pointer protection: ${errorMessage(error)}` };
			if (ctx) report(ctx);
			return state;
		}
	}

	function removeSettingsFile(): void {
		if (state.kind === "active") fs.rmSync(state.settingsPath, { force: true });
	}

	// The file can vanish under a live session (a manual delete or cleanup); srt would then
	// fail with a cryptic error while the footer still says the sandbox is active.
	function checkSettingsFile(current: State, ctx: ExtensionContext | undefined): State {
		if (current.kind !== "active" || fs.existsSync(current.settingsPath)) return current;
		// A restart may have replaced the state since the snapshot was taken; it owns the file then,
		// and this call must not run srt against the deleted file.
		if (state !== current) return { kind: "blocked", reason: "sandbox is restarting" };
		state = { kind: "blocked", reason: `settings file missing: ${current.settingsPath}; restart pi` };
		if (ctx) report(ctx);
		return state;
	}

	function report(ctx: ExtensionContext): void {
		const line = describeState(state);
		if (!line) return;
		ctx.ui?.setStatus(STATUS_KEY, line.status);
		const notices = [...(line.notice ? [line.notice] : []), ...(line.extraNotices ?? [])];
		for (const notice of notices) {
			ctx.ui?.notify(notice, line.level);
			if (!ctx.hasUI) process.stderr.write(`${notice}\n`);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		removeSettingsFile();
		// Calls already waiting hold the pending promise, so only a settled one is replaced.
		if (state.kind !== "pending") {
			state = { kind: "pending" };
			ready = new Promise<void>((resolve) => {
				markReady = resolve;
			});
		}
		try {
			state = await start(ctx);
		} catch (error) {
			state = { kind: "blocked", reason: errorMessage(error) };
		}
		markReady();
		report(ctx);
	});

	pi.on("session_shutdown", async () => {
		removeSettingsFile();
		if (state.kind === "active") state = { kind: "blocked", reason: "session ended" };
	});

	pi.registerCommand("sandbox", {
		description: "Show the bash sandbox state and effective config",
		handler: async (_args, ctx) => {
			if (state.kind !== "active") {
				const line =
					state.kind === "off" ? "sandbox OFF (--no-sandbox)" : blockedMessage(state.kind === "blocked" ? state.reason : "starting");
				ctx.ui.notify(line, "info");
				return;
			}
			const { network, filesystem } = applyGrants(state.settings, state.grants);
			const lines = [
				`Sandbox active (srt ${SRT_VERSION}: ${state.srtPath})`,
				`Settings: ${state.settingsPath}`,
				`Allowed domains: ${network.allowedDomains.join(", ") || "(none)"}`,
				`Unix sockets: ${network.allowUnixSockets.join(", ") || "(none)"}`,
				`Deny read: ${filesystem.denyRead.join(", ")}`,
				`Allow write: ${filesystem.allowWrite.join(", ")}`,
				`Deny write: ${filesystem.denyWrite.join(", ")}`,
				`Env removed: ${state.envNames.join(", ") || "(none)"}`,
				...presetLines(state.presets),
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
