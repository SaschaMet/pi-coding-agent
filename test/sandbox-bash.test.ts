import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sandboxBashExtension from "../.pi/extensions/sandbox-bash.ts";
import {
	DEFAULT_CONFIG,
	anyCase,
	buildSrtSettings,
	checkCwd,
	findSrt,
	gitMaintenanceOff,
	globalGitConfigDenies,
	gitPointerLiterals,
	gitTreeDenies,
	linkedWorktreeGitWrites,
	loadSandboxConfig,
	nonRepoDenies,
	resolvePaths,
	secretEnvNames,
	shellQuote,
	submoduleConfigNeeded,
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

describe("gitMaintenanceOff", () => {
	it("appends both pairs when no count is set", () => {
		const out = gitMaintenanceOff({ PATH: "/bin" });
		expect(out).toMatchObject({
			PATH: "/bin",
			GIT_CONFIG_COUNT: "2",
			GIT_CONFIG_KEY_0: "maintenance.auto",
			GIT_CONFIG_VALUE_0: "false",
			GIT_CONFIG_KEY_1: "gc.auto",
			GIT_CONFIG_VALUE_1: "0",
		});
	});

	it("keeps existing pairs and appends after them", () => {
		const out = gitMaintenanceOff({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "x" });
		expect(out).toMatchObject({
			GIT_CONFIG_COUNT: "3",
			GIT_CONFIG_KEY_0: "user.name",
			GIT_CONFIG_VALUE_0: "x",
			GIT_CONFIG_KEY_1: "maintenance.auto",
			GIT_CONFIG_VALUE_1: "false",
			GIT_CONFIG_KEY_2: "gc.auto",
			GIT_CONFIG_VALUE_2: "0",
		});
	});

	it("treats an empty count as zero", () => {
		const out = gitMaintenanceOff({ GIT_CONFIG_COUNT: "" });
		expect(out.GIT_CONFIG_COUNT).toBe("2");
		expect(out.GIT_CONFIG_KEY_0).toBe("maintenance.auto");
	});

	it("returns a malformed count unchanged", () => {
		const input = { GIT_CONFIG_COUNT: "abc", PATH: "/bin" };
		const out = gitMaintenanceOff(input);
		expect(out).toEqual(input);
		expect(out.GIT_CONFIG_KEY_0).toBeUndefined();
	});

	it("does not mutate its input", () => {
		const input: NodeJS.ProcessEnv = { PATH: "/bin" };
		gitMaintenanceOff(input);
		expect(input).toEqual({ PATH: "/bin" });
		expect(input.GIT_CONFIG_COUNT).toBeUndefined();
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

describe("linkedWorktreeGitWrites", () => {
	// A main repo with one linked worktree, laid out the way git writes it: the worktree's
	// `.git` file names its record, and the record's `gitdir` file names it back.
	function linkedRepo(root = path.join(scratch, "repo")) {
		const common = path.join(root, ".git");
		const gitDir = path.join(common, "worktrees", "lead");
		for (const dir of [gitDir, path.join(common, "objects"), path.join(common, "refs", "heads"), path.join(common, "hooks")]) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const cwd = path.join(root, ".worktrees", "lead");
		fs.mkdirSync(cwd, { recursive: true });
		fs.writeFileSync(path.join(cwd, ".git"), `gitdir: ${gitDir}\n`);
		fs.writeFileSync(path.join(gitDir, "gitdir"), `${path.join(cwd, ".git")}\n`);
		const tmpdir = path.join(scratch, "tmp");
		fs.mkdirSync(tmpdir, { recursive: true });
		return { common, gitDir, cwd, revParse: `${gitDir}\n${common}\n${cwd}\n`, vars: { cwd, home: "/Users/h", tmpdir } };
	}

	it("opens its own worktree record, objects and the run branch prefixes, and keeps packs closed", () => {
		const { common, gitDir, revParse, vars } = linkedRepo();
		expect(linkedWorktreeGitWrites(revParse, vars)).toEqual({
			allowWrite: [
				gitDir,
				path.join(common, "objects"),
				path.join(common, "refs", "heads", "handsoff"),
				path.join(common, "logs", "refs", "heads", "handsoff"),
				path.join(common, "refs", "heads", "hill-climb"),
				path.join(common, "logs", "refs", "heads", "hill-climb"),
			],
			denyWrite: [path.join(common, "objects", "pack"), path.join(common, "objects", "info")],
		});
	});

	const none = { allowWrite: [], denyWrite: [] };

	it("adds nothing in a main checkout, where the git dir is the common dir", () => {
		const { common, vars } = linkedRepo();
		expect(linkedWorktreeGitWrites(`${common}\n${common}\n${path.dirname(common)}\n`, vars)).toEqual(none);
	});

	it("adds nothing for a git dir outside the worktree records, such as a submodule", () => {
		const { common, cwd, vars } = linkedRepo();
		const submodule = path.join(common, "modules", "sub");
		fs.mkdirSync(submodule, { recursive: true });
		expect(linkedWorktreeGitWrites(`${submodule}\n${common}\n${cwd}\n`, vars)).toEqual(none);
	});

	it("adds nothing for empty output", () => {
		expect(linkedWorktreeGitWrites("", linkedRepo().vars)).toEqual(none);
	});

	it("adds nothing when objects is a symlink out of the git dir", () => {
		const { common, revParse, vars } = linkedRepo();
		const elsewhere = path.join(scratch, "elsewhere");
		fs.mkdirSync(elsewhere);
		fs.rmSync(path.join(common, "objects"), { recursive: true });
		fs.symlinkSync(elsewhere, path.join(common, "objects"));
		expect(linkedWorktreeGitWrites(revParse, vars)).toEqual(none);
	});

	it("adds nothing when the git dir sits in a writable temp folder", () => {
		const { revParse, vars } = linkedRepo();
		expect(linkedWorktreeGitWrites(revParse, { ...vars, tmpdir: scratch })).toEqual(none);
	});

	it("adds nothing when a branch prefix is a symlink back into the git dir", () => {
		const { common, revParse, vars } = linkedRepo();
		fs.symlinkSync("../../hooks", path.join(common, "refs", "heads", "handsoff"));
		expect(linkedWorktreeGitWrites(revParse, vars)).toEqual(none);
	});

	it("adds nothing when a branch log prefix points at the whole git dir", () => {
		const { common, revParse, vars } = linkedRepo();
		fs.mkdirSync(path.join(common, "logs", "refs", "heads"), { recursive: true });
		fs.symlinkSync("../../..", path.join(common, "logs", "refs", "heads", "hill-climb"));
		expect(linkedWorktreeGitWrites(revParse, vars)).toEqual(none);
	});

	it("accepts a back-link written relative to the worktree record", () => {
		const { gitDir, cwd, revParse, vars } = linkedRepo();
		fs.writeFileSync(path.join(gitDir, "gitdir"), `${path.relative(gitDir, path.join(cwd, ".git"))}\n`);
		expect(linkedWorktreeGitWrites(revParse, vars).allowWrite).toHaveLength(6);
	});

	it("adds nothing for a worktree record that belongs to another checkout", () => {
		const { gitDir, revParse, vars } = linkedRepo();
		fs.writeFileSync(path.join(gitDir, "gitdir"), `${path.join(scratch, "other", ".git")}\n`);
		expect(linkedWorktreeGitWrites(revParse, vars)).toEqual(none);
	});

	it("adds nothing for a temp-folder git dir spelled in another letter case", () => {
		const { gitDir, cwd, revParse, vars } = linkedRepo();
		// Only the temp-folder prefix changes case; the git layout below it stays as git writes it.
		const shout = (text: string) => text.replaceAll(scratch, scratch.toUpperCase());
		const shouted = shout(revParse);
		// Only case-insensitive file systems resolve the other spelling at all.
		if (!fs.existsSync(shouted.split("\n")[1])) return;
		fs.writeFileSync(path.join(gitDir, "gitdir"), `${shout(path.join(cwd, ".git"))}\n`);
		expect(linkedWorktreeGitWrites(shouted, { ...vars, tmpdir: scratch })).toEqual(none);
	});

	it("adds nothing when the git dir sits in a home folder whose code runs unsandboxed", () => {
		const home = path.join(scratch, "home");
		const { revParse, vars } = linkedRepo(path.join(home, ".pi", "repo"));
		expect(linkedWorktreeGitWrites(revParse, { ...vars, home })).toEqual(none);
	});
});

// Real git, so the fixtures have exactly the layout git writes.
const gitIn = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
// Spelled out here on purpose, so the test does not rely on the helper it checks.
const ci = (value: string) => value.replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const REV_PARSE = ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"];

function mainCheckout(dir: string): string {
	fs.mkdirSync(dir, { recursive: true });
	gitIn(dir, "init", "-q", "-b", "main");
	gitIn(dir, "commit", "-q", "--allow-empty", "-m", "base");
	return fs.realpathSync(dir);
}

describe("submoduleConfigNeeded", () => {
	const both: Array<[string, string]> = [
		["diff.ignoreSubmodules", "all"],
		["status.submoduleSummary", "false"],
	];

	it("returns nothing when both settings are already right", () => {
		expect(submoduleConfigNeeded("[diff]\n\tignoreSubmodules = all\n[status]\n\tsubmoduleSummary = false\n")).toEqual([]);
	});

	it("returns both pairs for empty text", () => {
		expect(submoduleConfigNeeded("")).toEqual(both);
	});

	it("matches keys case-insensitively and accepts quoted values", () => {
		expect(submoduleConfigNeeded('[DIFF]\n\tIgnoreSubmodules = "all"\n[Status]\n\tSUBMODULESUMMARY = "false"\n')).toEqual([]);
	});

	it("returns only the missing or wrong setting", () => {
		expect(submoduleConfigNeeded("[diff]\n\tignoreSubmodules = all\n")).toEqual([both[1]]);
		expect(submoduleConfigNeeded("[diff]\n\tignoreSubmodules = none\n[status]\n\tsubmoduleSummary = false\n")).toEqual([both[0]]);
	});
});

describe("gitTreeDenies", () => {
	it("denies nested .git entries and the pointer files in a main checkout, in every letter case", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		const common = path.join(top, ".git");
		expect(gitTreeDenies(gitIn(top, ...REV_PARSE))).toEqual([
			ci(path.join(top, "*", "**", ".git")),
			ci(path.join(common, "commondir")),
			ci(path.join(common, "config.worktree")),
			ci(path.join(common, "modules")),
			ci(path.join(common, "worktrees", "*", "commondir")),
			ci(path.join(common, "worktrees", "*", "gitdir")),
			ci(path.join(common, "worktrees", "*", "config.worktree")),
			ci(path.join(common, "config")),
			ci(path.join(common, "hooks")),
		]);
	});

	it("denies a .git file anywhere below a linked worktree", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		const common = path.join(top, ".git");
		const wt = path.join(scratch, "wt");
		gitIn(top, "worktree", "add", "-q", "-b", "side", wt, "HEAD");
		expect(gitTreeDenies(gitIn(wt, ...REV_PARSE))).toEqual([
			ci(path.join(fs.realpathSync(wt), "**", ".git")),
			ci(path.join(common, "commondir")),
			ci(path.join(common, "config.worktree")),
			ci(path.join(common, "modules")),
			ci(path.join(common, "worktrees", "*", "commondir")),
			ci(path.join(common, "worktrees", "*", "gitdir")),
			ci(path.join(common, "worktrees", "*", "config.worktree")),
			ci(path.join(common, "config")),
			ci(path.join(common, "hooks")),
		]);
	});

	it("returns nothing for empty or short input", () => {
		expect(gitTreeDenies("")).toEqual([]);
		expect(gitTreeDenies("/a/.git\n/a/.git\n")).toEqual([]);
	});

	it("returns null when a path holds a glob character", () => {
		const top = mainCheckout(path.join(scratch, "pro[x]ject"));
		expect(gitTreeDenies(gitIn(top, ...REV_PARSE))).toBeNull();
	});
});

describe("anyCase", () => {
	it("writes each ASCII letter as a two-letter class and keeps everything else", () => {
		expect(anyCase("/a/B-c.d_9/*/**/.git")).toBe("/[aA]/[bB]-[cC].[dD]_9/*/**/.[gG][iI][tT]");
	});

	it("matches the helper in this file", () => {
		expect(anyCase("/Users/x/Projects/app/.git/commondir")).toBe(ci("/Users/x/Projects/app/.git/commondir"));
	});
});

describe("nonRepoDenies", () => {
	it("denies a .git entry at any depth below a cwd outside the temp folders", () => {
		expect(nonRepoDenies("/Users/h/Projects", ["/Users/h/Projects"], ["/private/tmp", "/var/folders/x/T"])).toEqual([
			anyCase("/Users/h/Projects/**/.git"),
		]);
	});

	it("adds nothing for a cwd inside a temp folder", () => {
		expect(nonRepoDenies("/private/tmp/work", ["/private/tmp/work"], ["/private/tmp"])).toEqual([]);
		expect(nonRepoDenies("/private/tmp", ["/private/tmp"], ["/private/tmp"])).toEqual([]);
	});

	it("does not treat a folder that only shares a name prefix as inside a temp folder", () => {
		expect(nonRepoDenies("/private/tmpx/a", ["/private/tmpx/a"], ["/private/tmp"])).toEqual([anyCase("/private/tmpx/a/**/.git")]);
	});
});

describe("gitPointerLiterals", () => {
	// Real file modes; root ignores them.
	const asUser = process.getuid?.() !== 0;
	const lock = (target: string, body: () => void) => {
		const original = fs.statSync(target).mode & 0o777;
		fs.chmodSync(target, 0o000);
		try {
			body();
		} finally {
			fs.chmodSync(target, original);
		}
	};

	it.skipIf(!asUser)("returns null when the worktrees folder exists but cannot be read", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		gitIn(top, "worktree", "add", "-q", "-b", "a", path.join(scratch, "wt-a"), "HEAD");
		const common = path.join(top, ".git");
		lock(path.join(common, "worktrees"), () => expect(gitPointerLiterals(common)).toBeNull());
	});

	it("returns null when the worktrees entry is a file, not a folder", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		const common = path.join(top, ".git");
		fs.writeFileSync(path.join(common, "worktrees"), "x");
		expect(gitPointerLiterals(common)).toBeNull();
	});

	it.skipIf(!asUser)("returns null when a record's gitdir file exists but cannot be read", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		gitIn(top, "worktree", "add", "-q", "-b", "a", path.join(scratch, "wt-a"), "HEAD");
		const common = path.join(top, ".git");
		lock(path.join(common, "worktrees", "wt-a", "gitdir"), () => expect(gitPointerLiterals(common)).toBeNull());
	});

	it("keeps canonical case in the literals", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		const wt = path.join(scratch, "WT-Upper");
		gitIn(top, "worktree", "add", "-q", "-b", "a", wt, "HEAD");
		const literals = gitPointerLiterals(path.join(top, ".git")) as string[];
		expect(literals).toContain(path.join(top, ".git", "worktrees", "WT-Upper", "commondir"));
		expect(literals).toContain(path.join(fs.realpathSync(wt), ".git"));
	});

	it("lists the record files and the worktree .git files, sorted", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		const common = path.join(top, ".git");
		const wtA = path.join(scratch, "wt-a");
		const wtB = path.join(scratch, "wt-b");
		gitIn(top, "worktree", "add", "-q", "-b", "a", wtA, "HEAD");
		gitIn(top, "worktree", "add", "-q", "-b", "b", wtB, "HEAD");
		const expected = [
			path.join(common, "worktrees", "wt-a", "commondir"),
			path.join(common, "worktrees", "wt-a", "gitdir"),
			path.join(fs.realpathSync(wtA), ".git"),
			path.join(common, "worktrees", "wt-b", "commondir"),
			path.join(common, "worktrees", "wt-b", "gitdir"),
			path.join(fs.realpathSync(wtB), ".git"),
		].sort();
		expect(gitPointerLiterals(common)).toEqual(expected);
	});

	it("returns nothing when there are no worktrees", () => {
		const top = mainCheckout(path.join(scratch, "main"));
		expect(gitPointerLiterals(path.join(top, ".git"))).toEqual([]);
	});
});

