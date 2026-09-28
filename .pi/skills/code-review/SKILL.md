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
stays isolated. A large diff splits by file, never by lens: 2 to 4 reviewers each apply all three lenses to
one group of related files.

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
- `file-rules/index.md` — in Step 1, to match reviewable files to file-type rule docs. Pass only the matched
  doc paths; the reviewer reads the docs, the parent does not.

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

One rule overrides both lists: **any secret-file finding** from Step 1 makes the Security lens run.

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

1. Capture review context, in this order: `git diff HEAD --name-only` first, then
   `git ls-files --others --exclude-standard` and `git status`; sort the names per File selection in
   `references/review-context.md` (excluded, lockfile, secret, reviewable); then
   `git diff HEAD --numstat -- <reviewable files>` and the context diff over the reviewable files only
   (`git diff HEAD -U1 -- <reviewable files>` under 300 changed lines, `-U0` at 300 or more). Never run an
   unscoped `git diff`. Read surrounding code from the files on demand only where needed to prove impact.
   Work the capture checklist in `references/review-context.md` (change intent, test-only classification,
   file sizes over 250 lines, lint/typecheck bypasses, trust-boundary determination, rule-doc match,
   secret-file checks). This capture happens once, here.
2. Select lenses per **Lens Selection** above, using the trust-boundary and classification results from
   Step 1. Note dropped lenses as scope notes.
3. Discover project-specific quality commands from `package.json`, near-root tool config, and `README`/docs,
   and build the `Project Validation Context` block per `references/review-context.md`.
4. Build the `Review Context` block per `references/review-context.md`. Hard cap: under 30 lines — it is a
   manifest, not a report. Name files and symbols and let the reviewer read the code; do not paste excerpts.
5. When the Security lens survived selection, read `references/threat-model.md` and build a diff-scoped
   Threat Context block (from `THREAT_MODEL.md` if present, else a lightweight 4-question sketch, else a
   one-line "no new trust boundary" note).
6. Check the size, then dispatch. Use the reviewable files (N) and changed lines (L) from Step 1.
   - **Too big** — N > 60: spawn no reviewer. Return verdict `REQUIRES_MODIFICATION`, `## Findings` with
     `- none`, and the scope note `too big: <N> files; re-run on one of: <group key> (<count>), ...`, using
     the group keys from **File-group split**. Parent-written secret-file findings still appear, and a HIGH
     one makes the verdict `FAIL`.
   - **Default** — N ≤ 15 and L ≤ 800: dispatch exactly one reviewer.
   - **Split** — 16 ≤ N ≤ 60, or L > 800 with N ≤ 60: form groups per **File-group split** and add the
     scope note `split: <N> files, <L> lines -> <k> groups`. If grouping yields fewer than 2 groups,
     dispatch one reviewer and add the scope note `split not possible: <N> files, <L> lines`.

   Dispatch with `Agent`, using the template in **Subagent Dispatch**. The prompt carries the
   reviewable-file list, never the diff body and never an excluded, lockfile, or secret file — the reviewer
   runs its own scoped diff per `references/dispatch.md`.
7. Collect every reviewer with `get_subagent_result({ agent_id, wait: true })`.
   - Under a split, a group reviewer that fails or never starts marks its files `skipped: reviewer failed`.
     Keep the other groups' results. Stop with the exact blocker only when no reviewer ran.
   - If subagent tooling is unavailable, blocked, or the single reviewer never starts, stop and report the
     exact blocker. Do not run the review in the parent session and do not invent results.
   - If the agent stops, times out, or exhausts its budget after partial output, keep what completed, report
     it, and add a scope note naming what went unchecked. A review with an incomplete pass never returns
     `PASS`.
   - If a lens line is missing from the verdict block, the pass is incomplete — treat it as above.
   - Check the file ledger against the dispatched file list. A dispatched file the ledger omits is
     incomplete coverage: add a scope note naming the missing file. A missing or `skipped` file means the
     verdict cannot be `PASS`.
8. When the reviewers returned at least one `security` finding, dispatch the verification wave per
   `references/security-verification.md`: one verifier **per file**, findings grouped, never one per finding.
   Give it only the findings and the cited file paths — never the diff, never the reviewer's reasoning. Issue
   all verifiers in a single message so they run concurrently, then collect each with `wait: true`. Under a
   split this is still one wave, dispatched after every group has returned.
   - Drop `unconfirmed` security findings with low confidence; demote borderline ones to LOW. Record dropped
     and demoted findings as a one-line scope note each.
   - Secret-file findings from Step 1 never go to a verifier; they stand as written.
   - A demoted finding keeps its explanation but has its "why fix it now" re-calibrated to the new severity —
     an urgency argument written for a HIGH is wrong on a LOW.
