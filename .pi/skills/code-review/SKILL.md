---
name: code-review
description: Use this skill when the user asks to do a code review, to review local changes, inspect a diff, audit code quality, check security, assess QA risk, or produce a combined review verdict. Focus on actionable defects in the changed code. Do not use for implementation requests, broad architecture brainstorming, or style-only cleanup unless review is explicitly requested.
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

Always load `references/review-context.md` (what to capture in Steps 1-3) and `references/finding-explanation.md` (the `explanation` field every finding carries above its recommendation, passed to every specialist pass). Then load only what the requested scope needs:

- `qa-validator.md` — correctness, regression, edge-case, test adequacy.
- `security-review.md` — exploitable vulnerabilities.
- `code-review.md` — maintainability, performance, design.
- `threat-model.md` — only when Security is selected: build the diff-scoped Threat Context that defines what counts as a vulnerability here.
- `security-verification.md` — only when Security returns at least one finding: separate discovery from verification and triage severity before the verdict.
- `severity.md` — whenever you assign or merge severities: severity floors, compounding findings, pre-existing-but-load-bearing code.
- `dispatch.md` — at Step 4: pass-specific prompt clauses and the collect call.

## Review Scope

| User request | Passes to run |
| --- | --- |
| Generic review, diff review, audit, or combined verdict | QA, Security, and Code Quality |
| QA, regression, behavior, or test adequacy only | QA only |
| Security review only | Security only |
| Maintainability, performance, design, or code quality only | Code Quality only |

## Execution Steps

Before Step 1, check whether `graphify-out/graph.json` exists at the repository root. If it exists, use `graphify query`, `graphify path`, or `graphify explain` to build review context for changed architecture, dependency paths, public contracts, ownership boundaries, or cross-file behavior. If no graph exists and the diff is architecture-heavy or touches unclear cross-module flows, run `graphify <repo-root> --mode deep --no-viz` before dispatching specialist passes. Do not run graphify for small localized diffs where direct file inspection is sufficient. Treat graphify output as context passed to specialists, not as a finding by itself.

1. Capture review context — run `git status` and `git diff`, review only added/modified lines plus the surrounding code needed to prove impact, and work the capture checklist in `references/review-context.md` (change intent, test-only classification, file sizes over 250 lines, lint/typecheck bypasses, trust-boundary determination). This capture happens once, here. Specialist passes consume it; they never re-run `git status` or `git diff`.
2. Discover project-specific quality commands and conventions from `package.json`, near-root tool config, and `README`/docs, and build the `Project Validation Context` block per `references/review-context.md`.
3. Build the `Review Context` block per `references/review-context.md` — changed files and symbols, intended behavior, touched public contracts, blast radius, new invariants the diff introduces and the call sites that did not adopt them, CARDS notes, graphify context, and the user's explicit focus areas.
4. Dispatch the selected read-only specialist passes as subagents:
   - When the Security pass is selected, first read `references/threat-model.md` and build a diff-scoped Threat Context block (from `THREAT_MODEL.md` if present, else a lightweight 4-question sketch, else a one-line "no new trust boundary" note). Pass this block to the Security discovery subagent so it knows what counts as a vulnerability here.
   - Security runs as two waves: (a) a discovery subagent that reports candidate findings, then (b) an independent verification pass per `references/security-verification.md`. Do not give the verifier the discovery agent's reasoning.
   - Code Quality owns the lint/typecheck bypasses found in Step 1; they are findings unless the diff shows explicit repository-owner/user approval.
   - Spawn every selected pass with `Agent` using the dispatch table in **Subagent Dispatch**. Issue all spawns for one wave in a single message so they run concurrently.
   - Every pass gets the inputs enumerated in the spawn template plus its row's pass-specific inputs, and both reference paths: its own from the table, and `references/finding-explanation.md`.
   - Specialists write the `explanation` because they hold the code context. The parent quality-gates it in Step 10 but must not invent one for a finding that came back without it — send the pass back or record the gap as a scope note.
   - Apply strict non-overlap ownership. Out-of-scope items become scope notes, not findings.
5. Collect every dispatched pass with `get_subagent_result({ agent_id, wait: true })` before merging, deduping, or producing a verdict. Do not proceed with partial results while an agent is still running.
   - When the Security pass ran, collect its discovery agent first, then dispatch and collect the verification wave before merging: drop `unconfirmed` security findings with confidence < 0.5, demote borderline ones to LOW, and record dropped/demoted findings as a one-line scope note. A demoted finding keeps its explanation but has its "why fix it now" re-calibrated to the new severity — an urgency argument written for a HIGH is wrong on a LOW.
   - If subagent tooling is unavailable, blocked, or a selected agent never starts, stop and report the exact blocker. Do not run the missing pass in the parent session and do not invent that pass.
   - If an agent stops, times out, or exhausts its `max_turns` budget after producing partial output, keep every completed pass, report the partial findings, and add a scope note naming the incomplete pass and what it did not check. A review with an incomplete pass never returns `PASS`.
