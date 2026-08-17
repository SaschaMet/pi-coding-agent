import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export type Mode = "pull" | "push";
type JsonObject = Record<string, unknown>;

const EXCLUDED_TOP_LEVEL_PATHS = new Set([
	"auth.json",
	"sessions",
	"npm",
	"models.json",
	"trust.json",
	"AGENTS.md",
]);
// Extension directories containing this marker file are considered
// system-managed and will be pruned from local during sync.
// User-created directories without the marker are left intact.
// See scripts/sync-pi-config.md for details.
const MANAGED_EXTENSION_MARKER = ".pi-managed";
const SETTINGS_RELATIVE_PATH = "settings.json";
const MCP_RELATIVE_PATH = "mcp.json";
const EXTENSIONS_RELATIVE_PATH = "extensions";

function resolveGlobalAgentDir(): string {
	const fromEnv = process.env.PI_CODING_AGENT_DIR?.trim();
	if (fromEnv) return path.resolve(fromEnv);
	return path.join(os.homedir(), ".pi", "agent");
}

function resolveClaudeConfigDir(): string {
	return path.join(os.homedir(), ".claude");
}

const SYSTEM_MD_RELATIVE_PATH = ".pi/SYSTEM.md";
const CLAUDE_MD_FILENAME = "CLAUDE.md";

export function copySystemMdToClaudeMd(projectRoot: string): boolean {
	const sourcePath = path.join(projectRoot, SYSTEM_MD_RELATIVE_PATH);
	if (!fs.existsSync(sourcePath)) return false;

	const claudeDir = resolveClaudeConfigDir();
	ensureDir(claudeDir);
	const targetPath = path.join(claudeDir, CLAUDE_MD_FILENAME);

	const sourceBuf = fs.readFileSync(sourcePath);

	if (fs.existsSync(targetPath)) {
		const targetBuf = fs.readFileSync(targetPath);
		if (sourceBuf.equals(targetBuf)) return false;
	}

	fs.writeFileSync(targetPath, sourceBuf);
	return true;
}

function parseMode(argv: string[]): Mode {
	const mode = argv[2] as Mode | undefined;
	if (!mode || (mode !== "pull" && mode !== "push")) {
		throw new Error("Usage: tsx scripts/sync-pi-config.ts <pull|push>");
	}
	return mode;
}

function ensureDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

function isManagedRelativePath(relativePath: string): boolean {
	const normalized = relativePath.split(path.sep).join("/");
	if (!normalized) return false;
	if (path.posix.basename(normalized) === ".DS_Store") return false;

	const topLevel = normalized.split("/")[0];
	return !EXCLUDED_TOP_LEVEL_PATHS.has(topLevel);
}

function listRelativeFilesRecursive(root: string): string[] {
	if (!fs.existsSync(root)) return [];
	const files: string[] = [];

	const walk = (relativeDir: string) => {
		const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;

		for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
			const relativePath = relativeDir
				? path.posix.join(relativeDir.split(path.sep).join("/"), entry.name)
				: entry.name;

			if (!isManagedRelativePath(relativePath)) continue;

			if (entry.isDirectory()) {
				walk(relativePath);
				continue;
			}

			if (entry.isFile()) {
				files.push(relativePath);
			}
		}
	};

	walk("");
	return files.sort();
}

function getExtensionDirectoryName(relativePath: string): string | undefined {
	const normalized = relativePath.split(path.sep).join("/");
	const parts = normalized.split("/");
	if (parts.length < 3 || parts[0] !== EXTENSIONS_RELATIVE_PATH)
		return undefined;
	return parts[1];
}

function isExtensionsRelativePath(relativePath: string): boolean {
	const normalized = relativePath.split(path.sep).join("/");
	return (
		normalized === EXTENSIONS_RELATIVE_PATH ||
		normalized.startsWith(`${EXTENSIONS_RELATIVE_PATH}/`)
	);
}

function listExtensionDirectoryNames(root: string): Set<string> {
	const extensionsRoot = path.join(root, EXTENSIONS_RELATIVE_PATH);
	if (!fs.existsSync(extensionsRoot)) return new Set();

	return new Set(
		fs
			.readdirSync(extensionsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name),
	);
}

function removePulledGlobalExtensionDirectories(
	files: string[],
	globalAgentDir: string,
): string[] {
	const globalExtensionDirectories = listExtensionDirectoryNames(globalAgentDir);
	if (globalExtensionDirectories.size === 0) return files;

	return files.filter((relativePath) => {
		const extensionDirectory = getExtensionDirectoryName(relativePath);
		return (
			extensionDirectory === undefined ||
			!globalExtensionDirectories.has(extensionDirectory)
		);
	});
}

function parseObjectJson(text: string): JsonObject | undefined {
	try {
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return undefined;
		return parsed as JsonObject;
	} catch {
		return undefined;
	}
}

