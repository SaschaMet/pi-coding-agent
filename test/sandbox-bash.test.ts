import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sandboxBashExtension from "../.pi/extensions/sandbox-bash.ts";
import {
	DEFAULT_CONFIG,
	buildSrtSettings,
	checkCwd,
	findSrt,
	loadSandboxConfig,
	resolvePaths,
	secretEnvNames,
	shellQuote,
	wrapCommand,
} from "../.pi/extensions/lib/sandbox-bash.ts";
import { asExtensionAPI, createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

let scratch: string;

beforeEach(() => {
	scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-lib-")));
});

afterEach(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

describe("shellQuote", () => {
	const awkward = [
		"plain",
		"it's",
		"''",
		"$(echo pwned)",
		"`id`",
		"a\nb\nc",
		"$HOME ${PATH} \\ \" ; | & > <",
		"",
	];

	it.each(awkward)("round-trips %j through /bin/bash byte-identical", (value) => {
		const out = execFileSync("/bin/bash", ["-c", `printf %s ${shellQuote(value)}`], { encoding: "utf8" });
		expect(out).toBe(value);
	});
});

describe("wrapCommand", () => {
	it("execs srt with the settings file and passes the command as one literal argument", () => {
		const wrapped = wrapCommand("echo 'hi' $(x)", "/s/settings.json", "/bin/srt");
		expect(wrapped).toBe(
			`exec '/bin/srt' --settings '/s/settings.json' -- /bin/bash -c 'echo '\\''hi'\\'' $(x)'`,
		);
	});

	it("does not let the outer shell expand anything in the command", () => {
		const fakeSrt = path.join(scratch, "fake-srt");
		// Prints each argv element on its own line so the test sees what srt would receive.
		fs.writeFileSync(fakeSrt, '#!/bin/bash\nfor a in "$@"; do printf "[%s]\\n" "$a"; done\n', { mode: 0o755 });
		const command = "echo $HOME; it's\nnext `id`";
		const out = execFileSync("/bin/bash", ["-c", wrapCommand(command, "/s.json", fakeSrt)], { encoding: "utf8" });
		expect(out).toBe(`[--settings]\n[/s.json]\n[--]\n[/bin/bash]\n[-c]\n[${command}]\n`);
	});
});

describe("secretEnvNames", () => {
	it("returns names that look like secrets, sorted, never values", () => {
		const names = secretEnvNames({
			GITHUB_TOKEN: "ghp_x",
			OPENAI_API_KEY: "sk",
			MY_SECRET: "s",
			DB_PASSWORD: "p",
			NPM_AUTH: "a",
			AWS_SECRET_ACCESS_KEY: "k",
			SOME_CREDENTIALS: "c",
			PATH: "/usr/bin",
			HOME: "/Users/x",
		});
		expect(names).toEqual([
			"AWS_SECRET_ACCESS_KEY",
			"DB_PASSWORD",
			"GITHUB_TOKEN",
			"MY_SECRET",
			"NPM_AUTH",
			"OPENAI_API_KEY",
			"SOME_CREDENTIALS",
		]);
		expect(names.join(" ")).not.toContain("ghp_x");
	});

	it("keeps cmux variables and SSH_AUTH_SOCK", () => {
		expect(
			secretEnvNames({ CMUX_CUA_AUTH_TOKEN_FILE: "/p", CMUX_SOCKET_PATH: "/s", SSH_AUTH_SOCK: "/a" }),
		).toEqual([]);
	});

	it("skips names srt cannot unset", () => {
		expect(secretEnvNames({ "BAD-TOKEN": "x", "1TOKEN": "y" })).toEqual([]);
	});
});

describe("checkCwd", () => {
	it("rejects the home directory and the filesystem root", () => {
		expect(checkCwd(os.homedir(), os.homedir())).toMatch(/home directory/);
		expect(checkCwd("/", os.homedir())).toMatch(/filesystem root/);
	});

	it("rejects a folder that contains the home directory", () => {
		expect(checkCwd(path.dirname(os.homedir()), os.homedir())).toMatch(/contains the home directory/);
	});

	it.each([".pi/agent", "Library/LaunchAgents", ".config"])("rejects ~/%s, whose files run outside the sandbox", (sub) => {
		expect(checkCwd(path.join(os.homedir(), sub), os.homedir())).toMatch(/runs outside the sandbox/);
	});

	it("accepts a project directory", () => {
		expect(checkCwd(scratch, os.homedir())).toBeUndefined();
		expect(checkCwd(path.join(os.homedir(), "Projects", "x"), os.homedir())).toBeUndefined();
	});
});

describe("findSrt", () => {
	const install = (dir: string) => {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "srt"), "#!/bin/sh\n", { mode: 0o755 });
	};

	it("skips a copy inside a folder the sandbox can write", () => {
		const planted = path.join(scratch, "project", "node_modules", ".bin");
		const real = path.join(scratch, "global", "bin");
		install(planted);
		install(real);
		const pathVar = [planted, real].join(path.delimiter);
		expect(findSrt(pathVar, [path.join(scratch, "project")])).toBe(path.join(real, "srt"));
	});

	it("skips a symlink whose target is writable", () => {
		const target = path.join(scratch, "project", "evil");
		install(target);
		const links = path.join(scratch, "links");
		fs.mkdirSync(links);
		fs.symlinkSync(path.join(target, "srt"), path.join(links, "srt"));
		expect(findSrt(links, [path.join(scratch, "project")])).toBeUndefined();
	});

	it("returns undefined when no safe copy exists", () => {
		expect(findSrt(path.join(scratch, "none"), [])).toBeUndefined();
	});
});

