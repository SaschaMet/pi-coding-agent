import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// A dot-led segment is excluded so ".." can never pass as a name.
export const WORKTREE_BRANCH = /^(handsoff|hill-climb)(\/(?!\.)[A-Za-z0-9._-]+)+$/;

// git runs outside the sandbox: a planted fsmonitor command or hook must not run.
export const SAFE_GIT_ARGS = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

const BASE_REF = /^[A-Za-z0-9._/~^@{}-]+$/;
const GIT_TIMEOUT_MS = 120_000;
const PARAM_KEYS = new Set(["action", "path", "branch", "base"]);

export interface WorktreeParams {
	action: "add" | "remove";
	path: string;
	branch?: string;
	base?: string;
}

export interface WorktreeResult {
	ok: boolean;
	refused?: string[];
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	gitArgs?: string[];
}

export interface WorktreeOptions {
	cwd: string;
	realGit: string;
	env?: NodeJS.ProcessEnv;
}

function bad(target: string, reason: string): string {
	return `bad ${target}: ${reason}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function lstatOrNone(target: string): fs.Stats | undefined {
	try {
		return fs.lstatSync(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function realpath(target: string): string {
	return fs.realpathSync.native(target);
}

function samePath(a: string, b: string): boolean {
	try {
		return realpath(a) === realpath(b);
	} catch {
		return false;
	}
}

function isInside(child: string, parent: string): boolean {
	return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

function readText(file: string, problems: string[]): string | undefined {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		problems.push(bad(file, `unreadable (${errorMessage(error)})`));
		return undefined;
	}
}

/**
 * File reads only, never git: git itself follows these pointers, so they are checked
 * before any git command runs. Every doubt becomes a `bad` line and nothing throws.
 */
export function checkGitPointers(mainCheckout: string): string[] {
	const problems: string[] = [];
	try {
		inspect(mainCheckout, problems);
	} catch (error) {
		problems.push(bad(mainCheckout, `cannot be inspected (${errorMessage(error)})`));
	}
	return problems;
}

function inspect(mainCheckout: string, problems: string[]): void {
	const main = realpath(mainCheckout);
	const common = path.join(main, ".git");
	if (!fs.lstatSync(common).isDirectory()) {
		problems.push(bad(common, "not a real directory"));
		return;
	}
	const commonReal = realpath(common);
	for (const name of ["commondir", "config.worktree", "modules"]) {
		if (lstatOrNone(path.join(common, name))) problems.push(bad(path.join(common, name), "must not exist"));
	}
	const roots = [main];
	const registered = new Set<string>();
	const records = path.join(common, "worktrees");
	const recordsStat = lstatOrNone(records);
	if (recordsStat && !recordsStat.isDirectory()) {
		problems.push(bad(records, "not a real directory"));
	} else if (recordsStat) {
		for (const id of fs.readdirSync(records)) {
			const worktree = checkRecord(path.join(records, id), commonReal, problems);
			if (worktree) {
				registered.add(worktree);
				roots.push(worktree);
			}
		}
	}
	for (const root of roots) walk(root, root, registered, problems);
}

function checkRecord(record: string, commonReal: string, problems: string[]): string | undefined {
	if (!lstatOrNone(record)?.isDirectory()) {
		problems.push(bad(record, "not a real directory"));
		return undefined;
	}
	if (lstatOrNone(path.join(record, "config.worktree"))) {
		problems.push(bad(path.join(record, "config.worktree"), "must not exist"));
	}
	const commondirFile = path.join(record, "commondir");
	const commondir = readText(commondirFile, problems);
	if (commondir !== undefined && !samePath(path.resolve(record, commondir.trim()), commonReal)) {
		problems.push(bad(commondirFile, "does not point at the common dir"));
	}
	const gitdirFile = path.join(record, "gitdir");
	const gitdir = readText(gitdirFile, problems);
	if (gitdir === undefined) return undefined;
	const pointerTarget = path.resolve(record, gitdir.trim());
	if (path.basename(pointerTarget) !== ".git") {
		problems.push(bad(gitdirFile, "does not name a .git file"));
		return undefined;
	}
	const worktree = path.dirname(pointerTarget);
	if (!lstatOrNone(worktree)?.isDirectory()) {
		problems.push(bad(gitdirFile, `worktree folder gone: ${worktree}`));
		return undefined;
	}
	const pointer = path.join(worktree, ".git");
	if (!lstatOrNone(pointer)?.isFile()) {
		problems.push(bad(pointer, `not a regular file (named by ${gitdirFile})`));
		return realpath(worktree);
	}
	const text = readText(pointer, problems);
	const match = text === undefined ? null : /^gitdir: (.+?)\s*$/.exec(text);
	if (text !== undefined && !match) problems.push(bad(pointer, `not a gitdir pointer (named by ${gitdirFile})`));
	else if (match && !samePath(path.resolve(worktree, match[1]), record)) {
		problems.push(bad(pointer, `does not point at its record (named by ${gitdirFile})`));
	}
	return realpath(worktree);
}

// Other worktree roots are walked as their own roots; symlinks are never followed.
function walk(dir: string, root: string, registered: Set<string>, problems: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		problems.push(bad(dir, "unreadable folder"));
		return;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.name.toLowerCase() === ".git") {
			if (full !== path.join(root, ".git")) problems.push(bad(full, "nested repo"));
			continue;
		}
		if (entry.name === "node_modules" || !entry.isDirectory() || registered.has(full)) continue;
		walk(full, root, registered, problems);
	}
}

function checkBranch(branch: string): string | undefined {
	if (branch.startsWith("-")) return `branch ${branch} must not start with "-"`;
	if (branch.includes("..")) return `branch ${branch} must not contain ".."`;
	for (const segment of branch.split("/")) {
		if (segment.startsWith(".") || segment.endsWith(".lock")) return `branch ${branch} has an invalid segment`;
	}
	if (!WORKTREE_BRANCH.test(branch)) return `branch ${branch} must match handsoff/<name> or hill-climb/<name>`;
	return undefined;
}

function parseParams(params: unknown): WorktreeParams | string {
	if (typeof params !== "object" || params === null || Array.isArray(params)) return "params must be an object";
	const record = params as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!PARAM_KEYS.has(key)) return `unknown field ${key}`;
	}
	if (record.action !== "add" && record.action !== "remove") return 'action must be "add" or "remove"';
	if (typeof record.path !== "string" || record.path.length === 0) return "path must be a non-empty string";
	for (const key of ["branch", "base"]) {
		if (record[key] !== undefined && typeof record[key] !== "string") return `${key} must be a string`;
	}
	for (const value of Object.values(record)) {
		if (typeof value === "string" && value.includes("\0")) return "values must not contain NUL";
	}
	return {
		action: record.action,
		path: record.path,
		branch: record.branch as string | undefined,
		base: record.base as string | undefined,
	};
}

function guessMainCheckout(cwd: string): string | undefined {
	try {
		for (let dir = realpath(cwd); ; dir = path.dirname(dir)) {
			const stat = lstatOrNone(path.join(dir, ".git"));
			if (stat?.isDirectory()) return dir;
			if (stat?.isFile()) {
				const match = /^gitdir: (.+?)\s*$/.exec(fs.readFileSync(path.join(dir, ".git"), "utf8"));
				if (!match) return undefined;
				const common = path.dirname(path.dirname(path.resolve(dir, match[1])));
				return path.basename(common) === ".git" ? path.dirname(common) : undefined;
			}
			if (path.dirname(dir) === dir) return undefined;
		}
	} catch {
		return undefined;
	}
}

function refuse(...lines: string[]): WorktreeResult {
	return { ok: false, refused: lines };
}

export function runGitWorktree(params: unknown, options: WorktreeOptions): WorktreeResult {
	try {
		return execute(params, options);
	} catch (error) {
		return refuse(`unexpected failure: ${errorMessage(error)}`);
	}
}

function execute(rawParams: unknown, { cwd, realGit, env }: WorktreeOptions): WorktreeResult {
	const parsed = parseParams(rawParams);
	if (typeof parsed === "string") return refuse(parsed);
	const params = parsed;
	if (!path.isAbsolute(realGit)) return refuse("git path must be absolute");

	const gitEnv: NodeJS.ProcessEnv = { ...(env ?? process.env), GIT_CONFIG_NOSYSTEM: "1" };
	for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete gitEnv[name];
	const git = (args: string[]) =>
		spawnSync(realGit, [...SAFE_GIT_ARGS, ...args], { cwd, env: gitEnv, encoding: "utf8", timeout: GIT_TIMEOUT_MS });

	const revParse = git(["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
	const lines = revParse.status === 0 ? revParse.stdout.replace(/\n$/, "").split("\n") : [];
	if (lines.length !== 2) {
		// A planted pointer can make git itself fail, so name it instead of hiding it.
		const guess = guessMainCheckout(cwd);
		const problems = guess ? checkGitPointers(guess) : [];
		return problems.length > 0 ? { ok: false, refused: problems } : refuse("main checkout cannot be determined");
	}
	const common = realpath(lines[0]);
	if (path.basename(common) !== ".git" || !fs.lstatSync(common).isDirectory()) {
		return refuse("main checkout cannot be determined");
	}
	const main = path.dirname(common);
	const top = realpath(lines[1]);

	const pointerProblems = checkGitPointers(main);
	if (pointerProblems.length > 0) return { ok: false, refused: pointerProblems };

	const list = git(["worktree", "list", "--porcelain"]);
	if (list.status !== 0) return refuse("worktree list failed");
	const registered = new Set<string>();
	for (const line of list.stdout.split("\n")) {
		if (!line.startsWith("worktree ")) continue;
		try {
			const real = realpath(line.slice("worktree ".length));
			if (real !== main) registered.add(real);
		} catch {
			// A folder that is gone cannot be a target.
		}
	}
	const owners = [main];
	if (top !== main && registered.has(top)) owners.push(top);

	const finish = (args: string[]): WorktreeResult => {
		const result = git(args);
		if (result.error) return refuse(`git failed to run: ${result.error.message}`);
		return {
			ok: result.status === 0,
			exitCode: result.status ?? undefined,
			stdout: result.stdout,
			stderr: result.stderr,
			gitArgs: [...SAFE_GIT_ARGS, ...args],
		};
	};

	if (params.action === "remove") {
		const target = realpath(path.resolve(cwd, params.path));
		if (!registered.has(target)) return refuse(`${target} is not a registered worktree`);
		if (!owners.some((owner) => isInside(target, path.join(owner, ".worktrees")))) {
			return refuse(`${target} is not under an allowed .worktrees folder`);
		}
		const here = realpath(cwd);
		if (here === target || isInside(here, target)) return refuse("cannot remove the worktree this session runs in");
		return finish(["worktree", "remove", "--", target]);
	}

	const branch = params.branch;
	if (!branch) return refuse("branch is required for add");
	const branchProblem = checkBranch(branch);
	if (branchProblem) return refuse(branchProblem);
	if (git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0) {
		return refuse(`branch ${branch} already exists`);
	}
	const base = params.base ?? "HEAD";
	if (base.startsWith("-") || !BASE_REF.test(base)) return refuse(`base ${base} is not an allowed ref`);
	const resolved = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
	if (resolved.status !== 0) return refuse(`base ${base} does not resolve to a commit`);
	const sha = resolved.stdout.trim();

	if (params.path.split(/[\\/]/).includes("..")) return refuse('path must not contain ".."');
	const target = path.resolve(cwd, params.path);
	const container = [...owners, ...registered]
		.filter((owner) => isInside(target, owner))
		.sort((a, b) => b.length - a.length)[0];
	if (!container || !owners.includes(container)) return refuse(`${target} is inside another worktree`);
	const root = path.join(container, ".worktrees");
	if (!isInside(target, root)) return refuse(`${target} must be inside ${root}`);

	const chain = [root];
	for (const part of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
		chain.push(path.join(chain[chain.length - 1], part));
	}
	for (const dir of chain) {
		const stat = lstatOrNone(dir);
		if (!stat) break;
		if (!stat.isDirectory()) return refuse(`${dir} is not a real folder`);
	}
	if (lstatOrNone(target)) return refuse(`${target} already exists`);

	fs.mkdirSync(path.dirname(target), { recursive: true });
	// A sandboxed process can swap a folder for a symlink between the check and mkdir, and this git runs outside the sandbox.
	if (realpath(path.dirname(target)) !== path.dirname(target) || lstatOrNone(target)) {
		return refuse(`${path.dirname(target)} changed while the tool ran`);
	}
	const added = finish(["worktree", "add", "-b", branch, "--", target, sha]);
	if (!added.ok) return added;
	// A parallel process can swap the new folder for a symlink while git runs.
	let landed: string | undefined;
	try {
		landed = realpath(target);
	} catch {
		landed = undefined;
	}
	if (landed !== target) return { ...added, ok: false, refused: [`${target} moved while git ran`] };
	return added;
}
