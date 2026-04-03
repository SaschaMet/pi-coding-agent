# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Behavior

- Plan mode restricts the toolset to read-only tools.
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
- `Ctrl+Alt+W` — toggle the plan widget by default

## Configuration

You can override the widget shortcut in `.pi/agent.config.json`:

```json
{
  "planMode": {
    "toggleWidgetShortcut": "ctrl+shift+w"
  }
}
```

Set `toggleWidgetShortcut` to your preferred key combination. If the value is omitted, the default `Ctrl+Alt+W` is used.