describe("resolvePaths", () => {
	const vars = () => ({ cwd: scratch, home: "/Users/h", tmpdir: scratch });

	it("expands ., ./x, ~, ~/x and $TMPDIR to absolute paths", () => {
		expect(resolvePaths([".", "./sub", "~", "~/.ssh", "$TMPDIR", "$TMPDIR/x"], vars())).toEqual([
			scratch,
			path.join(scratch, "sub"),
			"/Users/h",
			"/Users/h/.ssh",
			scratch,
			path.join(scratch, "x"),
		]);
	});

	it("resolves relative entries against cwd and keeps glob names", () => {
		expect(resolvePaths([".pi/", ".env.*"], vars())).toEqual([
			path.join(scratch, ".pi"),
			path.join(scratch, ".env.*"),
		]);
	});

	// Inside srt, lstat on a denied file fails with EPERM even though the file exists.
	it("keeps a path it may not stat, under its real parent", () => {
		const denied = path.join(scratch, "auth.json");
		fs.writeFileSync(denied, "{}");
		const original = fs.realpathSync;
		const spy = vi.spyOn(fs, "realpathSync").mockImplementation(((target: fs.PathLike) => {
			if (String(target) === denied) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
			return original(target);
		}) as typeof fs.realpathSync);
		try {
			expect(resolvePaths([denied], vars())).toEqual([denied]);
		} finally {
			spy.mockRestore();
		}
	});

	it("follows symlinks of existing ancestors so the kernel sees real paths", () => {
		if (process.platform !== "darwin") return;
		expect(resolvePaths(["/tmp", "/tmp/not-there/x"], vars())).toEqual([
			"/private/tmp",
			"/private/tmp/not-there/x",
		]);
	});
});

describe("loadSandboxConfig", () => {
	it("returns the defaults when no global file exists", () => {
		expect(loadSandboxConfig(scratch)).toEqual(DEFAULT_CONFIG);
	});

	it("unions arrays from the global file without dropping defaults", () => {
		fs.writeFileSync(
			path.join(scratch, "sandbox.json"),
			JSON.stringify({ network: { allowedDomains: ["github.com", "registry.npmjs.org"] }, filesystem: { allowWrite: ["~/x"] } }),
		);
		const config = loadSandboxConfig(scratch);
		expect(config.network.allowedDomains).toEqual(["registry.npmjs.org", "github.com"]);
		expect(config.filesystem.allowWrite).toEqual([...DEFAULT_CONFIG.filesystem.allowWrite, "~/x"]);
		expect(config.filesystem.denyRead).toEqual(DEFAULT_CONFIG.filesystem.denyRead);
	});

	it("throws on a file that does not parse", () => {
		fs.writeFileSync(path.join(scratch, "sandbox.json"), "{ nope");
		expect(() => loadSandboxConfig(scratch)).toThrow(/sandbox\.json/);
	});

	it("throws on an entry that is not a list of strings", () => {
		fs.writeFileSync(path.join(scratch, "sandbox.json"), JSON.stringify({ network: { allowedDomains: "github.com" } }));
		expect(() => loadSandboxConfig(scratch)).toThrow(/allowedDomains/);
	});
});

