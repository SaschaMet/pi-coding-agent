---
name: preflight-checklist
description: Builds a deploy-readiness checklist for a code change from the plan or spec, the conversation, and the task's own diff, then runs every check the agent can and records evidence. Use in the Validate step of a planned task, before handing open manual checks to the user, or when the user asks what to verify before deploying, whether work is ready to ship, or which manual checks remain. Run it instead of offering it. Not for reviewing code for defects (code-review) or walking the human through steps (wizard).
---

# Preflight Checklist

A **preflight** is the pilot's checklist before takeoff: every item is checked now, from the instruments, not from memory. Here the instruments are commands, files, and logs. The agent runs every item it can, and the human gets only what truly needs a human, already pre-tested.

## Definition of Done

- Every item has an owner, a status, and evidence from this run or a stated reason.
- Every item in an existing plan/spec checklist has a verdict.
- Every `agent` item ran. Every `human` item was tried as far as the dry-run rule allows.
- The report reached the user: failures first, then human to-dos.

## Workflow

1. **Resolve sources.** The armed plan or spec (if any), decisions from the conversation, and the task's own diff:
   - On `main`: uncommitted files the task owns (plan Scope → Modify, else files changed this session).
   - On a feature branch: `git diff $(git merge-base HEAD <default-branch>)`, limited the same way.
   - Every other changed file goes on one line, "Not checked: outside this task". Never turn it into an item; never fix it.
   - The task diff is ground truth. Where the plan and the diff disagree, the diff wins and the gap becomes an item.
2. **Build from scratch.** One item per: changed behavior, acceptance criterion or Done When line, caller at risk, config/env/migration/dependency change, doc the change makes stale, and the project gate (from `AGENTS.md`). Each item states the exact command or check and the expected result.
3. **Reconcile the existing checklist** (plan Verification and Done When, spec Manual Verification and Definition of Done). Give each existing item one verdict:
   - `kept`: paths, commands (`package.json` scripts), and expected results exist and still match the diff.
   - `fixed: <what changed>`: right intent, wrong detail (renamed file, wrong command). Use the corrected item.
   - `dropped: <reason>`: obsolete or covered by another item.
   Never edit the plan or spec. Report each `fixed`/`dropped` item as an AI-Notes `gotcha` for the owner session to append. Changing Done When needs the user's approval and an Amendment.
4. **Assign an owner.** `agent` by default. `human` only with a reason: needs credentials, prod or a remote system, a physical device, or the user's taste or decision.
5. **Run.**
   - Every `agent` item: run it now. Evidence = command + exit code + trimmed output from this run. Redact tokens, keys, and env values; never print or read `.env` files.
   - Every `human` item: dry-run it local and read-only, with no network, no credentials, no state change outside the repo. Examples: `bash -n`, a config parse, `--help`, a stubbed binary on `PATH`, reading the installed package source or local session logs to confirm the behavior. Stop at the first step that needs more. Hand over the exact pre-built command with the expected result per outcome.
   - Nothing runnable (hypothetical change, files absent): list what you would run and mark each `not run: <reason>`. Never mark it passed.
6. **Fix or report.** A failed item inside the approved scope: fix it, then re-run the whole preflight. Outside the scope: report it, do not fix. Two failed fixes on one item: stop and report.
7. **Stay fresh.** If any file changed after the checklist ran (your own fix or a review fix), re-run the whole preflight before reporting.
8. **Write.** Plan or spec exists → write `checklist.md` into its folder (overwrite; git keeps history). No plan or spec → chat only. Running as a worker or subagent → return the checklist in the final report; the owner session writes it.
9. **Report.** Counts per status, failures first, the "Not checked" line, then human to-dos in the `SYSTEM.md` human to-do format. Offer `$wizard` for the human pass.

## Item format

```markdown
| # | Check → expected | Owner | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `npm test` → 0 failed | agent | pass | exit 0, "1193 passed" |
| 2 | recap uses grunt in a bridge session → log shows `iqRouter/grunt` | agent | pass | `grep` over session logs: 103 recap entries, all grunt |
| 3 | prod `/healthz` accepts the token → 200 | human: needs prod token | dry-run ok | `bash -n` exit 0; stubbed `curl` exit 22 fails the script |
```

Statuses: `pass`, `fail`, `dry-run ok`, `not run: <reason>`. Reconciled items add their verdict in the Check column.

## Gotchas

- "Tests pass" without output from this run is not evidence. A result from an earlier turn is stale after any later edit.
- A plan item copied without checking its paths and commands is the failure this skill exists to stop. Verify, then give a verdict.
- "Please check manually" is a last resort. First look for the evidence yourself: logs, installed source, a local run, a stub.
- An item is `human` because of what it needs, not because it is slow or tedious. Slow agent items still run.
- A failure is reported first, never buried under passes.
- Read-only means no edits, not no checks. A read-only turn or a "just write the summary" turn still runs tests, typecheck, and local read-only dry-runs. Do not end with "Should I run the preflight?"; run it.
