import fs from "node:fs";
import path from "node:path";

export const SRT_VERSION = "0.0.79";
export const CONFIG_FILE_NAME = "sandbox.json";

export interface SandboxConfig {
	network: {
		allowedDomains: string[];
		deniedDomains: string[];
	};
	filesystem: {
		denyRead: string[];
		allowWrite: string[];
		denyWrite: string[];
	};
}

// Paths use ".", "~" and "$TMPDIR"; resolvePaths makes them absolute per session.
export const DEFAULT_CONFIG: SandboxConfig = {
	network: {
		allowedDomains: ["registry.npmjs.org"],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: [
			"~/.ssh",
			"~/.aws",
			"~/.gnupg",
			"~/.pi/agent/auth.json",
			"~/.pi/agent/models.json",
			"~/.config/gh",
			"~/.netrc",
			"~/.git-credentials",
			"~/.docker/config.json",
			".env",
			".env.*",
		],
		// /tmp is listed because tests in this repo create files there on purpose.
		allowWrite: [".", "$TMPDIR", "/tmp", "~/.npm"],
		// npx runs the unpacked trees in _npx later, outside the sandbox, without an integrity check.
		denyWrite: [".env", ".env.*", ".pi/", ".git/hooks", "~/.npm/_npx"],
	},
};

// Files here are run or loaded later by tools outside the sandbox.
const UNSAFE_HOME_DIRS = [".pi", "Library", ".config"];

const NPM_TOKEN_FILE = "~/.npmrc";
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|_KEY|CREDENTIAL|AUTH)/i;
const POSIX_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GLOB_CHARS = /[*?[\]{}]/;

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

// The outer shell only ever sees fixed text plus single-quoted literals, so the
// command cannot be expanded or split before srt receives it.
export function wrapCommand(command: string, settingsPath: string, srtPath: string): string {
	return `exec ${shellQuote(srtPath)} --settings ${shellQuote(settingsPath)} -- /bin/bash -c ${shellQuote(command)}`;
}

// Names only: values never leave process.env. cmux and SSH_AUTH_SOCK hold paths, not secrets.
export function secretEnvNames(env: NodeJS.ProcessEnv): string[] {
	return Object.keys(env)
		.filter((name) => POSIX_NAME.test(name))
		.filter((name) => !name.startsWith("CMUX_") && name !== "SSH_AUTH_SOCK")
		.filter((name) => SECRET_NAME.test(name))
		.sort();
}

// "." is writable, so the cwd decides how much of the disk the sandbox may change.
export function checkCwd(cwd: string, home: string): string | undefined {
	const real = realOrSelf(cwd);
	const realHome = realOrSelf(home);
	if (real === "/") return `cwd is the filesystem root (${cwd}); start pi inside a project`;
	if (real === realHome) return `cwd is the home directory (${cwd}); start pi inside a project`;
	if (isWithin(realHome, real)) return `cwd ${cwd} contains the home directory; start pi inside a project`;
	for (const dir of UNSAFE_HOME_DIRS) {
		if (isWithin(real, path.join(realHome, dir))) {
			return `cwd ${cwd} is inside ~/${dir}, whose code runs outside the sandbox; start pi inside a project`;
		}
	}
	return undefined;
}

function isWithin(child: string, parent: string): boolean {
	return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

export function sameRealPath(a: string, b: string): boolean {
	return realOrSelf(a) === realOrSelf(b);
}

// A copy the sandbox can write could fake the version and the probe, then run commands unsandboxed.
export function findSrt(pathVar: string, writableRoots: readonly string[]): string | undefined {
	return findBinary("srt", pathVar, writableRoots);
}

export function findBinary(name: string, pathVar: string, writableRoots: readonly string[]): string | undefined {
	const roots = writableRoots.map(realOrSelf);
	for (const dir of pathVar.split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, name);
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
		} catch {
			continue;
		}
		const locations = [path.resolve(candidate), realOrSelf(candidate)];
		if (locations.some((location) => roots.some((root) => isWithin(location, root)))) continue;
		return candidate;
	}
	return undefined;
}

export interface PathVars {
	cwd: string;
	home: string;
	tmpdir: string;
}

// Branch prefixes a linked-worktree session may write: the handsoff and hill-climb runs.
export const LINKED_WORKTREE_BRANCH_PREFIXES = ["handsoff", "hill-climb"] as const;

