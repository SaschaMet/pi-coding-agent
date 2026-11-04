# Lead playbook

Read this when your task starts with `You are a handsoff lead.` You own one package: its worktree, its branch, its hill-climb run, its workers. The orchestrator owns the clock, the merge, and the operator. Nobody answers questions; the gate approval already delegated every decision to you.

## Contract

- Inputs, all read-only: `$RUN/brief.md`, `$RUN/packages/<package>/matrix.json`, the verifier next to it, the time signal in your task.
- Outputs: commits on your branch in your worktree, `$RUN/packages/<package>/lead-report.md`, the files listed under **Stages**. Then `cmux wait-for -S <package>-done`.
- You may spawn cmux panes (workers, one reviewer) with `$cmux-orchestration`, split from your own surface, at most 5 at once. Your workers are cmux workers: their tasks start with `You are a cmux worker.` and they never spawn.
- Never start a subagent with `isolation: worktree`: its unsandboxed `git add -A` enters a nested repo a session planted.
- You never: push, merge into any branch but your own, edit files outside your worktree and its hill-climb worktrees, edit the matrix or verifier, ask the orchestrator or operator anything.
- Pace to the time signal. Correctness wins over the clock, but when the orchestrator steers "budget spent", finish the current round, run review and preflight on the best state, and signal.

## Stages

Report each stage change by writing `stage: <name>` as the first line of `$RUN/packages/<package>/stage.txt`; the orchestrator reads it on idle.

### grill

Run `$grill-me` on the package: the brief's section for this package plus its acceptance criteria. Silent research and risk assessment as the skill says; then answer every question yourself, in the question block format, with the recommendation as the answer unless the codebase contradicts it. Write the summary to `$RUN/packages/<package>/grill-summary.md` with the Grill Status line `overridden <date>: handsoff, answers delegated to agent`. Every default change and simplification from the grill becomes a plan item in the next stage.

Done when: the summary exists and lists every question with its answer and the rejected option.

### plan

One to three files, one behavior: `$create-plan`. Otherwise `$create-spec` (it runs `$research-codebase` first). Write into `docs/plans/<name>/` or `docs/specs/<name>/` in your worktree with `<name>` = `handsoff-<task>-<package>`. Set its Grill Status row to the `overridden` line above. Every acceptance criterion maps to a test the verifier counts.

Done when: the document exists, its Grill Status is `overridden`, and every acceptance criterion names its test.

### climb

Run `$hill-climb` steps 5 to 7 on this package, with the given matrix and verifier (no new gate: the operator approved them):

1. `hc.py init --run $RUN/packages/<package>/hc --matrix matrix.json --cwd <your worktree>`.
2. Each round: directions = the open plan items, grouped so that workers never touch the same files. Fan-out 1 to 5, narrower when a direction gained.
3. Every code worker gets the two-step TDD dispatch from `$cmux-orchestration` → TDD gate: red dispatch, you rerun the failing command yourself, then green dispatch. One worktree per worker from the current best, where `$hill-climb` step 6.2 puts it: your own checkout's `.worktrees/`, never `$TMPDIR`, created and removed with the `git_worktree` tool (bash `git worktree` fails in the sandbox). Every branch you or a worker create starts with `hill-climb/` or `handsoff/`: the sandbox lets a lead write only those branches, so any other name fails with `cannot lock ref ... Operation not permitted`.
4. Re-score every worker with `hc.py score` (after `npm ci` in that worktree when its `package.json` or lockfile changed); `close-round`; update the plan's status markers and AI-Notes from the worker reports (you are the owner session of that document); close each worker's pane whose report you have read (`$cmux-orchestration` → Fail-Safe Teardown). A pane whose worker failed stays open and goes under `open_issues`.
5. Stop on `targets_met`, `plateau`, or `budget`. Merge the best candidate's branch into your package branch (`git merge --ff-only` from the best worktree's branch, or cherry-pick).

Done when: `hc.py status` shows a stop reason and your branch holds the best state.

### review

Boot one reviewer pane (fresh pi, cwd = your worktree, read-only task) that runs `$code-review` on `git diff <baseline-sha>` and writes `$RUN/packages/<package>/code-review.md`. Then:

| Findings | Do |
| --- | --- |
| HIGH, or any `security` finding | one fix round: dispatch workers on the findings (TDD gate applies), re-score, re-run the reviewer on the new diff. At most one such round; a second HIGH list goes to the report as open issues. |
| MEDIUM, LOW, Optional | list them in `lead-report.md` under `accepted_findings`; do not fix |
| `REQUIRES_MODIFICATION` from size | split the diff by file group as the review says and run each group |

Done when: `code-review.md` exists, no HIGH or security finding is unaddressed, and every other finding is listed.

### preflight

Run `$preflight-checklist` yourself on the package: plan or spec, the conversation (your grill summary), the diff. Write `checklist.md` into the document folder. A failed `agent` item inside the package: fix it (TDD gate), re-run the whole preflight. Two failed fixes on one item: stop, list it as an open issue. `human` items are listed, not run.

Done when: `checklist.md` exists and every `agent` item is `pass` or listed as an open issue.

### signal

Write `$RUN/packages/<package>/lead-report.md`:

```markdown
package: <package>
stop: <targets_met|plateau|budget>
aggregate: <best from hc.py status>
branch: handsoff/<task>/<package>
baseline_sha: <sha>
rounds: <N>
acs: <done>/<total>
tests: <command> -> <pass/fail counts>
review: <HIGH count fixed>, accepted_findings below
preflight: <pass count>/<total>, human items below
accepted_findings:
- <severity> <file:line> <one line>
open_issues:
- <one line each, or none>
human_items:
- <one line each, or none>
ai_notes:
- <entries for the plan or spec, format of that document>
```

Close the reviewer's pane and any finished worker pane still open; failed ones stay. Worktrees stay; the orchestrator asks the operator. Then print `LEAD_DONE package=<package> stop=<reason>` as your last chat line and run `cmux wait-for -S <package>-done`.

## Gotchas

- **Do not** wait for a human on the grill's start prompt or any permission prompt in your workers' panes. **Do** approve a worker's prompt when it acts inside its worktree; otherwise pick No and record it under `open_issues` as `refused: <action>`.
- **Do not** add plan items the grill did not produce. **Do** keep the scope the operator approved; a needed widening is an open issue, not work.
- **Do not** let two workers in one round edit the same file. **Do** merge those directions into one worker.
- **Do not** mark the grill `done`. **Do** write the `overridden` line; a human did not answer.
