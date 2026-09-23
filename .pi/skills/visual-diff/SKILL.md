---
name: visual-diff
description: Use this skill when the user wants to see, understand, or walk through code changes visually — "show me the diff", "explain this PR", "what changed on this branch", "visual review", or a readable page for a commit, range, or working tree. It builds one offline HTML page with the real highlighted diff grouped into themes, notes pinned to lines, an impact diagram, behavior changes, and review focus. Do not use to find defects or give a verdict (code-review), to quiz the user on a change (pr-quiz), or to create or describe a PR (pull-request).
---

# Visual Diff

Turn a change set into one offline web page that explains it next to the real code.

The work is split in two:

- **The script** collects the diff and renders the code. It is the only source of code on the page.
- **You** write `narrative.json`: themes, notes, behavior changes, removed behavior, the impact graph, and review focus. You point at code by hunk id (`h1`, `h2`, …). You never retype code.

Script: `node <skill-dir>/scripts/visual-diff.mjs`, where `<skill-dir>` is the folder of this file.

## Definition of Done

- `render` exited 0 and printed the page path.
- Every theme cites real hunk ids, and every claim cites `file:line`.
- Intent is marked `stated` (from a commit message or PR body) or `inferred`.
- The user got a summary of 10 lines or fewer plus the page path.

## Workflow

### 1. Parse the request

`/visual-diff [summary|deep] [--range <r> | --commit <sha> | --pr <n>] [--path <p>]`

- Mode defaults to `summary`. Use `deep` when the user asks for a thorough or expert review.
- No target → the working tree against its base: the upstream, else the merge-base with the default branch, else `HEAD`. Untracked files are included.
- `--pr <n>` → first check out the PR head with `gh pr checkout <n>`. `collect` refuses to run otherwise.

**Done when**: mode and target are fixed.

### 2. Collect

Run `node <skill-dir>/scripts/visual-diff.mjs collect <target flags>`.

- Exit 0 with `no changes` → tell the user and stop.
- Exit 3 with `diff too large; narrow with --path` → ask the user which path to narrow to, or pick the most relevant folder and say so.
- Otherwise stdout starts with `run: <dir>`, then one line per hunk: `h3 src/a.ts @@ -10,4 +10,6 @@ +3 -1`. Lines marked `[generated]` are lockfiles, minified, or build output.

Read the hunk index first. Skip `[generated]` hunks. Read the rest of `<dir>/diff.patch` in pages, not all at once. `<dir>/meta.json` holds the base, stats, excluded files, and for PRs the PR body (`prBody`).

**Done when**: you know every non-generated hunk.

### 3. Understand

- Read commit messages (`git log <base>..HEAD`) or `prBody` for the stated intent.
- Read the code around each hunk: the enclosing function, its callers, its tests.
- Apply the lenses in [references/lenses.md](references/lenses.md). `summary` uses change taxonomy, cross-file impact, and hidden risks. `deep` uses all seven.
- Group hunks into themes by purpose, not by file. Rate each theme's importance from 1 to 5.

**Done when**: each hunk belongs to a theme or is left for "Other changes" on purpose.

### 4. Map the impact

- If `graphify-out/graph.json` exists, run up to 5 `graphify query "what depends on <symbol or file>" --budget 1500` calls for the most important changed symbols. Set `impact.source` to `graphify`.
- Otherwise grep for callers of the changed exported symbols, 1 hop only. Scope the grep to source folders and set a timeout. Set `impact.source` to `grep`.
- Changed symbols are `changed` nodes. Their direct callers or dependents are `affected` nodes. Give nodes a `layer` (for example `ui`, `service`, `data`) when the codebase has clear layers.
- Nothing found → `impact.source` `none` with empty lists.

**Done when**: the impact block is written, even if empty.

### 5. Write the narrative

Write `<dir>/narrative.json` as described in [references/narrative-schema.md](references/narrative-schema.md). Plain text only; `` `code` `` spans are the only markup.

**Done when**: the file exists.

### 6. Render

Run `node <skill-dir>/scripts/visual-diff.mjs render --dir <dir>`.

- As an unattended agent (a subagent or a cmux worker), add `--no-open` and report the path instead.
- Exit 2 → stderr lists every violation. Fix them and run `render` again. Stop after 2 failed fixes and report the errors (the stop-and-report rule).
- Exit 0 → stdout is the page path. The page opens in the browser unless `--no-open` was given.

**Done when**: the page exists.

### 7. Report

Print 10 lines or fewer: what changed, why, the top 3 review-focus items, and the page path. Then suggest `code-review` to verify the focus items and `pr-quiz` to test understanding.

Tell the user two facts once:

- Run folders in `$TMPDIR/pi-reports/` are never deleted by this skill. The OS temp cleanup removes them.
- Secrets are filtered by file name only (env files, keys, credentials). A secret inside an ordinary file is shown as-is.

**Done when**: the user has the summary and the path.

## Rules

- Never write diff lines into the narrative. The page shows code only from `diff.patch`.
- Never present a suspicion as a bug. Review focus lists failure scenarios to check, not verdicts.
- Order themes by importance, not by file order.
- The script writes only inside `$TMPDIR/pi-reports/` and never changes the git index or working tree.
