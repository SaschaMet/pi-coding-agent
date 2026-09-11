#!/usr/bin/env bash
# Blocks AI tool invocations that read or mutate .env files.
# Receives hook input JSON on stdin.

set -euo pipefail

INPUT="$(cat)"

python3 - "$INPUT" <<'PY'
import json
import os
import re
import sys

try:
    payload = json.loads(sys.argv[1] or "{}")
except Exception:
    payload = {}

tool_name = str(
    payload.get("toolName")
    or payload.get("tool_name")
    or payload.get("tool")
    or payload.get("name")
    or ""
).lower()
cwd = str(payload.get("cwd") or os.getcwd())

tool_input = (
    payload.get("toolInput")
    if "toolInput" in payload
    else payload.get("tool_input", payload.get("toolArgs", payload.get("tool_args", payload.get("input", {}))))
)

if isinstance(tool_input, str):
    try:
        tool_input = json.loads(tool_input)
    except Exception:
        tool_input = {"value": tool_input}

def iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from iter_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from iter_strings(item)

def is_blocked_env_path(value):
    normalized = value.replace("\\", "/").strip().strip("\"'")
    base = os.path.basename(normalized)
    if base == ".env.example":
        return False
    return base == ".env" or base.startswith(".env.")

def scope_contains_env(scope_value):
    normalized = scope_value.replace("\\", "/").strip().strip("\"'")
    if not normalized:
        return False

    scope_path = normalized
    if not os.path.isabs(scope_path):
        scope_path = os.path.join(cwd, scope_path)
    scope_path = os.path.normpath(scope_path)

    env_path = os.path.join(cwd, ".env")
    if os.path.isfile(env_path):
        try:
            if os.path.commonpath([scope_path, env_path]) == scope_path:
                return True
        except ValueError:
            pass

    try:
        for entry in os.listdir(cwd):
            if entry.startswith(".env.") and entry != ".env.example":
                candidate = os.path.join(cwd, entry)
                if not os.path.isfile(candidate):
                    continue
                try:
                    if os.path.commonpath([scope_path, candidate]) == scope_path:
                        return True
                except ValueError:
                    continue
    except Exception:
        return False

    return False

def deny(reason):
    print(json.dumps({
        "continue": False,
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }))

for text in iter_strings(tool_input):
    if is_blocked_env_path(text):
        deny("Access to .env files is blocked by the no-env-read hook. Use .env.example for documentation.")
        sys.exit(0)

if tool_name in {"grep", "glob", "find", "ls"}:
    for text in iter_strings(tool_input):
        if scope_contains_env(text):
            deny("Search/list scope includes .env files, which are blocked by the no-env-read hook.")
            sys.exit(0)

command = ""
if isinstance(tool_input, dict):
    command = str(tool_input.get("command") or tool_input.get("cmd") or "")

if command:
    command_without_examples = command.replace(".env.example", "")
    if re.search(r"(^|[^\w.-])\.env(?:\.[A-Za-z0-9_.-]+)?($|[^\w.-])", command_without_examples):
        deny("Shell command targeting .env file is blocked by the no-env-read hook.")
        sys.exit(0)

print("{}")
PY
