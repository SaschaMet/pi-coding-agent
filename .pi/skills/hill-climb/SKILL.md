---
name: hill-climb
description: Runs a measured hill-climb on any artifact (code, page, script, text, image, config). Turns "make X better" into a numeric criteria matrix the user confirms, measures a baseline with a task-specific verifier, then dispatches isolated cmux workers in rounds until every target is met, three rounds bring no gain, or the round budget is spent. Use when the user asks to optimize, tune, improve, or iterate on something until a measurable goal is reached, or says hill-climb or "keep improving until". Not for a single change with a known fix (do it), for subjective taste reviews (no number, no climb), or for spec writing (create-spec).
disable-model-invocation: true
---

# Hill-climb

Climb only what you can measure. The verifier is the ruler, the workers are the legs, and you, the orchestrator, hold the ruler. A score you did not compute yourself is not a score.

Companion skills: `$cmux-orchestration` for every pane verb (boot, dispatch, watch, teardown), `$sandboxed-bash` when a worker reports a block.

## Definition of Done

- A confirmed matrix exists: every criterion has a measurement command, unit, direction, baseline, target, and weight.
- `scripts/hc.py` holds a baseline and a scored log for every candidate of every round.
- The run stopped for one of exactly three reasons: `targets_met`, `plateau`, `budget`.
- The final report shows baseline, every candidate's scores, the stop reason, the winning worktree, and the apply command. Nothing was merged or deployed.

## Workflow

Each step ends on a check. Do not start the next step before it passes.

### 1. Intake and research

Pin down the artifact (path or URL), what "better" means to the user, and any hard limits they state. Then research what "perfect" is for this kind of artifact and how experts measure it. Pick the sources that fit: web search for standards and reference examples, the repository's own tests and benchmarks, files the user attached, a domain skill (`$seo`, `$impeccable`, `$helpful-content`, ...). Delegate noisy research to a read-only subagent; keep findings, not transcripts.

Check: you can name 2 to 6 candidate criteria, each with a tool or command that prints a number.

### 2. Criteria matrix

Write `matrix.json` (`python3 -I scripts/hc.py example` prints the shape). Rules:

| Rule | Do |
| --- | --- |
| A criterion has no unit or no command | Drop it or replace it with a proxy that has one (readability "feels better" becomes a Flesch index; "looks right" becomes a pixel diff against a reference). |
| Several criteria compete | Weighted sum is the default. Propose weights; propose `aggregate: custom` only when a sum misrepresents the goal and say why. |
| One criterion must never regress (tests, a11y violations, error count) | Set `floor` to the baseline value. A broken floor makes the candidate invalid, whatever the sum says. |
| A measurement is noisy (timings, Lighthouse) | Set `repeat` (3 or 5). The median is scored. |
| The user names a target | Use it verbatim. Otherwise derive it from the research and cite the source in `measure`. |

Check: `hc.py init --dry-run` prints the command with no `matrix invalid` error.

### 3. Verifier

Write the verifier into the run folder `$TMPDIR/pi-reports/hill-climb/<run>/` (workers may read it there, never write). Contract: non-interactive, runs with cwd = the candidate directory, exits 0, last stdout line is one JSON object with one number per criterion name. Reuse what exists before writing anything: a test runner's JSON reporter, Playwright's `toHaveScreenshot` diff output, Lighthouse CI, a benchmark harness. Read [references/verifier-recipes.md](references/verifier-recipes.md) now for the recipe that matches the artifact type.

Check: the verifier runs twice on the untouched artifact and both runs print the same JSON (or, with `repeat`, numbers within the noise you expect).

### 4. Gate

Present to the user, in this order: the matrix as a table (criterion, how measured, unit, direction, target, weight, floor), the aggregation and why, the verifier in one paragraph (what it runs, what it reads), budget and plateau (`10` and `3` unless changed), worker fan-out for round 1 (default `3`, max `5`), and the directions each worker will try. Then wait. Edit the matrix on feedback and present again. Never start without an explicit yes, and never lower a target later to reach it.

