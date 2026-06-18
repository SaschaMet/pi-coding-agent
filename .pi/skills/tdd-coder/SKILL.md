---
name: tdd-coder
description: Use this skill only when the user explicitly asks for TDD, test-first implementation, red-green-refactor, or strict test-driven changes. Implement features, fixes, and refactors by writing failing tests first, adding minimal production code, refactoring after green, and validating coverage. Do not use for ordinary coding requests.
---

# TDD Coding

Strict test-driven development with phased red-green-refactor cycles.
Write failing tests first, implement the smallest change to pass, refactor, and validate coverage.
Run Red, Green, and Refactor phases in the parent session by default. Use subagents only when the user explicitly asks for delegated TDD work. The parent session coordinates scope, sequencing, validation, and final reporting.

## Core Rules

- Always write or update tests before production code.
- One behavior change per red-green-refactor cycle.
- Keep test data local, deterministic, and minimal.
- Reuse existing test frameworks and coverage tooling — do not invent new setups without asking.
- Investigate root causes when tests fail. Never silence a failure without verifying behavior.
- Keep changes narrowly scoped. No drive-by refactors.
- Preserve CARDS during each cycle: clarity of intent, correct dependency direction, local change impact, invalid-state prevention, and separation of domain/orchestration/IO concerns.
- Notebooks are out of scope unless explicitly requested.
- Use the available file-edit tool for edits. Use the available shell/command tool for test and coverage runs.

## Gotchas

- A test that passes immediately is not a valid Red phase; rewrite it or pick the next behavior.
- Do not ask about integration tests when the user already specified test scope or the change is clearly unit-level.
- Do not add dependencies or new test infrastructure when existing tooling can cover the behavior.
- Coverage targets apply to changed paths; avoid broad test padding.
- Do not make a test pass by adding cross-layer shortcuts, broad nullable states, casts, dynamic maps, or mixed concerns.

## Workflow

### Step 0 — Discovery & Setup

Read all project config files you need in a single parallel batch before writing anything.
Use `rg --files` to map the project layout; use `rg` for fast text searches instead of `grep`.

Check:

- Languages, frameworks, test runners, coverage tools, CI config
- `pyproject.toml`, `package.json`, `Makefile`, `pom.xml`, `Cargo.toml`, etc.
- Existing test conventions: file naming, directory layout, assertion style
- Project-level test instructions: `.github/instructions/testing.instructions.md`, `CONTRIBUTING.md`

Detect exact test and coverage commands. Reuse documented commands unchanged.
If no test setup exists, propose the smallest viable addition and confirm with the user before proceeding.

### Step 1 — Scope & Test Strategy

Clarify only decisions the repository and request do not answer before writing code:

| Situation | Default test strategy |
| --- | --- |
| Unit-level behavior or already-scoped request | Add/update unit tests only; do not ask about integration tests. |
| Public API, CLI, file I/O, pipeline, or black-box behavior | Ask whether integration tests are needed; if yes, follow [references/integration-test-workflow.md](references/integration-test-workflow.md). |
| Repository has coverage threshold | Use the repository threshold. |
| No coverage threshold exists | Target 70% for changed code paths when coverage tooling exists. |
| Coverage tooling is missing | Ask before adding coverage dependencies or config; otherwise report coverage unavailable. |

Record each planned TDD cycle in `update_plan` before starting.
For each cycle that touches architecture or domain logic, also record the owner module, dependency boundary, invariant under test, and invalid state that must be rejected or made unrepresentable.

### Step 2 — Red Phase (Write Failing Tests)

Follow [references/red-phase.md](references/red-phase.md).

1. Read relevant existing test files, write one failing unit test for the current cycle, and run the narrowest test scope.
2. Confirm failure for the expected reason.
3. When the behavior touches domain rules, write the Red test against the invariant or invalid state, not only the happy path.
4. If integration tests were requested, write failing integration tests using collected input/output pairs and confirm they fail.
5. Do NOT write production code.

Mark the Red step completed in `update_plan`.

### Step 3 — Green Phase (Minimal Implementation)