6. Normalize each finding into `category`, `severity`, `file`, `line`, `title`, `evidence`, `explanation`, `recommendation`, `confidence`. The `explanation` sits above `recommendation` and follows `references/finding-explanation.md`: what this is, why it matters, why fix it now — written for a decision-maker, never a restatement of `evidence`.
7. Dedupe with key `(file, line, normalized_root_cause)`.
8. Apply precedence when duplicate root cause exists: `security` > `qa` > `code_quality`.
9. Sort final findings: severity `HIGH` first, then `MEDIUM`, then `LOW`; tie-break by category precedence above, then file+line.
10. Quality-gate every finding before final output:
    - exact changed line or nearest changed line
    - concrete failure/exploit/maintenance scenario
    - production or user impact
    - an `explanation` with all three parts — what this is, why it matters, why fix it now — in plain language, with no sentence whose subject is the review or the reviewer. A finding whose explanation only restates its evidence is not ready to ship; rewrite it, do not drop the field.
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

| Rationalization | Required action |
| --- | --- |
| "It's a small diff, this is probably fine" | Judge risk from what changed (trust boundary, blast radius, deleted checks), not line count |
| "Tests pass, so behavior is correct" | QA still checks edge cases and regressions the tests don't exercise |
| "The discovery agent sounded confident" | Verifier re-derives the exploit path independently and ignores discovery's confidence |
| "It's just a refactor, no behavior change" | Diff against actual removed/changed lines, not the stated intent, before ruling out impact |
| "The complex finding didn't confirm on first read" | Route to Complex verification (one extra hop, check tests/comments) before defaulting to unconfirmed |
| "Running the suite will settle this" | Read the code and the existing tests; execute only under the single-command rule in the dispatch table |

- Review the current diff by default. Do not expand into a whole-repo audit unless the user asks; graphify queries must stay scoped to changed files, callers, contracts, and directly affected paths.
- Do not implement fixes in this skill; switch only if the user explicitly asks for remediation.
- Include suggested tests only when they directly prove the finding or close a changed-behavior gap.

## Merge Rules

- Do not reword findings in a way that loses technical meaning.
- Keep the strongest evidence, the fullest explanation, and the clearest recommendation. When deduping across passes, the surviving finding keeps the best explanation available — merging must never leave a finding without one.
- Keep only one canonical finding per dedupe key.
- Preserve specialist handoff notes in a separate section when useful.
- Prefer evidence that references project-specific commands/config discovered from `package.json`, `*.toml`, and `README/docs`; use graphify evidence only when it points to a concrete changed path, caller, dependency, or boundary.
- Report only actionable issues with concrete impact. Structural findings are valid when they show a concrete maintenance cost and a clearer organization that deletes meaningful complexity.
- If a finding depends on an assumption, state the assumption and confidence.

## Subagent Dispatch

Dispatch only after capturing `git status`, `git diff`, touched files, graphify context when available, `Review Context`, and `Project Validation Context`. Every pass runs read-only in the background; the parent collects with `get_subagent_result`. Pass-specific prompt clauses and the collect call live in `references/dispatch.md`.

All four passes use `subagent_type: generic-readonly` (or `readonly`) with `max_turns: 10`.

| Pass | Reference to read | Pass-specific inputs |
| --- | --- | --- |
| QA | `references/qa-validator.md` | blast radius and new invariants introduced by the diff, including call sites that did not adopt them |
| Security discovery | `references/security-review.md` | Threat Context |
| Security verification | `references/security-verification.md` | one finding (file, line, title, claimed exploit path) and the cited file paths — nothing else |
| Code Quality | `references/code-review.md` | file size context including files over 250 lines, lint/typecheck bypass scan, CARDS architecture notes, blast radius and new invariants |

Spawn template — vary only the pass name, reference, budget, inputs, and owned categories:

```text
Agent({
  subagent_type: "generic-readonly",
  description: "<pass> pass",
  max_turns: <budget from table>,
  run_in_background: true,
  prompt: "Run the <pass> pass for this code review. Read <absolute code-review skill dir>/<reference from table> and <absolute code-review skill dir>/references/finding-explanation.md. Scope: current diff only, supplied below — do not re-run git status or git diff. Inputs: <diff summary>, <touched files>, <Review Context>, <Project Validation Context>, <pass-specific inputs from table>. Report only <owned categories>. Use this schema per finding: category, severity, file, line, title, evidence, explanation, recommendation, confidence. The explanation goes above the recommendation and carries all three parts from finding-explanation.md — what this is, why it matters, why fix it now — in plain language for a decision-maker, never a restatement of evidence. Do not report <other categories>."
})
```

## Required Output

Return markdown with this exact structure:

```markdown
## Scope Notes

- [optional merged handoff notes]

## Findings

1. title: short title
   category: security|qa|code_quality
   severity: HIGH|MEDIUM|LOW
   file: path/to/file
   line: 123
   evidence: concrete proof
   confidence: high|medium|low

   explanation:
   - What this is — the defect in plain language, no jargon
   - Why it matters — what breaks, who hits it, when, how far it spreads
   - Why fix it now — cost of fixing against cost of leaving it, and what makes it urgent or deferrable

   recommendation: smallest corrective action

2. ...

## Final Verdict

PASS | FAIL | REQUIRES_MODIFICATION
```

If no findings exist, output `## Findings` with `- none`.
Add new lines between findings to make it clearer and easier to read.