/**
 * Extra write and deny paths for a session whose cwd is a linked worktree: its index and
 * branch tips live in the main repo's git dir, outside `.`. The session can rewrite its own
 * `.git` file and anything a sandboxed main checkout can reach, so every check fails closed:
 * the common dir must sit outside writable and unsafe folders, its worktree record must name
 * this checkout back, and no symlink may sit below it on the way to a returned path.
 * The paths come back canonical and must not be resolved again, so a later symlink swap
 * cannot redirect them. `revParse` is the output of
 * `git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel`.
 */
export function linkedWorktreeGitWrites(revParse: string, vars: PathVars): { allowWrite: string[]; denyWrite: string[] } {
	const none = { allowWrite: [], denyWrite: [] };
	const [gitDirLine, commonLine, toplevel] = revParse.trim().split("\n");
	if (!gitDirLine || !commonLine || !toplevel) return none;
	const gitDir = canonicalPath(gitDirLine);
	const common = canonicalPath(commonLine);
	if (gitDir === common) return none;
	const unsafeRoots = [
		...resolvePaths(DEFAULT_CONFIG.filesystem.allowWrite, vars),
		...UNSAFE_HOME_DIRS.map((dir) => path.join(vars.home, dir)),
	].map(canonicalPath);
	if (unsafeRoots.some((root) => isWithin(common, root))) return none;
	if (!isWithin(gitDir, path.join(common, "worktrees"))) return none;
	const backLink = readFirstLine(path.join(gitDir, "gitdir"));
	// git may write the back-link relative to the record folder (`--relative-paths`).
	if (!backLink || canonicalPath(path.resolve(gitDir, backLink)) !== canonicalPath(path.join(toplevel, ".git"))) return none;
	const allowWrite = [
		gitDir,
		path.join(common, "objects"),
		...LINKED_WORKTREE_BRANCH_PREFIXES.flatMap((prefix) => [
			path.join(common, "refs", "heads", prefix),
			path.join(common, "logs", "refs", "heads", prefix),
		]),
	];
	const denyWrite = [path.join(common, "objects", "pack"), path.join(common, "objects", "info")];
	if ([...allowWrite, ...denyWrite].some((entry) => hasSymlinkBelow(common, entry))) return none;
	return { allowWrite, denyWrite };
}

// macOS file systems ignore case, and the JS realpath keeps the caller's spelling; native does not.
export function canonicalPath(target: string): string {
	try {
		return fs.realpathSync.native(target);
	} catch {
		return path.resolve(target);
	}
}

/**
 * Deny patterns for the checkout a session runs in. srt checks them on every access, so
 * files made mid-session are covered; the main checkout's own .git/ stays writable.
 * Returns [] for short input and null when a path holds a glob character, which would
 * turn a literal path into a pattern. `revParse` is as for `linkedWorktreeGitWrites`.
 */
export function gitTreeDenies(revParse: string): string[] | null {
	const lines = revParse.trim().split("\n");
	if (lines.length < 3 || !lines[1] || !lines[2]) return [];
	const common = canonicalPath(lines[1]);
	const top = canonicalPath(lines[2]);
	if (GLOB_CHARS.test(common) || GLOB_CHARS.test(top)) return null;
	const main = isRealDirectory(path.join(top, ".git")) && canonicalPath(path.join(top, ".git")) === common;
	return [
		path.join(top, ...(main ? ["*", "**", ".git"] : ["**", ".git"])),
		path.join(common, "commondir"),
		path.join(common, "config.worktree"),
		path.join(common, "modules"),
		path.join(common, "worktrees", "*", "commondir"),
		path.join(common, "worktrees", "*", "gitdir"),
		path.join(common, "worktrees", "*", "config.worktree"),
		path.join(common, "config"),
		path.join(common, "hooks"),
	].map(anyCase);
}

// macOS disks ignore letter case, so a pointer spelled COMMONDIR is the same file to git.
export function anyCase(pattern: string): string {
	return pattern.replace(/[A-Za-z]/g, (char) => `[${char.toLowerCase()}${char.toUpperCase()}]`);
}

// Outside a repo no pointer file may be planted below the cwd; temp folders stay free for tests.
export function nonRepoDenies(cwd: string, _writableRoots: readonly string[], tmpRoots: readonly string[]): string[] {
	if (tmpRoots.some((root) => isWithin(cwd, root))) return [];
	return [anyCase(path.join(cwd, "**", ".git"))];
}

function isRealDirectory(target: string): boolean {
	try {
		return fs.lstatSync(target).isDirectory();
	} catch {
		return false;
	}
}