function parseNpmPackageName(spec: string): string | undefined {
	if (!spec.startsWith("npm:")) return undefined;

	const raw = spec.slice(4);
	if (!raw) return undefined;

	const atIndex = raw.lastIndexOf("@");
	if (atIndex <= 0) return raw;
	return raw.slice(0, atIndex);
}

function mergePackages(
	sourcePackages: string[],
	targetPackages: string[],
): string[] {
	const merged: string[] = [];
	const addExact = (value: string) => {
		if (!merged.includes(value)) merged.push(value);
	};

	for (const sourceValue of sourcePackages) addExact(sourceValue);

	for (const targetValue of targetPackages) {
		const targetName = parseNpmPackageName(targetValue);
		if (!targetName) {
			addExact(targetValue);
			continue;
		}

		const existingByNameIndex = merged.findIndex(
			(candidate) => parseNpmPackageName(candidate) === targetName,
		);
		if (existingByNameIndex === -1) {
			addExact(targetValue);
			continue;
		}

		merged[existingByNameIndex] = targetValue;
	}

	return merged;
}

function mergeSettingsPackages(
	sourceBuf: Buffer,
	targetBuf: Buffer,
): Buffer | undefined {
	const sourceJson = parseObjectJson(sourceBuf.toString("utf-8"));
	const targetJson = parseObjectJson(targetBuf.toString("utf-8"));
	if (!sourceJson || !targetJson) return undefined;

	const sourcePackages = Array.isArray(sourceJson.packages)
		? sourceJson.packages.filter((v): v is string => typeof v === "string")
		: [];
	const targetPackages = Array.isArray(targetJson.packages)
		? targetJson.packages.filter((v): v is string => typeof v === "string")
		: [];

	sourceJson.packages = mergePackages(sourcePackages, targetPackages);
	return Buffer.from(`${JSON.stringify(sourceJson, null, 2)}\n`, "utf-8");
}

function getJsonObjectProperty(
	json: JsonObject,
	property: string,
): JsonObject | undefined {
	const value = json[property];
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as JsonObject;
}

function mergeMcpServers(
	sourceBuf: Buffer,
	targetBuf: Buffer,
): Buffer | undefined {
	const sourceJson = parseObjectJson(sourceBuf.toString("utf-8"));
	const targetJson = parseObjectJson(targetBuf.toString("utf-8"));
	if (!sourceJson || !targetJson) return undefined;

	const sourceServers = getJsonObjectProperty(sourceJson, "mcpServers");
	const targetServers = getJsonObjectProperty(targetJson, "mcpServers");
	if (!sourceServers || !targetServers) return undefined;

	sourceJson.mcpServers = { ...sourceServers, ...targetServers };
	return Buffer.from(`${JSON.stringify(sourceJson, null, 2)}\n`, "utf-8");
}

function copyFileIfChanged(
	source: string,
	target: string,
	relativePath: string,
): boolean {
	const sourceBuf = fs.readFileSync(source);
	let outputBuf: Buffer<ArrayBufferLike> = sourceBuf;

	if (fs.existsSync(target)) {
		const targetBuf = fs.readFileSync(target);
		if (relativePath === SETTINGS_RELATIVE_PATH) {
			const mergedSettings = mergeSettingsPackages(sourceBuf, targetBuf);
			if (mergedSettings) outputBuf = mergedSettings;
		}
		if (relativePath === MCP_RELATIVE_PATH) {
			const mergedMcp = mergeMcpServers(sourceBuf, targetBuf);
			if (mergedMcp) outputBuf = mergedMcp;
		}
		if (outputBuf.equals(targetBuf)) return false;
	}

	ensureDir(path.dirname(target));
	fs.writeFileSync(target, outputBuf);
	return true;
}

function removeFileIfExists(filePath: string): boolean {
	if (!fs.existsSync(filePath)) return false;
	fs.rmSync(filePath);
	return true;
}

function removeDirectoryIfExists(dirPath: string): boolean {
	if (!fs.existsSync(dirPath)) return false;
	fs.rmSync(dirPath, { recursive: true, force: true });
	return true;
}

function isPreservedTargetOnlyRelativePath(
	mode: Mode,
	relativePath: string,
): boolean {
	if (mode === "pull" && isExtensionsRelativePath(relativePath)) return true;
	if (mode === "push" && getExtensionDirectoryName(relativePath) !== undefined)
		return true;
	return relativePath === MCP_RELATIVE_PATH;
}

function isManagedExtensionDir(dirPath: string): boolean {
	return fs.existsSync(path.join(dirPath, MANAGED_EXTENSION_MARKER));
}

