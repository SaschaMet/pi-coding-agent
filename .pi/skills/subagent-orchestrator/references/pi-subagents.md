# PI Subagents Extension

This runtime uses [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) for delegated agents.

Maintenance-only sections: Install, Agent Frontmatter, Scheduling, Background Execution settings, events, and RPC details are for extension maintenance or runtime debugging. Normal orchestration should use the tool schemas and execution patterns only.

## Install

The package is declared in `.pi/settings.json`:

```json
"packages": [
  "npm:@tintinweb/pi-subagents"
]
```

Manual install:

```bash
pi install npm:@tintinweb/pi-subagents
```

## Tools

### `Agent`

Launch a subagent.

```text
Agent({
  subagent_type: "generic-readonly",
  prompt: "Find all files that handle authentication",
  description: "Find auth files",
  run_in_background: true
})
```

Required:

- `subagent_type`: built-in or custom type.
- `prompt`: delegated task.
- `description`: short UI label.

Optional:

- `model`: provider/model id or fuzzy name.
- `thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `max_turns`: graceful turn limit.
- `run_in_background`: return an id immediately.
- `resume`: resume a prior agent id.
- `isolated`: disable extension/MCP tools.
- `isolation`: `"worktree"` for git worktree isolation.
- `inherit_context`: fork parent conversation.
- `schedule`: cron, interval, or one-shot schedule.

Notes:

- Foreground agents block until complete and return results inline.
- Background agents return an `agent_id` immediately and notify on completion.
- `schedule` forces background execution.
- Frontmatter is authoritative for strategy fields. If an agent file sets `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background`, `isolated`, or `isolation`, `Agent` parameters only fill unspecified values.
- Do not pass `model` unless the user explicitly requested a different model or the active skill specifies one.
- Project agents in this repo should omit `model` frontmatter unless a skill deliberately needs a specific model.

### `get_subagent_result`

Retrieve background results.

```text
get_subagent_result({
  agent_id: "agent-id",
  wait: true,
  verbose: false
})
```

Parameters:

- `agent_id`: required background agent id.
- `wait`: wait until completion.
- `verbose`: include full conversation log.

### `steer_subagent`

Redirect a running agent.

```text
steer_subagent({
  agent_id: "agent-id",
  message: "Stop broad refactoring. Only inspect auth middleware."
})
```

Steering interrupts after the current tool execution.

## Built-In Agent Types

- `general-purpose`: all tools, inherits parent prompt with append mode.
- `Explore`: read-only exploration, standalone prompt. Use only when the user explicitly requests it or a skill explicitly allows its configured model.
- `Plan`: read-only planning, standalone prompt.

Agent type names are case-insensitive. Unknown types fall back to `general-purpose` with a note.

## Project Agents

Custom project agents live in `.pi/agents/<name>.md`.
Global agents live in `$PI_CODING_AGENT_DIR/agents/<name>.md`, default `~/.pi/agent/agents/<name>.md`.
Project agents override global agents with the same name.
Default agents can be ejected, overridden, disabled, reset, edited, or deleted through `/agents`.

Project-specific agents in this repo:

- `generic-readonly`: scoped read-only research/planning/summarization.
- `generic-worker`: scoped implementation/file updates.
- `gan-generator`: generator role for explicit generator/evaluator workflows.
- `gan-evaluator`: evaluator role for explicit generator/evaluator workflows.

## Agent Frontmatter

Supported fields:

- `description`
- `display_name`
- `tools`: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, or `none`.
- `extensions`
- `skills`
- `memory`: `project`, `local`, `user`.
- `disallowed_tools`
- `isolation`: `worktree`.
- `model`
- `thinking`
- `max_turns`
- `prompt_mode`: `replace` or `append`.
- `inherit_context`
- `run_in_background`
- `isolated`
- `enabled`

Field defaults:

- `description`: filename.
- `tools`: all built-in tools.
- `extensions`: `true`.
- `skills`: `true`.
- `model`: inherit parent.
- `thinking`: inherit parent.
- `max_turns`: unlimited.
- `prompt_mode`: `replace`.
- `inherit_context`: `false`.
- `run_in_background`: `false`.
- `isolated`: `false`.
- `enabled`: `true`.

Read-only role guidance:

- Use `generic-readonly` for default research/planning/summarization so the subagent inherits the parent model.
- Use `generic-worker` for implementation or file-modifying work so the subagent inherits the parent model.
- Use `Explore` or `Plan` only when the user explicitly requests those built-ins or a skill explicitly allows their configured model behavior.

## Scheduling

`Agent` accepts `schedule`:

- Cron: 6 fields, e.g. `"0 0 9 * * 1"`.
- Interval: `"30s"`, `"5m"`, `"1h"`, `"2d"`.
- Relative one-shot: `"+10m"`, `"+2h"`, `"+1d"`.
- Absolute one-shot: ISO timestamp.

Restrictions:

- `schedule` forces background execution.
- `schedule` cannot combine with `inherit_context` or `resume`.
- Headless `pi -p` does not wait for scheduled subagents.

Schedules are session-scoped. Manage them through `/agents -> Scheduled jobs`.

Scheduled jobs are stored at `<cwd>/.pi/subagent-schedules/<sessionId>.json` with PID-based locking. Disable scheduling through `/agents -> Settings -> Scheduling -> disabled`.

Scheduled fires bypass the manual-agent concurrency queue so intervals are not delayed by long-running manual agents.

## Background Execution

- Background agents run concurrently, default max concurrency 4.
- Excess background agents queue.
- Join mode defaults to `smart`: agents spawned in the same turn are grouped into one completion notification.
- Use `get_subagent_result` when the parent needs a background result.

Join modes:

- `smart`: same-turn background agents are grouped; solo agents notify individually.
- `async`: each agent notifies on completion.
- `group`: force grouping even for one agent.

Group timeout behavior:

- First completed agent starts a 30-second group timeout.
- If not all agents finish in time, a partial notification is sent.
- Remaining agents continue with shorter 15-second rebatch windows.

## Execution Patterns

### Single Foreground

Use when the parent needs the result immediately:

```text
Agent({
  subagent_type: "generic-readonly",
  description: "Map auth flow",
  prompt: "Find the auth entry points and summarize the call path."
})
```

### Parallel Background

Use only when the user explicitly asks for independent subagents and tasks are low-overlap:

```text
Agent({
  subagent_type: "generic-readonly",
  description: "Map API routes",
  prompt: "Find API route handlers and summarize ownership.",
  run_in_background: true
})

