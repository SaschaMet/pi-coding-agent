# Implementation Workflow (Checklist)

- Re-read volatile files immediately before editing (especially files touched by tests, generated outputs, or active parallel work).
- Treat screenshots as inspiration only; implement against verified requirements in task text, tests, and source docs.
- Call out terminal-dependent behavior (shell, TTY, keybindings, ANSI, interactive prompts) and validate in the target environment.
- Preserve editor affordances:
  - keep shortcuts/keybindings behavior unchanged unless explicitly requested,
  - keep cursor/focus/selection flows predictable,
  - keep status/help text and error surfaces clear.
- Use correct tool names in skill docs and tasks for this harness:
  - `apply_patch` maps to runtime file-edit tools (`edit` for targeted replacements, `write` for full-file writes),
  - `shell_command` maps to runtime command execution (`bash`),
  - `update_plan` has no direct runtime tool here; include plan notes in responses unless/until that tool exists.