describe("DEFAULT_CONFIG", () => {
	it("allows only the npm registry", () => {
		expect(DEFAULT_CONFIG.network.allowedDomains).toEqual(["registry.npmjs.org"]);
	});

	it("never lets bash write the project .pi directory or read .env files", () => {
		expect(DEFAULT_CONFIG.filesystem.denyWrite).toContain(".pi/");
		expect(DEFAULT_CONFIG.filesystem.denyRead).toEqual(expect.arrayContaining([".env", ".env.*"]));
	});

	// npx runs these unpacked trees later, outside the sandbox, without an integrity check.
	it("never lets bash write the npx package cache", () => {
		expect(DEFAULT_CONFIG.filesystem.denyWrite).toContain("~/.npm/_npx");
	});
});

describe("buildSrtSettings", () => {
	const input = () => ({
		cwd: scratch,
		home: "/Users/h",
		tmpdir: scratch,
		settingsDir: "/Users/h/.pi/agent/sandbox-run",
		uid: 501,
		cmuxSocket: "/Users/h/.local/state/cmux/cmux.sock",
		envNames: ["GITHUB_TOKEN"],
	});

	it("resolves every path and denies writes to the settings directory", () => {
		const settings = buildSrtSettings(DEFAULT_CONFIG, input());
		expect(settings.filesystem.allowWrite).toContain(scratch);
		expect(settings.filesystem.denyWrite).toEqual(
			expect.arrayContaining([path.join(scratch, ".pi"), "/Users/h/.pi/agent/sandbox-run"]),
		);
		expect(settings.filesystem.denyRead).toContain("/Users/h/.ssh");
		expect(settings.network.strictAllowlist).toBe(true);
	});

	it("allows the cmux socket and the tsx socket folder only", () => {
		const settings = buildSrtSettings(DEFAULT_CONFIG, input());
		expect(settings.network.allowUnixSockets).toEqual([
			"/Users/h/.local/state/cmux/cmux.sock",
			path.join(scratch, "tsx-501"),
		]);
	});

	it("leaves the cmux socket out when cmux is not running", () => {
		const settings = buildSrtSettings(DEFAULT_CONFIG, { ...input(), cmuxSocket: undefined });
		expect(settings.network.allowUnixSockets).toEqual([path.join(scratch, "tsx-501")]);
	});

	it("denies the secret env vars and the npm token file", () => {
		const settings = buildSrtSettings(DEFAULT_CONFIG, input());
		expect(settings.credentials.envVars).toEqual([{ name: "GITHUB_TOKEN", mode: "deny" }]);
		expect(settings.credentials.files).toEqual([
			{ path: "/Users/h/.npmrc", mode: "deny" },
		]);
	});
});


let binDir: string;
let projectDir: string;
const saved = { PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, TMPDIR: process.env.TMPDIR };

beforeEach(() => {
	binDir = path.join(scratch, "bin");
	projectDir = path.join(scratch, "project");
	fs.mkdirSync(binDir);
	fs.mkdirSync(projectDir);
	process.env.PI_CODING_AGENT_DIR = path.join(scratch, "agent");
	process.env.PATH = `${binDir}:/usr/bin:/bin`;
	// The fake srt must sit outside every writable root, and the system temp folder is one.
	process.env.TMPDIR = path.join(scratch, "tmp");
	fs.mkdirSync(process.env.TMPDIR);
});