// srt also refuses to rename the folders above a literal path, which glob rules do not give.
// Null means the list is unknown: an unreadable record could hide a pointer.
export function gitPointerLiterals(commonDir: string): string[] | null {
	const root = path.join(commonDir, "worktrees");
	let ids: string[];
	try {
		ids = fs.readdirSync(root);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
	}
	const literals = new Set<string>();
	for (const id of ids) {
		const record = path.join(root, id);
		if (!isRealDirectory(record)) continue;
		literals.add(path.join(record, "commondir"));
		literals.add(path.join(record, "gitdir"));
		let pointer: string | undefined;
		try {
			pointer = fs.readFileSync(path.join(record, "gitdir"), "utf8").split("\n")[0].trim() || undefined;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			return null;
		}
		if (!pointer) continue;
		const file = path.resolve(record, pointer);
		literals.add(path.join(canonicalPath(path.dirname(file)), path.basename(file)));
	}
	return [...literals].sort();
}

interface GitConfigEntry {
	section: string;
	subsection: string | undefined;
	key: string;
	value: string;
	raw: string;
}

// Names compare case-insensitively; `raw` keeps the spelling for messages.
function parseGitConfig(text: string): GitConfigEntry[] {
	const entries: GitConfigEntry[] = [];
	let section = "";
	let subsection: string | undefined;
	let rawSection = "";
	for (let line of logicalLines(text)) {
		line = line.trim();
		if (line.startsWith("[")) {
			const header = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/.exec(line);
			if (!header) {
				section = "";
				continue;
			}
			rawSection = header[1];
			section = header[1].toLowerCase();
			subsection = header[2]?.replace(/\\(.)/g, "$1");
			const dot = header[1].indexOf(".");
			if (subsection === undefined && dot > 0) {
				rawSection = header[1].slice(0, dot);
				section = rawSection.toLowerCase();
				subsection = header[1].slice(dot + 1);
			}
			line = header[3].trim();
		}
		const keyed = /^([A-Za-z][A-Za-z0-9-]*)\s*(=\s*(.*))?$/.exec(line);
		if (!section || !keyed) continue;
		const value = keyed[2] === undefined ? "true" : parseConfigValue(keyed[3] ?? "");
		entries.push({ section, subsection, key: keyed[1].toLowerCase(), value, raw: `${rawSection}.${keyed[1]}` });
	}
	return entries;
}

// A comment ends its line even when it ends in a backslash; only code lines continue.
function logicalLines(text: string): string[] {
	const out: string[] = [];
	let pending = "";
	for (const physical of text.split(/\r?\n/)) {
		const { code, commented } = stripComment(physical);
		if (!commented && /(?:^|[^\\])(?:\\\\)*\\$/.test(code)) {
			pending += code.slice(0, -1);
			continue;
		}
		out.push(pending + code);
		pending = "";
	}
	if (pending) out.push(pending);
	return out;
}

function stripComment(line: string): { code: string; commented: boolean } {
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === "\\") i++;
		else if (char === '"') quoted = !quoted;
		else if (!quoted && (char === "#" || char === ";")) return { code: line.slice(0, i), commented: true };
	}
	return { code: line, commented: false };
}

function parseConfigValue(text: string): string {
	let out = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "\\" && i + 1 < text.length) {
			const next = text[++i];
			out += next === "n" ? "\n" : next === "t" ? "\t" : next;
		} else if (char === '"') quoted = !quoted;
		else if (!quoted && (char === "#" || char === ";")) break;
		else out += char;
	}
	return out.trim();
}

// Git status then never enters a nested repo a session staged as a gitlink, whose config could run a command outside the sandbox.
export function submoduleConfigNeeded(configText: string): Array<[string, string]> {
	const wanted: Array<{ name: string; key: string; value: string }> = [
		{ name: "diff.ignoreSubmodules", key: "ignoresubmodules", value: "all" },
		{ name: "status.submoduleSummary", key: "submodulesummary", value: "false" },
	];
	const entries = parseGitConfig(configText);
	return wanted
		.filter(({ name, key, value }) => {
			const section = name.split(".")[0];
			const last = entries.filter((e) => e.section === section && e.subsection === undefined && e.key === key).at(-1);
			return last?.value !== value;
		})
		.map(({ name, value }): [string, string] => [name, value]);
}

// Last matching entry wins, as git reads it.
export function currentConfigValue(configText: string, name: string): string | undefined {
	const [section, key] = name.toLowerCase().split(".");
	return parseGitConfig(configText)
		.filter((e) => e.section === section && e.subsection === undefined && e.key === key)
		.at(-1)?.value;
}

