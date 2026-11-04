---
name: handsoff
description: Runs a task end to end without the operator after one approval. Defines the task with explore and hill-climb into a brief, a numeric criteria matrix and a verifier, gets a single gate approval, then orchestrates one cmux lead per work package (grill-me self-answered, plan or spec, TDD rounds, code review, preflight) and hands back one branch with the full run log. Use when the user says handsoff, "do this hands-off", "run the whole workflow yourself", "I only want to approve once", or wants a task finished while they are away. Not for a single change with a known fix (do it), for a measured improvement loop alone (hill-climb), for defining without executing (explore, create-spec), or for an interactive grilling (grill-me).
disable-model-invocation: true
---

# Handsoff

One approval, then no questions. The operator defines once and applies once; everything between is the agent's job. The verifier and the run folder are the only witnesses, so every decision is recorded there.

Companion skills: `$explore` and `$hill-climb` for the define phase, `$cmux-orchestration` for every pane verb, `$grill-me`, `$create-plan`, `$create-spec`, `$tdd`, `$code-review`, `$preflight-checklist` inside the lead loop.

## Roles

| Role | Runs where | Does | Never |
| --- | --- | --- | --- |
| Operator | chat | approves the gate, applies the handback, approves teardown | is asked anything between gate and report |
| Orchestrator (you) | this session | defines, gates, boots leads, watches, answers prompts, merges, re-scores, reports | edits files, answers a lead's grill questions |
| Lead | one cmux workspace per package | grill, plan or spec, hill-climb rounds, review, preflight, signal ([references/lead-playbook.md](references/lead-playbook.md)) | touches another package, pushes, merges |
| Worker | one pane, one worktree, one round | one direction, self-verifies, commits, signals | loops, edits the verifier |
| Reviewer | one pane, read-only | `$code-review` on the package diff | edits |

## Definition of Done

- The run folder holds brief, matrix, verifier, `run.json`, every package's grill summary, plan or spec, hill-climb log, review report, checklist.
- Every package is `done`, `failed`, or `unmerged` in `run.json`, each with a stop reason.
- Branch `handsoff/<task>` holds the merged best state of every `done` package, re-scored after the merge. Nothing was merged into the working branch or pushed.
- The report reached the operator with scores, stop reasons, accepted findings, open issues, the apply command, and a teardown request. Panes and worktrees still exist.

## Refusal list

Do these never, and do the alternative:

- No `git push`, no merge into the working branch. Do: merge onto `handsoff/<task>` only.
- No edits outside the worktrees and the run folder. Do: refuse the prompt, log it with `handsoff.py issue`.
- No run without cmux. Do: stop at the gate with `cmux required` when `cmux ping` fails.
- No pane or worktree close before the operator approves. Do: ask once, in the report.
- No criterion without a measurement command. Do: stop at the gate with the finding.
- No grill session marked `done`. Do: `overridden <date>: handsoff, answers delegated to agent`.
- No lowered target to reach it. Do: report `plateau` or `budget` with the gap.

## Workflow

Each step ends on a check. Do not start the next step before it passes.

### 1. Preflight

```bash
cmux ping && git -C <repo> status --porcelain          # cmux reachable; tree clean
SKILL_DIR=<folder of this SKILL.md>                     # ~/.pi/agent/skills/handsoff when installed globally
HO=$SKILL_DIR/scripts/handsoff.py
HC=$SKILL_DIR/../hill-climb/scripts/hc.py
RUN=$TMPDIR/pi-reports/handsoff/<task>-<yyyymmdd-hhmm>  # outside every worktree
WT=$(git -C <repo> worktree list --porcelain | sed -n '1s/^worktree //p')/.worktrees/handsoff-<task>-<yyyymmdd-hhmm>  # main checkout; never under $TMPDIR, see Gotchas
EXCL=$(git -C <repo> rev-parse --path-format=absolute --git-path info/exclude)
mkdir -p "$(dirname "$EXCL")"; grep -qxF '.worktrees/' "$EXCL" 2>/dev/null || printf '\n.worktrees/\n' >> "$EXCL"
ls -d "$(dirname "$WT")"/*/ 2>/dev/null                 # leftovers of aborted runs: list them in the gate message
```

A dirty tree: commit or stash only files you own (repo rule 11); otherwise stop with the list. Non-repo artifact: the "repo" is the artifact folder, worktrees become `cp -R` copies under `WT=$RUN/wt`, the handback is `$RUN/merged/` instead of a branch; every other step is the same.

