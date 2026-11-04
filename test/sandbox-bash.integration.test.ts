import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sandboxBashExtension from "../.pi/extensions/sandbox-bash.ts";
import { checkGitPointers } from "../.pi/extensions/lib/git-worktree.ts";
import { SRT_VERSION } from "../.pi/extensions/lib/sandbox-bash.ts";
import { asExtensionAPI, createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function srtVersion(): string | undefined {
	try {
		return execFileSync("srt", ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
	} catch {
		return undefined;
	}
}

// A skip is not a pass: the reason is printed so a skipped run is visible in the gate output.
const skipReason =
	process.platform !== "darwin"
		? "not macOS"
		: process.env.SANDBOX_RUNTIME === "1"
			? "running inside sandbox; run this file from a normal terminal or pi --no-sandbox"
			: srtVersion() !== SRT_VERSION
				? `srt ${SRT_VERSION} not installed`
				: undefined;
// vitest swallows console output during collection, so the notice goes straight to stderr.
if (skipReason) process.stderr.write(`\nSKIPPED: sandbox-bash integration (${skipReason})\n`);

describe.skipIf(skipReason !== undefined)("sandboxed bash against real srt", () => {
	let scratch: string;
	let project: string;
	let agentDir: string;
	let run: (command: string) => Promise<string>;
	let settingsPath: string;
	const saved = {
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		GITHUB_TOKEN: process.env.GITHUB_TOKEN,
	};

	beforeAll(async () => {
		scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-int-")));
		project = path.join(scratch, "project");
		agentDir = path.join(scratch, "agent");
		fs.mkdirSync(path.join(project, ".pi", "extensions"), { recursive: true });
		fs.writeFileSync(path.join(project, ".env"), "SBX_FIXTURE=visible\n");
		// srt denies .git/config writes, so the repo is created outside the sandbox.
		execFileSync("git", ["init", "-q", project]);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.GITHUB_TOKEN = "sbx-fake-token";

		const fake = createFakePi();
		fake.exec = (command: string, args: string[], options?: { cwd?: string; timeout?: number }) =>
			new Promise((resolve) => {
				execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout, encoding: "utf8" }, (error, stdout, stderr) => {
					const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
					resolve({ stdout, stderr, code, killed: false });
				});
			});
		const extensionPath = path.join(repoRoot, ".pi", "extensions", "sandbox-bash.ts");
		fake.getAllTools = () => [{ name: "bash", sourceInfo: { path: extensionPath } }];
		sandboxBashExtension(asExtensionAPI(fake));
		const ui = createFakeUi();
		await Promise.all(fake.handlers.get("session_start")!.map((h) => h({}, { cwd: project, hasUI: true, ui })));
		expect(ui.setStatus.mock.calls.at(-1)?.[1], ui.notify.mock.calls.map((c: unknown[]) => c[0]).join(" / ")).toMatch(
			/^sandbox: /,
		);
		settingsPath = path.join(agentDir, "sandbox-run", fs.readdirSync(path.join(agentDir, "sandbox-run"))[0]);

		const tool = fake.tools.get("bash")!;
		const ctx = { cwd: project, sessionManager: { getSessionId: () => "int", getSessionFile: () => undefined } };
		// Every probe ends with `true` so a denied step shows up in the text, not as a thrown exit code.
		run = async (command) => {
			const result = await tool.execute("int", { command: `${command}; true`, timeout: 60 }, undefined, undefined, ctx);
			return result.content.map((part: { text: string }) => part.text).join("");
		};
	}, 60_000);

	afterAll(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		fs.rmSync(scratch, { recursive: true, force: true });
		fs.rmSync(path.join(os.homedir(), "sbx-probe"), { force: true });
	});

	it("runs a plain command", async () => {
		expect(await run("echo hi")).toContain("hi");
	});

	it("denies reading ssh keys and gh credentials", async () => {
		expect(await run("cat ~/.ssh/known_hosts 2>&1")).toMatch(/Operation not permitted|No such file/);
		expect(await run("ls ~/.config/gh 2>&1")).toMatch(/Operation not permitted|No such file/);
	});

	it("denies reading .env files in the project", async () => {
		const out = await run("cat .env 2>&1");
		expect(out).toMatch(/Operation not permitted/);
		expect(out).not.toContain("SBX_FIXTURE");
	});

	it("never prints an npm auth token", async () => {
		expect(await run('cat "$HOME/.npmrc" 2>&1')).not.toMatch(/_authToken=\S{8,}/);
	});

	it("stops an interpreter from writing outside the project", async () => {
		await run(`node -e "require('fs').writeFileSync(process.env.HOME+'/sbx-probe','x')" 2>&1`);
		expect(fs.existsSync(path.join(os.homedir(), "sbx-probe"))).toBe(false);
	});

	it("denies writes to .pi/ and to its own settings file", async () => {
		expect(await run("echo x > .pi/extensions/probe.ts 2>&1")).toMatch(/Operation not permitted/);
		expect(fs.existsSync(path.join(project, ".pi", "extensions", "probe.ts"))).toBe(false);
		expect(await run(`echo x >> '${settingsPath}' 2>&1`)).toMatch(/Operation not permitted/);
	});

	it("allows writes in the project and in the host TMPDIR", async () => {
		const out = await run('echo x > ./tmp-probe && echo "$TMPDIR" && echo y > "$TMPDIR/sbx-int-probe" && echo wrote');
		expect(out).toContain(os.tmpdir());
		expect(out).toContain("wrote");
		expect(fs.existsSync(path.join(project, "tmp-probe"))).toBe(true);
		fs.rmSync(path.join(os.tmpdir(), "sbx-int-probe"), { force: true });
	});

	it("reaches the npm registry and nothing else", async () => {
		expect(await run("curl -sI --max-time 20 https://registry.npmjs.org | head -1")).toMatch(/200/);
		expect(await run("curl -sI --max-time 20 https://example.com 2>&1 | head -1")).toMatch(/403|Forbidden/);
		expect(await run(`node -e "require('dns').lookup('sbx-probe.example.com',(e,a)=>console.log(e?e.code:a))"`)).toMatch(
			/ENOTFOUND|EAI_AGAIN/,
		);
	}, 60_000);

	it("removes secret env vars and keeps the socket paths", async () => {
		const out = await run('echo "gh=[${GITHUB_TOKEN:-}] ssh=[${SSH_AUTH_SOCK:+set}] cmux=[${CMUX_SOCKET_PATH:+set}]"');
		expect(out).toContain("gh=[]");
		if (process.env.SSH_AUTH_SOCK) expect(out).toContain("ssh=[set]");
		if (process.env.CMUX_SOCKET_PATH) expect(out).toContain("cmux=[set]");
	});

	it("passes awkward commands through unchanged", async () => {
		const value = `it's $(echo no) \`id\` "$HOME"\nline2 \\ ; |`;
		const out = await run(`cat <<'SBX_EOF'\n${value}\nSBX_EOF`);
		expect(out).toContain(value);
	});

	it("blocks app launches, AppleScript and git config writes", async () => {
		expect(await run("open -a Calculator 2>&1; echo rc=$?")).not.toContain("rc=0");
		expect(await run("osascript -e 'display notification \"x\"' 2>&1; echo rc=$?")).not.toContain("rc=0");
		expect(await run("git config --local sbx.probe z 2>&1")).toMatch(/could not write config|Operation not permitted/);
	});
});

