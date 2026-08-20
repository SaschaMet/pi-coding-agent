---
name: code-review
description: Use this skill when the user asks to do a code review, to review local changes, inspect a diff, audit code quality, check security, assess QA risk, or produce a combined review verdict. Focus on actionable defects in the changed code. Do not use for implementation requests, broad architecture brainstorming, or style-only cleanup unless review is explicitly requested.
---

# Code Review Orchestrator

You are the coordinator, not the reviewer. You own context capture, lens selection, dispatch, collection,
assembly, and the final verdict. You never perform the review yourself.

One subagent reads the changed code and applies all three lenses over that single read; a second, isolated
subagent verifies any security finding. The lenses share files, so splitting them into separate agents would
pay for the same reads three times and buy nothing — there is no independence claim between QA, Security, and
Code Quality. Verification is different: its whole value is not having seen the reviewer's reasoning, so it
stays isolated.

## Goal

- One unified report.
- Every finding proven against the changed code.
- Security findings independently verified before they reach the verdict.

## Reference Material

Load `references/review-context.md` (what to capture in Steps 1-3) and `references/dispatch.md` (diff
handoff, budgets, model selection, prompt clauses, collect call). Then load only what the review needs:

- `threat-model.md` — only when the Security lens is selected: build the diff-scoped Threat Context that
  defines what counts as a vulnerability here.
- `security-verification.md` — only when the reviewer returns at least one security finding.
- `severity.md` — at assembly, for the final verdict. The reviewer reads it too and owns compounding
  escalation, because it sees all three categories in one context.
- `finding-explanation.md` — the reviewer reads this; the parent does not need it unless a finding comes back
  malformed.

`reviewer.md` is read by the reviewer subagent, not by the parent.

## Lens Selection

Select from the request, then narrow with what Step 1 captured. The narrowing is not optional — running a
lens over a diff it cannot possibly fire on is pure cost.

| User request | Lenses |
| --- | --- |
| Generic review, diff review, audit, or combined verdict | QA, Security, Code Quality |
| QA, regression, behavior, or test adequacy only | QA |
| Security review only | Security |
| Maintainability, performance, design, or code quality only | Code Quality |

Then drop lenses the diff cannot support, using the Step 1 capture:

- **No trust-boundary surface** (no new/changed entry point, authn/authz, input parsing or deserialization,
  file/network/subprocess I/O, secret or token handling, security-relevant config default, and no
  `THREAT_MODEL.md` hit): drop Security. Skip `threat-model.md`, skip the Threat Context, skip the verifier.
- **Docs, markdown, or comment-only diff**: Code Quality alone.
- **Config-only diff with no security-relevant key**: Code Quality alone.
- **Test-only diff**: QA alone — the test-only classification is itself the finding to judge.

Record every dropped lens as a one-line scope note saying why. A dropped lens is a stated decision, never a
silent omission.

## Execution Steps

Before Step 1, check whether `graphify-out/graph.json` exists at the repository root.

- Graph exists: use `graphify query`, `graphify path`, or `graphify explain` scoped to changed files, callers,
  contracts, and directly affected paths.
- No graph: do not build one automatically. If the diff crosses 3+ module architecture boundaries and direct
  inspection cannot resolve the flow, ask the user to approve a one-time build
  (`graphify <repo-root> --mode deep --no-viz`). With approval, dispatch a read-only digest agent (max 3
  turns, `model: "grunt"`) that runs the build and scoped queries and returns a ≤20-line context block — raw
  build output never enters the parent context.
- Small localized diff: skip graphify; direct file inspection is sufficient.

Treat graphify output as context passed to the reviewer, not as a finding by itself.

1. Capture review context — run `git status`, `git diff HEAD --stat`, and the context diff
   (`git diff HEAD -U1` under 300 changed lines, `-U0` at 300 or more). Read surrounding code from the files
   on demand only where needed to prove impact. Work the capture checklist in `references/review-context.md`
   (change intent, test-only classification, file sizes over 250 lines, lint/typecheck bypasses,
   trust-boundary determination). This capture happens once, here.