Check: the user approved the matrix, aggregation, verifier, budget, and fan-out in one reply.

### 5. Baseline

```bash
HC=.pi/skills/hill-climb/scripts/hc.py          # this skill's folder; ~/.pi/agent/skills/hill-climb/scripts/hc.py when installed globally
RUN=$TMPDIR/pi-reports/hill-climb/<run>        # <run> = <artifact-slug>-<yyyymmdd-hhmm>
python3 -I "$HC" init --run "$RUN" --matrix matrix.json --cwd <artifact dir>
```

`init` validates the matrix, stores the verifier checksum, measures the baseline, and refuses to proceed when the baseline already meets every target (then there is nothing to climb; report that).

Check: `init` printed `baseline` and `verifier_sha256`, and `stop` is `null`.

### 6. Rounds

Repeat until `close-round` prints a non-null `stop`.

1. **Plan the round.** Pick fan-out and one direction per worker. Round 1 fans out for breadth (different hypotheses). Once a direction gains, narrow: more workers on refinements of the winner, at most one on a new hypothesis. State the plan in one line to the user.
2. **Isolate.** One worktree per worker, branched from the best state:
   ```bash
   BEST=$(python3 -I "$HC" status --run "$RUN" | jq -r .best.cwd)
   WT=$(git rev-parse --show-toplevel)/.worktrees/hill-climb-<run>   # run from the session's own cwd: the climb's starting checkout
   EXCL=$(git -C "$BEST" rev-parse --path-format=absolute --git-path info/exclude)
   mkdir -p "$(dirname "$EXCL")"; grep -qxF '.worktrees/' "$EXCL" 2>/dev/null || printf '\n.worktrees/\n' >> "$EXCL"
   # Create the worktree with the git_worktree tool: action add, branch hill-climb/<run>/r<N>-w<n>,
   # path $WT/r<N>-w<n>, base: the SHA from `git -C "$BEST" rev-parse HEAD`.
   # No such tool: run `git -C "$BEST" worktree add -b "hill-climb/<run>/r<N>-w<n>" "$WT/r<N>-w<n>" HEAD` in bash;
   # on `Operation not permitted`, stop and ask the user.
   ```
   Outside git: `WT=$RUN/wt` and `cp -R "$BEST" "$WT/r<N>-w<n>"`. Git worktrees never go under `$TMPDIR`: a pane whose cwd is there loses the guards' temp exemptions and prompts for every run-folder and temp file.
3. **Dispatch** per `$cmux-orchestration`: boot one pane per worker with `cd <worktree> && CMUX_PI_HOOKS_DISABLED=1 pi --no-session --model "$WORKER_MODEL"`, confirm the model line, send the task from the template below, run `confirm_dispatch`, then `bash <cmux-orchestration skill dir>/scripts/wait-or-prompt.sh <token> <surface>` for every worker. Relay prompts to the user; never answer them yourself.
4. **Re-score every result yourself.** The worker's own number is a hint, yours is the record:
   ```bash
   git -C "$WT/r<N>-w<n>" diff --quiet <baseline-sha> -- package.json package-lock.json; [ $? -eq 1 ] && (cd "$WT/r<N>-w<n>" && npm ci)   # git worktrees only; 1 = changed
   python3 -I "$HC" score --run "$RUN" --round <N> --worker w<n> --cwd "$WT/r<N>-w<n>" --direction "<one line>"
   ```
   Exit 4 means the verifier checksum changed: restore the verifier from your copy, discard every score of that round, score again, and tell the user which worker touched it. Exit 3 means the candidate breaks the verifier's preconditions (build fails, test runner crashes): that candidate is out of the round; note it in the report with the stderr reason.
5. **Close the round:**
   ```bash
   python3 -I "$HC" close-round --run "$RUN" --round <N>
   ```
   Read `winner`, `gained`, `plateau`, `stop`. The best state moves only when a valid candidate beats it. Report the one-line result to the user and continue with step 1 from `best.cwd`.

