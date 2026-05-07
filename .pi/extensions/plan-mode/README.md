# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Behavior

- Plan mode restricts the toolset to read-only tools.
- Subagent delegation is not in the default plan-mode toolset. Normal research stays in-session with read-only tools.
- The current plan is tracked internally and updated as the agent completes steps.
- The plan widget is hidden by default while the agent is coding.
- Use the widget toggle command or shortcut to show or hide the plan on demand.
- When the plan finishes, the widget is cleared automatically.

## Commands

- `/plan` — toggle plan mode
- `/todos` — print the current plan progress
- `/plan-widget` — toggle the plan widget visibility

## Shortcuts

- `Ctrl+Alt+P` — toggle plan mode
- `Ctrl+P` — toggle the plan widget in this project config
- Default without project override: `Ctrl+Alt+W`

## Configuration

The widget shortcut is configured in `.pi/agent.config.json`:

```json
{
  "planMode": {
    "toggleWidgetShortcut": "ctrl+p"
  }
}
```

Set `toggleWidgetShortcut` to your preferred key combination. If omitted, `Ctrl+Alt+W` is used.
