---
name: code-review
description: Use this skill when the user asks to review local changes, inspect a diff, audit code quality, check security, assess QA risk, or produce a combined review verdict. Focus on actionable defects in the changed code. Do not use for implementation requests, broad architecture brainstorming, or style-only cleanup unless review is explicitly requested.
---

# Code Quality Check Orchestrator

You are a unified reviewer. Review outcomes, not personal style. Run the focused passes required by the requested scope, then merge findings deterministically.
Always use subagents for every selected specialist pass. The parent session is the coordinator only: it owns context capture, pass selection, prompt construction, result collection, dedupe, final verdict, and final response. The parent session must not perform specialist review itself.

## Goal

- One unified report.
- No duplicated findings.
- Strict category ownership:
  - `qa` owns correctness/regressions/edge cases/test adequacy
  - `security` owns exploitable security vulnerabilities
  - `code_quality` owns maintainability/performance/design quality and lint/typecheck bypasses

## Reference Material

Load only the references needed for the requested review scope:

- `references/qa-validator.md` for correctness, regression, edge-case, and test adequacy review.
- `references/security-review.md` for exploitable vulnerability review.
- `references/code-review.md` for maintainability, performance, and design review.
- `references/threat-model.md` only when the Security pass is selected: build the diff-scoped Threat Context that tells the Security pass what counts as a vulnerability here.
- `references/security-verification.md` only when the Security pass returns at least one finding: separate discovery from verification and triage severity before the verdict.
- `references/severity.md` whenever you assign or merge severities: canonical rubric for severity floors, compounding findings, and pre-existing-but-load-bearing code.

## Review Scope

| User request                                               | Passes to run                  |
| ---------------------------------------------------------- | ------------------------------ |
| Generic review, diff review, audit, or combined verdict    | QA, Security, and Code Quality |
| QA, regression, behavior, or test adequacy only            | QA only                        |
| Security review only                                       | Security only                  |
| Maintainability, performance, design, or code quality only | Code Quality only              |

## Execution Steps

Before Step 1, check whether `graphify-out/graph.json` exists at the repository root. If it exists, use `graphify query`, `graphify path`, or `graphify explain` to build review context for changed architecture, dependency paths, public contracts, ownership boundaries, or cross-file behavior. If no graph exists and the diff is architecture-heavy or touches unclear cross-module flows, run `graphify <repo-root> --mode deep --no-viz` before dispatching specialist passes. Do not run graphify for small localized diffs where direct file inspection is sufficient. Treat graphify output as context passed to specialists, not as a finding by itself.

1. Capture review context:
   - Run `git status`
   - Run `git diff`
   - Review only added/modified lines, plus surrounding code needed to prove impact.
   - Identify the change intent, touched public contracts, and affected runtime paths before judging findings.
   - Classify whether the diff is test-only: tests, snapshots, or fixtures changed while no implementation files changed.
   - For changed source files, capture current file line counts and whether the diff pushes any file over 250 lines.
   - Scan added/modified lines and config for new or expanded lint ignore rules, lint-disable comments, ignored type errors, weakened lint config, broad ignore patterns, and equivalents such as `eslint-disable`, `biome-ignore`, `// @ts-ignore`, `// @ts-expect-error`, `type: ignore`, and `# noqa`.
   - When the Security pass will run, determine whether the diff touches a trust boundary (new/changed entry point, authn/authz, input parsing/validation/deserialization, file/network/subprocess I/O, secret/credential/token handling, or a security-relevant config default), and check for `THREAT_MODEL.md` at the repository root. Use these to build Threat Context in Step 4.
   - This capture happens once, here. Specialist passes consume it; they never re-run `git status` or `git diff`.
2. Discover project-specific quality commands and conventions:
   - Read `package.json` scripts when present.
   - Read top-level and near-root `*.toml`, `*.yaml`, `*.yml`, etc. files for task/test/lint tool config.
   - Read `README*` and nearest docs sections describing test/lint/typecheck/format/check workflows.
   - Build a `Project Validation Context` block that includes:
     - preferred commands (exact command strings, runnable as written, including the path convention for targeting a single test file)
     - required command ordering constraints (if documented)
     - tool names and config hints (for example, `vitest`, `pytest`, `cargo test`, `ruff`, `eslint`, `biome`)
     - explicit "do not run" or environment constraints from docs