Follow [references/green-phase.md](references/green-phase.md).

1. Read the failing test output and production files needed for the fix.
2. Write the smallest production code change that makes the failing tests pass.
3. Keep the implementation inside the owning module or boundary; do not bypass architecture to satisfy the test.
4. Re-run the exact same test command until tests pass.
5. Run the nearest broader affected test scope.
6. Do NOT add features, optimize, or refactor in this phase.

Mark the Green step completed in `update_plan`.

### Step 4 — Refactor Phase

Follow [references/refactor-phase.md](references/refactor-phase.md).

1. Refactor only after Green passes.
2. Apply one CARDS improvement at a time when useful: clearer names/types, restored dependency direction, smaller change surface, stronger invariant representation, or cleaner concern separation.
3. Re-run all affected tests after each change.
4. If any test fails, revert only the refactor change and investigate.
5. Do NOT add new functionality.

Mark the Refactor step completed in `update_plan`.

### Step 5 — Loop or Complete

- If more behaviors remain, return to Step 2 for the next cycle.
- When all behaviors are covered, proceed to validation.

### Step 6 — Validate & Report

1. Run the full affected test suite using the available shell/command tool.
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
- If tests exist but coverage is missing, ask before adding coverage dependencies or config; otherwise report coverage unavailable.
- If no test setup exists, propose the smallest viable setup and ask before adding dependencies.
- Check existing config files first (`pyproject.toml`, `requirements.txt`, `package.json`, service-local config).

## Completion Criteria

- Unit tests were added or updated before production code.
- Targeted unit tests pass.
- Integration tests were added only if requested, with exact input/output pairs.
- Integration tests pass when present.
- Nearby affected tests pass.
- Coverage was measured when possible and meets repository threshold or changed-path target.
- No notebook tests were added unless explicitly requested.

## Delegated Execution Examples

Use these examples only when the user explicitly asks for delegated TDD work. Use foreground agents because each TDD phase depends on the prior phase output.

Examples:

### Red

```text
Agent({
  subagent_type: "generic-worker",
  description: "TDD red phase",
  prompt: "Run the Red phase for this TDD cycle. Objective: <behavior>. Scope: <test files/areas>. Read references/red-phase.md from the tdd-coder skill directory and relevant existing tests. Write or update tests only. Do not edit production code. Run the narrowest test command: <command>. Return: tests changed, command run, expected failure evidence, and next Green scope."
})
```

### Green

```text
Agent({
  subagent_type: "generic-worker",
  description: "TDD green phase",
  prompt: "Run the Green phase for this TDD cycle. Use this Red output: <red-agent-output>. Scope: <production files/areas>. Read references/green-phase.md from the tdd-coder skill directory and the relevant production files. Make the smallest production change to pass the failing tests. Do not refactor or add extra behavior. Run the exact Red test command until it passes, then run nearest broader affected tests. Return: production files changed, commands run, pass evidence, and Refactor candidates."
})
```

### Refactor

```text
Agent({
  subagent_type: "generic-worker",
  description: "TDD refactor phase",
  prompt: "Run the Refactor phase for this TDD cycle. Use this Green output: <green-agent-output>. Read references/refactor-phase.md from the tdd-coder skill directory. Apply only behavior-preserving improvements. Re-run affected tests after each change. If a refactor breaks tests, revert only that refactor change. Return: refactors made, commands run, pass evidence, or 'no refactor needed'."
})
```

This skill-specific orchestration:

- Parent session owns `update_plan`, phase sequencing, and final report.
- If delegated TDD is explicitly requested, Red, Green, and Refactor agents run sequentially, not in parallel.
- Each delegated agent gets exact file ownership and commands.
- If a delegated phase agent fails, stop and report the exact failure. Do not continue to the next phase.

## Response Contract

Report in this order:

1. **Tests added** — unit tests first, then integration tests if any.
2. **Production files changed** — list with brief rationale.
3. **Commands executed** — exact test and coverage commands run with exit codes.
4. **Results** — pass/fail for each test scope, coverage percentage.
5. **Blockers** — any remaining issues with the smallest next action.
