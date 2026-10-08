# Gates and Guards

How the quality gates and path guards in `.pi/extensions/` decide. Source of truth is the code and its tests. This page explains them.

## Overview

| Extension | When it runs | What it does | Fails to |
| --- | --- | --- | --- |
| `gates.ts` | After each agent turn (`agent_end`) | Checks the final message against what actually happened. Sends one correction. | Open when git cannot answer |
| `read-boundary-guard.ts` | Before `read`, `write`, `edit`, `grep`, `find`, `ls` | Blocks paths outside the working directory unless approved or trusted. | Blocked |
| `write-boundary-guard.ts` | Before `write`, `edit` | Limits writes to the armed spec or plan scope. | Blocked once armed. Open while not armed. |
| `security-guard.ts` | Before every tool call, and on each prompt (`input`) | Blocks `.env` and credential paths, dangerous shell commands, protected-branch and force pushes, hook bypasses, and secrets in prompts. Shares one policy with the Claude hook and the global git hook. | Blocked, and prompts dropped |
| `model-whitelist.ts` | At startup | Shows only the OpenRouter models listed in `models.json`. | No-op |
| `subagent-delegation-policy.ts` | On input and before each agent start | Routes explicit delegation requests to the `Agent` tool. Adds delegation rules. | Continue |
| `subagent-rules-injection.ts` | Before a subagent starts | Adds `.pi/SYSTEM.md` to a subagent that lacks it. | Continue |

## Install requirement

The project copy of each extension disarms itself when a global copy exists (`isShadowedProjectCopy`). Reason: project files load only in trusted projects, so project content must never be able to disarm a guard.

Result: guards and gates only act from `~/.pi/agent/extensions/`. Run `npm run pi:sync-global` after every change to an extension. Until then the old global copy acts.

## Gates (`gates.ts`)

Gates do not block tool calls. They run once when the agent ends its turn.

What it records during the turn:

