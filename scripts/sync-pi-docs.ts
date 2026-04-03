import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SOURCE_PACKAGE_NAME = "@mariozechner/pi-coding-agent";
const SOURCE_ROOT = path.join(process.cwd(), "node_modules", SOURCE_PACKAGE_NAME);
const TARGET_ROOT = path.join(process.cwd(), "docs", "vendor", "pi-coding-agent");
const METADATA_FILE = path.join(TARGET_ROOT, "sync-metadata.json");

function listFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };
  walk(root);
  return files.sort();
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function copyFileIfChanged(source: string, target: string): void {
  const sourceContent = fs.readFileSync(source);
  if (fs.existsSync(target)) {
    const existingContent = fs.readFileSync(target);
    if (sourceContent.equals(existingContent)) {
      return;
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sourceContent);
}

function removeStaleFiles(targetRoot: string, expectedFiles: Set<string>): void {
  const existingFiles = listFilesRecursive(targetRoot);
  const staleFiles = existingFiles.filter((filePath) => !expectedFiles.has(path.resolve(filePath)));
  for (const staleFile of staleFiles) {
    fs.rmSync(staleFile, { force: true });
  }

  const allDirs = new Set<string>();
  for (const filePath of listFilesRecursive(targetRoot)) {
    let current = path.dirname(filePath);
    while (current.startsWith(targetRoot)) {
      allDirs.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  const dirs = Array.from(allDirs).sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    if (dir === targetRoot) continue;
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  }
}

function collectSourceFiles(): Array<{ source: string; target: string }> {
  const mappings: Array<{ source: string; target: string }> = [];

  mappings.push({
    source: path.join(SOURCE_ROOT, "README.md"),
    target: path.join(TARGET_ROOT, "README.md"),
  });

  const docsDir = path.join(SOURCE_ROOT, "docs");
  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    mappings.push({
      source: path.join(docsDir, entry.name),
      target: path.join(TARGET_ROOT, "docs", entry.name),
    });
  }

  const extensionsDir = path.join(SOURCE_ROOT, "examples", "extensions");
  for (const sourceFile of listFilesRecursive(extensionsDir)) {
    const relative = path.relative(extensionsDir, sourceFile);
    mappings.push({
      source: sourceFile,
      target: path.join(TARGET_ROOT, "examples", "extensions", relative),
    });
  }

  return mappings.sort((a, b) => a.target.localeCompare(b.target));
}

function readSourceVersion(): string {
  const packageJsonPath = path.join(SOURCE_ROOT, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version?: string };
  return packageJson.version ?? "unknown";
}

function computeSyncedAtIso(sourceFiles: string[]): string {
  let maxMtimeMs = 0;
  for (const sourceFile of sourceFiles) {
    const stats = fs.statSync(sourceFile);
    if (stats.mtimeMs > maxMtimeMs) {
      maxMtimeMs = stats.mtimeMs;
    }
  }

  if (maxMtimeMs === 0) {
    maxMtimeMs = Date.parse("1970-01-01T00:00:00.000Z");
  }

  return new Date(maxMtimeMs).toISOString();
}

function main(): void {
  if (!fs.existsSync(SOURCE_ROOT)) {
    throw new Error(`Source package path not found: ${SOURCE_ROOT}`);
  }

  const mappings = collectSourceFiles();
  for (const { source } of mappings) {
    if (!fs.existsSync(source)) {
      throw new Error(`Required source file missing: ${source}`);
    }
  }

  for (const { source, target } of mappings) {
    copyFileIfChanged(source, target);
  }

  const syncedAt = computeSyncedAtIso(mappings.map((entry) => entry.source));
  const metadata = {
    sourcePackage: SOURCE_PACKAGE_NAME,
    sourceVersion: readSourceVersion(),
    syncedAt,
    files: mappings.map((entry) => toPosix(path.relative(TARGET_ROOT, entry.target))),
  };

  fs.mkdirSync(TARGET_ROOT, { recursive: true });
  fs.writeFileSync(METADATA_FILE, `${JSON.stringify(metadata, null, 2)}\n`);

  const expectedFiles = new Set<string>([
    ...mappings.map((entry) => path.resolve(entry.target)),
    path.resolve(METADATA_FILE),
  ]);
  removeStaleFiles(TARGET_ROOT, expectedFiles);

  console.log(`Synced ${mappings.length} files from ${SOURCE_PACKAGE_NAME}@${metadata.sourceVersion}`);
  console.log(`Target: ${TARGET_ROOT}`);
}

main();
