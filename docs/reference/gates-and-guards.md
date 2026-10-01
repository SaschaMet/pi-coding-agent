# Gates and Guards

How the quality gates and path guards in `.pi/extensions/` decide. Source of truth is the code and its tests. This page explains them.

## Overview

| Extension | When it runs | What it does | Fails to |
| --- | --- | --- | --- |
| `gates.ts` | After each agent turn (`agent_end`) | Checks the final message against what actually happened. Sends one correction. | Open when git cannot answer |
| `read-boundary-guard.ts` | Before `read`, `write`, `edit`, `grep`, `find`, `ls` | Blocks paths outside the working directory unless approved or trusted. | Blocked |
| `write-boundary-guard.ts` | Before `write`, `edit` | Limits writes to the armed spec or plan scope. | Blocked once armed. Open while not armed. |
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

- The `.env` read block is a Claude Code hook (`~/.claude/hooks/block-env-files.sh`). It is not part of PI. PI has no equivalent.
- Shell rules such as "no push to main" are Claude Code hooks too.

## Tests

Each behavior above is pinned by a test. Change a guard only together with its test.

- `test/gates.test.ts`
- `test/read-boundary-guard.test.ts`
- `test/write-boundary-guard.test.ts`
- `test/spec-scope.test.ts`
- `test/trust-loader.test.ts`
- `test/subagent-delegation-policy.test.ts`
