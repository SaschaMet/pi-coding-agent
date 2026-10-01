---
name: plan-view
description: Use this skill when a plan or spec in `docs/plans/` or `docs/specs/` (flat or in its own `<name>/` folder) should be read as a web page — "show the plan", "render the spec", "open the plan view" — and after each implementation step, so the page shows current status markers and AI-Notes. It renders the markdown to one offline HTML page next to it, with status chips, done/total counts, a Grill Status badge, an AI-Notes timeline, and archify diagrams. Do not use for research docs or any other markdown, to write or change a plan (create-plan, create-spec), or to show a code diff (visual-diff).
---

# Plan View

Render a plan or spec as one offline web page next to it. The markdown stays the only source of truth: the `.html` and `<doc>.assets/*.html` files are generated. Never edit them by hand.

Script: `node <skill-dir>/scripts/plan-view.mjs`, where `<skill-dir>` is the folder of this file.

## Definition of Done

- `render` exited 0 and printed the page path.
- The page was rendered after the last edit to the `.md`.

## Render

`node <skill-dir>/scripts/plan-view.mjs render <docs/{plans,specs}/[<name>/]*.md> [--no-open]`

- Run it from the repository root. Paths are checked after resolving symlinks. Only files directly in `docs/plans/` or `docs/specs/`, or one folder below them (`docs/specs/<name>/spec-<name>.md`), render.
- The page is written as `<doc>.html` next to the `.md`. stdout is its absolute path.
- Without `--no-open`, the page opens in the browser. Use `--no-open` when no human watches (subagents, cmux workers, CI).
- Render again after every edit to the `.md`. The page never updates by itself. Its header shows the source sha256 and render time.

Exit codes:

- `0` — page written. Malformed AI-Notes entries still render, marked "unparsed", with one `warning:` line each on stderr.
- `2` — bad arguments, an input path outside `docs/plans/` or `docs/specs/` or more than one folder deep, or invalid diagram references. stderr lists every problem. The previous page stays untouched.

## Diagrams

A line that holds only a diagram reference embeds an archify diagram:

```md
![Plan flow after the change](plan-x.assets/flow.dataflow.json)
```

- The JSON file must sit directly in `<doc>.assets/` and be named `<id>.<type>.json`. `<type>` is one of `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`. Each `<id>` is used once per document.
- The script runs `archify validate`, then `archify render` to `<doc>.assets/<id>.html`, and embeds that file in a sandboxed iframe with the caption below it.
- For the JSON format, run `node <skill-library>/archify/bin/archify.mjs guide`, where `<skill-library>` is `../../skill-library` from `<skill-dir>`.
- Other images and Mermaid blocks stay text.

## Gotchas

- A render failure does not fail an implementation step. Fix the diagram once. If the render still fails, add a `gotcha` AI-Note, name the failure in the step report, and continue.
- The page loads nothing from the network. Links to `http(s)` and relative paths work. Other link schemes render as text.
