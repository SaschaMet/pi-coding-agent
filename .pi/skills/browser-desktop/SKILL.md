---
name: browser-desktop
description: Use the local desktop browser tool for page navigation and screenshots via installed browsers (chrome, brave, safari).
argument-hint: Goal, URL, and preferred browser (optional)
---

# Browser Desktop Skill

Use this skill when the task requires opening a real local browser, navigating pages, taking screenshots, inspecting console output or network requests, and closing the browser session.

## Tool Contract

Use tool `browser` with this schema:

- `action`: `list | open | navigate | screenshot | close | inspect`
- `browser` (optional): `chrome | brave`
- `url` (required for `open`, `navigate`, and `inspect`): `http://` or `https://`
- `inspect` (optional for `inspect`): `console | network | all`
- `durationMs` (optional for `inspect`): capture window in milliseconds
- `maxEntries` (optional for `inspect`): max console/network entries to return
- `reload` (optional for `inspect`): reload after navigation to recapture startup activity

## Execution Rules

- Always start with `action: "list"` unless the user already specified a known installed browser.
- If the user did not specify browser, pick the first available in this order: `brave`, `chrome`.
- Validate URLs before use. Reject non-http(s) URLs.
- Use `open` to launch a page in a browser.
- Use `navigate` to change the URL in an existing front window/tab.
- Use `inspect` to capture browser console output, network requests, or both.
- Use `screenshot` after `open`/`navigate` when visual verification is requested.
- Use `close` unless a user asks to keep the browser open.

## Standard Flow

1. `list`
2. `open` (or `navigate`) with target URL
3. optional `inspect`
4. optional `screenshot`
5. optional `close`

## Error Handling

- If no supported browser is available, return a clear error and ask user which browser to install/use.
- If requested browser is unavailable, report exact missing browser name and stop.
- If screenshot fails, return the exact failure message and keep session state unchanged.
- If inspect fails, return the exact failure message and do not claim that console or network capture succeeded.

## Output Requirements

- Report browser used, action executed, and resulting URL/path.
- For `inspect`, report browser used, capture mode, and the returned console/network summaries.
- For screenshot, include saved path and image result from the tool output.
- Keep responses concise and task-focused.

## Safety

- Do not run install commands automatically.
- Do not claim navigation/screenshot success without tool confirmation.
- Do not claim inspect success without tool confirmation.
- Do not access local files via URL schemes; only use `http`/`https`.
- Desktop browser automation is host-only. Do not assume it can run inside a container sandbox.
- Sandboxed localhost access is a separate HTTP fetch concern. If a task only needs HTTP access to a local app, prefer the HTTP tool path over GUI browser automation.