describe.skipIf(skipReason !== undefined)("sandboxed bash in a linked worktree against real srt", () => {
	let root: string;
	let main: string;
	let common: string;
	let lead: string;
	let fake: ReturnType<typeof createFakePi>;
	let run: (command: string) => Promise<string>;
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();

	beforeAll(async () => {
		// The temp folder is a writable root, where the sandbox correctly opens no git paths.
		const fixtures = path.join(repoRoot, "test", ".fixtures");
		fs.mkdirSync(fixtures, { recursive: true });
		root = fs.realpathSync(fs.mkdtempSync(path.join(fixtures, "sbx-wt-")));
		main = path.join(root, "main");
		common = path.join(main, ".git");
		lead = path.join(main, ".worktrees", "lead");
		// srt denies .git writes from the main checkout's outside, so the repo is built unsandboxed.
		execFileSync("git", ["init", "-q", "-b", "main", main]);
		git(main, "commit", "-q", "--allow-empty", "-m", "base");
		git(main, "worktree", "add", "-q", "-b", "handsoff/t/p", lead, "HEAD");
		process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");

		fake = createFakePi();
		fake.exec = (command: string, args: string[], options?: { cwd?: string; timeout?: number }) =>
			new Promise((resolve) => {
				execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout, encoding: "utf8" }, (error, stdout, stderr) => {
					const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
					resolve({ stdout, stderr, code, killed: false });
				});
			});
		const extensionPath = path.join(repoRoot, ".pi", "extensions", "sandbox-bash.ts");
		fake.getAllTools = () => [{ name: "bash", sourceInfo: { path: extensionPath } }];
		sandboxBashExtension(asExtensionAPI(fake));
		const ui = createFakeUi();
		await Promise.all(fake.handlers.get("session_start")!.map((h) => h({}, { cwd: lead, hasUI: true, ui })));
		expect(ui.setStatus.mock.calls.at(-1)?.[1]).toMatch(/^sandbox: /);

		const tool = fake.tools.get("bash")!;
		const ctx = { cwd: lead, sessionManager: { getSessionId: () => "int-wt", getSessionFile: () => undefined } };
		run = async (command) => {
			const result = await tool.execute("int-wt", { command: `${command}; true`, timeout: 60 }, undefined, undefined, ctx);
			return result.content.map((part: { text: string }) => part.text).join("");
		};
	}, 60_000);

	afterAll(() => {
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
		fs.rmSync(root, { recursive: true, force: true });
	});

	const commit = 'git -c user.email=t@t -c user.name=t commit -qm';

	it("stages and commits on the lead's handsoff branch", async () => {
		const before = git(main, "rev-parse", "handsoff/t/p");
		const out = await run(`echo a > a.txt && git add a.txt && ${commit} a && echo committed`);
		expect(out).toContain("committed");
		expect(git(main, "rev-parse", "handsoff/t/p")).not.toBe(before);
	});

	it("refuses git worktree add in bash, then creates the worker through the trusted tool and commits in it", async () => {
		const worker = path.join(lead, ".worktrees", "hill-climb-r", "r1-w1");
		const refused = await run(`git worktree add -q -b hill-climb/r/refused .worktrees/hill-climb-r/refused HEAD 2>&1`);
		expect(refused).toMatch(/Operation not permitted|could not|cannot/);
		expect(fs.existsSync(path.join(lead, ".worktrees", "hill-climb-r", "refused"))).toBe(false);

		await fake.tools.get("git_worktree")!.execute(
			"t",
			{ action: "add", path: worker, branch: "hill-climb/r/r1-w1", base: "HEAD" },
			undefined,
			undefined,
			{ cwd: lead, hasUI: false, sessionManager: { getSessionId: () => "int-wt", getSessionFile: () => undefined } } as never,
		);
		expect(fs.existsSync(path.join(worker, ".git"))).toBe(true);
		expect(git(main, "branch", "--list", "hill-climb/r/r1-w1")).toContain("hill-climb/r/r1-w1");
		// The worker commits from its own session; the lead may write only its own record.
		const out = await run(`cd .worktrees/hill-climb-r/r1-w1 && echo b > b.txt && git add b.txt 2>&1`);
		expect(out).toMatch(/Operation not permitted|Unable to create/);
	});

	it("keeps its own pointer files closed", async () => {
		const record = git(lead, "rev-parse", "--absolute-git-dir");
		const files = [path.join(lead, ".git"), path.join(record, "commondir"), path.join(common, "commondir")];
		// A main checkout has no commondir file; creating one must be denied just like changing one.
		const snapshot = () => files.map((file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null));
		const before = snapshot();
		for (const file of files) {
			expect(await run(`printf x >> '${file}' 2>&1`), file).toMatch(/Operation not permitted/);
		}
		expect(snapshot()).toEqual(before);
	});

	it("refuses to rename its own record and a sibling's record", async () => {
		const record = git(lead, "rev-parse", "--absolute-git-dir");
		expect(await run(`mv '${record}' '${record}-x' 2>&1`)).toMatch(/Operation not permitted/);
		expect(fs.existsSync(record)).toBe(true);
		expect(fs.existsSync(`${record}-x`)).toBe(false);

		git(main, "worktree", "add", "-q", "-b", "handsoff/t/sib", path.join(main, ".worktrees", "sib"), "HEAD");
		const sibling = path.join(common, "worktrees", "sib");
		expect(await run(`mv '${sibling}' '${sibling}-x' 2>&1`)).toMatch(/Operation not permitted/);
		expect(fs.existsSync(sibling)).toBe(true);
		expect(fs.existsSync(`${sibling}-x`)).toBe(false);
	});

	it("cannot point git at a planted repo, so a config hook never runs", async () => {
		const scratch2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-evil-")));
		const evil = path.join(scratch2, "evil");
		const marker = path.join(scratch2, "marker");
		const record = git(lead, "rev-parse", "--absolute-git-dir");
		const pointerFile = path.join(lead, ".git");
		const commondirFile = path.join(record, "commondir");
		const saved = { pointer: fs.readFileSync(pointerFile, "utf8"), commondir: fs.readFileSync(commondirFile, "utf8") };
		try {
			execFileSync("git", ["init", "-q", evil]);
			fs.appendFileSync(path.join(evil, ".git", "config"), `[core]\n\tfsmonitor = "touch ${marker}; false"\n`);
			const evilGit = path.join(evil, ".git");
			await run(`printf 'gitdir: ${evilGit}\\n' > .git 2>&1`);
			await run(`echo '${evilGit}' > '${commondirFile}' 2>&1`);
			// The planted config would run unsandboxed here if either redirect had landed.
			try {
				execFileSync("git", ["status", "--porcelain"], { cwd: lead, stdio: "ignore", timeout: 20_000 });
			} catch {
				// A broken pointer makes git fail; only the marker matters.
			}
			expect(fs.existsSync(marker)).toBe(false);
		} finally {
			fs.writeFileSync(pointerFile, saved.pointer);
			fs.writeFileSync(commondirFile, saved.commondir);
			fs.rmSync(scratch2, { recursive: true, force: true });
		}
	});

	it("keeps main, other branches, config, hooks and packed history closed", async () => {
		const mainTip = git(main, "rev-parse", "main");
		// update-ref skips git's own "branch is checked out" refusal, so only the sandbox can stop it.
		for (const command of [
			"git update-ref refs/heads/main HEAD",
			"git branch other",
			"git config --local sbx.probe z",
			`touch '${common}/hooks/sbx-probe'`,
			`mkdir -p '${common}/objects/pack' 2>/dev/null; touch '${common}/objects/pack/sbx-probe'`,
		]) {
			expect(await run(`${command} 2>&1`), command).toMatch(/Operation not permitted|cannot lock ref|could not write config/);
		}
		expect(git(main, "rev-parse", "main")).toBe(mainTip);
		expect(git(main, "branch", "--list", "other")).toBe("");
		expect(fs.readFileSync(path.join(common, "config"), "utf8")).not.toContain("sbx");
		expect(fs.existsSync(path.join(common, "hooks", "sbx-probe"))).toBe(false);
		expect(fs.existsSync(path.join(common, "objects", "pack", "sbx-probe"))).toBe(false);
	});
	it("refuses a prepared record moved into the worktrees folder", async () => {
		// $TMPDIR is a writable root, so the source side of the move is allowed.
		const prep = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-prep-")));
		try {
			const planted = path.join(prep, "planted-target");
			fs.mkdirSync(planted);
			fs.mkdirSync(path.join(prep, "prep-rec"));
			fs.writeFileSync(path.join(prep, "prep-rec", "commondir"), `${planted}\n`);
			const target = path.join(common, "worktrees", "planted");
			expect(await run(`mv '${path.join(prep, "prep-rec")}' '${target}' 2>&1`)).toMatch(/Operation not permitted/);
			expect(fs.existsSync(target)).toBe(false);
		} finally {
			fs.rmSync(prep, { recursive: true, force: true });
		}
	});
});

