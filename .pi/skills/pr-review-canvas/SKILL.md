---
name: pr-review-canvas
description: Use this skill when the user asks for a visual review, walkthrough, or interactive summary of a GitHub PR or local worktree changes before opening a PR. Trigger on PR URLs and prompts like "review these local changes", "show me what changed", "open a PR canvas", or "make an HTML review". Do NOT use for plain text code review (/code-review), PR description writing (/pull-request), or unrelated frontend implementation.
---

# PR Review Canvas

Generate an interactive HTML walkthrough of a GitHub PR or local worktree changes: gather PR data via `gh api` or local changes via `git status`, categorize files into core vs. boilerplate, add reviewer annotations, render diffs with moved-code detection, then open the page and inspect it.

**Skill assets** — locate the skill directory first, then Read the files:

```bash
git rev-parse --show-toplevel   # → {project_root}
```

Assets live at `{project_root}/.pi/skills/pr-review-canvas/`: `styles.css`, `renderer.js`, `template.html`.

## Workflow

### 1. Preflight

Determine the source first:

| User intent                        | Source mode | Required input       |
| ---------------------------------- | ----------- | -------------------- |
| Reviews an existing GitHub PR URL  | `pr`        | PR URL               |
| Reviews changes before a PR exists | `local`     | Current git worktree |

For `pr` mode:

```bash
gh auth status
```

If this fails, stop and tell the user: `gh auth login` is required.

Parse `{owner}`, `{repo}`, `{number}` from the PR URL before continuing.

For `local` mode:

```bash
git status --short
git diff --stat HEAD
git diff --binary HEAD > /tmp/pr-review-local.patch
```

If `git status --short` is empty, stop and tell the user there are no local changes to review.

Use `local` as `{number}` in all output filenames below. Treat staged, unstaged, and untracked paths as review scope; include untracked text files by adding their content to the body summary manually when `git diff HEAD` cannot show them.

### 2. Fetch review data

For `pr` mode, run all three in parallel:

```bash
gh api repos/{owner}/{repo}/pulls/{number} \
  --jq '{title, body, user: .user.login, state, additions, deletions, changed_files, base: .base.ref, head: .head.ref}'

gh api repos/{owner}/{repo}/pulls/{number}/comments \
  --jq '[.[] | {user: .user.login, body, path, line}]'

gh api repos/{owner}/{repo}/pulls/{number}/files --paginate \
  --jq '[.[] | {key: (.filename | gsub("[^a-zA-Z0-9]"; "_")), value: (.patch // "")}] | from_entries' \
  > /tmp/pr-patches-{number}.json
```

For `local` mode, build the patch JSON from the local diff:

```bash
python3 <<'PY'
import json, re
from pathlib import Path

patch = Path('/tmp/pr-review-local.patch').read_text()
files = {}
current = None
buf = []
for line in patch.splitlines():
    if line.startswith('diff --git '):
        if current:
            files[re.sub(r'[^a-zA-Z0-9]', '_', current)] = '\n'.join(buf)
        parts = line.split(' b/', 1)
        current = parts[1] if len(parts) == 2 else line.split()[-1]
        buf = [line]
    elif current:
        buf.append(line)
if current:
    files[re.sub(r'[^a-zA-Z0-9]', '_', current)] = '\n'.join(buf)
Path('/tmp/pr-patches-local.json').write_text(json.dumps(files))
print(f"Wrote {len(files)} local file patches")
PY
```

### 3. Write body HTML

Read diffs from `/tmp/pr-patches-{number}.json`. Write `<body>` content to `/tmp/pr-review-{number}-body.html`.

**Required structure:**

- Header: title, source label (`#number` for PRs, `local changes` for local mode), author/branch when available, stat pills (`+additions`, `-deletions`, `N files`)
- Summary: what the PR does in plain English
- File sections: core changes expanded (`.file-body.open`), mechanical/boilerplate collapsed
- Verdict checklist at the bottom

**Optional enhancements** — use what fits the PR:

- Pseudocode summaries for dense implementation files — collapse the real diff in a `.bp-section` below
- Inline SVG / mermaid (CDN) diagrams, before/after tables, callout boxes for risks or breaking changes

**CSS classes:**

| Class                                   | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `.header`, `.header h1`, `.header-meta` | Page header                                                     |
| `.pill.add`, `.pill.del`, `.pill.files` | Stat badges                                                     |
| `.content`                              | Centered wrapper (max 900px)                                    |
| `.summary`                              | TL;DR box                                                       |
| `.section-title`                        | Section heading with bottom border                              |
| `.ic`                                   | Inline code (mono, blue, dark bg)                               |
| `.file-card`, `.file-hdr`, `.file-body` | Collapsible file card — `onclick="toggle(this)"` on `.file-hdr` |
| `.file-note`                            | Sticky reviewer annotation inside a card                        |
| `.bp-section`, `.bp-hdr`, `.bp-body`    | Collapsed boilerplate — `onclick="toggleBP(this)"`              |
| `.verdict`                              | Review checklist box                                            |

