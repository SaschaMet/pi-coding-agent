---
name: subagent-orchestrator
description: Use this skill only when the user explicitly asks for subagents, delegation, parallel agents, worker agents, background agents, or delegated execution. Select and scope subagents, define handoffs, and coordinate outputs with the @tintinweb/pi-subagents extension. Do not use for ordinary planning, repository inspection, or implementation in the current session.
---

# Subagent Orchestrator

Use this skill as the policy layer for delegated work. Full extension details, schemas, examples, settings, and runtime behavior are documented in [`references/pi-subagents.md`](references/pi-subagents.md).

## Tools

Use only `@tintinweb/pi-subagents` tools:

- `Agent`
- `get_subagent_result`
- `steer_subagent`

Do not use unsupported payloads: `{ agent, task }`, `{ tasks: [...] }`, or `{ chain: [...] }`.

## Delegation Rules

- Use subagents only when the user explicitly asks for delegation/subagents.
- Do not delegate normal repository inspection, planning, implementation, or skill execution by default.
- Direct `/skill:*` and skill-use requests stay in-session unless the user explicitly asks for delegation.
- Do not delegate the immediate blocker if the main session needs that result before it can continue.
- Use separate agents for separate concerns.
- Run subtasks in parallel only when the user explicitly requests independent subagents and the subtasks are independent.
- Do not split strongly overlapping tasks across different agents.
- Prefer foreground `Agent` calls when the parent needs the result immediately.
- Prefer background `Agent` calls only when the parent can keep working without the result.

## Agent Selection

- `Explore`: fast read-only codebase exploration.
- `Plan`: read-only implementation planning.
- `general-purpose`: complex multi-step work that should inherit parent rules.
- `generic-readonly`: project-specific read-only research, planning, and summarization.
- `generic-worker`: project-specific implementation or file-modifying work.
- `gan-generator` / `gan-evaluator`: explicit GAN/generator-evaluator workflows only.

## Prompting Requirements

- State exact objective, scope boundaries, and expected output format.
- Name files/directories to inspect or modify.
- For worker tasks, specify file ownership, acceptance criteria, and required checks.
- For background agents, state whether partial results are acceptable.
- Keep each delegated prompt narrow and testable.

## Script

Examples:

### Foreground

```text
Agent({
  subagent_type: "Explore",
  description: "Map auth flow",
  prompt: "Find the auth entry points and summarize the call path."
})
```

### Background

```text
Agent({
  subagent_type: "generic-readonly",
  description: "Map API routes",
  prompt: "Find API route handlers and summarize ownership.",
  run_in_background: true
})

get_subagent_result({ agent_id: "<agent-id>", wait: true, verbose: false })
```

### Steering

```text
steer_subagent({
  agent_id: "<agent-id>",
  message: "Stop broad exploration. Only inspect auth middleware and summarize findings."
})
```

This skill-specific orchestration:

- Use foreground agents when the next parent step depends on the result.
- Use background agents only for independent work.
- Run dependent chains as sequential foreground `Agent` calls and pass prior output in the next prompt.

## Failure Handling

- If delegated execution fails, report the failure exactly and stop.
- Do not simulate missing subagent output.
- Re-run with refined scope only when failure cause is clear.
- If a background agent is still running and the parent needs the result, call `get_subagent_result({ wait: true })`.