- Each finished tool call and whether it errored. Blocked calls produce no result, so they are not recorded.
- The last assistant message with text.
- Paths that successful `bash` commands changed (see [Bash mutation detection](#bash-mutation-detection)).
- A baseline of `git status --porcelain -uall` taken at the start of the turn.

Checks at the end of the turn (`lib/gate-checks.ts`):

| Check | Fails when |
| --- | --- |
| `changes_disclosed` | A file is new in `git status` since the turn began and the final message does not name it. A full path counts. A bare file name counts only when it is unique among the turn's changes. |
| `artifacts_exist` | A successful `write` or `edit` names a path that does not exist on disk. |
| `files_non_empty` | A successful `write` or `edit` left an empty file. |
| `bash_mutations_disclosed` | A path changed by `bash` is not named in the final message. |
| `verification_actually_ran` | The final message claims success ("tests pass", "typecheck is clean", "build succeeded") and no verification command ran this turn. |

What counts as a verification command: `npm|pnpm|yarn|bun [run] test|typecheck|type-check|lint|build`, `vitest`, `jest`, `pytest`, `tsc`, `eslint`, `cargo test`, `go test`, `make test|check`.

Sentences with negation ("not", "n't", "never", "fail", "unable", "cannot") are not treated as success claims. An honest "I did not run the tests" passes.

On violation:

1. The gate sends one user message that starts with `[GATE VIOLATION]` and lists each failure.
2. If the next turn still violates, it only reports `[GATES] N violation(s) still open`. It does not loop.

Fail-open cases: not a git repo, or `git status` fails. Then only the non-git checks run.

Control:

- `/gates` shows the status.
- `/gates on` and `/gates off` toggle it. The choice is saved per session branch. A new branch starts with gates on.

## Read boundary guard (`read-boundary-guard.ts`)

Applies to `read`, `write`, `edit`, `grep`, `find`, `ls`. Paths are resolved through symlinks, so a symlink cannot escape.

Decision order:

1. No path argument: block.
2. Path under global PI (`~/.pi`, or `PI_CODING_AGENT_DIR`): read-only tools pass. `write` and `edit` are blocked.
3. Path inside the working directory: pass.
4. Path inside the system temp directory, read-only tools: pass.
5. Path inside `<temp>/pi-reports/`, `write` or `edit`: pass.
6. Path inside a trusted directory from `.pi/trust.json`: pass. See [`trust.json.md`](trust.json.md).
7. Otherwise: ask the user (Yes/No). Without a UI: block.

On macOS the system temp directory is `$TMPDIR`, not `/tmp`. Never write to `/tmp`.

## Write boundary guard (`write-boundary-guard.ts`)

Keeps `write` and `edit` inside the scope of the approved spec or plan. It is off until armed.

### Arming

- Automatic: when a `write` or `edit` to `docs/specs/spec-*.md` or `docs/plans/plan-*.md` succeeds and no scope is armed, the guard arms itself from that file. The same holds one folder down: `docs/specs/<name>/spec-*.md` and `docs/plans/<name>/plan-*.md`. Other files in a document folder (research, reviews, `sub-plan-*`) never arm it.
- Manual: `/scope <path-to-spec>`. Use this in a new session.
- `/scope` shows the status. `/scope off` disarms.
- If a scope is already armed, a new spec or plan does not replace it. The agent cannot rewrite its own boundary. Run `/scope off` first.
- If the spec cannot be parsed and a scope is armed, the old scope stays. If none is armed, writes stay unrestricted and the guard tells you to fix the spec.

### Scope format

The spec needs a `Scope` heading (any level, optional number) with two labelled lists:

```markdown
## 2. Scope

**Modify:**
- `src/feature/`
- `test/feature.test.ts`

**Forbid:**
- `src/secrets.ts`
```

Rules:

- `Modify` needs at least one real entry. Placeholders (`...`, `none`, `tbd`, `path/to/file`) do not count.
- `Forbid` is optional.
- A plain path matches that file or everything under that folder.
- `*` matches inside one path segment. `**` matches any number of segments. `?` matches one character.
- The parser follows the spec template in `.pi/skills/create-spec/references/spec-template.md`. If the template's Scope section changes, change `lib/spec-scope.ts` with it. Otherwise the guard allows something different from what the spec says.

### Decision order for each write

1. Inside the system temp directory (resolved): pass.
2. Outside the working directory: block, or ask.
3. Matches `Forbid`: block, or ask.
4. The armed spec itself: pass.
5. Under `docs/specs/`, `docs/plans/`, `docs/research/`, including document folders such as `docs/specs/<name>/`: pass.
6. Matches `Modify`: pass.
7. Otherwise: block, or ask.

"Block, or ask" means: ask the user (Yes/No) when a UI exists. Without a UI it blocks.

Forbid and containment are checked before any allowance, so no allowlist overrides a denial.

### Changing the scope of an armed spec

A write to the armed spec that changes its Modify or Forbid lists needs a Yes from the user.

- The guard predicts the file after the edit. If it cannot predict it exactly, it asks.
- `widens`: a new Modify entry, or a dropped Forbid entry. Stop and re-grill the spec before continuing.
- `narrows`: anything else that changed. Add an Amendment to the spec.
- After the write lands, the guard re-arms only if the file on disk matches the approved lists.
- Notes and status markers in the spec do not trigger this.

## Security guard (`security-guard.ts`, `.pi/security/`)

One policy for PI, Claude Code, and git on this machine.

- `.pi/security/policy.ts` holds the rules as data. `guard-core.ts` evaluates them. It is pure and runs under plain `node`.
- Adapters: the PI extension `security-guard.ts`, the Claude hook `guard-cli.ts`, and the git pre-commit hook (`guard-cli.ts pre-commit`, reached through `git-hooks/dispatch`).
- Install: sync ships the files to `~/.pi/agent/security/`. The human runs the one-time git and Claude commands in `scripts/sync-pi-config.md`. Sync never writes global git config or `~/.claude/settings.json`.

What it blocks:

| Rule | PI and Claude tool calls | Prompts | git commit |
| --- | --- | --- | --- |
| `.env`, `.env.*` (not `.example`, `.sample`, `.template`, `.dist`, `.defaults`, `.vault`) | Any path input, `grep`/`find` globs, shell commands | | Staged file names |
| Credential paths: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.npmrc`, `*.pem`, `*.key`, `secrets/` | Any path input, shell commands | | |
| Push to `main`, `master`, `production`, `release/*`; force push (`--force-with-lease` is allowed); deleting a protected branch | Shell commands; a bare push uses the current branch, and an unknown branch blocks | | |
| `rm` with `-r`/`-f` on `/`, `~`, `$HOME`, or a direct child of them; pipe-to-shell; exfil hosts; `--dangerously-skip-permissions` | Shell commands | | |
| `--no-verify`, `git commit -n`, any change of `core.hooksPath` | Shell commands | | |
| Secret patterns (block mode) | | Dropped with the pattern name and "If this was a real key, rotate it now." | Commit fails |
| 64-hex and generic `key = value` patterns (warn mode) | | Warning only | Warning only |

Fails closed:

- PI: when `policy.ts` or `guard-core.ts` cannot load, every tool call blocks and every prompt is dropped. Fix it from a plain shell with `npm run pi:sync-global`.
- Claude: the hook command is `node "$HOME/.pi/agent/security/guard-cli.ts" || exit 2`. Every deny and error exits 2.
- git: a missing `node` or policy fails the commit. More than 5 MB of staged text (lockfiles excluded) fails the commit.
- Sync: `push` refuses a policy that does not load and writes nothing.

The git dispatcher hands each hook (14 names) to the repo's own `.git/hooks/<name>` with the same arguments and stdin, so repo hooks keep running.

Rollback: `git config --global --unset core.hooksPath`, `git config --global --unset core.excludesFile`, and remove the hook entries from `~/.claude/settings.json`.

## Bash mutation detection

`lib/bash-mutations.ts` finds paths a `bash` command plausibly changed. It feeds `bash_mutations_disclosed`.

- Detected: `>`, `>>`, `2>`, `&>`, `sed -i`, `mv`, `git mv`, `cp` (sources and destination), `rm`, `touch`, `tee`, `mkdir`, `ln`.
- Ignored: `/dev/*`, the system temp directory, tokens with shell metacharacters, options, and any command containing an unquoted heredoc (`<<`).
- Anything it does not recognize yields nothing. It misses some changes. It never blocks.

## Model whitelist (`model-whitelist.ts`)

- Reads `~/.pi/agent/models.json`, provider `openrouter` (or `openRouter`).
- Replaces the built-in OpenRouter model catalog with the models listed there.
- If the file is missing, invalid, or has no models, it does nothing.
- Run `/reload` after editing `models.json`.

## Subagent delegation policy (`subagent-delegation-policy.ts`)

- Input matching "spawn a subagent for X and another for Y" is rewritten into two `Agent` calls with `generic-readonly`.
- Every turn gets a hidden delegation policy message. Main rules: delegate only when asked, use `generic-readonly` for research and `generic-worker` for edits, subagents inherit the parent model, research subagents use the research model from `.pi/SYSTEM.md`.

## Subagent rules injection (`subagent-rules-injection.ts`)

- Detects a subagent by the `<active_agent name="` tag in its system prompt.
- If the prompt does not contain the first line of `.pi/SYSTEM.md` (`# Role and Communication`), it injects `.pi/SYSTEM.md` once.
- Missing, unreadable or empty file: it does nothing and the subagent still starts.

## Not covered here

Known gaps of the security guard:

- Shell matching is a speed bump, not a boundary: obfuscated commands such as `$(printf ...)` pass. The path check and the git hook are the enforcing layers.
- A Claude hook that reaches its `timeout` (30 s) is cancelled, and Claude allows the call.
- A repo's `.claude/settings.json` with `"disableAllHooks": true` turns off the Claude guard there. Read an untrusted repo's settings before you trust the folder.
- A repo with its own `core.hooksPath` (husky, lefthook) skips the global git hook. `git commit --no-verify` typed by a human skips it too.
- While the global `core.hooksPath` is set, repo hooks under names without a wrapper (for example `push-to-checkout`, `reference-transaction`) do not run.
- Installers that use `git rev-parse --git-path hooks` (for example `graphify hook install`) write into the global folder. Use the env-prefix command in `scripts/sync-pi-config.md`.
- Staged changes to tracked `.env.<other>` files are blocked.
- Binary staged files are not scanned.
- Extension `/commands` are not prompt-scanned: PI runs them before `input`.
- The agent guard does not scan commits; the git hook does.
- PI-only guards (gates, scope guard) do not exist for Claude. PI has no sandbox like Claude's.
- The legacy Claude hooks were removed after a side-by-side check. Two stay, because nothing replaces them: `scan-secrets.sh` (BIP39 seed phrases in Claude prompts) and `prompt-injection-defender.sh` (injection warnings on tool output).
- A `git push` whose branch is built at run time (`$(...)`, `$VAR`, backticks) is blocked; type the branch name.
- Code review is not automatic: the `code-review` skill runs only when invoked.
- No injection warning on tool results yet.
- `init-project` and `add-coding-standard` do not yet check that the global guard is installed.

## Tests

Each behavior above is pinned by a test. Change a guard only together with its test.

- `test/gates.test.ts`
- `test/read-boundary-guard.test.ts`
- `test/write-boundary-guard.test.ts`
- `test/spec-scope.test.ts`
- `test/trust-loader.test.ts`
- `test/subagent-delegation-policy.test.ts`
- `test/security-guard.test.ts`
- `test/security-parity.test.ts`
- `test/security-git-hook.test.ts`
- `test/sync-pi-config.test.ts` (file modes and the policy check before push)