const MAX_INCLUDE_DEPTH = 10;

/**
 * Global git config files and every file they pull in or point at (includes, hooks,
 * attributes, excludes) become unwritable when they sit in a writable folder; a session
 * that could edit them could run commands outside the sandbox. Targets srt cannot name
 * safely, or an include that cannot be read, return `blocked` instead.
 */
export function globalGitConfigDenies(input: {
	home: string;
	xdgConfigHome?: string;
	writableRoots: readonly string[];
	repoTop?: string;
	gitConfigGlobal?: string;
	extraFiles?: readonly string[];
}): { denyWrite: string[] } | { blocked: string } {
	const { home, xdgConfigHome, repoTop } = input;
	if (input.gitConfigGlobal) {
		return { blocked: `GIT_CONFIG_GLOBAL is set (${input.gitConfigGlobal}); unset it, srt cannot protect the file it names` };
	}
	const roots = input.writableRoots.map(realOrSelf);
	const denyWrite = new Set<string>([
		realPath(path.join(home, ".gitconfig")),
		realPath(path.join(home, ".config", "git")),
		...(xdgConfigHome ? [realPath(path.join(xdgConfigHome, "git"))] : []),
	]);
	const seen = new Set<string>();
	let blocked: string | undefined;

	const visit = (file: string, depth: number): void => {
		if (blocked || seen.has(file)) return;
		seen.add(file);
		if (depth > MAX_INCLUDE_DEPTH) {
			blocked = `git config includes nest deeper than ${MAX_INCLUDE_DEPTH} at ${file}`;
			return;
		}
		let text: string;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT" && code !== "ENOTDIR") blocked = `cannot read git config ${file}: ${errorText(error)}`;
			return;
		}
		for (const entry of parseGitConfig(text)) {
			const include = entry.section === "include" || entry.section === "includeif";
			const isPath = include
				? entry.key === "path"
				: entry.section === "core" && ["hookspath", "attributesfile", "excludesfile"].includes(entry.key);
			if (!isPath || !entry.value) continue;
			const relative = !include && !path.isAbsolute(entry.value) && !entry.value.startsWith("~");
			if (relative && !repoTop) {
				blocked = `${entry.raw} in ${file} is relative and no repository top is known: ${entry.value}`;
				return;
			}
			const target = resolveConfigPath(entry.value, home, relative ? (repoTop as string) : path.dirname(file));
			if (!target || GLOB_CHARS.test(target)) {
				blocked = `${entry.raw} in ${file} cannot be protected (glob characters or ~user path): ${entry.value}`;
				return;
			}
			const real = realPath(target);
			if (roots.some((root) => isWithin(real, root))) denyWrite.add(real);
			if (include) visit(target, depth + 1);
		}
	};

	visit(path.join(home, ".gitconfig"), 0);
	visit(path.join(xdgConfigHome ?? path.join(home, ".config"), "git", "config"), 0);
	for (const file of input.extraFiles ?? []) visit(file, 0);
	return blocked ? { blocked } : { denyWrite: [...denyWrite] };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function resolveConfigPath(value: string, home: string, base: string): string | undefined {
	if (value === "~") return home;
	if (value.startsWith("~/")) return path.join(home, value.slice(2));
	if (value.startsWith("~")) return undefined;
	return path.resolve(base, value);
}

function readFirstLine(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf8").split("\n")[0].trim() || undefined;
	} catch {
		return undefined;
	}
}

// A missing component ends the walk: git creates it later as a real folder. Any other
// lstat failure counts as a symlink, so doubt adds no path.
function hasSymlinkBelow(root: string, target: string): boolean {
	let current = root;
	for (const part of path.relative(root, target).split(path.sep)) {
		current = path.join(current, part);
		try {
			if (fs.lstatSync(current).isSymbolicLink()) return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code !== "ENOENT";
		}
	}
	return false;
}

export function resolvePaths(entries: readonly string[], vars: PathVars): string[] {
	return entries.map((entry) => realPath(expand(entry, vars)));
}

function expand(entry: string, { cwd, home, tmpdir }: PathVars): string {
	const trimmed = entry.length > 1 ? entry.replace(/\/+$/, "") : entry;
	if (trimmed === "~") return home;
	if (trimmed.startsWith("~/")) return path.join(home, trimmed.slice(2));
	if (trimmed === "$TMPDIR") return path.resolve(tmpdir);
	if (trimmed.startsWith("$TMPDIR/")) return path.join(tmpdir, trimmed.slice("$TMPDIR/".length));
	return path.resolve(cwd, trimmed);
}

