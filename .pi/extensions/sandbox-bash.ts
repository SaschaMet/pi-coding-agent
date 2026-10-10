import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import {
	buildSrtSettings,
	checkCwd,
	findSrt,
	loadSandboxConfig,
	SRT_VERSION,
	sameRealPath,
	type SrtSettings,
	secretEnvNames,
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
	| { kind: "active"; srtPath: string; settingsPath: string; settings: SrtSettings; envNames: string[] };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function blockedMessage(reason: string): string {
	return `bash blocked: sandbox unavailable (${reason})`;
}

type Report = { status: string; notice?: string; level: "warning" | "error" };

function describeState(state: State): Report | undefined {
	if (state.kind === "off") return { status: "sandbox OFF", notice: OFF_MESSAGE, level: "warning" };
	if (state.kind === "blocked") {
		return { status: "bash blocked: sandbox unavailable", notice: blockedMessage(state.reason), level: "error" };
	}
	if (state.kind !== "active") return undefined;
	const { network, filesystem } = state.settings;
	return {
		status: `sandbox: ${network.allowedDomains.length} domains, ${filesystem.allowWrite.length} write paths, ${state.envNames.length} env removed`,
		level: "warning",
	};
}

// CLAUDE_CODE_TMPDIR keeps $TMPDIR the same path inside and outside srt.
function sandboxEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
	return { ...(env ?? process.env), CLAUDE_CODE_TMPDIR: os.tmpdir() };
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
			env: sandboxEnv(context.env),
		};
	};

	const inner = createBashToolDefinition(process.cwd(), { spawnHook });
	pi.registerTool({
		...inner,
		label: "bash (sandboxed)",
		promptGuidelines: [...(inner.promptGuidelines ?? []), GUIDELINE],
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const current = checkSettingsFile(await currentState(), ctx);
			if (current.kind === "blocked") throw new Error(blockedMessage(current.reason));
			return inner.execute(toolCallId, params, signal, onUpdate, ctx);
		},
	});

	function sandboxedOperations(active: Extract<State, { kind: "active" }>): BashOperations {
		const local = createLocalBashOperations();
		return {
			exec: (command, cwd, options) =>
				local.exec(wrapCommand(command, active.settingsPath, active.srtPath), cwd, {
					...options,
					env: sandboxEnv(options.env),
				}),
		};
	}

	pi.on("user_bash", async (_event, ctx) => {
		const current = checkSettingsFile(await currentState(), ctx);
		if (current.kind === "off") return undefined;
		if (current.kind === "active") return { operations: sandboxedOperations(current) };
		const reason = current.kind === "blocked" ? current.reason : "sandbox not ready";
		return {
			result: { output: blockedMessage(reason), exitCode: 1, cancelled: false, truncated: false },
		};
	});

	async function start(ctx: ExtensionContext): Promise<State> {
		if (pi.getFlag("no-sandbox") === true) return { kind: "off" };
		const home = os.homedir();
		const cwdProblem = checkCwd(ctx.cwd, home);
		if (cwdProblem) return { kind: "blocked", reason: cwdProblem };

		// pi resolves a tool name to its last registration; another bash would bypass the sandbox.
		const owner = pi.getAllTools().find((tool) => tool.name === "bash")?.sourceInfo.path;
		if (!owner || !sameRealPath(owner, fileURLToPath(import.meta.url))) {
			return { kind: "blocked", reason: `the active bash tool comes from ${owner ?? "nowhere"}, not the sandbox` };
		}

		const config = loadSandboxConfig(getAgentDir());
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
		fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });

		const probe = await pi.exec("/bin/bash", ["-c", wrapCommand("true", settingsPath, srtPath)], {
			cwd: ctx.cwd,
			timeout: PROBE_TIMEOUT_MS,
		});
		if (probe.code !== 0) {
			fs.rmSync(settingsPath, { force: true });
			return { kind: "blocked", reason: `srt probe failed (exit ${probe.code}): ${probe.stderr.trim().slice(0, 200)}` };
		}
		return { kind: "active", srtPath, settingsPath, settings, envNames };
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
		if (!line.notice) return;
		ctx.ui?.notify(line.notice, line.level);
		if (!ctx.hasUI) process.stderr.write(`${line.notice}\n`);
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
			const { network, filesystem } = state.settings;
			const lines = [
				`Sandbox active (srt ${SRT_VERSION}: ${state.srtPath})`,
				`Settings: ${state.settingsPath}`,
				`Allowed domains: ${network.allowedDomains.join(", ") || "(none)"}`,
				`Unix sockets: ${network.allowUnixSockets.join(", ") || "(none)"}`,
				`Deny read: ${filesystem.denyRead.join(", ")}`,
				`Allow write: ${filesystem.allowWrite.join(", ")}`,
				`Deny write: ${filesystem.denyWrite.join(", ")}`,
				`Env removed: ${state.envNames.join(", ") || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