describe.skipIf(skipReason !== undefined)("sandboxed bash in a main checkout against real srt", () => {
	let root: string;
	let main: string;
	let common: string;
	let wt: string;
	let recordId: string;
	let xdg: string;
	let run: (command: string) => Promise<string>;
	const saved = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();

	beforeAll(async () => {
		const fixtures = path.join(repoRoot, "test", ".fixtures");
		fs.mkdirSync(fixtures, { recursive: true });
		root = fs.realpathSync(fs.mkdtempSync(path.join(fixtures, "sbx-main-")));
		main = path.join(root, "main");
		common = path.join(main, ".git");
		wt = path.join(main, ".worktrees", "wt");
		xdg = path.join(main, "xdg-home");
		execFileSync("git", ["init", "-q", "-b", "main", main]);
		git(main, "commit", "-q", "--allow-empty", "-m", "base");
		git(main, "worktree", "add", "-q", "-b", "handsoff/t/wt", wt, "HEAD");
		recordId = fs.readdirSync(path.join(common, "worktrees"))[0];
		fs.mkdirSync(xdg, { recursive: true });
		process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
		// Set before session_start: the sandbox reads it when it builds its settings.
		process.env.XDG_CONFIG_HOME = xdg;

		const fake = createFakePi();
		fake.exec = (command: string, args: string[], options?: { cwd?: string; timeout?: number }) =>
			new Promise((resolve) => {
				execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout, encoding: "utf8" }, (error, stdout, stderr) => {
					const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
					resolve({ stdout, stderr, code, killed: false });
				});
			});
		const extensionPath = path.join(repoRoot, ".pi", "extensions", "sandbox-bash.ts");
		fake.getAllTools = () => [{ name: "bash", sourceInfo: { path: extensionPath } }];
		sandboxBashExtension(asExtensionAPI(fake));
		const ui = createFakeUi();
		await Promise.all(fake.handlers.get("session_start")!.map((h) => h({}, { cwd: main, hasUI: true, ui })));
		expect(ui.setStatus.mock.calls.at(-1)?.[1], ui.notify.mock.calls.map((c: unknown[]) => c[0]).join(" / ")).toMatch(
			/^sandbox: /,
		);

		const tool = fake.tools.get("bash")!;
		const ctx = { cwd: main, sessionManager: { getSessionId: () => "int-main", getSessionFile: () => undefined } };
		run = async (command) => {
			const result = await tool.execute("int-main", { command: `${command}; true`, timeout: 60 }, undefined, undefined, ctx);
			return result.content.map((part: { text: string }) => part.text).join("");
		};
	}, 60_000);

	afterAll(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(path.join(os.tmpdir(), "sbx-scratch-int"), { recursive: true, force: true });
	});

	it("refuses nested repos, planted pointers and renames of worktree records", async () => {
		const record = path.join(common, "worktrees", recordId);
		const pointers = [path.join(wt, ".git"), path.join(record, "commondir"), path.join(record, "gitdir")];
		const before = pointers.map((file) => fs.readFileSync(file, "utf8"));
		const commands = [
			"git init sub",
			"mkdir -p sub2 && printf 'gitdir: /x\\n' > sub2/.git",
			"mkdir -p .git/modules/x && printf x > .git/modules/x/config",
			`printf x >> .git/worktrees/${recordId}/commondir`,
			`printf x >> .worktrees/wt/.git`,
			`printf x >> .git/worktrees/${recordId}/gitdir`,
			`mv .git/worktrees/${recordId} .git/worktrees/${recordId}-x`,
			"mv .worktrees/wt .worktrees/wt-x",
		];
		for (const command of commands) {
			expect(await run(`${command} 2>&1`), command).toMatch(/Operation not permitted/);
		}
		expect(fs.existsSync(path.join(main, "sub", ".git"))).toBe(false);
		expect(fs.existsSync(path.join(main, "sub2", ".git"))).toBe(false);
		expect(fs.existsSync(path.join(common, "modules", "x", "config"))).toBe(false);
		expect(pointers.map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
		expect(fs.existsSync(record)).toBe(true);
		expect(fs.existsSync(`${record}-x`)).toBe(false);
		expect(fs.existsSync(wt)).toBe(true);
		expect(fs.existsSync(`${wt}-x`)).toBe(false);
	});

	it("refuses pointer names and nested repos spelled in another letter case", async () => {
		const record = path.join(common, "worktrees", recordId);
		const configBefore = fs.readFileSync(path.join(common, "config"), "utf8");
		const commands = [
			"printf x > .git/COMMONDIR",
			"mkdir -p sub3/.GIT",
			"printf x >> .git/CONFIG",
			`printf x > .git/worktrees/${recordId}/COMMONDIR`,
		];
		for (const command of commands) {
			expect(await run(`${command} 2>&1`), command).toMatch(/Operation not permitted/);
		}
		// Directory listings are case-sensitive about the stored name, unlike existsSync on APFS.
		expect(fs.readdirSync(common)).not.toContain("COMMONDIR");
		expect(fs.readdirSync(common)).not.toContain("CONFIG");
		expect(fs.readdirSync(record)).not.toContain("COMMONDIR");
		expect(fs.readdirSync(path.join(main, "sub3"))).not.toContain(".GIT");
		expect(fs.readFileSync(path.join(common, "config"), "utf8")).toBe(configBefore);
	});

	it("still stages and commits, and creates repos in the temp folder", async () => {
		const before = git(main, "rev-parse", "HEAD");
		const out = await run(
			`echo a > a && git add a && git -c user.email=t@t -c user.name=t commit -qm a && echo committed`,
		);
		expect(out).toContain("committed");
		expect(git(main, "rev-parse", "HEAD")).not.toBe(before);

		const scratchRepo = path.join(os.tmpdir(), "sbx-scratch-int");
		try {
			expect(await run(`git init -q "$TMPDIR/sbx-scratch-int" && echo init-ok`)).toContain("init-ok");
			expect(fs.existsSync(path.join(scratchRepo, ".git"))).toBe(true);
		} finally {
			fs.rmSync(scratchRepo, { recursive: true, force: true });
		}
	});

	it("denies writing the XDG git config", async () => {
		const out = await run(`mkdir -p '${xdg}/git' 2>&1; printf x > '${xdg}/git/config' 2>&1`);
		expect(out).toMatch(/Operation not permitted/);
		expect(fs.existsSync(path.join(xdg, "git", "config"))).toBe(false);
	});
	it("never runs a config hook of a nested repo moved in and staged as a gitlink", async () => {
		const prep = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-prep-")));
		const marker = path.join(prep, "marker");
		const inner = path.join(prep, "inner");
		const sub = path.join(prep, "sub");
		try {
			execFileSync("git", ["init", "-q", "-b", "main", inner]);
			fs.writeFileSync(path.join(inner, "f.txt"), "one\n");
			git(inner, "add", "f.txt");
			git(inner, "commit", "-q", "-m", "inner");
			fs.appendFileSync(path.join(inner, ".git", "config"), `[core]\n\tfsmonitor = "touch ${marker}; false"\n`);
			fs.mkdirSync(sub);
			fs.copyFileSync(path.join(inner, "f.txt"), path.join(sub, "f.txt"));
			fs.writeFileSync(path.join(sub, ".git"), `gitdir: ${path.join(inner, ".git")}\n`);

			// An earlier test's refused `git init sub` leaves an empty sub/, so a fresh name keeps mv from nesting.
			const moved = path.join(main, "gitlink-sub");
			expect(fs.existsSync(moved)).toBe(false);
			const out = await run(`mv '${sub}' gitlink-sub && git add gitlink-sub && echo staged`);
			expect(out).toContain("staged");
			expect(git(main, "ls-files", "-s", "gitlink-sub")).toMatch(/^160000 \S+ 0\tgitlink-sub$/);
			// The sandboxed add may run the planted hook inside the sandbox, which is allowed; only unsandboxed runs count.
			fs.rmSync(marker, { force: true });

			const runs: Array<[string[], NodeJS.ProcessEnv]> = [
				[["status", "--porcelain"], process.env],
				[["status", "--porcelain=2", "--branch"], { ...process.env, GIT_OPTIONAL_LOCKS: "0" }],
				[["status", "--porcelain", "-z", "--untracked-files=all"], { ...process.env, GIT_OPTIONAL_LOCKS: "0" }],
			];
			for (const [args, env] of runs) {
				// File times have 1 s granularity on some filesystems; the touch must register as a change.
				await new Promise((resolve) => setTimeout(resolve, 1000));
				fs.utimesSync(path.join(moved, "f.txt"), new Date(), new Date());
				try {
					execFileSync("git", args, { cwd: main, env, stdio: "ignore", timeout: 20_000 });
				} catch {
					// Only the marker matters.
				}
				expect(fs.existsSync(marker), args.join(" ")).toBe(false);
			}
			// Control: without the repo setting the same status does run the planted hook.
			await new Promise((resolve) => setTimeout(resolve, 1000));
			fs.utimesSync(path.join(moved, "f.txt"), new Date(), new Date());
			try {
				execFileSync("git", ["-c", "diff.ignoreSubmodules=none", "status", "--porcelain"], { cwd: main, stdio: "ignore", timeout: 20_000 });
			} catch {
				// Only the marker matters.
			}
			expect(fs.existsSync(marker), "control run without the setting").toBe(true);
		} finally {
			try {
				git(main, "rm", "-q", "-f", "--cached", "gitlink-sub");
			} catch {
				// Nothing was staged.
			}
			fs.rmSync(path.join(main, "gitlink-sub"), { recursive: true, force: true });
			fs.rmSync(prep, { recursive: true, force: true });
		}
	});

	it("a record moved in under a new id stays unreachable", async () => {
		const prep = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-prep-")));
		const target = path.join(common, "worktrees", "planted2");
		try {
			fs.mkdirSync(path.join(prep, "prep-rec2"));
			fs.writeFileSync(path.join(prep, "prep-rec2", "commondir"), "../..\n");
			fs.writeFileSync(path.join(prep, "prep-rec2", "gitdir"), `${path.join(prep, "nowhere", ".git")}\n`);
			fs.writeFileSync(path.join(prep, "prep-rec2", "HEAD"), "ref: refs/heads/main\n");
			const out = await run(`mv '${path.join(prep, "prep-rec2")}' .git/worktrees/planted2 2>&1 && echo moved`);
			expect(out).toContain("moved");
			expect(fs.existsSync(target)).toBe(true);
			// No pointer file names the new record, so git never reads its commondir; the check flags it.
			expect(checkGitPointers(main).some((line) => line.includes("planted2"))).toBe(true);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
			fs.rmSync(prep, { recursive: true, force: true });
		}
	});
});

