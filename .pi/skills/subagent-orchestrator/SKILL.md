---
name: subagent-orchestrator
description: Central orchestration policy for explicit delegated execution and delegated fetch_web_page workflows. Use only when the user explicitly asks for subagents/delegation or when routing fetch_web_page retrieval/summarization through readonly subagents.
---

# Subagent Orchestrator

Central policy for spawning and coordinating subagents.
Use this skill to keep delegation decisions consistent and maintainable.

## Delegation Contract

- Treat this skill as the single policy source for subagent orchestration.
- Use the `subagent` tool only when the user explicitly asks for delegation/subagents or when delegating `fetch_web_page` retrieval/summarization.
- Do not delegate normal repository inspection, planning, implementation, or skill execution by default. Run that work in the current session.
- Direct `/skill:*` and skill-use requests stay in-session unless the user explicitly asks for delegation.
- Use separate subagents for separate concerns.
- Run subtasks in parallel only when the user explicitly requests independent subagents and the subtasks are independent.
- Do not split strongly overlapping tasks across different subagents.

## Agent Selection Rules

- Use `generic-readonly` for:
  - delegated `fetch_web_page` retrieval
  - delegated fetch-and-summary chains
  - explicitly delegated repository reconnaissance
  - explicitly delegated codebase understanding
  - explicitly delegated pattern discovery
  - explicitly delegated planning and summarization
  - explicitly delegated log and CLI investigation that does not require file mutation
- Use `generic-worker` for:
  - explicitly delegated implementation requests
  - explicitly delegated code implementation
  - explicitly delegated file edits
  - explicitly delegated behavior changes
  - explicitly delegated tests and validation updates tied to changed code

## Execution Patterns

### Single

Use `{ agent, task }` when one scoped delegation is enough.
Default for delegated `fetch_web_page` retrieval.

### Parallel

Use `{ tasks: [...] }` only when the user explicitly requests independent subagents and the subtasks are independent and low-overlap.

### Chain

Use `{ chain: [...] }` when later steps depend on prior outputs.
Use `{previous}` explicitly in downstream task prompts.
Default for delegated fetch-then-summarize flows.

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