Check: `cmux ping` succeeded, the tree is clean, `$RUN` and `$WT` do not exist yet.

### 2. Define

Pick the path:

| Task | Path |
| --- | --- |
| Repo task with an existing test or check command that can score the result | **Short.** One message: brief (job, packages, non-goals), matrix, verifier, budget, in the gate shape from [references/templates.md](references/templates.md). |
| Anything else | **Full.** `$explore` to a confirmed brief, one question per turn. Then `$hill-climb` steps 1 to 3 (research, matrix, verifier). Then the gate. |

Rules for both paths:

- The brief's skeleton becomes the package list: one package per independent part, each with its own files and its own acceptance criteria. One part means one package. Parts that must change the same files are one package.
- Every package gets its own `matrix.json` and verifier under `$RUN/packages/<package>/`. A coding package's default criteria: `tests_failing` (target 0, floor at baseline), `typecheck_errors` (target 0), `acs_done` (count of acceptance criteria whose test passes, target = all, higher). Add task-specific criteria from the research.
- Budget: `budget_rounds` 10 and `plateau_rounds` 3 per package (hill-climb defaults), 1 to 5 workers per round chosen by the lead, wall clock = your estimate × 1.5 in seconds.
- A package with no measurable criterion stops the define phase: state which package and why, and ask for a proxy or a narrower task.

Check: every package has `matrix.json` that passes `hc.py init --dry-run` and a verifier that prints the same JSON twice on the untouched artifact.

### 3. Gate

Send the gate message from [references/templates.md](references/templates.md): brief, package table, matrix per package, verifier per package, budget, refusal list, what the handback will be. Then wait. Edit on feedback and send again. Start only on an explicit yes.

Check: the operator approved in one reply. From here on, no message to the operator until step 8, except a `SANDBOX STOP` that needs a `sandbox.json` edit (relay the line, wait, resume).

### 4. Boot

```bash
BASE=$(git rev-parse HEAD)
python3 -I "$HO" init --run "$RUN" --task <task> --budget-seconds <N> --artifact <path> --baseline-sha "$BASE"
cp brief.md "$RUN/"; # matrices and verifiers already live under $RUN/packages/<package>/
```

Per package, in the order of the package table:

1. Create the worktree with the `git_worktree` tool: `action: add`, `branch: handsoff/<task>/<package>`, `path: $WT/<package>`, `base: $BASE`. No such tool (another repo): run `git worktree add -b handsoff/<task>/<package> "$WT/<package>" "$BASE"` in bash; if it fails with `Operation not permitted`, stop and ask the operator.
2. `cmux workspace create --name "handsoff/<task>/<package>"`; boot `cd <worktree> && CMUX_PI_HOOKS_DISABLED=1 pi --no-session --model "$WORKER_MODEL"` in its first surface per `$cmux-orchestration` → Boot the Team (model from your own footer, fallback rule as written there). Verify the model line.
3. Send the lead task from [references/templates.md](references/templates.md) → Lead task, then `confirm_dispatch`.
4. `python3 -I "$HO" package --run "$RUN" --name <package> --workspace <ws> --surface <ref> --worktree <path> --branch handsoff/<task>/<package> --state running --stage boot`.

Leads run in parallel. More than two packages: boot two, then boot the next when one settles, so one machine does not run ten builds at once.

Check: `handsoff.py status` lists every booted package as `running`, and each lead's screen shows `Working…`.

### 5. Watch

While leads run, your own commands never touch `.git/worktrees/` or a lead's checkout: a command already running keeps its sandbox rules, so it could swap a worktree a lead creates and point that worker's git at another config.

Run `bash <cmux-orchestration skill dir>/scripts/wait-or-prompt.sh <package>-done <lead surface>` for every running lead, in the background, and act on its exit code without asking the operator:

| Exit | Meaning | Do |
| --- | --- | --- |
| 0 | lead signalled | read `$RUN/packages/<package>/lead-report.md`; `package --state done --stop <reason> --aggregate <x>` |
| 2 | permission prompt | inside the lead's worktree or `$RUN`: approve (`send-key enter`). Anything else: pick the prompt's No, `issue --text "refused: <action>"`, steer the lead with "refused, continue without it" |
| 3 | sandbox stop | `NEEDS_UNSANDBOXED`: never; log as refused. `NEEDS_DOMAIN` or `bash blocked`: the one allowed interruption; relay to the operator, wait, resume |
| 4 | idle without signal | task still in the input box: press Enter. Pane dead or no progress after two idle reports: `package --respawn` and boot the lead again on the same worktree with "resume from your last AI-Note"; a second loss: `--state failed --stop lead_lost` |
| 1 | timed out | same as idle |

