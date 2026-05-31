import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MUTATING_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch", "create_file", "rename", "delete"]);
const READ_ENV_TOOLS = new Set(["read", "grep", "glob", "find", "ls"]);
const MUTATE_ENV_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch", "create_file", "rename", "delete"]);
const BASH_TOOLS = new Set(["bash"]);

const TOOL_ALIASES = new Map([
  ["read", "read"],
  ["write", "write"],
  ["edit", "edit"],
  ["multiedit", "multiedit"],
  ["applypatch", "apply_patch"],
  ["createfile", "create_file"],
  ["rename", "rename"],
  ["delete", "delete"],
  ["bash", "bash"],
  ["runinterminal", "bash"],
  ["grep", "grep"],
  ["glob", "glob"],
  ["find", "find"],
  ["ls", "ls"],
]);

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function normalizeEventName(eventName) {
  const key = String(eventName).replace(/[-_\s]/g, "").toLowerCase();
  if (key === "pretooluse") return "PreToolUse";
  if (key === "posttooluse") return "PostToolUse";
  return String(eventName);
}

function normalizeToolName(toolName) {
  const key = String(toolName).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return TOOL_ALIASES.get(key) ?? String(toolName).toLowerCase();
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function hasPackageScript(cwd, script) {
  const parsed = readJsonFile(path.join(cwd, "package.json"));
  if (typeof parsed !== "object" || parsed === null) return false;
  const scripts = parsed.scripts;
  return typeof scripts === "object" && scripts !== null && typeof scripts[script] === "string";
}

function detectPackageManager(cwd) {
  if (fileExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fileExists(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fileExists(path.join(cwd, "bun.lock")) || fileExists(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

function packageScriptCommand(cwd, script) {
  return {
    label: `package:${script}`,
    cwd,
    command: detectPackageManager(cwd),
    args: ["run", script],
  };
}

function makefileHasTarget(cwd, target) {
  const makefilePath = fileExists(path.join(cwd, "Makefile"))
    ? path.join(cwd, "Makefile")
    : path.join(cwd, "makefile");
  if (!fileExists(makefilePath)) return false;

  const content = fs.readFileSync(makefilePath, "utf8");
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*:`, "m").test(content);
}

function pyprojectHasRuff(cwd) {
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (!fileExists(pyprojectPath)) return false;
  const content = fs.readFileSync(pyprojectPath, "utf8");
  return /^\[tool\.ruff(?:\.|\])/.test(content) || /\bruff\b/.test(content);
}

function hasPreCommitConfig(cwd) {
  return fileExists(path.join(cwd, ".pre-commit-config.yaml")) || fileExists(path.join(cwd, ".pre-commit-config.yml"));
}

function detectLintCommand(cwd) {
  if (makefileHasTarget(cwd, "lint")) {
    return { label: "make:lint", cwd, command: "make", args: ["lint"] };
  }

  for (const script of ["lint", "check:fast", "check"]) {
    if (hasPackageScript(cwd, script)) return packageScriptCommand(cwd, script);
  }

  if (pyprojectHasRuff(cwd)) {
    return { label: "python:ruff-check", cwd, command: "uv", args: ["run", "ruff", "check", "."] };
  }

  if (hasPreCommitConfig(cwd)) {
    return { label: "pre-commit", cwd, command: "pre-commit", args: ["run", "--all-files"] };
  }

  return undefined;
}

function resolveToolPath(cwd, inputPath) {
  return path.resolve(cwd, inputPath);
}

function envPath(cwd) {
  return path.join(cwd, ".env");
}

function isEnvPath(cwd, inputPath) {
  return path.relative(envPath(cwd), resolveToolPath(cwd, inputPath)) === "";
}

function pathContainsEnvScope(cwd, inputPath) {
  const resolvedScope = resolveToolPath(cwd, inputPath);
  const resolvedEnv = envPath(cwd);

  if (resolvedScope === resolvedEnv) return true;

  const relativeEnv = path.relative(resolvedScope, resolvedEnv);
  return relativeEnv === ".env" || (!relativeEnv.startsWith("..") && !path.isAbsolute(relativeEnv));
}

function getToolPathInput(toolName, input) {
  if (["read", "write", "edit", "multiedit", "create_file", "rename", "delete"].includes(toolName)) {
    return firstNonEmptyString(input.path, input.file_path, input.filePath);
  }

  if (["grep", "glob", "find", "ls"].includes(toolName)) {
    return firstNonEmptyString(input.path, input.file_path, input.filePath) ?? ".";
  }

  return undefined;
}

function patchTouchesEnv(cwd, input) {
  const patchText = firstNonEmptyString(input.command, input.patch, input.diff);
  if (!patchText) return false;

  for (const line of patchText.split(/\r?\n/)) {
    const match = /^(?:\+\+\+|---|\*\*\* (?:Add|Update|Delete) File:)\s+(?:a\/|b\/)?(.+)$/.exec(line.trim());
    if (match && isEnvPath(cwd, match[1])) return true;
  }

  return false;
}

function shouldBlockEnvAccess(cwd, toolName, input) {
  if (!fileExists(envPath(cwd))) return undefined;
  if (!READ_ENV_TOOLS.has(toolName) && !MUTATE_ENV_TOOLS.has(toolName)) return undefined;

  if (toolName === "apply_patch" && patchTouchesEnv(cwd, input)) {
    return "Blocked apply_patch: refusing to change existing .env file. Use .env.example for documentation.";
  }

  const inputPath = getToolPathInput(toolName, input);
  if (!inputPath) return undefined;

  if (READ_ENV_TOOLS.has(toolName) && toolName !== "read") {
    if (!pathContainsEnvScope(cwd, inputPath)) return undefined;
  } else if (!isEnvPath(cwd, inputPath)) {
    return undefined;
  }

  const action = MUTATE_ENV_TOOLS.has(toolName) ? "change" : "read";
  return `Blocked ${toolName}: refusing to ${action} existing .env file. Use .env.example for documentation.`;
}

function gitStatus(cwd) {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  if (result.status !== 0) return undefined;
  return result.stdout;
}

function snapshotDir(cwd) {
  const key = Buffer.from(path.resolve(cwd)).toString("hex");
  return path.join(os.tmpdir(), "agent-quality-guard", key);
}

function snapshotFile(cwd, toolCallId) {
  return path.join(snapshotDir(cwd), `${toolCallId}.txt`);
}

function storeStatusSnapshot(cwd, toolCallId) {
  const status = gitStatus(cwd);
  if (status === undefined) return;
  fs.mkdirSync(snapshotDir(cwd), { recursive: true });
  fs.writeFileSync(snapshotFile(cwd, toolCallId), status, "utf8");
}

function loadStatusSnapshot(cwd, toolCallId) {
  const filePath = snapshotFile(cwd, toolCallId);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    fs.rmSync(filePath, { force: true });
    return content;
  } catch {
    return undefined;
  }
}

function outputJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function runLint(cwd) {
  const lintCommand = detectLintCommand(cwd);
  if (!lintCommand) return false;

  const result = spawnSync(lintCommand.command, lintCommand.args, {
    cwd: lintCommand.cwd,
    encoding: "utf8",
  });

  const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
  const message = output.length > 0 ? output : `No output from ${lintCommand.label}.`;

  if (result.status === 0) {
    outputJson({
      continue: true,
      systemMessage: `Post-change lint passed (${lintCommand.label}).\n${message}`,
    });
    return true;
  }

  outputJson({
    continue: false,
    stopReason: `Post-change lint failed (${lintCommand.label}).`,
    systemMessage: `Post-change lint failed (${lintCommand.label}).\n${message}`,
  });
  process.exit(2);
}

function main() {
  const payload = readStdinJson();
  const cwd = firstNonEmptyString(payload.cwd) ?? process.cwd();
  const eventName = normalizeEventName(
    firstNonEmptyString(payload.hookEventName, payload.hook_event_name, payload.eventName, payload.event_name) ?? "",
  );
  const toolName = normalizeToolName(firstNonEmptyString(payload.toolName, payload.tool_name, payload.tool, payload.name) ?? "");
  const toolInput = payload.toolInput ?? payload.tool_input ?? payload.input ?? {};
  const toolCallId = firstNonEmptyString(payload.toolCallId, payload.tool_call_id, payload.tool_use_id, payload.id, payload.callId);

  if (eventName === "PreToolUse") {
    const blockReason = shouldBlockEnvAccess(cwd, toolName, toolInput);
    if (blockReason) {
      outputJson({
        continue: false,
        stopReason: blockReason,
        systemMessage: blockReason,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: blockReason,
        },
      });
      return;
    }

    if (toolCallId && BASH_TOOLS.has(toolName)) storeStatusSnapshot(cwd, toolCallId);
    outputJson({ continue: true });
    return;
  }

  if (eventName === "PostToolUse") {
    if (MUTATING_TOOLS.has(toolName)) {
      if (runLint(cwd)) return;
      outputJson({ continue: true });
      return;
    }

    if (toolCallId && BASH_TOOLS.has(toolName)) {
      const before = loadStatusSnapshot(cwd, toolCallId);
      const after = gitStatus(cwd);
      if (before !== undefined && after !== undefined && before !== after) {
        if (runLint(cwd)) return;
        outputJson({ continue: true });
        return;
      }
    }

    outputJson({ continue: true });
    return;
  }

  outputJson({ continue: true });
}

main();
