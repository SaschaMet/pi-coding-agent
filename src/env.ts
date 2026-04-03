import fs from "node:fs";
import path from "node:path";

export function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separatorIndex = withoutExport.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = withoutExport.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  let value = withoutExport.slice(separatorIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    const inlineCommentIndex = value.indexOf(" #");
    if (inlineCommentIndex !== -1) {
      value = value.slice(0, inlineCommentIndex).trimEnd();
    }
  }

  return [key, value];
}

export function parseEnvFile(cwd: string): Record<string, string> {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, "utf-8");
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    values[key] = value;
  }

  return values;
}

export function loadEnvFile(cwd: string): void {
  const values = parseEnvFile(cwd);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
