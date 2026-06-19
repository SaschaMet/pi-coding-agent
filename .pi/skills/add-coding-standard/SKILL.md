---
name: add-coding-standard
description: Use this skill when the user asks to add, initialize, harden, standardize, or audit a repository's coding standard, quality gates, CI checks, hooks, tests, coverage, mutation testing, copy/paste detection, security checks, or AI-development guardrails. Use it for repo-wide standards work, not ordinary feature implementation, isolated lint fixes, or generic coding advice.
---

# Add Coding Standard

Install or audit a profile-based engineering standard with the smallest repo-specific change that makes the standard executable.

## Trigger Boundary

Use for repo-wide quality standards: formatter, linter, typing, tests, coverage, mutation testing, copy/paste detection, security checks, hooks, CI, cleanup checks, and AI-development guardrails.

Do not use for ordinary feature work, one-off lint fixes, generic code advice, or broad architecture redesign. For a large standard that conflicts with current architecture, create a spec first.

## Definition of Done

- The repository shape, language stack, package manager, existing checks, CI, hooks, and instruction files were inspected first.
- A Baseline, Standard, or Hardened profile is selected and documented with data classification when relevant.
- Existing working tools and command names are preserved unless they conflict with the selected standard.
- Missing formatter, linter, typecheck, tests, coverage, mutation, duplicate-code, security, cleanup, and AI-risk checks are added only where they fit the repo.
- CARDS architecture guardrails are documented where the repo has meaningful architecture boundaries: Clarity, Alignment, Resilience, Domain Integrity, and Separation.
- Strict typing is enforced as an agent behavior: use the narrowest practical types and avoid `any`, `unknown`, dynamic/object escape hatches, or broad casts unless no safer boundary type exists.
- Public and non-trivial functions, methods, and classes have concise purpose-focused documentation comments in the language's local convention, such as JSDoc/TSDoc, Python docstrings, or equivalent.
- A lint, doc-lint, or equivalent static rule checks required documentation comments when the repo's language/tooling supports it.
- Linting and typecheck rules are treated as quality gates. AI agents must not add or expand lint ignore rules, lint-disable comments, ignored type errors, weakened lint config, or broad ignore patterns to pass checks; any exception requires explicit repository-owner/user approval.
- A universal agent session-end lint hook is installed or adapted so an existing linter/check runs when the agent session ends, reports informational results, always exits successfully, and passes silently when none exists.
- A universal `.env` guard is installed or adapted so existing `.env` files cannot be read or changed by AI tools; `.env.example` remains available for documentation.
- Future agents can find the standard through `AGENTS.md` or an equivalent local instruction file.
- The narrowest meaningful local and CI-oriented verification commands were run or documented if unavailable.

## Workflow

Before Step 1, check whether `graphify-out/graph.json` exists at the target repository root. If it exists, use `graphify query` for architecture, dependency, ownership, duplicate-hotspot, and cross-file relationship questions before falling back to manual traversal. If no graph exists and the standard work is architecture-heavy, monorepo-wide, or unclear from local file inspection, run `graphify <path> --mode deep --no-viz` before producing the gap analysis; otherwise continue with direct repo inspection. Treat graph output as supporting evidence, not a substitute for reading the exact files you will edit.

1. Inspect before proposing:
   - languages, repo shape, package manager, frameworks, source/test layout
   - current format, lint, typecheck, test, coverage, mutation, copy/paste detection, hook, CI, audit, and secret-scan setup
   - existing `.github/hooks`, `.github/copilot`, `.claude/settings.json`, `.codex` or Codex plugin hook config, and `.pi/extensions`
   - existing `AGENTS.md`, `CLAUDE.md`, engineering docs, workflow files, and scripts
   - sensitive-data clues and AI-risk patterns such as test-only fixes, weak assertions, over-mocking, snapshot churn, and hardcoded fixtures
   - existing architecture boundaries, dependency direction, domain invariants, invalid-state handling, and separation between domain, orchestration, IO, and presentation
   - graphify evidence when available: god nodes, surprising connections, community boundaries, dependency paths, and duplicate or cross-cutting hotspots relevant to the standard
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
   - duplicate-code hotspots and whether copy/paste detection should warn locally or block CI
   - CARDS gaps: unclear intent, wrong-way dependencies, broad change blast radius, invalid domain states, or mixed concerns
   - graphify-backed relationship findings, including source nodes/paths when they affect architecture guardrails or quality-gate placement
   - targeted questions that cannot be answered from the repo
