---
name: orchestrator
description: End-to-end feature implementation using the full agent pipeline. Spawns planner to create a plan, griller to review it, then runs tdd_red/tdd_green/tdd_refactor for each phase. Use when the user wants a feature, bug fix, or refactor implemented from plan through tested code. Do not use for planning-only, review-only, or single TDD cycle tasks.
---

# Orchestrator

End-to-end implementation pipeline: Plan → Grill → TDD per phase.
You are the conductor. You do not write code or tests yourself — you spawn
specialized agents and coordinate their work.

## Custom Agents

| Role | Agent name | Config | Model / Effort |
|---|---|---|---|
| Planning | `planner` | `.codex/agents/planner.toml` | high, read-only |
| Plan review | `griller` | `.codex/agents/griller.toml` | high, read-only |
| Write failing tests | `tdd_red` | `.codex/agents/tdd-red.toml` | high, workspace-write |
| Minimal implementation | `tdd_green` | `.codex/agents/tdd-green.toml` | high, workspace-write |
| Refactor | `tdd_refactor` | `.codex/agents/tdd-refactor.toml` | medium, workspace-write |

## Core Rules

- Use `update_plan` to record all pipeline stages at the start, then mark each step completed as you advance.
- Run stages strictly sequentially: planning → grilling → TDD. Do not start a later stage before the prior one completes.
- Within implementation, run TDD phases sequentially per plan phase: Red → Green → Refactor.
- Give each agent only the context it needs: the current plan phase and relevant files — not the full conversation history.
- If griller rejects the plan, loop back to planner with the griller's feedback. Do not proceed to implementation with an unresolved Critical or High risk.
- Keep the user informed between stages with a brief status update.
- Do not write production code, tests, or plans yourself. Delegate all work to the appropriate agent.
- Subagents must not spawn further agents (`max_depth = 1`).

## Workflow

### Stage 0 — Initialize

Record all pipeline stages in `update_plan` before spawning any agent:
- Stage 1: Plan
- Stage 2: Grill
- Stage 3: TDD phase 1 (Red / Green / Refactor)
- … one row per plan phase once the plan is known

### Stage 1 — Plan

Spawn `planner` with:
- The task description
- Instructions to research the codebase and produce a phased implementation plan following `$interactive-planner`
- Default output path: `docs/plans/plan-<feature>.md`

Wait for planner to finish. Collect the plan. Update `update_plan`.

### Stage 2 — Grill

Spawn `griller` with:
- A reference to the plan from Stage 1
- Instructions to stress-test it following `$grill-me`

**Decision gate:**

| Verdict | Action |
|---|---|
| Approved | Proceed to Stage 3. |
| Approved with conditions | Show conditions to user. If user accepts, proceed. Otherwise loop to Stage 1 with feedback. |
| Rejected | Loop to Stage 1 with griller's feedback. Max 2 loops — after that, surface the disagreement to the user. |

Update `update_plan` after the verdict.

### Stage 3 — Implement (TDD per phase)

For **each phase** in the approved plan, run one TDD cycle:

#### 3a — Red

Spawn `tdd_red` with:
- The current phase from the plan
- Existing test files and testing conventions
- Instructions to write failing tests and confirm they fail for the right reason

Wait for `tdd_red`. Update `update_plan`.

#### 3b — Green

Spawn `tdd_green` with:
- The failing tests from 3a
- The current phase from the plan
- Instructions to write the minimal implementation to make failing tests pass

Wait for `tdd_green`. Update `update_plan`.

#### 3c — Refactor

Spawn `tdd_refactor` with:
- The code written in 3b
- Instructions to improve structure and naming while keeping all tests green

Wait for `tdd_refactor`. Update `update_plan`.

#### Phase gate

After each Red → Green → Refactor cycle:
- Confirm all tests pass.
- If a phase fails, surface the issue to the user before continuing to the next phase.
- Move to the next phase in the plan.

### Stage 4 — Final Report

After all phases complete:

1. Run the full test suite using `shell_command`.
2. Summarize what was implemented, tested, and any remaining concerns.
3. List files changed, grouped by phase.

## Guardrails

- Do not collapse all phases into one large spawn. Small, sequential handoffs produce better outputs.
- Do not pass the entire conversation history to each subagent — give focused, phase-specific context.
- If a subagent is unavailable, surface the blocker to the user rather than attempting to substitute inline.

## When NOT to Use This Skill

- User only wants a plan → use `$interactive-planner` directly.
- User only wants a review → use `$grill-me` directly.
- User wants a single TDD cycle → use `$tdd-coding` directly.
- User wants a quick fix or explanation → handle inline, no orchestration needed.