Every 30 seconds at most: `python3 -I "$HO" status --run "$RUN"`. When `over_budget` is true, steer every running lead with "budget spent: finish the current round, run review and preflight on the best state, signal", and accept their next signal as `--stop budget`.

Check: `status` prints `stop: all_settled` or `stop: budget` with no `running` package left.

### 6. Merge and re-score

```bash
# Create it with the git_worktree tool: action add, branch handsoff/<task>, path $WT/merged, base $BASE (fallback as in step 4).
for P in $(python3 -I "$HO" status --run "$RUN" | jq -r '.merge_order[]'); do
  git -C "$WT/merged" merge --no-ff --no-edit "handsoff/<task>/$P" \
    || { git -C "$WT/merged" merge --abort; python3 -I "$HO" package --run "$RUN" --name "$P" --state unmerged --stop merge_conflict --note "conflict: $(git -C "$WT/merged" diff --name-only --diff-filter=U | tr '\n' ' ')"; }
done
```

Then run every `done` package's verifier in `$WT/merged` and compare with its best scores from `hc.py status`. A regression below a floor marks that package `--note "merge regressed: <criterion>"`; do not fix it, report it. Copy each worktree's `docs/plans/<name>/` or `docs/specs/<name>/` into `$RUN/packages/<package>/docs/` (those folders are gitignored and vanish with the worktree).

Check: `handsoff/<task>` exists, every `done` package is `merged` or `unmerged`, and the merged verifier output is saved as `$RUN/merged-scores.json`.

### 7. Report

Send the report from [references/templates.md](references/templates.md) → Report. First line: the run's stop reason and the counts. Nothing is applied, nothing closed. If the repo has `scripts/git-pointer-check.ts`, run `npx tsx scripts/git-pointer-check.ts <main checkout>` and quote every `bad` line in the report: the operator must not run git by hand in a worktree it names.

Check: the report names `git merge handsoff/<task>` (or the `cp` command) as the operator's step and asks for teardown approval in its last line.

### 8. Teardown (after the operator's yes only)

Run `npx tsx scripts/git-pointer-check.ts <main checkout>` first (when the repo has it) and quote every `bad` line to the operator. Then remove every worktree under `$WT` with the `git_worktree` tool (`action: remove`; no tool: `git worktree remove` in bash), deepest path first (leads nest worker worktrees in their own checkout), then `rmdir "$WT"`, `cmux workspace close` every lead workspace, `cmux tree --all` shows nothing of this run. Branches and `$RUN` stay.

## Gotchas

- **Do not** start a lead's task with `You are a cmux worker.` That line makes it read the subagent rules, which forbid spawning panes, so the lead can never dispatch workers. **Do** use the lead task in [references/templates.md](references/templates.md), which starts with `You are a handsoff lead.` and grants the spawn.
- **Do not** answer a lead's grill questions. **Do** make the lead self-answer; the gate approval is the delegation, and the summary records `overridden`.
- **Do not** let a lead fix Medium or Low review findings. **Do** list them under accepted findings; only HIGH findings (and every security finding) get one fix round.
- **Do not** read a lead's report from the screen. **Do** read `$RUN/packages/<package>/lead-report.md`; scrollback wraps and truncates.
- **Do not** score a package from the lead's number. **Do** run its verifier yourself on the merged state; the lead already re-scored its workers, you re-score the lead.
- **Do not** wait blind. **Do** keep every `wait-or-prompt.sh` call in 15-second slices; a lead on a prompt never signals.
- **Do not** create a worktree under `$TMPDIR`. A pane whose cwd is there loses the guards' temp exemptions, so every run-folder write, temp read, and armed-plan write prompts. **Do** use `$WT` in the git-excluded `.worktrees/`.
- **Do not** compare merge scores taken with different packages. Worktrees in `.worktrees/` borrow the main checkout's `node_modules`. **Do** run `npm ci` in `$WT/merged` when the merge changed `package.json` or the lockfile.
- **Do not** boot the leads before `handsoff.py init`. **Do** record the baseline SHA first; every branch and the merge start from it.

Changing this skill: run `python3 -I scripts/test_handsoff.py` and the scenarios in [references/eval-scenarios.md](references/eval-scenarios.md).