// Seatbelt matches real paths, so /tmp must become /private/tmp. Missing tails
// and glob names are kept as written under the nearest real ancestor.
function realPath(absolute: string): string {
	const base = path.basename(absolute);
	if (GLOB_CHARS.test(base)) return path.join(realPath(path.dirname(absolute)), base);
	let existing = absolute;
	const tail: string[] = [];
	while (!fs.existsSync(existing)) {
		const parent = path.dirname(existing);
		if (parent === existing) return absolute;
		tail.unshift(path.basename(existing));
		existing = parent;
	}
	try {
		return path.join(fs.realpathSync(existing), ...tail);
	} catch {
		// A nested sandbox may deny lstat on a file it lists; its parent still resolves.
		const parent = path.dirname(existing);
		if (parent === existing) return absolute;
		return path.join(realPath(parent), path.basename(existing), ...tail);
	}
}

function realOrSelf(target: string): string {
	try {
		return fs.realpathSync(target);
	} catch {
		return path.resolve(target);
	}
}

// Fail-closed: a broken global file throws instead of falling back to defaults.
export function loadSandboxConfig(agentDir: string): SandboxConfig {
	const file = path.join(agentDir, CONFIG_FILE_NAME);
	if (!fs.existsSync(file)) return DEFAULT_CONFIG;
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`);
	}
	return mergeConfig(DEFAULT_CONFIG, raw, file);
}

function mergeConfig(base: SandboxConfig, raw: unknown, source: string): SandboxConfig {
	const extra = asRecord(raw, source);
	const network = asRecord(extra.network ?? {}, `${source} network`);
	const filesystem = asRecord(extra.filesystem ?? {}, `${source} filesystem`);
	const union = (current: string[], value: unknown, key: string) => [
		...new Set([...current, ...asStrings(value, `${source} ${key}`)]),
	];
	return {
		network: {
			allowedDomains: union(base.network.allowedDomains, network.allowedDomains, "allowedDomains"),
			deniedDomains: union(base.network.deniedDomains, network.deniedDomains, "deniedDomains"),
		},
		filesystem: {
			denyRead: union(base.filesystem.denyRead, filesystem.denyRead, "denyRead"),
			allowWrite: union(base.filesystem.allowWrite, filesystem.allowWrite, "allowWrite"),
			denyWrite: union(base.filesystem.denyWrite, filesystem.denyWrite, "denyWrite"),
		},
	};
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function asStrings(value: unknown, label: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
		throw new Error(`${label} must be a list of non-empty strings`);
	}
	return value;
}

export interface SettingsInput extends PathVars {
	settingsDir: string;
	uid: number;
	cmuxSocket: string | undefined;
	envNames: readonly string[];
}

export interface SrtSettings {
	network: SandboxConfig["network"] & { strictAllowlist: true; allowUnixSockets: string[] };
	filesystem: SandboxConfig["filesystem"];
	credentials: {
		files: Array<{ path: string; mode: "deny" }>;
		envVars: Array<{ name: string; mode: "deny" }>;
	};
}

export function buildSrtSettings(config: SandboxConfig, input: SettingsInput): SrtSettings {
	const resolve = (entries: readonly string[]) => resolvePaths(entries, input);
	// tsx opens an IPC socket in <tmpdir>/tsx-<uid>; only that folder may bind sockets.
	const sockets = [
		...(input.cmuxSocket ? [input.cmuxSocket] : []),
		path.join(realOrSelf(input.tmpdir), `tsx-${input.uid}`),
	];
	return {
		network: {
			allowedDomains: [...config.network.allowedDomains],
			deniedDomains: [...config.network.deniedDomains],
			strictAllowlist: true,
			allowUnixSockets: sockets,
		},
		filesystem: {
			denyRead: resolve(config.filesystem.denyRead),
			allowWrite: resolve(config.filesystem.allowWrite),
			denyWrite: [...resolve(config.filesystem.denyWrite), input.settingsDir],
		},
		credentials: {
			// srt rejects "mask" without network credential injection, and on macOS mask is a deny anyway.
			files: [{ path: resolve([NPM_TOKEN_FILE])[0], mode: "deny" }],
			envVars: input.envNames.map((name) => ({ name, mode: "deny" as const })),
		},
	};
}