Check per round: every dispatched worker has a `score` entry or a logged reason, and `close-round` ran exactly once for that round number.

### 7. Report

```bash
python3 -I "$HC" status --run "$RUN" --markdown
```

Deliver: the stop reason in the first line, the table from `status`, what the winning change does (from its change note), the diff command (`git -C <best.cwd> diff <baseline-sha>`), and the apply command (`git merge`/`cherry-pick` of the best branch, or `cp` for non-git artifacts). Applying is the user's step. Then ask the user before closing panes or removing worktrees (the `git_worktree` tool with `action: remove` for every worktree under `$WT`, then `rmdir "$WT"`; no such tool: `git -C "$BEST" worktree remove` in bash, and on `Operation not permitted`, stop and ask the user), per the cmux fail-safe teardown.

Check: the report's first line names `targets_met`, `plateau`, or `budget`, and nothing outside `$RUN`, `$WT`, and the `.worktrees/` exclude line was changed.

## Worker task template

One message per worker, one line, ending with `$(ts)`:

```
You are a cmux worker. Your system prompt already contains the durable rules (SYSTEM.md) and, if present, this repo's AGENTS.md — follow them. Read the subagent rules: `.pi/SUBAGENT.md` if it exists, otherwise `~/.pi/agent/SUBAGENT.md`. Use `general-purpose` subagents for any subagent work. HILL-CLIMB round <N>, worker w<n>. Artifact: <path> in this worktree (cwd). Goal: improve the scores in <RUN>/matrix.json (read-only). Current best aggregate: <x>; last attempts and their results: <one line each, or "none">. Your direction: <one hypothesis, concrete>. Measure yourself with: cd <worktree> && <verifier_cmd>  (the verifier at <RUN>/<verifier> is read-only; never edit, copy, or work around it, and never edit matrix.json). Rules: stay inside this worktree; keep every floor criterion at or above its floor; commit your change with a message that states the hypothesis; write a change note (what you changed, why, your measured JSON) to $TMPDIR/pi-reports/hc-<run>-r<N>-w<n>.md; print `HC_DONE aggregate=<your number>` as your last chat line; then run `cmux wait-for -S hc-<run>-r<N>-w<n>`. Stop after one coherent attempt; do not loop. [time: ...]
```

## Gotchas

- **Do not** judge a candidate by reading it, even when the verifier is slow. **Do** run `hc.py score`; the time is the cost of a real number.
- **Do not** let the baseline run on a dirty tree. **Do** commit or stash the user's work first (only files you own, per the repo rules), so `best.cwd` and the worktrees share a clean ancestor.
- **Do not** run all five workers every round. **Do** fan out in round 1, then narrow; five parallel builds on one machine distort timing criteria. For timing criteria, score candidates sequentially.
- **Do not** mix a verifier change into a running climb. **Do** stop, present the new matrix at the gate again, and `init --force` a new run.
- **Do not** report "improved by 30 %" from a single run of a noisy metric. **Do** set `repeat` and quote the median.
- **Do not** score a worktree whose `package.json` or lockfile changed against borrowed packages. A worktree in `.worktrees/` has no `node_modules` and resolves the main checkout's copy upward. **Do** run `npm ci` in it first (step 6.4).
- **Do not** count a round where a worker never signalled as a plateau. **Do** read its screen, recover the attempt or log it as failed with the reason, then close the round.

## Output

Final message shape:

```markdown
Stop: <targets_met|plateau|budget> after <N> rounds. Best: round <r>, <worker>, aggregate <x>.

<table from `hc.py status --markdown`>

**Winning change.** <two sentences from the change note>
**Diff.** `git -C <best.cwd> diff <baseline-sha>`
**Apply.** `<merge/cherry-pick/cp command>` (not done)
**Not reached.** <criteria still below target, or "none">
```