5. Implement only the selected standard:
   - normalize scripts to one fast local check, one full check, and one CI verification command where practical
   - keep pre-commit fast; put mutation, duplicate-code, cleanup, and heavier AI-risk checks in CI or nightly unless the repo is small
   - add copy/paste detection where it fits: preserve existing duplicate-code tooling; otherwise prefer `jscpd@5`/`cpd` with `.jscpd.json`, `gitignore: true`, generated/build/vendor ignores, `threshold` reporter for blocking CI, and `ai` or `json` reporter for agent-readable diagnosis
   - start heuristic AI-risk checks in warning mode on legacy repos; make them blocking only after cleanup or explicit approval
   - prefer precise domain, inferred, generic, discriminated-union, branded, schema-derived, and readonly/container types over broad fallback types
   - document CARDS as executable architecture guidance when architecture boundaries exist: dependency direction, owner modules, invalid-state prevention, and concern separation
   - require concise documentation comments for public and non-trivial functions, methods, and classes; match the repo's existing convention and describe purpose, parameters, returns, side effects, or raised errors only when useful
   - add or tighten the existing linter/doc-linter rule that verifies those required comments when supported, such as JSDoc/TSDoc rules for TypeScript/JavaScript or docstring rules for Python; do not add a competing linter when the current one can be extended
   - do not use lint-disable comments, weakened lint config, `// @ts-ignore`, `type: ignore`, broad ignore patterns, or equivalent bypasses to make staged checks pass; fix the code or stop and request explicit repository-owner/user approval for a line-local documented exception
   - install or adapt the universal `.env` guard from [scripts/samples/block-env-read.sh](scripts/samples/block-env-read.sh), usually into `.github/hooks/scripts/block-env-read.sh`; it must:
     - block AI access to `.env` and `.env.*` files for read/search/list/write/edit tools while allowing `.env.example`
     - block shell commands that target `.env` or `.env.*` files
   - install or adapt the universal session-end lint hook from [scripts/samples/lint-on-session-end.sh](scripts/samples/lint-on-session-end.sh), usually into `.github/hooks/scripts/lint-on-session-end.sh`; it must:
     - run only at session end (`Stop`, `SessionEnd`, or PI `session_shutdown`), not after each edit
     - detect an existing linter/check first, using `make lint`, package scripts (`lint`, `check:fast`, `check`), Python Ruff from `pyproject.toml`, or pre-commit
     - no-op when no linter/check exists
     - always exit 0 because session-end lint is informational, not a blocker
   - wire the universal hook for installed agents without mutating user-level config:
     - Claude: merge [scripts/samples/claude-settings-hooks.json](scripts/samples/claude-settings-hooks.json) into project `.claude/settings.json`
     - Codex: provide repo-local config from [scripts/samples/codex-hooks.toml](scripts/samples/codex-hooks.toml) or plugin hooks from [scripts/samples/codex-plugin-hooks.json](scripts/samples/codex-plugin-hooks.json)
     - GitHub Copilot: add [scripts/samples/github-copilot-hooks.json](scripts/samples/github-copilot-hooks.json) as a repo-level `.github/hooks/*.json` hook file
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
| No duplicate-code detector exists | Add jscpd/cpd in warning mode for Baseline or legacy repos; make it blocking for Standard/Hardened only after establishing a repo-specific threshold. |
| No profile specified | Use Baseline for small tools/libraries, Standard for production apps/services, and ask before Hardened. |
| Monorepo with mixed stacks | Apply shared policy at root and stack-specific tooling per package. |
| Legacy repo with many heuristic warnings | Add warning-mode checks and document cleanup before blocking CI. |
| Coverage is present but weak | Add behavioral test guidance and critical-module mutation checks; do not treat coverage alone as done. |
| Architecture boundaries exist but are undocumented | Query graphify first when `graphify-out/graph.json` exists, then add CARDS guidance to the engineering standard or local agent instructions without forcing a new architecture. |
| Current architecture conflicts with CARDS | Document the conflict and create a spec before changing module boundaries. |

## Gotchas

- Do not ask for information the repository or existing graphify graph can answer. Inspect first.
- Do not add a second formatter, linter, package manager, test runner, or CI command when one can be extended.
- Do not delete or rewrite tests just to satisfy cleanup. Prove they are stale or obsolete first.
- Do not refactor every detected clone blindly. Use copy/paste reports to gate new duplication and target meaningful domain duplication first.
- Do not weaken typing or disable linting to pass local or staged checks. Fix the code first; if the tool is wrong, stop and request explicit repository-owner/user approval before adding the smallest documented line-local exception.
- Do not impose new layers just to satisfy CARDS. Preserve the local architecture and add guardrails for dependency direction, invariant ownership, and concern separation.
- Do not mutate trivial glue code to improve mutation scores. Target domain rules, validation, permissions, calculations, and parsing.
- Do not silently bless snapshot churn. Require a behavioral reason for changed snapshots.

## Skill Layout

- [agents/openai.yaml](agents/openai.yaml): UI metadata and default prompt.
- `references/`: standards, runtime defaults, CI snippets, and adapter guidance. Load only the files named in the workflow.
- [scripts/run-coding-standard.sh](scripts/run-coding-standard.sh): portable runner for fast, full, CI, and pre-commit checks. Use `--help` before adapting it.
- [scripts/samples/](scripts/samples/): sample Makefile, package scripts, jscpd config, pre-commit config, `.env` guard, session-end lint hook, agent hook wiring, and GitHub Actions wiring for target repos.
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
