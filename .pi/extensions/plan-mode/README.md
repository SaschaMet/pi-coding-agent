# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Behavior

- Plan mode restricts the toolset to read-only tools.
- Subagent delegation is not in the default plan-mode toolset. Normal research stays in-session with read-only tools.
- After a plan is produced, PI asks whether to execute, stay in plan mode, or refine the plan.

## Commands

- `/plan` — toggle plan mode

## Shortcuts

- `Ctrl+Alt+P` — toggle plan mode
