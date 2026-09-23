---
name: tdd
description: Use this skill for test-driven development (TDD, red-green-refactor) whenever you write or change code — implementing a feature, fixing a bug, refactoring, or adding tests — even if the user never says "TDD". Do not use for docs-only changes, code review ($code-review), or writing specs and plans ($create-spec, $create-plan).
---

# TDD

Write the test first, watch it fail for the right reason, then write the least code that makes it pass. Then refactor the code you touched until it is safe, simple, clean, and fast.

This skill is method only. The rules on when TDD applies live in `.pi/SYSTEM.md`.

## Step 0 - Baseline

1. Run the full suite once before any change. Use the command from the project's `AGENTS.md` (for example `npm test`).
2. Record the pass/fail count and any failing tests that already exist.

Done when the baseline count is recorded.

## Step 1 - Red

1. Pick one behavior. One test covers one behavior.
2. Write the test before any production code.
3. Run only that test.
4. Read the failure. It must fail on an assertion about the behavior.
5. If it fails on an import error, typo, missing fixture, or setup error, fix the test and run it again. If it passes on the first run, break the code on purpose or rewrite the test until it fails.
6. Record the command and the one failure line.

Done when the test fails on an assertion and the failure line is recorded.

## Step 2 - Green

1. Write the least code that makes the test pass. No extra branches, options, or cleanup.
2. If the test still fails, fix the code. Keep the assertion as strict as written.
3. Run the same test. Record the command and the pass line.
4. Run the full suite. Compare it to the baseline.
5. If a test outside your change breaks, stop and report it under the stop-and-report rule.

Done when the new test passes and the suite matches the baseline plus the new test.

## Step 3 - Refactor

Refactor only while all tests are green. Scope: the code this cycle added or changed. Run the passes in order. After each change, re-run the tests. Behavior stays the same; a new behavior starts a new Red. If a test turns red, undo the last change.

1. **Safe (security):**
   - Every external input (user, file, network, env) is validated before use.
   - Errors fail closed: on failure, the code denies, not allows.
   - No secrets, tokens, or personal data in logs, errors, or test fixtures.
   - Paths, shell commands, and queries do not concatenate untrusted input.
2. **Simple (simplicity):**
   - Every branch, parameter, and option has a current caller. Delete the rest.
   - Existing helpers or the standard library replace custom code where they fit.
   - No abstraction with one implementation and no named second caller.
3. **Clean (readability):**
   - Names say what the thing is or does, in the project's naming style.
   - Each function does one thing. Nesting stays at two levels or less where the language allows.
   - No duplicated logic within the changed code.
   - Comments explain why, not what. Remove comments the code already says.
4. **Fast (performance):**
   - **Benchmark exists:** run it before and after. Keep a change only if the numbers improve. Record both numbers.
   - **No benchmark:** read the changed code for clear waste and fix it:
     - repeated work inside loops (same call, lookup, or allocation)
     - a slower algorithm where a simple faster one fits (for example a nested loop where a `Map` or `Set` lookup works)
     - sequential or blocking I/O where the code already has an async or batched path
     - loading or copying more data than the code uses
   - Record one line per fix: what was wasteful and why the new version does less work. Without a benchmark, change only what the code shows is wasteful.

Findings outside the scope go in the session summary as follow-ups. Leave that code as is.

Done when all four passes ran on every changed line and the full suite is green.

## Step 4 - Repeat

Return to Step 1 for the next behavior.

Done when every acceptance criterion in the spec or plan has a passing test.

## Cases

- **Bug fix:** first write a regression test that reproduces the bug. It must fail the way the bug report describes. Then fix.
- **Untested code:** before changing it, write a characterization test. It pins what the code does today, even if that is wrong. Then change it with a normal Red test.
- **No test setup:** add the smallest setup the stack already supports (for example the runner already in `package.json`). Do not add a new framework.
- **Hard to test:** pin current behavior with a characterization test, then extract the logic into a pure function and test that. Keep the untested shell thin.

## Test quality

- Test behavior through the public surface, not internals or private state.
- For guards and checks, test both paths: the blocked action is blocked, the allowed action is allowed.
- Keep tests deterministic: no network, no real clock, no dependence on the user's home directory. Clean up temp files.
- Name tests after the behavior. Do not copy spec or plan IDs into test names or comments.
- Reuse the project's existing test helpers and patterns before writing new ones.

## Evidence

The session summary lists:

- **Baseline:** the pass/fail count before the change.
- **Red:** the command and the one failure line.
- **Green:** the command and the one pass line.
- **Refactor:** per pass (safe, simple, clean, fast), the change made or "no change needed". For fast, the benchmark numbers or the one-line reason per fix.
- **Suite:** the final pass/fail count.