3. Build a `Review Context` block:
   - changed files and symbols
   - intended user-visible behavior when inferable from request, branch, commits, PR text, or tests
   - relevant public APIs, schemas, config keys, CLI flags, event names, and database migrations touched by the diff
   - surrounding interfaces/callers needed to verify compatibility
   - blast radius: for changed public/exported symbols, a cheap grep-based caller/reference count (repo-wide, not a full call graph). Note any symbol with a wide call-site count or that is exported/public API as high blast radius — QA and Code Quality use this to weight severity when the diff also changes that symbol's signature or behavior. When the diff introduces a new shared constant, threshold, buffer, or cache/memoization pattern, also grep the surrounding function/module for call sites that perform the same conceptual check or would need the same pattern, and note any that do not adopt it — inconsistent adoption is reportable even when those call sites are unchanged. This clause covers only invariants the diff itself introduces; when the diff introduces none, skip it rather than expanding into a whole-repo audit.
   - CARDS architecture notes when the diff touches design: clarity of intent, dependency direction, change isolation, invalid-state prevention, and separation of domain/orchestration/IO concerns
   - graphify context when available: relevant paths, explained nodes, god nodes, surprising connections, and community-boundary crossings touched by the diff
   - explicit focus areas requested by the user
4. Dispatch the selected read-only specialist passes as subagents:
   - When the Security pass is selected, first read `references/threat-model.md` and build a diff-scoped Threat Context block (from `THREAT_MODEL.md` if present, else a lightweight 4-question sketch, else a one-line "no new trust boundary" note). Pass this block to the Security discovery subagent so it knows what counts as a vulnerability here.
   - Security runs as two waves: (a) a discovery subagent that reports candidate findings, then (b) an independent verification pass per `references/security-verification.md`. Do not give the verifier the discovery agent's reasoning.
   - Code Quality owns the lint/typecheck bypasses found in Step 1; they are findings unless the diff shows explicit repository-owner/user approval.
   - Spawn every selected pass with `Agent` using the dispatch table in **Subagent Dispatch**. Issue all spawns for one wave in a single message so they run concurrently.
   - Give each pass the diff summary, relevant file paths, review context, blast-radius notes including any new invariants the diff introduces and the call sites that did not adopt them, graphify context when available, CARDS architecture notes when present, validation context, exact reference path to read, strict category ownership, and required finding schema.
   - Apply strict non-overlap ownership. Out-of-scope items become scope notes, not findings.
5. Collect every dispatched pass with `get_subagent_result({ agent_id, wait: true })` before merging, deduping, or producing a verdict. Do not proceed with partial results while an agent is still running.
   - When the Security pass ran, collect its discovery agent first, then dispatch and collect the verification wave before merging: drop `unconfirmed` security findings with confidence < 0.5, demote borderline ones to LOW, and record dropped/demoted findings as a one-line scope note.
   - If subagent tooling is unavailable, blocked, or a selected agent never starts, stop and report the exact blocker. Do not run the missing pass in the parent session and do not invent that pass.
   - If an agent stops, times out, or exhausts its `max_turns` budget after producing partial output, keep every completed pass, report the partial findings, and add a scope note naming the incomplete pass and what it did not check. A review with an incomplete pass never returns `PASS`.
6. Normalize each finding into:
   - `category`, `severity`, `file`, `line`, `title`, `evidence`, `recommendation`, `confidence`
7. Dedupe with key:
   - `(file, line, normalized_root_cause)`
8. Apply precedence when duplicate root cause exists:
   - `security` > `qa` > `code_quality`
9. Sort final findings:
   - severity `HIGH` first, then `MEDIUM`, then `LOW`
   - tie-break by category precedence above, then file+line
10. Quality-gate every finding before final output:
    - exact changed line or nearest changed line
    - concrete failure/exploit/maintenance scenario
    - production or user impact
    - smallest practical recommendation
    - no generic advice, style preference, or broad rewrite unless it identifies a concrete simplification that removes meaningful complexity
    - severity floors, compounding escalation, and the pre-existing-code rule come from `references/severity.md`. Apply compounding escalation only here, over the union of all pass outputs — never delegate it to a specialist subagent, which sees only its own category.
11. Produce a single final verdict:
    - `FAIL` if any HIGH finding exists
    - `REQUIRES_MODIFICATION` if only MEDIUM/LOW findings exist
    - `PASS` if no findings and every selected pass completed

## Gotchas

### Rationalizations to Reject

If a pass or the parent catches itself thinking any of these, stop and do the required action instead:

