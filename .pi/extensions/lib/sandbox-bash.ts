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
	const roots = writableRoots.map(realOrSelf);
	for (const dir of pathVar.split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, "srt");
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
