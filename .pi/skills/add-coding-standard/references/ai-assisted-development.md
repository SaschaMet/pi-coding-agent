# Reference: AI-Assisted Development

Use this reference on every run. It defines guardrails against false confidence from AI-generated changes.

## Core idea

AI assistants can optimize for visible success signals such as passing tests or satisfying prompts.
A good coding standard must defend against false confidence.

## Common scenarios

- Tests changed instead of implementation fixed.
- Assertions weakened to make tests pass.
- Hardcoded branches added for visible sample inputs.
- Snapshot churn used to bless regressions.
- Tests added that do not execute production code.
- Over-mocking that bypasses real behavior.
- Coverage raised while branch quality and mutation resistance remain weak.
- Copy/pasted implementation added to satisfy one visible scenario instead of extracting or reusing existing behavior.
- Dead tests, stale fixtures, and stale snapshots left behind after refactors.
- Type errors bypassed with `any`, `unknown`, broad casts, `type: ignore`, `// @ts-ignore`, or equivalent escape hatches.
- Lint rules disabled or weakened to satisfy staged checks instead of fixing the code.

## Mitigations

Use layered controls:
- session-end AI hooks that run the repository's existing linter/check once when the agent session ends
- AI tool guards that block reads, searches, listings, and mutations of existing `.env` files
- changed-line coverage
- mutation testing on critical modules
- copy/paste detection for duplicated implementation logic
- review triggers for test-only diffs
- checks for orphaned tests
- checks for stale snapshots and fixtures
- checks for tests with no production execution where tooling supports it
- behavioral assertions over call-count assertions
- strict-type review for newly introduced broad types, casts, and ignore comments
- lint-disable review that rejects broad, file-level, config-level, or unjustified waivers

## Review triggers

Flag these patterns in warning mode at minimum:

- test-only changes that claim a production bug is fixed
- lowered assertions, widened snapshots, or deleted edge cases
- fixture changes without production behavior evidence
- mocks replacing real validation, parsing, permission, retry, or serialization paths
- hardcoded branches matching visible examples
- new or expanded duplicated production code, especially validation, permissions, parsing, retries, serialization, calculations, and data mapping
- new or expanded `any`, `unknown`, `object`, untyped containers, broad casts, or ignored type errors without proof that no precise type is practical
- new lint-disable comments or weakened lint configuration, especially near changed code

## Policy recommendation

Start heuristic checks in warning mode on existing repos.
Promote them to blocking CI after cleanup and stabilization.

## Duplicate-code detection

Prefer existing duplicate-code tooling when present. Otherwise use `jscpd@5`/`cpd` for JavaScript, TypeScript, Python, and mixed repos because it supports broad language detection, `.jscpd.json`, `gitignore`, threshold exits, SARIF, JSON, and token-efficient `ai` reports.

Default wiring:
- Baseline or legacy repo: warning mode, usually `cpd . --reporters ai,json --output reports/jscpd`, and document top clones for cleanup.
- Standard/Hardened: blocking CI after a baseline threshold is chosen, usually with `threshold` plus `json` or `sarif` reporters.
- Exclusions: generated files, build outputs, vendored code, dependencies, lockfiles, fixtures, snapshots, coverage, and report directories unless explicitly in scope.
- Triage: prioritize duplicated domain logic over tests or glue; use reports to prevent new duplication, not to force broad churn.