function pruneLocalExtensionDirectoriesThatExistGlobally(
	localPiDir: string,
	globalAgentDir: string,
): string[] {
	const globalExtensionDirectories = listExtensionDirectoryNames(globalAgentDir);
	if (globalExtensionDirectories.size === 0) return [];

	const removed: string[] = [];
	for (const extensionName of globalExtensionDirectories) {
		const globalExtPath = path.join(
			globalAgentDir,
			EXTENSIONS_RELATIVE_PATH,
			extensionName,
		);
		if (!isManagedExtensionDir(globalExtPath)) continue;

		const localExtensionDir = path.join(
			localPiDir,
			EXTENSIONS_RELATIVE_PATH,
			extensionName,
		);
		const relativeDir = `${EXTENSIONS_RELATIVE_PATH}/${extensionName}`;
		if (removeDirectoryIfExists(localExtensionDir)) removed.push(relativeDir);
	}

	pruneEmptyManagedDirectories(localPiDir);
	return removed;
}

function pruneEmptyManagedDirectories(root: string, relativeDir = ""): void {
	const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;
	if (!fs.existsSync(absoluteDir)) return;

	for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;

		const childRelative = relativeDir
			? path.posix.join(relativeDir.split(path.sep).join("/"), entry.name)
			: entry.name;

		if (!isManagedRelativePath(childRelative)) continue;
		pruneEmptyManagedDirectories(root, childRelative);
	}

	if (!relativeDir) return;

	if (fs.readdirSync(absoluteDir).length === 0) {
		fs.rmdirSync(absoluteDir);
	}
}

export function syncManagedPiDirectory(
	mode: Mode,
	localPiDir: string,
	globalAgentDir: string,
): {
	updated: string[];
	deleted: string[];
	directoriesRemoved: string[];
} {
	const sourceRoot = mode === "push" ? localPiDir : globalAgentDir;
	const targetRoot = mode === "push" ? globalAgentDir : localPiDir;
	ensureDir(targetRoot);
	const directoriesRemoved = pruneLocalExtensionDirectoriesThatExistGlobally(
		localPiDir,
		globalAgentDir,
	);

	const sourceFiles =
		mode === "pull"
			? removePulledGlobalExtensionDirectories(
					listRelativeFilesRecursive(sourceRoot),
					globalAgentDir,
				)
			: listRelativeFilesRecursive(sourceRoot);
	const sourceSet = new Set(sourceFiles);

	const updated: string[] = [];
	for (const relativePath of sourceFiles) {
		const sourcePath = path.join(sourceRoot, relativePath);
		const targetPath = path.join(targetRoot, relativePath);
		if (copyFileIfChanged(sourcePath, targetPath, relativePath))
			updated.push(relativePath);
	}

	const deleted: string[] = [];
	for (const targetRelativePath of listRelativeFilesRecursive(targetRoot)) {
		if (sourceSet.has(targetRelativePath)) continue;
		if (isPreservedTargetOnlyRelativePath(mode, targetRelativePath)) continue;
		const targetPath = path.join(targetRoot, targetRelativePath);
		if (removeFileIfExists(targetPath)) deleted.push(targetRelativePath);
	}

	pruneEmptyManagedDirectories(targetRoot);

	return { updated, deleted, directoriesRemoved };
}

export function main(): void {
	const mode = parseMode(process.argv);
	const projectRoot = process.cwd();
	const localPiDir = path.join(projectRoot, ".pi");
	const globalAgentDir = resolveGlobalAgentDir();

	if (!fs.existsSync(localPiDir)) {
		throw new Error(`Local .pi directory not found: ${localPiDir}`);
	}

	ensureDir(globalAgentDir);

	console.log(
		`Sync start: mode=${mode} local=${localPiDir} global=${globalAgentDir}`,
	);
	const result = syncManagedPiDirectory(mode, localPiDir, globalAgentDir);

	console.log(`Mode: ${mode}`);
	console.log(`Local: ${localPiDir}`);
	console.log(`Global: ${globalAgentDir}`);

	if (result.directoriesRemoved.length > 0) {
		console.log(`\nDirectories removed (${result.directoriesRemoved.length}):`);
		for (const dir of result.directoriesRemoved) {
			console.log(`  - ${dir}`);
		}
	}

	if (result.updated.length > 0) {
		console.log(`\nUpdated files (${result.updated.length}):`);
		for (const file of result.updated) {
			console.log(`  - ${file}`);
		}
	}

	if (result.deleted.length > 0) {
		console.log(`\nDeleted files (${result.deleted.length}):`);
		for (const file of result.deleted) {
			console.log(`  - ${file}`);
		}
	}

	if (
		result.directoriesRemoved.length === 0 &&
		result.updated.length === 0 &&
		result.deleted.length === 0
	) {
		console.log("No changes.");
	}

	if (copySystemMdToClaudeMd(projectRoot)) {
		console.log(
			`Copied SYSTEM.md -> ${resolveClaudeConfigDir()}/${CLAUDE_MD_FILENAME}`,
		);
	} else {
		console.log("SYSTEM.md -> CLAUDE.md: no changes.");
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
