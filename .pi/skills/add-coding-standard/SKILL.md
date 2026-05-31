---
name: add-coding-standard
description: Use this skill when the user asks to add, initialize, harden, standardize, or audit a repository's coding standard, quality gates, CI checks, hooks, tests, coverage, mutation testing, security checks, or AI-development guardrails. Use it for repo-wide standards work, not ordinary feature implementation, isolated lint fixes, or generic coding advice.
---

# Add Coding Standard

Install or audit a profile-based engineering standard with the smallest repo-specific change that makes the standard executable.

## Trigger Boundary

Use for repo-wide quality standards: formatter, linter, typing, tests, coverage, mutation testing, security checks, hooks, CI, cleanup checks, and AI-development guardrails.

Do not use for ordinary feature work, one-off lint fixes, generic code advice, or broad architecture redesign. For a large standard that conflicts with current architecture, create a spec first.

## Definition of Done

- The repository shape, language stack, package manager, existing checks, CI, hooks, and instruction files were inspected first.
- A Baseline, Standard, or Hardened profile is selected and documented with data classification when relevant.
- Existing working tools and command names are preserved unless they conflict with the selected standard.
- Missing formatter, linter, typecheck, tests, coverage, mutation, security, cleanup, and AI-risk checks are added only where they fit the repo.
- Coverage thresholds are set to the repository's current measured totals first, then only ratcheted upward as coverage improves.
- Strict typing is enforced as an agent behavior: use the narrowest practical types and avoid `any`, `unknown`, dynamic/object escape hatches, or broad casts unless no safer boundary type exists.
- Linting and typecheck rules are treated as quality gates. Disabling a rule requires a documented, local, narrow justification after first attempting a typed/code-level fix.
- A universal agent quality hook is installed or adapted so AI file changes run an existing linter/check when one is detectable, and pass silently when none exists.
- A universal `.env` guard is installed or adapted so existing `.env` files cannot be read or changed by AI tools; `.env.example` remains available for documentation.
- Future agents can find the standard through `AGENTS.md` or an equivalent local instruction file.
- The narrowest meaningful local and CI-oriented verification commands were run or documented if unavailable.

## Workflow

1. Inspect before proposing:
   - languages, repo shape, package manager, frameworks, source/test layout
   - current format, lint, typecheck, test, coverage, mutation, hook, CI, audit, and secret-scan setup
   - existing `.github/hooks`, `.claude/settings.json`, `.codex` or Codex plugin hook config, and `.pi/extensions`
   - existing `AGENTS.md`, `CLAUDE.md`, engineering docs, workflow files, and scripts
   - sensitive-data clues and AI-risk patterns such as test-only fixes, weak assertions, over-mocking, snapshot churn, and hardcoded fixtures
2. Load references:
   - Always read [references/core-standard.md](references/core-standard.md), [references/initialization-workflow.md](references/initialization-workflow.md), and [references/ai-assisted-development.md](references/ai-assisted-development.md).
   - For TypeScript browser apps, read [references/typescript-frontend.md](references/typescript-frontend.md).
   - For TypeScript services, CLIs, workers, and Node libraries, read [references/typescript-backend.md](references/typescript-backend.md).
   - For Python repos, read [references/python.md](references/python.md).
   - For Vitest/V8 coverage wiring, read [references/adapters-vitest-v8.md](references/adapters-vitest-v8.md).
   - For pytest/coverage.py wiring, read [references/adapters-pytest-coveragepy.md](references/adapters-pytest-coveragepy.md).
   - When updating GitHub Actions, read [references/github-actions-snippets.md](references/github-actions-snippets.md).
   - When writing target-repo docs, adapt [templates/engineering-standard.md](templates/engineering-standard.md) and [templates/AGENTS.md](templates/AGENTS.md).
3. Choose the target profile:
   - Baseline: small tools, internal automations, low-risk libraries.
   - Standard: production apps, APIs, services, and internal business-data systems.
   - Hardened: internet-facing or sensitive-data systems. Ask before applying Hardened if the user did not request it.
4. Produce a gap analysis before editing:
   - existing and preserved tools
   - missing checks and docs
   - conflicting workflows to remove or consolidate
   - stale tests, fixtures, snapshots, mocks, helper files, or generated artifacts to inspect
   - targeted questions that cannot be answered from the repo
