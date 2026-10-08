# Security guard: setting up repos

How the machine-wide security guard changes repo setup: how to check it is installed, how to install repo hooks, and which tricks to skip it are blocked.

## Background

The guard is installed once per machine:

- `git config --global core.hooksPath ~/.pi/agent/security/git-hooks` makes git run the guard's hooks in every repo.
- `git config --global core.excludesFile ~/.pi/agent/security/gitignore-global` ignores `.env` files everywhere.
- `~/.claude/settings.json` runs `guard-cli.ts` before every Claude tool call and on every prompt.
- PI loads `~/.pi/agent/extensions/security-guard.ts` in every session.

`core.hooksPath` changes one rule of git: git no longer runs `.git/hooks/<name>` by itself. The guard's dispatcher runs it instead, after its own scan (see [gates-and-guards.md](gates-and-guards.md)). Repo hooks keep working. Tools that **install** hooks need one extra step (below).

## Checking the install

```bash
node ~/.pi/agent/security/check-install.ts
```

Read-only. It prints one line per check and exits 0 when the guard is installed, 1 when something is missing:

| Check | Passes when | Otherwise |
| --- | --- | --- |
| `core.hooksPath` | global value (includes followed) is `~/.pi/agent/security/git-hooks` | `missing` |
| `git-hooks/dispatch`, `git-hooks/pre-commit` | executable | `missing` |
| `core.excludesFile` | global value is `~/.pi/agent/security/gitignore-global` | `missing` |
| `claude-hook` | Claude settings have a `PreToolUse` entry (matcher `*`) and a `UserPromptSubmit` entry running `guard-cli.ts`, and `disableAllHooks` is not set | `missing`; `skip` when there is no Claude settings file |
| `repo` | the current repo sets no local `core.hooksPath` | `warn` (this repo skips the global commit scan); `skip` outside a repo |

On `missing` it prints the one-time install commands. It never runs them, never writes anything, and never prints the Claude settings content. `PI_CODING_AGENT_DIR` and `CLAUDE_CONFIG_DIR` change where it looks.

`init-project` and `add-coding-standard` run this check in their Step 1 and report the result. A missing script means the guard is not installed.

## Installing repo hooks

Installers that ask git for the hooks folder (`git rev-parse --git-path hooks`) get the global folder while `core.hooksPath` is set. `graphify hook install` would append to the shared wrappers, where its block never runs. `pre-commit install` refuses outright ("Cowardly refusing to install hooks with `core.hooksPath` set").

Hide the global config for that one command:

```bash
GIT_CONFIG_GLOBAL=/dev/null graphify hook install
GIT_CONFIG_GLOBAL=/dev/null pre-commit install
```

Both then write into the repo's own `.git/hooks/` (verified: graphify, and pre-commit 4.6.2; the global hooks stay unchanged). The dispatcher runs those hooks after its scan. Use the same prefix for `graphify hook status` and `uninstall`.

Run these yourself. The guard blocks agents from hiding the global git config, because the same trick turns the commit scan off.

## Blocked ways to skip the commit scan

For PI and Claude agents, the guard blocks:

- Hiding `~/.gitconfig`: any `GIT_CONFIG_GLOBAL=` word; `HOME=`, `unset HOME`, or `env -i` / `env -` / `env -u HOME` in a command that runs git.
- Dropping the hook path: `--unset core.hooksPath` and any other `core.hooksPath` change, `git config --remove-section core` / `--rename-section core`, and writing `include.path` or `includeIf.*.path`.
- Skipping hooks: `--no-verify`, `git commit -n`, `git -c core.hooksPath=…`.
- The same forms inside `sh -c`, `bash -c`, `zsh -c`, or `dash -c`, checked up to 3 levels deep. Deeper nesting is blocked.

A word that starts with `GIT_CONFIG_GLOBAL=` is blocked even in a search; search without the `=`.

Not blocked (known gaps): raw edits of `~/.gitconfig` (`sed`, `>`, an editor), `$(...)` and variable tricks, shell aliases, `sudo`, and git run by `npm` or `make` scripts. `check-install.ts` still reports a removed hook path afterwards.

## Per-repo guards

`add-coding-standard` installs a per-repo `.env` guard (`.github/hooks/scripts/block-env-read.sh`) and merges Claude hooks into the repo's `.claude/settings.json`. On this machine the global guard already covers both. Keep them: a repo is also cloned on machines and by people without the global guard, and the per-repo copy is their only protection.

## Limits

- A repo with its own `core.hooksPath` (husky, lefthook) skips the global commit scan. The check warns about it. Today none of the 20 repos under `~/Projects` sets one.
- A bare `graphify hook install` run without the prefix still writes into the global folder. The graph then never rebuilds after a commit, and the next sync removes the block. No security impact.