**JS functions:**

| Function                    | Usage                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `toggle(el)`                | Toggle `.file-body` open/closed                                                                             |
| `toggleBP(el)`              | Toggle `.bp-body` open/closed                                                                               |
| `renderDiff(target, input)` | Render a unified diff — target is a DOM element, ID, or CSS selector; input is a patch string or line array |
| `esc(s)`                    | HTML-escape a string                                                                                        |

**Diff rendering:** Place `<div data-diff="KEY"></div>` where you want a diff rendered. Keys must match the sanitized patch JSON keys (`[a-zA-Z0-9_]`). The renderer auto-discovers these on DOM load from the embedded JSON in `template.html`.

> **CRITICAL — injection safety:** Patch strings can contain literal `</script>`, which breaks HTML parsing. Never embed raw patch output manually in a `<script>` tag. Always use the Python assembly step below.

Read `references/pseudocode-pattern.md` when you want an example of the pseudocode + collapsed diff pattern.

### 4. Assemble

```bash
python3 <<'PY'
import json
from pathlib import Path

import subprocess
project_root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
SKILL = Path(project_root) / '.pi/skills/pr-review-canvas'
patches = json.loads(Path('/tmp/pr-patches-{number}.json').read_text())
html    = Path('/tmp/pr-review-{number}-body.html').read_text()
css     = (SKILL / 'styles.css').read_text()
js      = (SKILL / 'renderer.js').read_text()
tmpl    = (SKILL / 'template.html').read_text()

safe_json = json.dumps(patches).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')

out = (tmpl
    .replace('/* INJECT_CSS */', css)
    .replace('/* INJECT_JS */', js)
    .replace('<!-- INJECT_BODY -->', html)
    .replace('{"__PR_DIFFS_PLACEHOLDER__":true}', safe_json)
)
Path('/tmp/pr-review-{number}.html').write_text(out)
print("Assembled: /tmp/pr-review-{number}.html")
PY
```

### 5. Serve, open, and inspect

**Preferred — Preview MCP (use if available):**
Call `mcp__Claude_Preview__preview_start` with `path=/tmp/pr-review-{number}.html`.

**Fallback — Python HTTP server:**

```bash
cd /tmp
python3 -m http.server 8432 --bind 127.0.0.1 &
server_pid=$!
echo "Server PID: $server_pid"
```

Open `http://127.0.0.1:8432/pr-review-{number}.html`. If port 8432 is taken, try 8433, 8434.

When using the fallback server, capture and report the server PID and stop command to the user:

```bash
kill $server_pid
```

If the PID is unknown, tell the user how to find and stop the port-specific process:

```bash
lsof -ti:8432 | xargs kill
```

After opening the page, inspect it before reporting success:

- Check the browser console for JavaScript, resource, CSP, or JSON parse errors.
- Confirm the page is not blank and every expanded file renders a readable diff or an explicit `No diff data` message.
- Check human readability: title, summary, file names, annotations, diff rows, and verdict must fit the viewport, have enough contrast, and not overlap.
- Click at least one file header and one boilerplate section, if present, to verify toggles.
- If readability or runtime errors fail, edit the body HTML, CSS, or assembly inputs and re-open until the page is usable.

## Error Handling

| Failure                                       | Action                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `gh auth status` fails                        | Stop; tell user to run `gh auth login`                                                                                                                           |
| `/tmp/pr-patches-{number}.json` is empty `{}` | PR may have no file changes, or private repo needs `repo` scope: `gh auth refresh -s repo`                                                                       |
| Page is blank or script errors                | Confirm assembly ran; never manually embed patches — always use the Python step                                                                                  |
| Port 8432 in use                              | `lsof -ti:8432                                                                                                                                                   | xargs kill` or increment port |
| Template inject produces broken HTML          | Verify the four placeholder strings exist in `template.html`: `/* INJECT_CSS */`, `/* INJECT_JS */`, `<!-- INJECT_BODY -->`, `{"__PR_DIFFS_PLACEHOLDER__":true}` |

## Renderer features (automatic)

- Filters import-only lines from diffs
- Collapses whitespace-only change pairs into context lines
- Detects moved code (≥3 consecutive matching lines) → blue/purple tint instead of red/green
- Near-moves (moved + small edits) → lighter purple tint