Agent({
  subagent_type: "generic-readonly",
  description: "Map test layout",
  prompt: "Find test entry points and summarize coverage patterns.",
  run_in_background: true
})
```

Then join each result:

```text
get_subagent_result({ agent_id: "first-id", wait: true })
get_subagent_result({ agent_id: "second-id", wait: true })
```

### Chain

There is no `{ chain: [...] }` payload. Run foreground agents sequentially and pass prior output into the next prompt:

```text
Agent({
  subagent_type: "generic-readonly",
  description: "Gather context",
  prompt: "Gather context for the cache invalidation bug."
})

Agent({
  subagent_type: "generic-readonly",
  description: "Plan fix",
  prompt: "Using this prior result: <paste prior output>. Plan the smallest fix."
})
```

## Worktree Isolation

Use:

```text
Agent({
  subagent_type: "generic-worker",
  prompt: "Implement the isolated refactor",
  description: "Refactor module",
  isolation: "worktree"
})
```

Behavior:

- Creates a temporary git worktree.
- Cleans up automatically if no changes are made.
- Commits changes to `pi-agent-<id>` if changes exist.
- Fails instead of running unisolated if worktree creation is impossible.

Prerequisites:

- Repository must be a git repo.
- Repository must have at least one commit.
- `git worktree add` must succeed.

## Memory

Set `memory` in agent frontmatter:

```yaml
---
memory: project
---
```

Scopes:

- `project`: `.pi/agent-memory/<name>/`
- `local`: `.pi/agent-memory-local/<name>/`
- `user`: `~/.pi/agent-memory/<name>/`

Read-only agents receive read-only memory access.

## Settings

Runtime settings are managed in `/agents -> Settings`.

Persistent files:

- Global: `~/.pi/agent/subagents.json`
- Project: `<cwd>/.pi/subagents.json`

Project values override global values.

Supported settings include:

- Max concurrency.
- Default max turns.
- Grace turns.
- Join mode.
- Scheduling enablement.

Malformed or invalid setting values are ignored per field. Project settings are written by `/agents -> Settings`; global settings can be edited by hand.

## Runtime Behavior

- Max-turn handling is graceful: the agent receives a wrap-up steering message, then a grace window before hard abort.
- Statuses include `completed`, `steered`, `aborted`, `stopped`, and `failed`.
- The widget shows active, queued, completed, stopped, failed, aborted, token usage, context usage, and compaction count.
- Completed results can be expanded in PI with `ctrl+o`.
- Conversation transcripts are written under `.pi/output/agent-*.jsonl`.

Token accounting:

- `tokens.total` equals input plus output plus cache write.
- Cache read is excluded from totals to avoid over-counting.
- Context usage percent is the current context size indicator.

## Prompting Requirements

- State exact objective, scope boundaries, and expected output format.
- Name files/directories to inspect or modify.
- For worker tasks, specify file ownership, acceptance criteria, and required checks.
- For background agents, state whether partial results are acceptable.
- Keep each delegated prompt narrow and testable.

## Failure Handling

- If delegated execution fails, report the failure exactly.
- Do not simulate missing subagent output.
- Re-run with refined scope only when failure cause is clear.
- If a background agent is still running and the parent needs the result, call `get_subagent_result({ wait: true })`.

## Events And RPC

Events:

- `subagents:created`
- `subagents:started`
- `subagents:completed`
- `subagents:failed`
- `subagents:steered`
- `subagents:compacted`
- `subagents:scheduled`
- `subagents:scheduler_ready`
- `subagents:ready`
- `subagents:settings_loaded`
- `subagents:settings_changed`

RPC over `pi.events`:

- `subagents:rpc:ping`
- `subagents:rpc:spawn`
- `subagents:rpc:stop`

Replies:

- `{ success: true, data?: T }`
- `{ success: false, error: string }`

## Unsupported Payloads

Do not use these payload shapes:

```text
{ agent, task }
{ tasks: [{ agent, task }] }
{ chain: [{ agent, task }] }
```

Use `Agent` calls instead. For chains, run foreground agents sequentially and pass prior output into the next prompt.