describe("bash tool ownership", () => {
	// pi resolves a tool name to the last registration, so a second bash would silently bypass the sandbox.
	it("no other installed extension registers a bash tool", () => {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		const roots = [
			...[".pi/npm/node_modules", ".pi/extensions", ".pi/local-packages"].map((p) => path.join(repoRoot, p)),
			...["npm/node_modules", "extensions", "local-packages"].map((p) => path.join(agentDir, p)),
		];
		const offenders: string[] = [];
		// Test folders and files never register a live tool; skipping them keeps the walk short.
		const skipDir = new Set(["@earendil-works", "test", "tests", "__tests__", "coverage"]);
		const walk = (dir: string, depth: number) => {
			if (!fs.existsSync(dir) || depth > 8) return;
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (skipDir.has(entry.name) || (entry.name === "node_modules" && depth > 0)) continue;
					walk(full, depth + 1);
				} else if (/\.(ts|js|mjs)$/.test(entry.name) && !/\.(d|test|spec)\.(ts|js|mjs)$/.test(entry.name)) {
					const source = fs.readFileSync(full, "utf8");
					const definesBash = /name:\s*["']bash["']/.test(source) || /createBashTool(Definition)?\(/.test(source);
					if (definesBash && source.includes("registerTool")) offenders.push(full);
				}
			}
		};
		for (const root of roots) walk(root, 0);
		// The global copy appears once the extension is synced; any other file is an override.
		const allowed = new Set([path.join(repoRoot, ".pi/extensions/sandbox-bash.ts"), path.join(agentDir, "extensions/sandbox-bash.ts")]);
		expect(offenders.filter((file) => !allowed.has(file))).toEqual([]);
		expect(offenders).toContain(path.join(repoRoot, ".pi/extensions/sandbox-bash.ts"));
		// Walking every installed package is slow under full-suite load (under 1s alone, over 30s seen).
	}, 120_000);
});
