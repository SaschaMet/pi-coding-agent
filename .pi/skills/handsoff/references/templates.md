# Templates

Read the one you need: **Gate** at step 3, **Lead task** at step 4, **Report** at step 7.

## Gate

One message, this order, plain words. Fill every slot; a slot you cannot fill is a finding, not a blank.

```markdown
**Handsoff gate: <task>**

**Job.** <the brief's single job, one sentence>

**Packages.**
| # | package | owns (files/areas) | acceptance criteria | lead path |
| --- | --- | --- | --- | --- |
| 1 | <slug> | <paths> | <AC1 …> | plan \| spec |

**Criteria per package.** (one table per package; from matrix.json)
| criterion | measured by | unit | direction | baseline | target | weight | floor |

**Verifier per package.** <one paragraph each: what it runs, what it reads, how long it takes>

**Budget.** <rounds> rounds × plateau <n> per package, 1 to 5 workers per round, wall clock <N> s (estimate <E> s × 1.5). On clock-out every lead finishes its round, runs review and preflight, and signals.

**Done per package.** Every acceptance criterion done, every test and check green, no HIGH or security review finding, preflight with no open agent item. MEDIUM and lower findings are accepted and listed.

**Will not happen.** push, merge into <working branch>, edits outside the worktrees, worktree removal, grill marked done, lowered targets, questions to you before the report.

**Handback.** branch `handsoff/<task>` + run folder `<RUN>`.

Yes to start?
```

## Lead task

One line per lead, sent with `cmux send` then Enter. Replace every `<…>`. Ends with the time signal from `handsoff.py ts`.

```
You are a handsoff lead. Your system prompt already contains the durable rules (SYSTEM.md) and this repo's AGENTS.md — follow them. Do NOT read the subagent rules; instead read `<skill dir>/references/lead-playbook.md` now and follow it end to end. You may spawn cmux panes for your workers and one reviewer via $cmux-orchestration, split from your own surface, at most 5 at once; your workers are cmux workers and never spawn. Package: <package>. Worktree: <path> (cwd, branch handsoff/<task>--<package>, baseline <sha>). Run folder: <RUN> (read brief.md and packages/<package>/hc/matrix.json + verifier; write only under packages/<package>/). Your package in the brief: <one paragraph: scope, files, acceptance criteria>. Stages: grill (self-answered, summary to packages/<package>/grill-summary.md) → plan (<plan|spec>, docs/<plans|specs>/handsoff-<task>-<package>/ in your worktree) → climb (hill-climb with the given matrix, TDD red/green dispatch per worker, re-score with hc.py) → review (fresh reviewer pane, $code-review; fix HIGH and security once, accept the rest) → preflight ($preflight-checklist, fix agent failures) → signal (packages/<package>/lead-report.md, print `LEAD_DONE package=<package> stop=<reason>`, then `cmux wait-for -S <package>-done`). Nobody will answer questions: decide, record the decision, continue. Never push, never merge into another branch, never edit matrix.json or the verifier; close only panes you spawned, and only after you read their report; never close your own pane or the orchestrator's. <ts>
```

Budget-spent steer (sent to a running lead):

```
Budget spent. Finish the current round, run review and preflight on the best state, then signal with stop=budget. <ts>
```

Respawn task (same worktree, after a lost lead):

```
You are a handsoff lead. <same bootstrap as above>. Resume package <package>: read packages/<package>/stage.txt, the AI-Notes of your plan or spec, and hc/run.json, then continue from that stage. <ts>
```

## Report

First line first. Numbers in the table, not in prose.

```markdown
Stop: <all_settled|budget>. Packages: <done> done, <failed> failed, <unmerged> unmerged. Branch `handsoff/<task>` from <baseline sha>.

<table from `handsoff.py status --markdown`>

**Merged state scores.** (one line per package: criterion → best / merged, floor breaks marked)

**Per package.**
- <package>: <stop>, <rounds> rounds, ACs <done>/<total>, review HIGH fixed <n>, accepted findings <n>, preflight <pass>/<total>. Files: `<RUN>/packages/<package>/` (grill-summary.md, docs/, hc/, code-review.md, lead-report.md).

**Accepted findings.** <severity file:line one line each, or none>
**Open issues.** <from `handsoff.py status`, plus merge regressions, or none>
**Human items.** <from the leads' preflights, or none>

**Diff.** `git diff <baseline sha> handsoff/<task>`
**Apply.** `git merge --no-ff handsoff/<task>` on <working branch> (not done)

Worktrees are still open: `<WT>/*`. Surfaces of failed leads: <surface refs, or none>. Remove them?
```
