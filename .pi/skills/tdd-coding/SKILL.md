---
name: tdd-coding
description: Implement features, bug fixes, and refactors with strict test-driven development. Runs phased red-green-refactor cycles with unit tests first, optional integration tests with user-defined input/output pairs, and coverage validation. Use when code must be written or modified following TDD discipline.
---

# TDD Coding

Strict test-driven development with phased red-green-refactor cycles.
Write failing tests first, implement the smallest change to pass, refactor, and validate coverage.

## Core Rules

- Always write or update tests before production code.
- One behavior change per red-green-refactor cycle.
- Keep test data local, deterministic, and minimal.
- Reuse existing test frameworks and coverage tooling — do not invent new setups without asking.
- Investigate root causes when tests fail. Never silence a failure without verifying behavior.
- Keep changes narrowly scoped. No drive-by refactors.
- Notebooks are out of scope unless explicitly requested.
- Use `apply_patch` for all file edits. Use `shell_command` for all test and coverage runs.

## Workflow

### Step 0 — Discovery & Setup

Read all project config files you need in a single parallel batch before writing anything.
Use `rg --files` to map the project layout; use `rg` for fast text searches instead of `grep`.

Check:
- Languages, frameworks, test runners, coverage tools, CI config
- `pyproject.toml`, `package.json`, `Makefile`, `pom.xml`, `Cargo.toml`, etc.
- Existing test conventions: file naming, directory layout, assertion style
- Project-level test instructions: `.github/instructions/testing.instructions.md`, `CONTRIBUTING.md`

Detect exact test and coverage commands. Reuse them unchanged.
If no test setup exists, propose the smallest viable addition and confirm with the user before proceeding.

### Step 1 — Scope & Test Strategy

Clarify with the user before writing any code:

1. **Unit tests** — always created. Confirm scope.
2. **Integration tests** — ask whether the user wants them.
   - If yes, follow the [integration test workflow](references/integration-test-workflow.md).
   - Collect input/output pairs from the user.
   - Help create fixture files when inputs or outputs are complex.
3. **Coverage target** — use the repository threshold if configured; otherwise default to 70% for changed code paths.

Record each planned TDD cycle in `update_plan` before starting.

### Step 2 — Red Phase (Write Failing Tests)

Follow [references/red-phase.md](references/red-phase.md).

1. Read all relevant existing test files in a parallel batch before writing.
2. Write one failing unit test that asserts the expected behavior for the current cycle.
3. Run the narrowest test scope using `shell_command` and confirm failure for the expected reason.
4. If integration tests were requested, write failing integration tests using collected input/output pairs and confirm they fail.
5. Do NOT write any production code in this phase.

Mark the Red step completed in `update_plan`.

### Step 3 — Green Phase (Minimal Implementation)

Follow [references/green-phase.md](references/green-phase.md).

1. Read all files you need to edit in a parallel batch before making any change.
2. Write the smallest production code change that makes the failing tests pass. Use `apply_patch` for all edits.
3. Re-run the exact same test command using `shell_command` until tests pass.
4. Run the nearest broader affected test scope.
5. Do NOT add features, optimize, or refactor in this phase.

Mark the Green step completed in `update_plan`.

### Step 4 — Refactor Phase

Follow [references/refactor-phase.md](references/refactor-phase.md).

1. Apply one improvement at a time using `apply_patch`.
2. Re-run all affected tests using `shell_command` after each change.
3. If any test fails, revert the change and investigate. Do NOT add new functionality.

Mark the Refactor step completed in `update_plan`.

### Step 5 — Loop or Complete

- If more behaviors remain, return to Step 2 for the next cycle.
- When all behaviors are covered, proceed to validation.

### Step 6 — Validate & Report

1. Run the full affected test suite using `shell_command`.
2. Run coverage when tooling is available.
3. Verify coverage meets the repository threshold or at least 70% for changed code paths.
4. If coverage is short, add focused behavior tests — not brittle padding.
5. Report results per the Response Contract below.

## Integration Test Rules

- Integration tests are black-box: given input → assert expected output.
- Small input/output pairs (< 10 lines): define inline in the test.
- Large or complex pairs: store as fixture files in the test fixtures directory.
- Fixture files must be deterministic and committed alongside tests.
- Follow [references/fixture-patterns.md](references/fixture-patterns.md) for naming and structure.
- Never hard-code environment-specific values (absolute paths, live URLs, secrets) in fixtures or tests.
- Tag or mark integration tests so they can be run separately from unit tests.

## Coverage Requirements

- Run a reproducible coverage command when available.
- Meet the repository threshold if configured.
- If no threshold exists, target at least 70% coverage for changed code paths; prefer 80%+ when practical.
- If coverage falls short, add focused behavior tests instead of brittle padding.
- If coverage cannot run, report the exact blocker and leave tests runnable.

## Missing Tooling Decision Rules

- If unit test tooling exists, use it directly.
- If tests exist but coverage is missing, add only minimal coverage setup for touched code.
- If no test setup exists, propose the smallest viable setup and ask before adding dependencies.
- Check existing config files first (`pyproject.toml`, `requirements.txt`, `package.json`, service-local config).

## Completion Criteria

- [ ] Unit tests added first in TDD sequence.
- [ ] All targeted unit tests pass.
- [ ] Integration tests added if requested, with correct input/output pairs.
- [ ] All integration tests pass (if applicable).
- [ ] Nearby affected tests pass.
- [ ] Coverage measured when possible.
- [ ] Coverage meets threshold (project default or 70% minimum).
- [ ] No notebook tests added unless explicitly requested.

## Response Contract

Report in this order:

1. **Tests added** — unit tests first, then integration tests if any.
2. **Production files changed** — list with brief rationale.
3. **Commands executed** — exact test and coverage commands run with exit codes.
4. **Results** — pass/fail for each test scope, coverage percentage.
5. **Blockers** — any remaining issues with the smallest next action.
