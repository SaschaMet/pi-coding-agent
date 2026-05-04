---
name: subagent-orchestrator
description: Central orchestration policy for delegated execution and spawning subagents. Use when tasks are non-trivial, long-horizon, high-context, or better split into scoped subagent workstreams while preserving coherence and minimizing overlap.
---

# Subagent Orchestrator

Central policy for spawning and coordinating subagents.
Use this skill to keep delegation decisions consistent and maintainable.

## Delegation Contract

- Treat this skill as the single policy source for subagent orchestration.
- For non-trivial tasks, delegate execution with the `subagent` tool.
- Keep trivial, localized tasks in-session unless the user explicitly asks for delegation.
- Use separate subagents for separate concerns.
- Run subtasks in parallel only when they are independent.
- Do not split strongly overlapping tasks across different subagents.

## Agent Selection Rules

- Use `generic-readonly` for:
  - repository reconnaissance
  - codebase understanding
  - pattern discovery
  - planning and summarization
  - log and CLI investigation that does not require file mutation
- Use `generic-worker` for:
  - code implementation
  - file edits
  - behavior changes
  - tests and validation updates tied to changed code

## Execution Patterns

### Single

Use `{ agent, task }` when one scoped delegation is enough.

### Parallel

Use `{ tasks: [...] }` when subtasks are independent and low-overlap.

### Chain

Use `{ chain: [...] }` when later steps depend on prior outputs.
Use `{previous}` explicitly in downstream task prompts.

## Prompting Requirements for Delegated Steps

- State exact objective, scope boundaries, and expected output format.
- Name files/directories to inspect or modify.
- For worker tasks, specify acceptance criteria and required checks.
- Keep each delegated prompt narrow and testable.

## User-Intent Guardrails

- If the user already gave a concrete task, execute it with this orchestration policy.
- If no concrete task was given, ask for the task before starting.
- Do not auto-pick tickets or speculative work.

## Failure Handling

- If delegated execution fails, report the failure exactly and stop.
- Do not simulate missing subagent output.
- Re-run with refined scope only when failure cause is clear.
