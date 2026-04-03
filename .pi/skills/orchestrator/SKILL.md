---
name: orchestrator
description: End-to-end feature implementation using the full agent pipeline. Spawns planner to create a plan, reviewer to review it, then runs tdd-red/tdd-green/tdd-refactor for each phase. Use when the user wants a feature, bug fix, or refactor implemented from plan through tested code. Do not use for planning-only, review-only, or single TDD cycle tasks.
---

# Orchestrator

End-to-end implementation pipeline: Plan → Grill → TDD per phase.
You are the conductor. You do not write code or tests yourself — you spawn
specialized agents and coordinate their work.

All delegated work must run through the `subagent` tool. Do not execute planner,
review, or TDD stages inline in the parent thread.

## Custom Agents

| Role                   | Agent name     | Config                       | Model / Effort          |
| ---------------------- | -------------- | ---------------------------- | ----------------------- |
| Planning               | `planner`      | `.pi/agents/planner.md`      | high, read-only         |
| Plan review            | `reviewer`     | `.pi/agents/reviewer.md`     | high, read-only         |
| Write failing tests    | `tdd-red`      | `.pi/agents/tdd-red.md`      | high, workspace-write   |
| Minimal implementation | `tdd-green`    | `.pi/agents/tdd-green.md`    | high, workspace-write   |
| Refactor               | `tdd-refactor` | `.pi/agents/tdd-refactor.md` | medium, workspace-write |

## Core Rules

- Use `update_plan` to record all pipeline stages at the start, then mark each step completed as you advance.
- Run stages strictly sequentially: planning → grilling → TDD. Do not start a later stage before the prior one completes.
- Within implementation, run TDD phases sequentially per plan phase: Red → Green → Refactor.
- Give each agent only the context it needs: the current plan phase and relevant files — not the full conversation history.
- If user clarifications are needed, ask first, wait for answers, then re-run the current stage via `subagent` with a `Clarifications` section.
- If reviewer rejects the plan, loop back to planner with the reviewer's feedback. Do not proceed to implementation with an unresolved Critical or High risk.
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
- Instructions to research the codebase and produce a phased implementation plan following `interactive-planner` semantics
- Default output path: `docs/plans/plan-<feature>.md`

If planner requests missing requirements, ask the user, then re-run planner through `subagent` with the answers appended under `Clarifications`.

Wait for planner to finish. Collect the plan. Update `update_plan`.

### Stage 2 — Grill

Spawn `reviewer` with:

- A reference to the plan from Stage 1
- Instructions to stress-test it following `grill-me` semantics

If reviewer needs policy or acceptance clarifications, ask the user, then re-run reviewer through `subagent` with the clarified constraints.

**Decision gate:**

| Verdict                  | Action                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Approved                 | Proceed to Stage 3.                                                                                       |
| Approved with conditions | Show conditions to user. If user accepts, proceed. Otherwise loop to Stage 1 with feedback.               |
| Rejected                 | Loop to Stage 1 with reviewer's feedback. Max 2 loops — after that, surface the disagreement to the user. |

Update `update_plan` after the verdict.

### Stage 3 — Implement (TDD per phase)

For **each phase** in the approved plan, run one TDD cycle:

#### 3a — Red

Spawn `tdd-red` with:

- The current phase from the plan
- Existing test files and testing conventions
- Instructions to write failing tests and confirm they fail for the right reason

Wait for `tdd-red`. Update `update_plan`.

If Red stage is blocked by missing behavior decisions, ask the user and re-run `tdd-red` through `subagent` with a `Clarifications` section.

#### 3b — Green

Spawn `tdd-green` with:

- The failing tests from 3a
- The current phase from the plan
- Instructions to write the minimal implementation to make failing tests pass

Wait for `tdd-green`. Update `update_plan`.

If Green stage hits ambiguous implementation choices, ask the user and re-run `tdd-green` through `subagent` with the answers included.

#### 3c — Refactor

Spawn `tdd-refactor` with:

- The code written in 3b
- Instructions to improve structure and naming while keeping all tests green

Wait for `tdd-refactor`. Update `update_plan`.

If Refactor stage reveals conflicting constraints, ask the user and re-run `tdd-refactor` through `subagent` with updated constraints.

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
- If a subagent name is unavailable, use inline fallback chain: `interactive-planner` -> `planner`; `grill-me` -> `reviewer`; `tdd-coding` -> `tdd-red` -> `tdd-green` -> `tdd-refactor`; `gan-coder` -> `gan-generator` -> `gan-critic`; `orchestrator` -> `planner` -> `reviewer` -> `tdd-red` -> `tdd-green` -> `tdd-refactor`.

## When NOT to Use This Skill

- User only wants a plan → use `interactive-planner` via `subagent` directly.
- User only wants a review → use `grill-me` via `subagent` directly.
- User wants a single TDD cycle → use `tdd-coding` via `subagent` directly.
- User wants a quick fix or explanation → handle inline, no orchestration needed.