9. Assemble the report. **Pass finding text through verbatim.** The reviewer holds the code context and
   already wrote `evidence`, `explanation`, and `recommendation`; rewriting them costs a second full
   generation of the same text and loses detail. Rewrite only a finding that fails the gate in Step 10.
   - Sort: severity `HIGH`, then `MEDIUM`, then `LOW`; tie-break `security` > `qa` > `code_quality`, then
     file+line.
   - Carry the reviewer's `## Optional` list through, deduped, one line each. Never promote an optional item
     into `## Findings`.
   - Do not copy the reviewer's `## Risk Plan` into the report. It is the reviewer's working plan; its
     unconfirmed risks already arrive as scope notes.
   - Apply the `severity.md` floors and the pre-existing-code rule. Compounding escalation already happened
     in the reviewer; do not redo it, and do not undo it.
   - Under a split: merge the group ledgers into one `Coverage:` line over all reviewable files. Move a
     finding filed against a file outside its reviewer's group to a scope note. Apply the blocking cap of 8
     over the merged set; overflow goes to one-line scope notes. A group with a missing ledger or lens line
     makes the pass incomplete.
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

    Dropping a finding is narrower than gating it. The two mistakes are not equal: a wrong finding kept costs
    a reader a minute; a real finding dropped is lost silently. Drop a reviewer finding only on one of two
    grounds, and record one scope note `dropped: <title> — Ground A|B — <file:line>`:
    - **Ground A** — the code the finding cites is absent from that file's diff.
    - **Ground B** — one diff line literally contradicts the finding's central claim, for example it calls a
      check missing and the diff contains that check.

    Never drop a finding about concurrency, a behavior or compatibility change, a declaration/definition
    mismatch, or a parameter that is accepted but unused: send it back or keep it. "Cannot verify", "low
    value", and "looks fine" are not grounds. The verifier's drop and demote rules in Step 8 are separate.
11. Produce a single verdict:
    - `FAIL` if any HIGH finding exists
    - `REQUIRES_MODIFICATION` if only MEDIUM/LOW findings exist, or on the too-big stop in Step 6
    - `PASS` if no findings, every selected lens completed, the ledger shows every dispatched file
      `reviewed`, and no `secret file not checked` scope note exists
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
  prompt: "Run the unified review pass. Read <skill dir>/references/reviewer.md, <skill dir>/references/finding-explanation.md, and <skill dir>/references/severity.md. Budget: 10 turns and 16 tool calls of review work — those three reads, the rule-doc reads, and the scoped diff call do not count against the 16. Batch independent reads into one turn. Scope: the current diff only. Changed files: <file list, each with its changed-line count from Step 1>. Rule docs: <matched rule-doc paths, or none> — read them in your first turn and apply each to its matching files. Run `git diff HEAD -U1 -- <changed files>` as your first tool call; never run the unscoped git status or git diff. Lenses to apply: <selected lenses>. Inputs: <Review Context>, <Project Validation Context>, <Threat Context if Security selected>. Caps: at most 8 blocking qa+code_quality findings ranked by severity, overflow to one-line scope notes; security uncapped with full exploit paths; optional items uncapped in a grouped ## Optional list, one line each, never counted against the 8. Use the schema and output format in reviewer.md. End the verdict with one line per lens naming what you checked, even where you found nothing, then the file ledger from reviewer.md: each changed file exactly once as `reviewed` or `skipped: <reason>`, then `coverage: <reviewed>/<total>`. Do not report on lenses that were not selected."
})
```

**File-group split** — only when Step 6 selects a split. The *shared prefix* is the longest folder path all
reviewable files share (may be empty). A file's *group key* is the first folder below the shared prefix;
files directly in the shared prefix get the key `.`.

1. Group files by group key.
2. A test, type-declaration, or doc file whose name stem matches a changed implementation file joins that
   file's group (`test/foo.test.ts`, `src/foo.d.ts`, and `docs/foo.md` join `src/foo.ts`).
3. Merge the smallest group into the next smallest until at most 4 groups remain.
4. If fewer than 2 groups result, sort the files by path and cut them into `ceil(N / 15)` groups, at most
   4. Still 1 group: Step 6's single-reviewer rule applies.

Every reviewable file is in exactly one group. Spawn all group reviewers in one message, each with the
Reviewer template above and its own 10-turn / 16-call budget. Per group, `Changed files:` lists only that
group's files, `Rule docs:` lists only the docs matched to them, and one added line reads `Other groups'
files (context only; never file a finding against them): <names>`. Never pass another group's diff.

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

- Coverage: <reviewed>/<total> files reviewed; skipped: <file> (<reason>), ... (or "skipped: none")
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
