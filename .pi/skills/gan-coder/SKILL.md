---
name: gan-coder
description: Adversarial coding workflow that implements tasks through a generator-vs-critic loop with subagents. Use when Codex should break a coding task into small plan slices, have a smaller coding model generate each slice, have a larger model test and review the result, and iterate until the slice passes before moving on. Best for non-trivial bug fixes, refactors, and feature work where correctness gates matter more than raw speed.
---

# GAN Coder

## Overview

Run coding work as a bounded adversarial loop. You are the orchestrator: you own the plan, slice the work, and gate progress. You delegate implementation to `gan_generator` and validation to `gan_critic`. You do not write implementation code yourself.

## Custom Agents

| Role | Agent name | Config |
|---|---|---|
| Implementation | `gan_generator` | `.codex/agents/gan-generator.toml` |
| Review & gate | `gan_critic` | `.codex/agents/gan-critic.toml` |

- `gan_generator` - smaller model with `medium` reasoning — fast, focused, scope-constrained.
- `gan_critic` - larger model with `high` reasoning in `read-only` sandbox — thorough, can run tests, cannot edit files.


## Core Rules

- Keep orchestration in the parent thread. Subagents must not spawn further agents (`max_depth = 1`).
- Own the plan yourself. Subagents execute and evaluate slices; they do not redefine scope.
- Slice the work into narrow, reviewable steps with explicit acceptance criteria.
- Run generator and critic sequentially per slice — the critic depends on the generator's output.
- Bound retries: at most `3` generator attempts per slice before surfacing the blocker.
- Treat the critic as a gate, not a co-author. Verdicts and defects only — not rewrites.
- Parallelize only across independent slices with disjoint file ownership.
- If the task is high-risk or the plan is weak, run `$grill-me` on the plan before starting the loop.

## Workflow

### 1. Build the plan

Before spawning any agent, write a short plan using `update_plan`. For each slice, record:

- **Files owned** — exact files the generator may touch (no others)
- **Behavior to change** — one user-visible change per slice
- **Done criteria** — tests or checks that define passing
- **Rejection conditions** — what the critic must enforce

Keep slices small enough that one generator attempt can finish without drifting scope. Update `update_plan` as each slice completes.

### 2. Spawn the generator

Spawn `gan_generator`. Give it:

- This slice only — not the full plan
- The exact files it owns
- Acceptance criteria
- Existing test commands to run (use project tooling, not invented scripts)
- Explicit instruction: make the smallest defensible change; use `apply_patch` for file edits; batch all reads before editing

Require the generator to return all four sections: **files changed**, **commands run**, **test results**, **unresolved issues**.

### 3. Spawn the critic

Spawn `gan_critic`. Give it:

- The slice brief and acceptance criteria
- The generator's output summary and changed files
- Exact test commands to re-run (the critic can use `shell_command` in its read-only sandbox)
- Permission to reject

Enforce that the critic returns exactly one verdict: `PASS`, `REVISE`, or `BLOCKED`. Reject vague output — demand concrete defects with minimum fixes.

### 4. Run the loop

Act on the verdict:

- `PASS` → mark the slice completed in `update_plan`, advance to the next slice
- `REVISE` → send only the defect list back to `gan_generator`; keep slice scope fixed; increment retry count
- `BLOCKED` → surface the structural issue to the user; repair the slice definition before resuming
- **3 failed generator attempts** → stop the loop, surface the blocker, ask the user how to proceed

If the loop stalls because the critic keeps shifting the target, stop and repair the acceptance criteria definition before continuing.

### 5. Finish

After all slices pass:

1. Run the full validation suite in the parent thread using `shell_command`.
2. For multi-slice or high-risk tasks, spawn `gan_critic` once more for a final whole-change review.
3. Report: slices completed, commands run, accepted risks, suggested next steps.

## Prompt Contracts

### Generator Contract

```text
You are gan_generator. Implement only this slice.
Own only these files: <files>.

Use apply_patch for all file edits.
Before editing, read all files you need in a single parallel batch.
Make the smallest change that satisfies the acceptance criteria below.
Run the listed test commands using shell_command.
Do not broaden scope, clean up unrelated code, or redesign.
Do not self-review. The critic handles that.

Acceptance criteria:
<criteria>

Test commands:
<commands>

Return exactly:
- Files changed (one-line summary per file)
- Commands run (exact command + exit code)
- Test results (pass/fail + brief explanation for any failure)
- Unresolved issues (blockers, risky assumptions, out-of-scope problems)
```

### Critic Contract

```text
You are gan_critic. Review this slice as a hard gate. Do not edit any file.

Read the slice brief and all changed files. Run the listed test commands using
shell_command when practical. Check for: correctness against the acceptance
criteria, regressions in nearby code, missing critical tests, and files touched
outside the declared scope.

Return exactly one verdict:

PASS — slice satisfies all acceptance criteria. Minor observations are allowed
but must be non-blocking.

REVISE — list each defect:
  DEFECT: what is wrong (specific, not stylistic)
  FIX: the minimum change required to resolve it
Limit to actionable defects only. No broad style feedback or out-of-scope suggestions.

BLOCKED — describe the structural issue requiring a plan-level decision. Name
the missing or contradictory constraint. Do not attempt to resolve it yourself.

Acceptance criteria:
<criteria>

Test commands:
<commands>
```

## Guardrails

- `max_depth = 1`: subagents must not spawn further agents. All orchestration stays in the parent thread.
- Assign exclusive file ownership per slice; never assign the same file to two parallel generators.
- Architecture debates return to the parent thread — never let generator and critic argue about design mid-loop.
- Use the project's existing tests and tooling. Do not invent a new validation stack inside the skill.
- Use `apply_patch` for all file edits inside subagents — it is the most in-distribution edit tool for Codex models.
- If subagent support is unavailable, simulate the same loop in one thread: draft → critique → revise → implement.

## References

- Custom agent configs: [`.codex/agents/gan-generator.toml`](.codex/agents/gan-generator.toml), [`.codex/agents/gan-critic.toml`](.codex/agents/gan-critic.toml)
- Codex agent template conventions: [`references/custom-agent-templates.md`](references/custom-agent-templates.md)
- Copilot agent templates (for the `.github/agents/` equivalents): [`references/copilot-agent-templates.md`](references/copilot-agent-templates.md)
