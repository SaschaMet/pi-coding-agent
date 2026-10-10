---
name: sandboxed-bash
description: Explains what to do when bash runs inside the OS sandbox and a command is blocked — "Operation not permitted", a "bash blocked" message, a blocked host (proxy 403 or ENOTFOUND), or a task that needs Docker, gh, git push/fetch, npm publish, or a listening port. Use when echo $SANDBOX_RUNTIME prints 1 and a command fails for those reasons, or before starting such a task. Not for permission errors outside the sandbox or for changing the sandbox policy.
---

# Sandboxed Bash

Check first: `echo $SANDBOX_RUNTIME` prints `1` → your bash is sandboxed. Empty → this skill does not apply.

| Symptom | Cause | Do this |
| --- | --- | --- |
| `Operation not permitted` on `.pi/`, `.env*`, `.git/hooks`, `.git/config` | Protected inside the project | Edits to `.pi/` go through the edit tool inside the armed spec scope, never to get past a block. Ask the human for git config |
| `Operation not permitted` outside the project | Only the project, `$TMPDIR`, `/tmp`, and `~/.npm` are writable | Write inside the project or `$TMPDIR` |
| Host blocked: `CONNECT tunnel failed, response 403` (macOS proxy) or `ENOTFOUND` / "could not resolve host" | Only `registry.npmjs.org` is allowed | Ask the human to add the domain to `~/.pi/agent/sandbox.json`. Never edit it yourself, never go unsandboxed for it |
| Docker, `gh`, `git push/fetch/pull`, `npm publish`, a listening port | No socket, no tokens, no binding — by design | Unsandboxed one-shot (below) |
| `bash blocked: sandbox unavailable (<reason>)` | srt missing or wrong version, config, cwd, tool override, settings file | Stop. Tell the human the reason and the fix. Read and edit tools still work |

## Unsandboxed one-shot

- Orchestrator in cmux: follow `$cmux-orchestration` → "Unsandboxed one-shot". A domain never qualifies.
- cmux worker or subagent: stop. Last line `NEEDS_UNSANDBOXED: <command> — <reason>` or `NEEDS_DOMAIN: <host> — <reason>`.
- Not in cmux: give the human the exact command for a normal terminal, then wait.

## Never

- Retry a blocked command, or re-run it through another interpreter, `eval`, a script file, or a different path.
- Edit `~/.pi/agent/sandbox.json` or the sandbox extension files to get past a block.
- Type commands into a bare cmux shell; only a pi run started with `--no-sandbox` runs unsandboxed work.
- Pass `--no-sandbox` where the sandbox extension is not loaded (`$SANDBOX_RUNTIME` empty outside any `--no-sandbox` session): pi rejects the unknown flag there.
