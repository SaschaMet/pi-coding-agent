// Never runs git: git follows the very pointers this script checks, so it reads files only.
// Fails closed: any doubt becomes a `bad` line and a non-zero exit.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { checkGitPointers } from "../.pi/extensions/lib/git-worktree.ts";

const args = process.argv.slice(2);
if (args.length !== 1) {
	process.stderr.write("usage: tsx scripts/git-pointer-check.ts <main checkout>\n");
	process.exit(2);
}

const main = args[0];
const problems = checkGitPointers(main);
if (problems.length > 0) {
	process.stdout.write(`${problems.join("\n")}\n`);
	process.exit(1);
}

let count = 0;
try {
	count = fs.readdirSync(path.join(main, ".git", "worktrees")).length;
} catch {
	// no worktrees directory means no linked worktrees
}
process.stdout.write(`ok ${count} worktrees\n`);
