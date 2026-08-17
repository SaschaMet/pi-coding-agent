/**
 * Refresh the vendored `avoid-ai-writing` skill from upstream
 * (https://github.com/conorbronsdon/avoid-ai-writing).
 *
 * Pi needs only SKILL.md plus the support files it references at runtime.
 * The rest of the upstream repo (corpus, CI, plugin/cursor wrappers, tests)
 * is dev tooling and is intentionally not copied.
 *
 * Usage: npm run pi:refresh-skill
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = "https://github.com/conorbronsdon/avoid-ai-writing";
const BRANCH = "main";
const ZIP_URL = `${REPO}/archive/refs/heads/${BRANCH}.zip`;

/** Minimal runtime file set, relative to the upstream repo root. */
const FILES_TO_COPY: string[] = [
	"SKILL.md",
	"LICENSE",
	// Upstream package.json has no "type" field, so its .js files stay CommonJS
	// (our repo root is "type": "module"); SKILL.md references them as scripts/*.js.
	"package.json",
	"detector/CATEGORIES.md",
	"detector/patterns.js",
	"detector/validate.js",
	"scripts/check-style.js",
	"examples/README.md",
	"examples/prose.json",
	"examples/technical.json",
];

const DEST_DIR = path.resolve(
	process.cwd(),
	".pi",
	"skills",
	"avoid-ai-writing",
);

function fail(message: string): never {
	console.error(`refresh-avoid-ai-writing: ${message}`);
	process.exit(1);
}

function downloadZip(zipPath: string): void {
	execFileSync("curl", ["-sSL", "-f", "-m", "120", "-o", zipPath, ZIP_URL], {
		stdio: ["ignore", "ignore", "pipe"],
	});
	if (fs.statSync(zipPath).size === 0) {
		fail(`downloaded zip is empty: ${ZIP_URL}`);
	}
}

function extractZip(zipPath: string, destDir: string): string {
	fs.mkdirSync(destDir, { recursive: true });
	execFileSync("unzip", ["-q", zipPath, "-d", destDir], {
		stdio: ["ignore", "ignore", "pipe"],
	});
	const entries = fs
		.readdirSync(destDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory());
	if (entries.length !== 1) {
		fail(
			`expected exactly one extracted directory, found: ${entries.map((e) => e.name).join(", ") || "(none)"}`,
		);
	}
	return path.join(destDir, entries[0].name);
}

function copyFileSet(srcRoot: string, destDir: string): void {
	for (const relPath of FILES_TO_COPY) {
		const src = path.join(srcRoot, relPath);
		if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
			fail(`expected file missing from upstream (layout changed?): ${relPath}`);
		}
		const dest = path.join(destDir, relPath);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(src, dest);
	}
}

function readVersion(skillPath: string): string | undefined {
	const text = fs.readFileSync(skillPath, "utf8");
	const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!frontmatter) return undefined;
	const version = frontmatter[1].match(/^version:\s*(.+)$/m);
	return version ? version[1].trim() : undefined;
}

function main(): void {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "avoid-ai-writing-"));
	try {
		const zipPath = path.join(tmpDir, "repo.zip");
		const extractDir = path.join(tmpDir, "extracted");
		console.log(`Downloading ${ZIP_URL} ...`);
		downloadZip(zipPath);
		const srcRoot = extractZip(zipPath, extractDir);
		copyFileSet(srcRoot, DEST_DIR);
		const version = readVersion(path.join(DEST_DIR, "SKILL.md"));
		console.log(
			`Updated .pi/skills/avoid-ai-writing (${FILES_TO_COPY.length} files, upstream version ${version ?? "unknown"}, branch ${BRANCH}).`,
		);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

main();