describe("globalGitConfigDenies", () => {
	let home: string;
	let work: string;
	beforeEach(() => {
		home = path.join(scratch, "home");
		work = path.join(scratch, "w");
		fs.mkdirSync(home, { recursive: true });
		fs.mkdirSync(work, { recursive: true });
	});
	type Extra = { xdgConfigHome?: string; repoTop?: string; gitConfigGlobal?: string; extraFiles?: string[] };
	const denies = (extra: Extra = {}) => globalGitConfigDenies({ home, writableRoots: [work, home], ...extra });
	const denyList = (extra: Extra = {}) => (denies(extra) as { denyWrite: string[] }).denyWrite;

	it("always denies the global config files, and the XDG folder when set", () => {
		expect(denies()).toEqual({ denyWrite: [path.join(home, ".gitconfig"), path.join(home, ".config", "git")] });
		const xdg = path.join(scratch, "xdg");
		expect(denyList({ xdgConfigHome: xdg })).toHaveLength(3);
		expect(denyList({ xdgConfigHome: xdg })).toContain(path.join(xdg, "git"));
	});

	it("denies include, includeIf and hooksPath targets inside a writable root", () => {
		fs.writeFileSync(
			path.join(home, ".gitconfig"),
			`[include]\n\tpath = ~/inc.cfg\n[core]\n\thooksPath = ${work}/hooks\n[includeIf "gitdir:/x/"]\n\tpath = rel.cfg\n`,
		);
		expect(denyList()).toEqual(
			expect.arrayContaining([path.join(home, "inc.cfg"), path.join(work, "hooks"), path.join(home, "rel.cfg")]),
		);
	});

	it("reads keys case-insensitively and accepts quoted values", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[CORE]\n\tHooksPath = "${work}/q-hooks"\n`);
		expect(denyList()).toContain(path.join(work, "q-hooks"));
	});

	it("follows included files recursively", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[include]\n\tpath = ~/inc.cfg\n`);
		fs.writeFileSync(path.join(home, "inc.cfg"), `[core]\n\tattributesFile = ${work}/attrs\n`);
		expect(denyList()).toContain(path.join(work, "attrs"));
	});

	it("reads the XDG config file too", () => {
		const xdg = path.join(scratch, "xdg");
		fs.mkdirSync(path.join(xdg, "git"), { recursive: true });
		fs.writeFileSync(path.join(xdg, "git", "config"), `[core]\n\texcludesFile = ${work}/ign\n`);
		expect(denyList({ xdgConfigHome: xdg })).toContain(path.join(work, "ign"));
	});

	it("leaves out a target outside every writable root", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[core]\n\thooksPath = /usr/share/x\n`);
		expect(denyList()).not.toContain("/usr/share/x");
	});

	it("blocks a target with glob characters and names the key and file", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[core]\n\texcludesFile = ${work}/*.ex\n`);
		const result = denies() as { blocked: string };
		expect(result.blocked).toMatch(/excludesFile/i);
		expect(result.blocked).toContain(path.join(home, ".gitconfig"));
	});

	it("blocks a ~otheruser path", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[include]\n\tpath = ~nobody/x\n`);
		expect(denies()).toEqual({ blocked: expect.stringMatching(/path/) });
	});

	it("terminates on an include cycle", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[include]\n\tpath = ~/a.cfg\n`);
		fs.writeFileSync(path.join(home, "a.cfg"), `[include]\n\tpath = ~/b.cfg\n`);
		fs.writeFileSync(path.join(home, "b.cfg"), `[include]\n\tpath = ~/a.cfg\n`);
		expect(denyList()).toEqual(expect.arrayContaining([path.join(home, "a.cfg"), path.join(home, "b.cfg")]));
	});

	it.each(["hooksPath", "attributesFile", "excludesFile"])("blocks a relative core.%s and names the key", (key) => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[core]\n\t${key} = .rel/x\n`);
		const result = denies() as { blocked: string };
		expect(result.blocked).toMatch(new RegExp(key, "i"));
	});

	it("resolves a relative core.hooksPath against the repo top and denies it inside a writable root", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[core]\n\thooksPath = .myhooks\n[core]\n\texcludesFile = ign\n`);
		const top = path.join(work, "repo");
		fs.mkdirSync(top);
		expect(denyList({ repoTop: top })).toEqual(expect.arrayContaining([path.join(top, ".myhooks"), path.join(top, "ign")]));
	});

	it("leaves out a relative path whose repo top is outside every writable root", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[core]\n\thooksPath = .myhooks\n`);
		const top = path.join(scratch, "elsewhere");
		fs.mkdirSync(top);
		const result = denies({ repoTop: top });
		expect(result).not.toHaveProperty("blocked");
		expect(denyList({ repoTop: top })).not.toContain(path.join(top, ".myhooks"));
	});

	it("resolves a relative include.path against the config file, as before", () => {
		fs.writeFileSync(path.join(home, ".gitconfig"), `[include]\n\tpath = rel.cfg\n`);
		expect(denyList({ repoTop: work })).toContain(path.join(home, "rel.cfg"));
	});

	it("blocks when GIT_CONFIG_GLOBAL is set and names it", () => {
		const result = denies({ gitConfigGlobal: path.join(work, "elsewhere.cfg") }) as { blocked: string };
		expect(result.blocked).toContain("GIT_CONFIG_GLOBAL");
	});

	it("does not let a comment ending in a backslash swallow the next line", () => {
		const evil = path.join(work, "evil.cfg");
		fs.writeFileSync(path.join(home, ".gitconfig"), `# note \\\n[include]\n\tpath = ${evil}\n`);
		expect(denyList()).toContain(evil);
	});

	it("scans extra repo config files with the same rules", () => {
		const top = path.join(work, "repo");
		const gitDir = path.join(top, ".git");
		fs.mkdirSync(gitDir, { recursive: true });
		const config = path.join(gitDir, "config");
		fs.writeFileSync(config, `[core]\n\thooksPath = .husky/_\n`);
		expect(denyList({ extraFiles: [config], repoTop: top })).toContain(path.join(top, ".husky", "_"));
	});

	it("scans includes found in an extra repo config file", () => {
		const evil = path.join(work, "evil.cfg");
		const config = path.join(work, "repo-config");
		fs.writeFileSync(config, `[include]\n\tpath = ${evil}\n`);
		expect(denyList({ extraFiles: [config] })).toContain(evil);
	});

	it("blocks a relative hooks path in an extra config file when no repo top is given", () => {
		const config = path.join(work, "repo-config");
		fs.writeFileSync(config, `[core]\n\thooksPath = .husky/_\n`);
		expect((denies({ extraFiles: [config] }) as { blocked: string }).blocked).toMatch(/hooksPath/i);
	});

	it("blocks an included file that exists but cannot be read", () => {
		if (process.getuid?.() === 0) return;
		fs.writeFileSync(path.join(home, ".gitconfig"), `[include]\n\tpath = ~/locked.cfg\n`);
		const locked = path.join(home, "locked.cfg");
		fs.writeFileSync(locked, "[core]\n");
		fs.chmodSync(locked, 0o000);
		try {
			expect(denies()).toEqual({ blocked: expect.stringContaining(locked) });
		} finally {
			fs.chmodSync(locked, 0o600);
		}
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
	options: {
		flags?: Record<string, boolean>;
		version?: string;
		probeCode?: number;
		bashSource?: string;
		git?: { stdout: string; code: number; killed?: boolean };
	} = {},
) {
	const fake = createFakePi({ flags: options.flags });
	const registerTool = vi.fn(fake.registerTool);
	fake.registerTool = registerTool;
	fake.exec = vi.fn(async (command: string, args: string[]) =>
		command === "git"
			? { stdout: options.git?.stdout ?? "", stderr: "", code: options.git?.code ?? 128, killed: options.git?.killed ?? false }
			: args.includes("--version")
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
	return { fake, ui, registerTool, start, shutdown, userBash, run, text, lastStatus, toolCtx };
}

describe("sandbox-bash extension", () => {
	it("registers the bash tool once, even when loaded twice on one pi", () => {
		const fake = createFakePi();
		const registerTool = vi.fn(fake.registerTool);
		fake.registerTool = registerTool;
		const bashCalls = () => registerTool.mock.calls.filter((call: any[]) => call[0]?.name === "bash").length;
		sandboxBashExtension(asExtensionAPI(fake));
		const totalAfterFirst = registerTool.mock.calls.length;
		sandboxBashExtension(asExtensionAPI(fake));
		expect(bashCalls()).toBe(1);
		expect(registerTool).toHaveBeenCalledTimes(totalAfterFirst);
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

	describe("git_worktree tool and running bash commands", () => {
		const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		const params = () => ({ action: "add", path: path.join(projectDir, ".worktrees", "h", "p"), branch: "handsoff/t/p" });

		it("is registered to run on its own, never in parallel with other tools", () => {
			const { fake } = setup();
			expect((fake.tools.get("git_worktree") as any).executionMode).toBe("sequential");
		});

		it("refuses while a sandboxed bash command of the same extension is still running", async () => {
			installFakeSrt();
			const s = setup();
			await s.start();
			const tool = s.fake.tools.get("git_worktree")!;
			const started = path.join(projectDir, "started");
			const running = s.run(`touch ${started}; sleep 2; echo finished`);
			for (let i = 0; i < 100 && !fs.existsSync(started); i++) await sleep(50);
			expect(fs.existsSync(started)).toBe(true);

			await expect(tool.execute("wt", params(), undefined, undefined, s.toolCtx)).rejects.toThrow(/bash command is running/);
			expect(s.text(await running)).toContain("finished");

			// With nothing in flight, the tool gets as far as its own checks (the folder is no repo).
			const after = await tool.execute("wt", params(), undefined, undefined, s.toolCtx).catch((error: Error) => error);
			expect(String(after)).not.toMatch(/bash command is running/);
		});

		it("counts a bash command that fails as finished", async () => {
			installFakeSrt();
			const s = setup();
			await s.start();
			await s.run("exit 3").catch(() => undefined);
			const tool = s.fake.tools.get("git_worktree")!;
			const after = await tool.execute("wt", params(), undefined, undefined, s.toolCtx).catch((error: Error) => error);
			expect(String(after)).not.toMatch(/bash command is running/);
		});
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

	describe("git paths at start", () => {
		const settings = () => {
			const dir = path.join(scratch, "agent", "sandbox-run");
			return JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8"));
		};
		const defaults = () =>
			resolvePaths(DEFAULT_CONFIG.filesystem.allowWrite, { cwd: projectDir, home: os.homedir(), tmpdir: os.tmpdir() });

		it("opens the main repo's git paths for a session in a linked worktree", async () => {
			installFakeSrt();
			const common = path.join(scratch, "repo", ".git");
			const gitDir = path.join(common, "worktrees", "lead");
			fs.mkdirSync(gitDir, { recursive: true });
			fs.mkdirSync(path.join(common, "objects"));
			fs.writeFileSync(path.join(projectDir, ".git"), `gitdir: ${gitDir}\n`);
			fs.writeFileSync(path.join(gitDir, "gitdir"), `${path.join(projectDir, ".git")}\n`);
			const revParse = `${gitDir}\n${common}\n${projectDir}\n`;
			const s = setup({ git: { stdout: revParse, code: 0 } });
			await s.start();
			const { allowWrite, denyWrite } = settings().filesystem;
			const expected = linkedWorktreeGitWrites(revParse, { cwd: projectDir, home: os.homedir(), tmpdir: os.tmpdir() });
			expect(expected.allowWrite).toHaveLength(6);
			expect(allowWrite).toEqual([...defaults(), ...expected.allowWrite]);
			expect(allowWrite).toContain(path.join(common, "refs", "heads", "handsoff"));
			expect(denyWrite).toContain(path.join(common, "objects", "pack"));
			expect(s.lastStatus()).toMatch(/sandbox: \d+ domains, 10 write paths/);
		});

		const linkedWorktreeRevParse = () => {
			const common = path.join(scratch, "repo", ".git");
			const gitDir = path.join(common, "worktrees", "lead");
			fs.mkdirSync(gitDir, { recursive: true });
			fs.mkdirSync(path.join(common, "objects"));
			fs.writeFileSync(path.join(projectDir, ".git"), `gitdir: ${gitDir}\n`);
			fs.writeFileSync(path.join(gitDir, "gitdir"), `${path.join(projectDir, ".git")}\n`);
			return `${gitDir}\n${common}\n${projectDir}\n`;
		};
		const echoGitConfig =
			'echo "count=$GIT_CONFIG_COUNT $GIT_CONFIG_KEY_0=$GIT_CONFIG_VALUE_0 $GIT_CONFIG_KEY_1=$GIT_CONFIG_VALUE_1"';
		// The test process must not already carry git config pairs, or the asserted count would shift.
		let savedCount: string | undefined;
		beforeEach(() => {
			savedCount = process.env.GIT_CONFIG_COUNT;
			delete process.env.GIT_CONFIG_COUNT;
		});
		afterEach(() => {
			if (savedCount === undefined) delete process.env.GIT_CONFIG_COUNT;
			else process.env.GIT_CONFIG_COUNT = savedCount;
		});

		it("turns off git auto maintenance for sandboxed bash in a linked worktree", async () => {
			installFakeSrt();
			const s = setup({ git: { stdout: linkedWorktreeRevParse(), code: 0 } });
			await s.start();
			expect(s.text(await s.run(echoGitConfig))).toContain("count=2 maintenance.auto=false gc.auto=0");
		});

		it("leaves git config env alone in a main checkout", async () => {
			installFakeSrt();
			const common = path.join(projectDir, ".git");
			const s = setup({ git: { stdout: `${common}\n${common}\n`, code: 0 } });
			await s.start();
			const out = s.text(await s.run(echoGitConfig));
			expect(out).toContain("count= ");
			expect(out).not.toContain("maintenance.auto");
		});

		it("turns off git auto maintenance for user ! commands in a linked worktree", async () => {
			installFakeSrt();
			const s = setup({ git: { stdout: linkedWorktreeRevParse(), code: 0 } });
			await s.start();
			const result = await s.userBash(echoGitConfig);
			const chunks: string[] = [];
			await result.operations.exec(echoGitConfig, projectDir, {
				onData: (data: Buffer) => chunks.push(data.toString()),
			});
			expect(chunks.join("")).toContain("count=2 maintenance.auto=false gc.auto=0");
		});

		it("adds no git paths in a main checkout", async () => {
			installFakeSrt();
			const common = path.join(projectDir, ".git");
			const s = setup({ git: { stdout: `${common}\n${common}\n`, code: 0 } });
			await s.start();
			expect(settings().filesystem.allowWrite).toEqual(defaults());
			expect(s.lastStatus()).toMatch(/sandbox: \d+ domains, 4 write paths/);
		});

		it("adds no git paths when git rev-parse is killed by its timeout", async () => {
			installFakeSrt();
			const common = path.join(scratch, "repo", ".git");
			const gitDir = path.join(common, "worktrees", "lead");
			fs.mkdirSync(gitDir, { recursive: true });
			fs.writeFileSync(path.join(projectDir, ".git"), `gitdir: ${gitDir}\n`);
			fs.writeFileSync(path.join(gitDir, "gitdir"), `${path.join(projectDir, ".git")}\n`);
			const s = setup({ git: { stdout: `${gitDir}\n${common}\n${projectDir}\n`, code: 0, killed: true } });
			await s.start();
			expect(settings().filesystem.allowWrite).toEqual(defaults());
		});

		it("denies tree entries and the global git config in a main checkout", async () => {
			installFakeSrt();
			const top = mainCheckout(projectDir);
			const revParse = gitIn(top, ...REV_PARSE);
			const s = setup({ git: { stdout: revParse, code: 0 } });
			await s.start();
			const { denyWrite } = settings().filesystem;
			expect(denyWrite).toEqual(expect.arrayContaining(gitTreeDenies(revParse)!));
			expect(denyWrite).toContain(path.join(os.homedir(), ".gitconfig"));
			expect(s.lastStatus()).toMatch(/sandbox: \d+ domains, 4 write paths/);
		});

		it("blocks bash when the checkout path holds a glob character", async () => {
			installFakeSrt();
			projectDir = path.join(scratch, "pro[x]ject");
			const top = mainCheckout(projectDir);
			const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
			await s.start();
			expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
			expect(s.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/glob/), "error");
			await expect(s.run("echo hi")).rejects.toThrow(/glob/);
		});

		it("adds the pointer files of a new worktree before the next bash command", async () => {
			installFakeSrt();
			const top = mainCheckout(projectDir);
			gitIn(top, "worktree", "add", "-q", "-b", "one", path.join(scratch, "wt-one"), "HEAD");
			const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
			await s.start();
			const newRecord = path.join(top, ".git", "worktrees", "wt-two", "commondir");
			expect(settings().filesystem.denyWrite).not.toContain(newRecord);
			// Created outside the sandbox, the way git_worktree does.
			gitIn(top, "worktree", "add", "-q", "-b", "two", path.join(scratch, "wt-two"), "HEAD");
			expect(s.text(await s.run("echo hi"))).toContain("SRT-WRAPPED");
			expect(settings().filesystem.denyWrite).toContain(newRecord);
			expect(settings().filesystem.denyWrite).toContain(path.join(top, ".git", "worktrees", "wt-one", "commondir"));
		});

		it("lets two parallel bash commands both run when the first one refreshed the pointer files", async () => {
			installFakeSrt();
			const top = mainCheckout(projectDir);
			gitIn(top, "worktree", "add", "-q", "-b", "one", path.join(scratch, "wt-one"), "HEAD");
			const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
			await s.start();
			const newRecord = path.join(top, ".git", "worktrees", "wt-two", "commondir");
			gitIn(top, "worktree", "add", "-q", "-b", "two", path.join(scratch, "wt-two"), "HEAD");
			const results = await Promise.all([s.run("echo a"), s.run("echo b")]);
			for (const result of results) expect(s.text(result)).toContain("SRT-WRAPPED");
			expect(settings().filesystem.denyWrite).toContain(newRecord);
		});

		describe("pointer files that cannot be listed", () => {
			const asUser = process.getuid?.() !== 0;
			const withLocked = async (target: string, body: () => Promise<void>) => {
				const original = fs.statSync(target).mode & 0o777;
				fs.chmodSync(target, 0o000);
				try {
					await body();
				} finally {
					fs.chmodSync(target, original);
				}
			};

			it.skipIf(!asUser)("blocks bash at start when the worktrees folder cannot be read", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				gitIn(top, "worktree", "add", "-q", "-b", "one", path.join(scratch, "wt-one"), "HEAD");
				const revParse = gitIn(top, ...REV_PARSE);
				await withLocked(path.join(top, ".git", "worktrees"), async () => {
					const s = setup({ git: { stdout: revParse, code: 0 } });
					await s.start();
					expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
					expect(s.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/pointer/), "error");
					await expect(s.run("echo hi")).rejects.toThrow(/pointer/);
				});
			});

			it.skipIf(!asUser)("blocks the next bash command, and runs nothing, once the worktrees folder cannot be read", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				gitIn(top, "worktree", "add", "-q", "-b", "one", path.join(scratch, "wt-one"), "HEAD");
				const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
				await s.start();
				expect(s.text(await s.run("echo fine"))).toContain("SRT-WRAPPED");
				const marker = path.join(projectDir, "ran");
				await withLocked(path.join(top, ".git", "worktrees"), async () => {
					await expect(s.run(`touch ${marker}`)).rejects.toThrow(/bash blocked: sandbox unavailable.*pointer/);
					expect(fs.existsSync(marker)).toBe(false);
					expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
					expect((await s.userBash("echo hi")).result.output).toMatch(/pointer/);
				});
				// Blocked stays blocked until the session restarts.
				await expect(s.run("echo again")).rejects.toThrow(/bash blocked/);
			});

			it("keeps the literals of a worktree whose record was removed unsandboxed, and adds new ones", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				const wtOne = path.join(scratch, "wt-one");
				gitIn(top, "worktree", "add", "-q", "-b", "one", wtOne, "HEAD");
				const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
				await s.start();
				const recordOne = path.join(top, ".git", "worktrees", "wt-one");
				const oldLiterals = [path.join(recordOne, "commondir"), path.join(recordOne, "gitdir"), path.join(fs.realpathSync(wtOne), ".git")];
				expect(settings().filesystem.denyWrite).toEqual(expect.arrayContaining(oldLiterals));

				gitIn(top, "worktree", "remove", "--force", wtOne);
				expect(fs.existsSync(recordOne)).toBe(false);
				gitIn(top, "worktree", "add", "-q", "-b", "two", path.join(scratch, "wt-two"), "HEAD");

				expect(s.text(await s.run("echo hi"))).toContain("SRT-WRAPPED");
				const denyWrite = settings().filesystem.denyWrite;
				expect(denyWrite).toEqual(expect.arrayContaining(oldLiterals));
				expect(denyWrite).toContain(path.join(top, ".git", "worktrees", "wt-two", "commondir"));
			});
		});

		describe("repo and global git config indirection", () => {
			it("denies a repo-local relative hooks path inside the checkout", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				gitIn(top, "config", "core.hooksPath", ".husky/_");
				const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
				await s.start();
				expect(s.lastStatus()).toMatch(/^sandbox: /);
				expect(settings().filesystem.denyWrite).toContain(path.join(top, ".husky", "_"));
			});

			it("blocks bash when GIT_CONFIG_GLOBAL is set", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				const revParse = gitIn(top, ...REV_PARSE);
				process.env.GIT_CONFIG_GLOBAL = path.join(scratch, "other.cfg");
				try {
					const s = setup({ git: { stdout: revParse, code: 0 } });
					await s.start();
					expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
					expect(s.ui.notify).toHaveBeenCalledWith(expect.stringContaining("GIT_CONFIG_GLOBAL"), "error");
				} finally {
					delete process.env.GIT_CONFIG_GLOBAL;
				}
			});
		});

		it("blocks bash and leaves the target alone when the repo config is a symlink", async () => {
			installFakeSrt();
			const top = mainCheckout(projectDir);
			const config = path.join(top, ".git", "config");
			const victim = path.join(scratch, "victim");
			fs.renameSync(config, victim);
			fs.symlinkSync(victim, config);
			const before = fs.readFileSync(victim, "utf8");
			const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
			await s.start();
			expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
			expect(s.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not a regular file"), "error");
			expect(fs.readFileSync(victim, "utf8")).toBe(before);
			expect(fs.lstatSync(config).isSymbolicLink()).toBe(true);
		});

		describe("submodule status settings", () => {
			const cfg = (dir: string, key: string) =>
				execFileSync("git", ["config", "--file", path.join(dir, "config"), "--get", key], { encoding: "utf8" }).trim();

			it("sets diff.ignoreSubmodules and status.submoduleSummary in a main checkout", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
				await s.start();
				const common = path.join(top, ".git");
				expect(cfg(common, "diff.ignoreSubmodules")).toBe("all");
				expect(cfg(common, "status.submoduleSummary")).toBe("false");
			});

			it("changes diff.ignoreSubmodules = none to all", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				gitIn(top, "config", "diff.ignoreSubmodules", "none");
				const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
				await s.start();
				expect(cfg(path.join(top, ".git"), "diff.ignoreSubmodules")).toBe("all");
			});

			it("announces each changed key with old and new value and the config path", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				gitIn(top, "config", "diff.ignoreSubmodules", "none");
				const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
				await s.start();
				expect(s.ui.notify).toHaveBeenCalledWith(
					expect.stringContaining("diff.ignoreSubmodules none -> all"),
					"info",
				);
				expect(s.ui.notify).toHaveBeenCalledWith(
					expect.stringContaining("status.submoduleSummary unset -> false"),
					"info",
				);
				expect(s.ui.notify).toHaveBeenCalledWith(
					expect.stringContaining(path.join(top, ".git", "config")),
					"info",
				);
			});

			it("sends no notice when both keys already hold the right values", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				gitIn(top, "config", "diff.ignoreSubmodules", "all");
				gitIn(top, "config", "status.submoduleSummary", "false");
				const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
				await s.start();
				const messages = s.ui.notify.mock.calls.map((c: unknown[]) => String(c[0]));
				expect(messages.filter((m: string) => m.includes("diff.ignoreSubmodules"))).toEqual([]);
			});

			it("blocks bash and names diff.ignoreSubmodules when the config cannot be written", async () => {
				installFakeSrt();
				const top = mainCheckout(projectDir);
				const config = path.join(top, ".git", "config");
				fs.chmodSync(config, 0o444);
				try {
					const s = setup({ git: { stdout: gitIn(top, ...REV_PARSE), code: 0 } });
					await s.start();
					expect(s.lastStatus()).toBe("bash blocked: sandbox unavailable");
					expect(s.ui.notify).toHaveBeenCalledWith(expect.stringContaining("diff.ignoreSubmodules"), "error");
				} finally {
					fs.chmodSync(config, 0o644);
				}
			});

			it("writes the settings into the common config for a linked-worktree session", async () => {
				installFakeSrt();
				const top = mainCheckout(path.join(scratch, "repo"));
				projectDir = path.join(scratch, "linked");
				gitIn(top, "worktree", "add", "-q", "-b", "lead", projectDir, "HEAD");
				const s = setup({ git: { stdout: gitIn(projectDir, ...REV_PARSE), code: 0 } });
				await s.start();
				const common = path.join(top, ".git");
				expect(cfg(common, "diff.ignoreSubmodules")).toBe("all");
				expect(cfg(common, "status.submoduleSummary")).toBe("false");
			});
		});

		it("starts normally with no git paths when git fails", async () => {
			installFakeSrt();
			const s = setup({ git: { stdout: "", code: 128 } });
			await s.start();
			expect(settings().filesystem.allowWrite).toEqual(defaults());
			expect(s.text(await s.run("echo hi"))).toContain("SRT-WRAPPED");
		});
	});
});