5. Implement only the selected standard:
   - normalize scripts to one fast local check, one full check, and one CI verification command where practical
   - keep pre-commit fast; put mutation, cleanup, and heavier AI-risk checks in CI or nightly unless the repo is small
   - start heuristic AI-risk checks in warning mode on legacy repos; make them blocking only after cleanup or explicit approval
   - prefer precise domain, inferred, generic, discriminated-union, branded, schema-derived, and readonly/container types over broad fallback types
   - do not use lint-disable comments, weakened lint config, `// @ts-ignore`, `type: ignore`, or equivalent bypasses to make staged checks pass unless the underlying tool is wrong and the exception is the narrowest possible line-level waiver
   - install or adapt the universal quality guard hook from [scripts/samples/quality-guard.mjs](scripts/samples/quality-guard.mjs), usually into `.github/hooks/quality-guard.mjs`; it must:
     - block AI access to an existing `.env` file for read/search/list/write/edit tools while allowing `.env.example`
     - block search/list scopes that include an existing `.env`
     - run after successful AI edit/write-style operations
     - detect possible file changes from AI shell operations by comparing git status before and after the command
     - block AI test-only worktree changes when changed test files exist and no implementation files changed
     - detect an existing linter/check first, using `make lint`, package scripts (`lint`, `check:fast`, `check`), Python Ruff from `pyproject.toml`, or pre-commit
     - no-op when no linter/check exists
   - wire the universal hook for installed agents without mutating user-level config:
     - Claude: merge [scripts/samples/claude-settings-hooks.json](scripts/samples/claude-settings-hooks.json) into project `.claude/settings.json`
     - Codex: provide repo-local config from [scripts/samples/codex-hooks.toml](scripts/samples/codex-hooks.toml) or plugin hooks from [scripts/samples/codex-plugin-hooks.json](scripts/samples/codex-plugin-hooks.json)
     - PI: copy [scripts/samples/pi-quality-guard.ts](scripts/samples/pi-quality-guard.ts) into `.pi/extensions/quality-guard.ts` as the thin adapter
   - when the repo lacks a standard executor, adapt [scripts/run-coding-standard.sh](scripts/run-coding-standard.sh) and the samples in [scripts/samples/](scripts/samples/)
   - update `.env.example`, CI workflows, hooks, engineering docs, and local agent instructions only when applicable
6. Verify and repair:
   - run the narrowest commands that prove the new wiring works
   - fix issues introduced by the standard changes
   - report assumptions, skipped checks, and what is enforced locally versus in CI

## Decision Table

| Situation | Default action |
| --- | --- |
| Multiple package managers exist | Preserve the manager used by lockfiles and current scripts; ask only if evidence conflicts. |
| Existing tool partly satisfies the standard | Extend it instead of replacing it. |
| No profile specified | Use Baseline for small tools/libraries, Standard for production apps/services, and ask before Hardened. |
| Monorepo with mixed stacks | Apply shared policy at root and stack-specific tooling per package. |
| Legacy repo with many heuristic warnings | Add warning-mode checks and document cleanup before blocking CI. |
| Coverage exists without thresholds | Set thresholds to current measured totals so future changes cannot lower coverage; increase only when the measured score improves. |
| Coverage is present but weak | Add behavioral test guidance and critical-module mutation checks; do not treat coverage alone as done. |

## Gotchas

- Do not ask for information the repository can answer. Inspect first.
- Do not add a second formatter, linter, package manager, test runner, or CI command when one can be extended.
- Do not delete or rewrite tests just to satisfy cleanup. Prove they are stale or obsolete first.
- Do not weaken typing or disable linting to pass local or staged checks. Fix the code first; use a waiver only with a concrete reason and the smallest possible scope.
- Do not mutate trivial glue code to improve mutation scores. Target domain rules, validation, permissions, calculations, and parsing.
- Do not silently bless snapshot churn. Require a behavioral reason for changed snapshots.

## Skill Layout

- [agents/openai.yaml](agents/openai.yaml): UI metadata and default prompt.
- `references/`: standards, runtime defaults, CI snippets, and adapter guidance. Load only the files named in the workflow.
- [scripts/run-coding-standard.sh](scripts/run-coding-standard.sh): portable runner for fast, full, CI, and pre-commit checks. Use `--help` before adapting it.
- [scripts/samples/](scripts/samples/): sample Makefile, package scripts, pre-commit config, universal quality guard hook, agent hook wiring, and GitHub Actions wiring for target repos.
- `templates/`: starting points for files written into target repositories. Adapt before use; do not copy blindly.

## Output

When planning or reporting, use:

```markdown
## Gap Analysis
- Existing:
- Preserve:
- Missing:
- Conflicts:
- Questions:

## Changes
- [file]: [change]

## Verification
- [command]: [result]
- Residual risk:
```