2. Select lenses per **Lens Selection** above, using the trust-boundary and classification results from
   Step 1. Note dropped lenses as scope notes.
3. Discover project-specific quality commands from `package.json`, near-root tool config, and `README`/docs,
   and build the `Project Validation Context` block per `references/review-context.md`.
4. Build the `Review Context` block per `references/review-context.md`. Hard cap: under 30 lines — it is a
   manifest, not a report. Name files and symbols and let the reviewer read the code; do not paste excerpts.
5. When the Security lens survived selection, read `references/threat-model.md` and build a diff-scoped
   Threat Context block (from `THREAT_MODEL.md` if present, else a lightweight 4-question sketch, else a
   one-line "no new trust boundary" note).
6. Dispatch the reviewer subagent with `Agent`, using the template in **Subagent Dispatch**. The prompt
   carries the changed-file list, never the diff body — the reviewer runs its own scoped diff per
   `references/dispatch.md`.
7. Collect it with `get_subagent_result({ agent_id, wait: true })`.
   - If subagent tooling is unavailable, blocked, or the agent never starts, stop and report the exact
     blocker. Do not run the review in the parent session and do not invent results.
   - If the agent stops, times out, or exhausts its budget after partial output, keep what completed, report
     it, and add a scope note naming what went unchecked. A review with an incomplete pass never returns
     `PASS`.
   - If a lens line is missing from the verdict block, the pass is incomplete — treat it as above.
8. When the reviewer returned at least one `security` finding, dispatch the verification wave per
   `references/security-verification.md`: one verifier **per file**, findings grouped, never one per finding.
   Give it only the findings and the cited file paths — never the diff, never the reviewer's reasoning. Issue
   all verifiers in a single message so they run concurrently, then collect each with `wait: true`.
   - Drop `unconfirmed` security findings with low confidence; demote borderline ones to LOW. Record dropped
     and demoted findings as a one-line scope note each.
   - A demoted finding keeps its explanation but has its "why fix it now" re-calibrated to the new severity —
     an urgency argument written for a HIGH is wrong on a LOW.
9. Assemble the report. **Pass finding text through verbatim.** The reviewer holds the code context and
   already wrote `evidence`, `explanation`, and `recommendation`; rewriting them costs a second full
   generation of the same text and loses detail. Rewrite only a finding that fails the gate in Step 10.
   - Sort: severity `HIGH`, then `MEDIUM`, then `LOW`; tie-break `security` > `qa` > `code_quality`, then
     file+line.
   - Carry the reviewer's `## Optional` list through, deduped, one line each. Never promote an optional item
     into `## Findings`.
   - Apply the `severity.md` floors and the pre-existing-code rule. Compounding escalation already happened
     in the reviewer; do not redo it, and do not undo it.
10. Gate each finding. Send a failing finding back to the reviewer, or record the gap as a scope note — never
    invent the missing part yourself:
    - exact changed line or nearest changed line
    - concrete failure, exploit, or maintenance scenario, with production or user impact
    - an `explanation` per `references/finding-explanation.md`: three parts for HIGH and MEDIUM, one line for
      LOW, in plain language, with no sentence whose subject is the review or the reviewer. An explanation
      that only restates its evidence is not ready to ship.
    - smallest practical recommendation
    - no generic advice, style preference, or broad rewrite unless it identifies a concrete simplification
      that removes meaningful complexity
11. Produce a single verdict:
    - `FAIL` if any HIGH finding exists
    - `REQUIRES_MODIFICATION` if only MEDIUM/LOW findings exist
    - `PASS` if no findings and every selected lens completed
    - Optional items never change the verdict.

## Gotchas

### Rationalizations to Reject