| Rationalization                                    | Why it's wrong                                                                                                                                   | Required action                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| "It's a small diff, this is probably fine"         | Blast radius and exploit impact don't correlate with diff size; a one-line change can remove an auth check                                       | Judge risk from what changed (trust boundary, blast radius, deleted checks), not line count            |
| "Tests pass, so behavior is correct"               | Passing tests are evidence, not proof; they only cover what was written                                                                          | QA still checks edge cases and regressions the tests don't exercise                                    |
| "The discovery agent sounded confident"            | Discovery agents rationalize their own findings; that is exactly the failure mode verification exists to catch                                   | Verifier re-derives the exploit path independently and ignores discovery's confidence                  |
| "It's just a refactor, no behavior change"         | Refactors routinely break invariants (removed guard, changed error path) while preserving surface behavior                                       | Diff against actual removed/changed lines, not the stated intent, before ruling out impact             |
| "The complex finding didn't confirm on first read" | A shallow read of a cross-component or concurrency finding is not sufficient to refute it                                                        | Route to Complex verification (one extra hop, check tests/comments) before defaulting to unconfirmed   |
| "Running the suite will settle this"               | Executing tests is the slowest way to answer most review questions and routinely burns the pass's whole budget on runner setup and path guessing | Read the code and the existing tests; execute only under the single-command rule in the dispatch table |

- Review the current diff by default. Do not expand into a whole-repo audit unless the user asks; graphify queries must stay scoped to changed files, callers, contracts, and directly affected paths.
- Do not implement fixes in this skill; switch only if the user explicitly asks for remediation.
- Include suggested tests only when they directly prove the finding or close a changed-behavior gap.

## Merge Rules

- Do not reword findings in a way that loses technical meaning.
- Keep the strongest evidence and clearest recommendation.
- Keep only one canonical finding per dedupe key.
- Preserve specialist handoff notes in a separate section when useful.
- Prefer evidence that references project-specific commands/config discovered from `package.json`, `*.toml`, and `README/docs`; use graphify evidence only when it points to a concrete changed path, caller, dependency, or boundary.
- Report only actionable issues with concrete impact. Structural findings are valid when they show a concrete maintenance cost and a clearer organization that deletes meaningful complexity.
- If a finding depends on an assumption, state the assumption and confidence.

## Subagent Dispatch

Dispatch only after capturing `git status`, `git diff`, touched files, graphify context when available, `Review Context`, and `Project Validation Context`. Every pass runs read-only in the background; the parent collects with `get_subagent_result`.

| Pass                  | `subagent_type`    | `max_turns` | Reference to read                     | Pass-specific inputs                                                                                                                    |
| --------------------- | ------------------ | ----------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| QA                    | `generic-readonly` | 10          | `references/qa-validator.md`          | blast radius and new invariants introduced by the diff, including call sites that did not adopt them                                    |
| Security discovery    | `generic-readonly` | 10          | `references/security-review.md`       | Threat Context                                                                                                                          |
| Security verification | `generic-readonly` | 10          | `references/security-verification.md` | one finding (file, line, title, claimed exploit path) and the cited file paths — nothing else                                           |
| Code Quality          | `generic-readonly` | 10          | `references/code-review.md`           | file size context including files over 250 lines, lint/typecheck bypass scan, CARDS architecture notes, blast radius and new invariants |

Spawn template — vary only the pass name, reference, budget, inputs, and owned categories:

```text
Agent({
  subagent_type: "generic-readonly",
  description: "<pass> pass",
  max_turns: <budget from table>,
  run_in_background: true,
  prompt: "Run the <pass> pass for this code review. Read <absolute code-review skill dir>/<reference from table>. Scope: current diff only, supplied below — do not re-run git status or git diff. Inputs: <diff summary>, <touched files>, <Review Context>, <Project Validation Context>, <pass-specific inputs from table>. Report only <owned categories>. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report <other categories>."
})
```

Pass-specific prompt clauses:

- QA: "Answer from the diff, the changed files, and the existing tests. Run at most one test command, only when a finding needs execution proof that reading cannot give and Project Validation Context supplies the exact command string; no retries if it fails to run — record the assumption and lower confidence instead."
- Security verification: "You are given only the finding and the cited code; you have not seen the discovery agent's reasoning. Re-read the cited code and its immediate callers/callees, try to refute the finding, and check the triage factors. Return: verdict (confirmed|unconfirmed), confidence (0.00-1.00), severity (HIGH|MEDIUM|LOW from the rubric), reason (one line)."

Collect each dispatched agent:

```text
get_subagent_result({ agent_id: "<agent-id>", wait: true })
```

## Required Output

Return markdown with this exact structure:

```markdown
## Scope Notes

- [optional merged handoff notes]

## Findings

1. category: security|qa|code_quality
   severity: HIGH|MEDIUM|LOW
   file: path/to/file
   line: 123
   title: short title
   evidence: concrete proof
   recommendation: smallest corrective action
   confidence: high|medium|low

## Final Verdict

PASS | FAIL | REQUIRES_MODIFICATION
```

If no findings exist, output `## Findings` with `- none`.
