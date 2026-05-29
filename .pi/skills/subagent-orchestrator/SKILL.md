---
name: subagent-orchestrator
description: Use this skill only when the user explicitly asks for subagents, delegation, parallel agents, worker agents, background agents, or delegated execution. Select and scope subagents, define handoffs, and coordinate outputs with the @tintinweb/pi-subagents extension. Do not use for ordinary planning, repository inspection, or implementation in the current session.
---

# Subagent Orchestrator

Use this skill as the policy layer for delegated work.

## Load References

Read [`references/pi-subagents.md`](references/pi-subagents.md) only when needed:

| Need | Load condition |
| --- | --- |
| Tool schema | Tool payload or parameter uncertainty |
| Worktree isolation | Delegated implementation needs isolated file edits |
| Scheduling/settings/events/RPC | Maintaining the extension or debugging runtime behavior |
| Built-in/custom agent details | Agent type selection is unclear after the table below |

## Tools

Use only `@tintinweb/pi-subagents` tools:

- `Agent`
- `get_subagent_result`
- `steer_subagent`

Do not use unsupported payloads: `{ agent, task }`, `{ tasks: [...] }`, or `{ chain: [...] }`.
Do not pass `model` to `Agent` unless the user explicitly requested a model or the active skill specifies one. Project agents should inherit the orchestrator model by default.

## Delegation Rules

- Before calling `Agent`, confirm explicit delegation, choose foreground/background execution, choose agent type, and define expected output/handoff.
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

| Task type | Default agent |
| --- | --- |
| Read-only research, planning, summarization | `generic-readonly` |
| Implementation or file-modifying work | `generic-worker` |
| User explicitly requests built-in Explore | `Explore` |
| User explicitly requests built-in Plan | `Plan` |
| Explicit GAN/generator-evaluator workflow | `gan-generator` / `gan-evaluator` |
| Complex task with no narrower fit | `general-purpose` |

Project agents inherit the parent model. Do not pass `model` unless the user explicitly requested a model or the active skill specifies one.

## Prompting Requirements

- State exact objective, scope boundaries, and expected output format.
- Name files/directories to inspect or modify.
- For worker tasks, specify file ownership, acceptance criteria, and required checks.
- For background agents, state whether partial results are acceptable.
- Keep each delegated prompt narrow and testable.

## Execution Examples

Examples:

### Foreground

```text
Agent({
  subagent_type: "generic-readonly",
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
