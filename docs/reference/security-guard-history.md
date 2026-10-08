# Security guard: what was built, decided, and verified

The full record of the machine-wide security guard work (2026-10-08). How the guard works is in [gates-and-guards.md](gates-and-guards.md); repo setup and installers are in [security-guard-repo-setup.md](security-guard-repo-setup.md); install and undo commands are in [`scripts/sync-pi-config.md`](../../scripts/sync-pi-config.md). This page is the history: what changed, why, and how it was proven.

## Summary

One policy now protects PI, Claude Code, and every git commit on this machine:

- Agents (PI and Claude) cannot read or write `.env` files or credential paths, run dangerous shell commands, push to protected branches, or skip or switch off the git hooks.
- Prompts with secrets are dropped before they reach a model.
- Every commit, by agents or humans, is scanned for secrets and staged `.env` files.
- `init-project` and `add-coding-standard` check that the guard is installed.

## Commits

| Commit | What |
| --- | --- |
| `8e07d2d` | Global security guard: policy, evaluator, PI extension, Claude hook CLI, git hook dispatcher, global ignore file, mode-keeping sync with a policy check, code-review lens rules, docs. `.pi/bin/fd` and `rg` tracked as executable. |
| `433ce0a` | Gaps found against the legacy Claude hooks: pipe-to-shell across pipes, exfil via rsync/scp/sftp/socat/telnet, push targets built at run time, `~<user>` homes as `rm` targets. |
| `edef56d` | Reference doc on repo setup with the global guard. |
| `c696c24` | Bypass fixes (hiding or dropping the git config, `sh -c` wrappers), `check-install.ts`, skill and graphify instructions, this record. |

## Components

| File (synced to `~/.pi/agent/…`) | Role |
| --- | --- |
| `.pi/security/policy.ts` | All rules as data: `.env` and credential paths, protected branches, `rm` targets, command regexes, 11 secret patterns (9 block, 2 warn). |
| `.pi/security/guard-core.ts` | Pure evaluator run by plain `node`: tool calls, shell splitting, git push/commit/config analysis, `-c` re-check (depth 3), `scanText`, `checkPolicy`. |
| `.pi/extensions/security-guard.ts` | PI adapter: blocks tool calls, drops prompts with secrets; blocks everything and drops every prompt when the core cannot load. |
| `.pi/security/guard-cli.ts` | Claude hook adapter (blocks only with exit 2) and the git `pre-commit` scan (lockfiles skipped, 5 MB limit). |
| `.pi/security/git-hooks/` | `dispatch` plus 14 wrappers; runs the scan, then hands every hook to the repo's own `.git/hooks/<name>`. |
| `.pi/security/gitignore-global` | Ignores `.env` and `.env.*` except the six example names. |
| `.pi/security/check-install.ts` | Read-only install check; exit 0 installed, 1 missing. |
| `scripts/sync-pi-config.ts` | Push keeps file modes and refuses a policy that does not load. |

## Installed on this machine

Done 2026-10-08, by the user and, on the user's explicit request, by the agent:

- `git config --global core.hooksPath ~/.pi/agent/security/git-hooks` and `core.excludesFile ~/.pi/agent/security/gitignore-global` (both were empty before).
- `~/.claude/settings.json`: a `PreToolUse` entry (matcher `*`) and a `UserPromptSubmit` entry running `node "$HOME/.pi/agent/security/guard-cli.ts" || exit 2`, `timeout: 30`. Edited by a script that changed only the `hooks` arrays and never printed the file.
- Legacy Claude hooks removed after a side-by-side check: `scan-commit.sh`, `block-env-files.sh`, and the five inline Bash hooks (push to main, exfil, permission flags, pipe-to-shell, `rm`). Kept: `scan-secrets.sh` (BIP39 seed phrases) and `prompt-injection-defender.sh` (no replacement yet).
- Backups: `~/.claude/settings.json.bak-2026-10-08` (before the new hook) and `~/.claude/settings.json.bak-2026-10-08-before-legacy-removal`. Both hold the full settings, including the OTEL header; delete them once Claude has run a day without problems.

Undo: `git config --global --unset core.hooksPath`, `git config --global --unset core.excludesFile`, and restore a settings backup.

## Decisions

### Global security parity (spec `global-security-parity`)

Grills 1 and 2 were answered by an agent (their reports were lost); grill 3 was answered by the orchestrator for the user (human override). The user then confirmed or changed the key answers.