afterEach(() => {
	process.env.PATH = saved.PATH;
	process.env.TMPDIR = saved.TMPDIR;
	if (saved.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.PI_CODING_AGENT_DIR;
	delete process.env.SBX_TEST_TOKEN;
	fs.rmSync(scratch, { recursive: true, force: true });
});

// Stands in for srt: drops "--settings <file> --" and runs the rest, marking the output.
function installFakeSrt(): string {
	const srt = path.join(binDir, "srt");
	fs.writeFileSync(
		srt,
		'#!/bin/bash\necho "SRT-WRAPPED settings=$2 tmp=$CLAUDE_CODE_TMPDIR"\nshift 3\nexec "$@"\n',
		{ mode: 0o755 },
	);
	return srt;
}

const extensionPath = path.resolve(import.meta.dirname, "../.pi/extensions/sandbox-bash.ts");

function setup(
	options: { flags?: Record<string, boolean>; version?: string; probeCode?: number; bashSource?: string } = {},
) {
	const fake = createFakePi({ flags: options.flags });
	const registerTool = vi.fn(fake.registerTool);
	fake.registerTool = registerTool;
	fake.exec = vi.fn(async (_command: string, args: string[]) =>
		args.includes("--version")
			? { stdout: `${options.version ?? "0.0.79"}\n`, stderr: "", code: 0, killed: false }
			: { stdout: "", stderr: "probe output", code: options.probeCode ?? 0, killed: false },
	);
	fake.getAllTools = () => [{ name: "bash", sourceInfo: { path: options.bashSource ?? extensionPath } }];
	sandboxBashExtension(asExtensionAPI(fake));
	const ui = createFakeUi();
	const sessionCtx = { cwd: projectDir, hasUI: true, ui };
	const toolCtx = {
		cwd: projectDir,
		hasUI: true,
		ui,
		sessionManager: { getSessionId: () => "test", getSessionFile: () => undefined },
	};
	const start = () => Promise.all((fake.handlers.get("session_start") ?? []).map((h) => h({}, sessionCtx)));
	const shutdown = () => Promise.all((fake.handlers.get("session_shutdown") ?? []).map((h) => h({}, sessionCtx)));
	const userBash = (command: string) =>
		(fake.handlers.get("user_bash") ?? [])[0]({ type: "user_bash", command, cwd: projectDir, excludeFromContext: false }, sessionCtx);
	const run = (command: string) => fake.tools.get("bash")!.execute("call-1", { command }, undefined, undefined, toolCtx);
	const text = (result: any) => result.content.map((part: any) => part.text).join("");
	const lastStatus = () => ui.setStatus.mock.calls.at(-1)?.[1] as string | undefined;
	return { fake, ui, registerTool, start, shutdown, userBash, run, text, lastStatus };
}

describe("sandbox-bash extension", () => {
	it("registers the bash tool once, even when loaded twice on one pi", () => {
		const fake = createFakePi();
		const registerTool = vi.fn(fake.registerTool);
		fake.registerTool = registerTool;
		sandboxBashExtension(asExtensionAPI(fake));
		sandboxBashExtension(asExtensionAPI(fake));
		expect(registerTool).toHaveBeenCalledTimes(1);
		expect(fake.tools.get("bash")).toBeDefined();
		expect(fake.registerFlag).toHaveBeenCalledWith("no-sandbox", expect.objectContaining({ type: "boolean" }));
	});

	it("tells the model which errors come from the sandbox and where the playbook is", () => {
		const { fake } = setup();
		const guidelines = (fake.tools.get("bash") as any).promptGuidelines.join("\n");
		expect(guidelines).toMatch(/OS sandbox/);
		expect(guidelines).toMatch(/permission error/);
		// macOS srt blocks hosts through a proxy (403); other setups fail to resolve.
		expect(guidelines).toMatch(/403/);
		expect(guidelines).toMatch(/ENOTFOUND/);
		expect(guidelines).toMatch(/bash blocked/);
		expect(guidelines).toMatch(/`sandboxed-bash` skill/);
	});

	it("runs commands through srt once the sandbox is active", async () => {
		installFakeSrt();
		const s = setup();
		await s.start();
		const out = s.text(await s.run("echo hi"));
		expect(out).toContain("SRT-WRAPPED");
		expect(out).toContain(`tmp=${os.tmpdir()}`);
		expect(out).toContain("hi");
		expect(s.lastStatus()).toMatch(/sandbox/);
	});

	it("waits for the startup probe instead of running unsandboxed", async () => {
		installFakeSrt();
		const s = setup();
		const pending = s.run("echo early");
		await new Promise((resolve) => setTimeout(resolve, 50));
		await s.start();
		expect(s.text(await pending)).toContain("SRT-WRAPPED");
	});

	it("blocks bash and runs nothing when srt is missing", async () => {
		const s = setup();
		await s.start();
		const marker = path.join(projectDir, "ran");
		await expect(s.run(`touch ${marker}`)).rejects.toThrow(/bash blocked: sandbox unavailable.*srt/);
		expect(fs.existsSync(marker)).toBe(false);
		expect(s.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/bash blocked: sandbox unavailable/), "error");
	});

	it("blocks bash when srt is not the pinned version", async () => {
		installFakeSrt();
		const s = setup({ version: "0.0.80" });
		await s.start();
		await expect(s.run("echo hi")).rejects.toThrow(/0\.0\.80.*0\.0\.79|0\.0\.79.*0\.0\.80/);
	});

	it("blocks bash when another extension's bash tool is the active one", async () => {
		installFakeSrt();
		const s = setup({ bashSource: "/elsewhere/other-bash.ts" });
		await s.start();
		await expect(s.run("echo hi")).rejects.toThrow(/other-bash\.ts/);
	});

	it("blocks bash when the probe command fails", async () => {
		installFakeSrt();
		const s = setup({ probeCode: 1 });
		await s.start();
		await expect(s.run("echo hi")).rejects.toThrow(/probe/);
	});

	it("blocks bash when pi starts in the home directory", async () => {
		installFakeSrt();
		const fake = createFakePi();
		fake.exec = vi.fn(async () => ({ stdout: "0.0.79\n", stderr: "", code: 0, killed: false }));
		sandboxBashExtension(asExtensionAPI(fake));
		const ui = createFakeUi();
		await Promise.all(fake.handlers.get("session_start")!.map((h) => h({}, { cwd: os.homedir(), hasUI: true, ui })));
		await expect(
			fake.tools.get("bash")!.execute("c", { command: "echo hi" }, undefined, undefined, { cwd: os.homedir() }),
		).rejects.toThrow(/home directory/);
	});

	it("writes a private settings file outside the writable paths and removes it on shutdown", async () => {
		installFakeSrt();
		process.env.SBX_TEST_TOKEN = "secret-value";
		const s = setup();
		await s.start();
		const settingsDir = path.join(scratch, "agent", "sandbox-run");
		const [file] = fs.readdirSync(settingsDir);
		const full = path.join(settingsDir, file);
		expect(fs.statSync(full).mode & 0o777).toBe(0o600);
		const settings = JSON.parse(fs.readFileSync(full, "utf8"));
		expect(settings.filesystem.denyWrite).toContain(fs.realpathSync(settingsDir));
		expect(settings.credentials.envVars).toContainEqual({ name: "SBX_TEST_TOKEN", mode: "deny" });
		expect(JSON.stringify(settings)).not.toContain("secret-value");
		await s.shutdown();
		expect(fs.existsSync(full)).toBe(false);
	});

	it("shows removed env names, never values, in /sandbox", async () => {
		installFakeSrt();
		process.env.SBX_TEST_TOKEN = "secret-value";
		const s = setup();
		await s.start();
		await s.fake.commands.get("sandbox")!.handler("", { cwd: projectDir, hasUI: true, ui: s.ui });
		const message = s.ui.notify.mock.calls.at(-1)?.[0] as string;
		expect(message).toContain("SBX_TEST_TOKEN");
		expect(message).not.toContain("secret-value");
		expect(message).toContain("registry.npmjs.org");
	});

	it("runs unsandboxed only with --no-sandbox, and says so", async () => {
		installFakeSrt();
		const s = setup({ flags: { "no-sandbox": true } });
		await s.start();
		const out = s.text(await s.run("echo hi"));
		expect(out).not.toContain("SRT-WRAPPED");
		expect(out).toContain("hi");
		expect(s.lastStatus()).toMatch(/sandbox OFF/);
		expect(await s.userBash("echo hi")).toBeUndefined();
	});

	// A --print run has no footer; the orchestrator verifies the one-shot pane by this line.
	it("says sandbox OFF on stderr when there is no UI", async () => {
		installFakeSrt();
		const fake = createFakePi({ flags: { "no-sandbox": true } });
		sandboxBashExtension(asExtensionAPI(fake));
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			await Promise.all(fake.handlers.get("session_start")!.map((h) => h({}, { cwd: projectDir, hasUI: false })));
			expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^sandbox OFF/));
		} finally {
			stderr.mockRestore();
		}
	});

	it("routes user ! commands through the same sandbox", async () => {
		installFakeSrt();
		const s = setup();
		await s.start();
		const result = await s.userBash("echo from-user");
		const chunks: string[] = [];
		const { exitCode } = await result.operations.exec("echo from-user", projectDir, {
			onData: (data: Buffer) => chunks.push(data.toString()),
		});
		expect(exitCode).toBe(0);
		expect(chunks.join("")).toMatch(/SRT-WRAPPED[\s\S]*from-user/);
	});

	describe("settings file lifecycle", () => {
		const settingsFile = () => {
			const dir = path.join(scratch, "agent", "sandbox-run");
			return path.join(dir, fs.readdirSync(dir)[0]);
		};

		it("blocks bash with a clear message once the settings file is gone, and keeps blocking", async () => {
			installFakeSrt();
			const s = setup();
			await s.start();
			const file = settingsFile();
			fs.rmSync(file);
			const marker = path.join(projectDir, "ran");
			const expected = `bash blocked: sandbox unavailable (settings file missing: ${file}; restart pi)`;

			await expect(s.run(`touch ${marker}`)).rejects.toThrow(expected);
			await expect(s.run(`touch ${marker}`)).rejects.toThrow(expected);
			const user = await s.userBash(`touch ${marker}`);
			expect(user.result.output).toBe(expected);
			expect(fs.existsSync(marker)).toBe(false);
			expect(fs.existsSync(file)).toBe(false);
			expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
		});

		it("blocks user ! commands first, too, when the file is gone", async () => {
			installFakeSrt();
			const s = setup();
			await s.start();
			fs.rmSync(settingsFile());
			const user = await s.userBash("echo hi");
			expect(user.result.output).toMatch(/settings file missing/);
			expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
		});

		it("rebuilds the sandbox with a new settings file on the next session start", async () => {
			installFakeSrt();
			const s = setup();
			await s.start();
			fs.rmSync(settingsFile());
			await expect(s.run("echo hi")).rejects.toThrow(/settings file missing/);
			await s.start();
			expect(s.text(await s.run("echo again"))).toContain("SRT-WRAPPED");
		});

		// A call that read the old active state just as session_start reset it must not write
		// "blocked" over the fresh pending state (the file is gone, but a restart is under way).
		it("never marks a restarting session as blocked from a stale snapshot", async () => {
			installFakeSrt();
			for (let ticks = 0; ticks <= 8; ticks++) {
				const s = setup();
				await s.start();
				s.ui.setStatus.mockClear();
				let release: () => void = () => undefined;
				const gate = new Promise<void>((resolve) => {
					release = resolve;
				});
				const exec = s.fake.exec;
				s.fake.exec = vi.fn(async (command: string, args: string[], options: unknown) => {
					if (args.includes("--version")) await gate;
					return exec(command, args, options);
				});
				const call = s.run("echo hi").catch((error: Error) => error);
				for (let i = 0; i < ticks; i++) await Promise.resolve();
				const restart = s.start();
				release();
				await Promise.all([call, restart]);
				const statuses = s.ui.setStatus.mock.calls.map((c) => c[1]);
				expect(statuses, `after ${ticks} microtasks`).not.toContain("bash blocked: sandbox unavailable");
				expect(s.text(await s.run("echo again"))).toContain("SRT-WRAPPED");
			}
		});

		it("blocks a bash call that arrives after session shutdown", async () => {
			installFakeSrt();
			const s = setup();
			await s.start();
			await s.shutdown();
			await expect(s.run("echo late")).rejects.toThrow(/bash blocked: sandbox unavailable \(session ended\)/);
		});
	});

	it("blocks user ! commands when the sandbox is unavailable", async () => {
		const s = setup();
		await s.start();
		const result = await s.userBash("echo hi");
		expect(result.result.exitCode).toBe(1);
		expect(result.result.output).toMatch(/bash blocked: sandbox unavailable/);
	});
});
