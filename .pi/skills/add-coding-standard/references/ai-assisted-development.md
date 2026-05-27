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
- Dead tests, stale fixtures, and stale snapshots left behind after refactors.

## Mitigations

Use layered controls:
- changed-line coverage
- mutation testing on critical modules
- review triggers for test-only diffs
- checks for orphaned tests
- checks for stale snapshots and fixtures
- checks for tests with no production execution where tooling supports it
- behavioral assertions over call-count assertions

## Review triggers

Flag these patterns in warning mode at minimum:

- test-only changes that claim a production bug is fixed
- lowered assertions, widened snapshots, or deleted edge cases
- fixture changes without production behavior evidence
- mocks replacing real validation, parsing, permission, retry, or serialization paths
- hardcoded branches matching visible examples

## Policy recommendation

Start heuristic checks in warning mode on existing repos.
Promote them to blocking CI after cleanup and stabilization.