| Decision | Choice | Why |
| --- | --- | --- |
| Where the rules live | One `policy.ts`, one pure evaluator, thin adapters | One rule changes in one place for every tool |
| Git hook approach | Global `core.hooksPath` with a dispatcher that chains repo hooks | Covers every repo and human commits without per-repo setup |
| Who writes global config | The human runs documented commands; sync never writes git config or Claude settings | Separation of duties |
| Hex-64 and `key = value` patterns | Warn, not block | Docker digests and config reads look the same |
| Protected branches | `main`, `master`, `production`, `release/*`; `--force-with-lease` allowed | User decision |
| Secret in a prompt | Drop it (`handled`) with the pattern name and "If this was a real key, rotate it now." | Never send a secret to a provider |
| Guard fails to load | PI blocks every tool call and drops every prompt; fix from a shell | Fail closed (user confirmed) |
| Claude hook timeout | `timeout: 30`, 1M-char cap on scanned text, block only with exit 2 | A timed-out hook lets the call through; JSON output that fails validation does too |
| Claude hook location | `~/.claude/settings.json` by hand, no sudo managed settings | User decision; a repo's `disableAllHooks` is an accepted gap |
| Sync check | Push refuses a policy that does not load and writes nothing | One broken file would block PI, Claude, and every commit |
| BIP39 and lockfile warning | Cut | No requirement; noise |
| `rm` rule | Only `/`, `~`, `$HOME`, `~<user>`, and their direct children, all flag forms | The legacy rule blocked normal deletes and missed `rm -r -f /` |
| Legacy hooks | Removed after a 99-case side-by-side diff showed nothing real lost | Duplication; legacy `--dangerously-skip-permissions` hook never worked |
| Push target built at run time | Blocked (`$(…)`, `$VAR`, backticks) | Cannot be checked, so it fails closed |

### Repo setup (spec `guard-repo-setup`)

Grill answered by the orchestrator for the user (human override); the user approved the plan.

| Decision | Choice | Why |
| --- | --- | --- |
| Hiding `~/.gitconfig` | Block any `GIT_CONFIG_GLOBAL=` word; `HOME=`, `unset HOME`, `env -i`/`-u HOME` with git | Verified bypass: the commit scan was skipped |
| Dropping the hook path | Block `--remove-section`/`--rename-section core` and `include.path`/`includeIf` writes | Permanent off switch, same class as `--unset core.hooksPath` |
| Wrapped commands | Re-check `sh`/`bash`/`zsh`/`dash -c` text, 3 levels; deeper is blocked | Every git rule was skipped one wrapper deep |
| Install check | Separate read-only `check-install.ts` | Testable; keeps the Claude hook path small; settings content stays out of agent context |
| No Claude settings file | `skip`, not `missing` | A check that always fails gets ignored |
| Repo warning | Only a local `core.hooksPath` | The real bypass; no guessing from husky or lefthook file names |
| Installer command | `GIT_CONFIG_GLOBAL=/dev/null <installer>`, run by a human | Works for graphify and pre-commit; the old env-prefix form fails for pre-commit |

## Verification evidence

- Tests: 708 before the work, 1090 after (51 files), all green; typecheck clean; smoke green against a temp sync.
- Parity: every shared case gives the same answer through the PI extension and the real `node guard-cli.ts`.
- Manual checklist (parity spec), 6 of 6: PI and Claude blocked `.env` reads; a commit with a fake key was rejected; repo `pre-commit`/`post-commit` hooks still ran; Claude settings unchanged; undo turned the hook off.
- Legacy diff: 99 cases; after the four fixes only 7 accepted differences remained (4 legacy false positives, 3 intended `rm` narrowings).
- Live, with only the new hook: 7 dangerous Bash commands blocked, the control ran, nothing leaked, nothing pushed; a prompt with a fake key never reached the model.
- Repo setup: `pre-commit install` refuses while `core.hooksPath` is set and installs with the prefix (pre-commit 4.6.2); `graphify hook install` with the prefix writes into `.git/hooks/` and leaves the global wrappers unchanged; after the sync, PI and Claude both blocked `GIT_CONFIG_GLOBAL=/dev/null git commit` with 0 commits created; `check-install.ts` prints six `ok` lines here and two `missing` lines with an empty global config.

## Incidents

- Mode-keeping push made `~/.pi/agent/bin/fd` and `rg` non-executable, because git tracked them as `100644`. Fixed by restoring the exec bit and tracking both as `100755`, with a test.
- The second sync shipped an unrelated, uncommitted `gates.ts` change; it was the user's own work.

## Known gaps

Listed with reasons in [gates-and-guards.md](gates-and-guards.md#not-covered-here). The main ones: shell matching is a speed bump (`$(…)`, aliases, `sudo`, scripts run by `npm`/`make`, raw edits of `~/.gitconfig`); a Claude hook that times out allows the call; a repo's `disableAllHooks` or own `core.hooksPath` skips the guard there; agents cannot install repo hooks.

## Open items

- Delete the two `~/.claude/settings.json` backups after a day of normal use.
- Load `init-project` once in an interactive session and confirm Step 1 reports the guard check (in print mode the report was hidden by a gates correction).
- Restart agent sessions that started before a sync; they run the old guard.
- Follow-ups: injection warning on tool output (then `prompt-injection-defender.sh` can go); optional BIP39 check in the new guard (then `scan-secrets.sh` can go).

## Working documents (local only)

`docs/specs/` is gitignored, so these stay on this machine:

- `docs/specs/global-security-parity/`: `spec-global-security-parity.md` (+ `.html`), `research-global-security-parity.md`, `grill-summary-4.md`, `reports/manual-checklist.md`, `reports/legacy-hook-diff.md`.
- `docs/specs/guard-repo-setup/`: `spec-guard-repo-setup.md` (+ `.html`), `research-guard-repo-setup.md`, `grill-summary-1.md`.
