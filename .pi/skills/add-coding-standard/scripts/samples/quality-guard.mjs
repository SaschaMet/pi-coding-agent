import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const READ_ENV_TOOLS = new Set(["read", "view", "grep", "glob", "find", "ls"]);
const MUTATE_ENV_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch", "create", "create_file", "rename", "delete"]);

const TOOL_ALIASES = new Map([
  ["read", "read"],
  ["view", "view"],
  ["write", "write"],
  ["edit", "edit"],
  ["multiedit", "multiedit"],
  ["applypatch", "apply_patch"],
  ["create", "create"],
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
  if (key === "stop" || key === "sessionend" || key === "sessionshutdown") return "SessionEnd";
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
  if (process.env.AGENT_LINT_COMMAND) {
    return { label: "env:AGENT_LINT_COMMAND", cwd, command: "bash", args: ["-lc", process.env.AGENT_LINT_COMMAND] };
  }

  if (makefileHasTarget(cwd, "lint")) {
    return { label: "make:lint", cwd, command: "make", args: ["lint"] };
  }

  for (const script of ["lint", "check:fast", "check"]) {
    if (hasPackageScript(cwd, script)) return packageScriptCommand(cwd, script);
  }

  if (pyprojectHasRuff(cwd)) {
    if (spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0) {
      return { label: "python:ruff-check", cwd, command: "uv", args: ["run", "ruff", "check", "."] };
    }
    return { label: "python:ruff-check", cwd, command: "ruff", args: ["check", "."] };
  }

  if (hasPreCommitConfig(cwd)) {
    return { label: "pre-commit", cwd, command: "pre-commit", args: ["run", "--all-files"] };
  }

  return undefined;
}

function basename(value) {
  return path.basename(String(value).replace(/\\/g, "/").trim().replace(/^["']|["']$/g, ""));
}

function isEnvPath(value) {
  const base = basename(value);
  if (base === ".env.example") return false;
  return base === ".env" || base.startsWith(".env.");
}

function envFiles(cwd) {
  const files = [];
  const env = path.join(cwd, ".env");
  if (fileExists(env)) files.push(env);

  try {
    for (const entry of fs.readdirSync(cwd)) {
      if (!entry.startsWith(".env.") || entry === ".env.example") continue;
      const candidate = path.join(cwd, entry);
      if (fileExists(candidate)) files.push(candidate);
    }
  } catch {
    return files;
  }

  return files;
}

function scopeContainsEnv(cwd, inputPath) {
  const resolvedScope = path.resolve(cwd, inputPath);
  for (const envFile of envFiles(cwd)) {
    const relative = path.relative(resolvedScope, envFile);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return true;
  }
  return false;
}

function getToolPathInputs(input) {
  const candidates = [];
  for (const key of ["path", "file_path", "filePath", "uri", "query", "includePattern", "pattern"]) {
    if (typeof input?.[key] === "string") candidates.push(input[key]);
  }
  return candidates;
}

function commandTouchesEnv(command) {
  if (!command) return false;
  return /(^|[^\w.-])\.env(?:\.[A-Za-z0-9_.-]+)?($|[^\w.-])/.test(command.replaceAll(".env.example", ""));
}

function shouldBlockEnvAccess(toolName, input, cwd) {
  if (!READ_ENV_TOOLS.has(toolName) && !MUTATE_ENV_TOOLS.has(toolName) && toolName !== "bash") return undefined;

  if (toolName === "bash") {
    const command = firstNonEmptyString(input.command, input.cmd);
    if (!commandTouchesEnv(command)) return undefined;
    return "Shell command targeting .env file is blocked by the no-env-read hook.";
  }

  for (const inputPath of getToolPathInputs(input)) {
    if (!isEnvPath(inputPath)) continue;
    const action = MUTATE_ENV_TOOLS.has(toolName) ? "change" : "read";
    return `Blocked ${toolName}: refusing to ${action} .env file. Use .env.example for documentation.`;
  }

  if (toolName === "grep" || toolName === "glob" || toolName === "find" || toolName === "ls") {
    for (const inputPath of getToolPathInputs(input)) {
      if (scopeContainsEnv(cwd, inputPath)) {
        return "Search/list scope includes .env files, which are blocked by the no-env-read hook.";
      }
    }
  }

  return undefined;
}

function outputJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function runLint(cwd) {
  const lintCommand = detectLintCommand(cwd);
  if (!lintCommand) {
    outputJson({ continue: true, systemMessage: "Session-end lint skipped: no lint/check command detected." });
    return;
  }

  const result = spawnSync(lintCommand.command, lintCommand.args, {
    cwd: lintCommand.cwd,
    encoding: "utf8",
  });

  const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
  const status = result.status === 0 ? "passed" : "finished with issues";
  outputJson({
    continue: true,
    systemMessage: `Session-end lint ${status} (${lintCommand.label}).${output ? `\n${output}` : ""}`,
  });
}

function main() {
  const payload = readStdinJson();
  const cwd = firstNonEmptyString(payload.cwd) ?? process.cwd();
  const eventName = normalizeEventName(
    firstNonEmptyString(payload.hookEventName, payload.hook_event_name, payload.eventName, payload.event_name) ?? "",
  );
  const toolName = normalizeToolName(firstNonEmptyString(payload.toolName, payload.tool_name, payload.tool, payload.name) ?? "");
  const rawToolInput = payload.toolInput ?? payload.tool_input ?? payload.toolArgs ?? payload.tool_args ?? payload.input ?? {};
  const toolInput = typeof rawToolInput === "object" && rawToolInput !== null ? rawToolInput : {};

  if (eventName === "PreToolUse") {
    const blockReason = shouldBlockEnvAccess(toolName, toolInput, cwd);
    if (blockReason) {
      outputJson({
        continue: false,
        permissionDecision: "deny",
        permissionDecisionReason: blockReason,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: blockReason,
        },
      });
      return;
    }

    outputJson({});
    return;
  }

  if (eventName === "SessionEnd") {
    runLint(cwd);
    return;
  }

  outputJson({});
}

main();
