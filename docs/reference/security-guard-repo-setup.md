# Security guard: setting up repos

How the machine-wide security guard changes repo setup, what can go wrong today, and the planned follow-up for the `init-project` and `add-coding-standard` skills.

Status: the follow-up is **not built**. Until it is, use the manual steps below.

## Background

The guard is installed once per machine:

- `git config --global core.hooksPath ~/.pi/agent/security/git-hooks` makes git run the guard's hooks in every repo.
- `git config --global core.excludesFile ~/.pi/agent/security/gitignore-global` ignores `.env` files everywhere.
- `~/.claude/settings.json` runs `guard-cli.ts` before every Claude tool call and on every prompt.
- PI loads `~/.pi/agent/extensions/security-guard.ts` in every session.

`core.hooksPath` changes one rule of git: git no longer runs `.git/hooks/<name>` by itself. The guard's dispatcher runs it instead, after its own scan (see [gates-and-guards.md](gates-and-guards.md)). Repo hooks keep working. Tools that **install** hooks are the problem.

## Problem 1: nothing checks that the guard is installed

The guard is a one-time, by-hand install. On a new machine, or after `git config --global --unset core.hooksPath`, it is simply missing. Today nothing notices.

- `init-project` and `add-coding-standard` set up a repo's agent rules and quality gates. Neither checks the global guard. A repo can look fully set up while no `.env` block and no commit scan exist.
- The failure is silent. Agents work normally; secrets are just not blocked.

## Problem 2: hook installers write into the global folder

Many installers ask git where hooks live: `git rev-parse --git-path hooks`. With the global `core.hooksPath` set, git answers `~/.pi/agent/security/git-hooks` for every repo.

Example, `graphify hook install` in a new repo:

1. graphify asks git for the hooks folder and gets the global folder.
2. It appends its rebuild block to the global `post-commit` and `post-checkout` wrappers and reports success.
3. Each wrapper starts with `exec .../dispatch`, so the shell never reaches the appended block. The graph never rebuilds after a commit. No error appears.
4. The next `npm run pi:sync-global` overwrites the wrappers and deletes the block. A `npm run pi:pull-global` would copy the changed wrappers into this repo first.

Source: graphify `hooks.py` (`_hooks_dir` uses `--git-path hooks`; `_install_hook` appends to an existing file). Repos that already had graphify hooks before the guard (this repo, `regiomanager`) are not affected: their hooks sit in `.git/hooks/` and the dispatcher runs them.

Fix that works today (tested in a temp repo): point git at the repo's own folder for that one command.

```bash
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath \
GIT_CONFIG_VALUE_0="$(git rev-parse --absolute-git-dir)/hooks" \
graphify hook install
```

`GIT_CONFIG_*` variables add a config value for that command and every git call it makes. The installer then writes into `.git/hooks/`, and the dispatcher runs that hook after its scan.

Agents cannot run this command: the guard blocks any command that sets `core.hooksPath`, because the same trick could turn the hook off. A human runs it.

## Problem 3: `pre-commit install` (pre-commit.com)

`add-coding-standard` ships a `.pre-commit-config.yaml` sample. Its normal setup step, `pre-commit install`, is reported to refuse to run while `core.hooksPath` is set. Not verified: `pre-commit` is not installed on this machine. Whether the env-prefix form above satisfies it is also unverified.

Hooks that `pre-commit` installed before the guard keep running through the dispatcher.

## Problem 4: per-repo guards now overlap

`add-coding-standard` installs a per-repo `.env` guard (`.github/hooks/scripts/block-env-read.sh`) and merges Claude hooks into the repo's `.claude/settings.json`. On this machine the global guard already covers both.

Keep them. A repo is also cloned on machines and by people without the global guard, and the per-repo copy is their only protection.

## Planned follow-up

Goal: both skills check the guard and never install it themselves (tools never write global git config or `~/.claude/settings.json`; the human runs the one-time commands).

1. A read-only check, run by both skills:

   | Check | Command | Pass when |
   | --- | --- | --- |
   | git hooks | `git config --global --get core.hooksPath` | equals `~/.pi/agent/security/git-hooks` |
   | hook files | `test -x ~/.pi/agent/security/git-hooks/dispatch` | executable |
   | ignore file | `git config --global --get core.excludesFile` | equals `~/.pi/agent/security/gitignore-global` |
   | Claude hook | `jq` over `~/.claude/settings.json` | a `PreToolUse` and a `UserPromptSubmit` entry run `guard-cli.ts` |
   | repo bypass | `git config --local --get core.hooksPath`, `.husky/`, `lefthook.yml` | none present, else warn that this repo skips the global hook |

   On a failed check: report it and print the one-time commands from `scripts/sync-pi-config.md`. Never run them.

2. Every place that tells an agent or human to run `graphify hook install` uses the env-prefix form and says a human must run it: `.pi/skills/graphify/references/hooks.md`, `init-project`, `add-coding-standard`.
3. Verify `pre-commit install` with the global hook path set, then document the working command or the limit.

Files: `.pi/skill-library/init-project/`, `.pi/skill-library/add-coding-standard/`, `.pi/skills/graphify/references/hooks.md`, and their skill tests. `.pi/skill-library/` was outside the security spec's scope, so this needs its own plan: `$create-plan`, grill, approval, then TDD.

## Until then

- New repo with graphify: run the env-prefix command above yourself.
- New machine: follow the install steps in `scripts/sync-pi-config.md`, then check with `git config --global --get core.hooksPath`.
- A repo that uses husky or lefthook gets no global commit scan. Today none of the 20 repos under `~/Projects` does.