| Rationalization | Required action |
| --- | --- |
| "It's a small diff, this is probably fine" | Judge risk from what changed (trust boundary, blast radius, deleted checks), not line count |
| "Tests pass, so behavior is correct" | Edge cases and regressions the tests don't exercise still count |
| "The reviewer sounded confident" | The verifier re-derives the exploit path independently and ignores the reviewer's confidence |
| "It's just a refactor, no behavior change" | Diff against actual removed/changed lines, not the stated intent, before ruling out impact |
| "The complex finding didn't confirm on first read" | Route to Complex verification (one extra hop, check tests/comments) before defaulting to unconfirmed |
| "Running the suite will settle this" | Read the code and the existing tests; execute only under the single-command rule in `references/dispatch.md` |
| "I'll tidy up this finding's wording" | Pass it through verbatim unless it fails the Step 10 gate |

- Review the current diff by default. Do not expand into a whole-repo audit unless asked; graphify queries
  stay scoped to changed files, callers, contracts, and directly affected paths.
- Do not implement fixes in this skill; switch only if the user explicitly asks for remediation.
- Include suggested tests only when they directly prove a finding or close a changed-behavior gap.
- Do not reword findings in a way that loses technical meaning.
- Report only actionable issues with concrete impact. Structural findings are valid when they show a concrete
  maintenance cost and a clearer organization that deletes meaningful complexity.

## Subagent Dispatch

Dispatch only after Steps 1-5. Both agents run read-only in the background; the parent collects with
`get_subagent_result`. Diff handoff, budgets, model selection, prompt clauses, and the collect call live in
`references/dispatch.md`.

**Reviewer:**

```text
Agent({
  subagent_type: "generic-readonly",
  description: "unified code review pass",
  max_turns: 10,
  run_in_background: true,
  prompt: "Run the unified review pass. Read <skill dir>/references/reviewer.md, <skill dir>/references/finding-explanation.md, and <skill dir>/references/severity.md. Budget: 10 turns and 16 tool calls of review work — those three reads and the scoped diff call do not count against the 16. Batch independent reads into one turn. Scope: the current diff only. Changed files: <file list>. Run `git diff HEAD -U1 -- <changed files>` as your first tool call; never run the unscoped git status or git diff. Lenses to apply: <selected lenses>. Inputs: <Review Context>, <Project Validation Context>, <Threat Context if Security selected>. Caps: at most 8 blocking qa+code_quality findings ranked by severity, overflow to one-line scope notes; security uncapped with full exploit paths; optional items uncapped in a grouped ## Optional list, one line each, never counted against the 8. Use the schema and output format in reviewer.md. End the verdict with one line per lens naming what you checked, even where you found nothing. Do not report on lenses that were not selected."
})
```

**Security verification** — one per file with findings, dispatched only after the reviewer returns:

```text
Agent({
  subagent_type: "generic-readonly",
  description: "security verification: <file>",
  max_turns: 8,
  run_in_background: true,
  prompt: "Verify security findings independently. Read <skill dir>/references/security-verification.md. Budget: 8 turns and 12 tool calls; that read does not count. You are given only these findings and the cited paths — you have not seen the reviewer's reasoning, and you do not get the diff. Findings: <file, line, title, claimed exploit path for each finding in this file>. Cited paths: <paths>. Never run git diff or git status. <append the Security verification clause from references/dispatch.md>"
})
```

## Required Output

```markdown
## Scope Notes

- [dropped lenses and why, dropped or demoted security findings, unchecked areas, assumptions]

## Findings

1. title: short title
   category: security|qa|code_quality
   severity: HIGH|MEDIUM|LOW
   file: path/to/file
   line: 123
   evidence: concrete proof
   confidence: high|medium|low

   explanation:
   - HIGH and MEDIUM: What this is / Why it matters / Why fix it now
   - LOW: one sentence naming what it costs to ignore

   recommendation: smallest corrective action

2. ...

## Optional

- path/to/file:12 — one-line naming, formatting, comment, or documentation-drift note

## Final Verdict

PASS | FAIL | REQUIRES_MODIFICATION
```

If no findings exist, output `## Findings` with `- none`. Omit `## Optional` when empty.
Add blank lines between findings to keep the report readable.
