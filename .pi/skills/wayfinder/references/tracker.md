# Wayfinder Tracker Operations

Read before the first tracker write in a session. Two trackers; **local is the default**. The effort's map records its choice on the `Tracker:` line in `## Notes` — read that line before writing. A new effort uses local unless the user asks for GitHub.

Both trackers hold the same map body: the five sections defined in `SKILL.md`'s **The Map** — `## Destination`, `## Notes`, `## Decisions so far`, `## Not yet specified`, `## Out of scope`. Only the mechanics below differ.

## Local markdown (default)

The map is a file; each ticket is a file beside it. Tracked in git — do **not** put maps under `.pi/scratch/`, which is gitignored, or `docs/plans/`, likewise.

```
.pi/wayfinder/<effort>/
  map.md                    # the map body
  issues/NN-<slug>.md       # one ticket per file, numbered from 01
  research/<slug>.md        # findings from research subagents
```

- **Map** — `.pi/wayfinder/<effort>/map.md`. `<effort>` is a short kebab-case slug of the destination.
- **Child ticket** — `.pi/wayfinder/<effort>/issues/NN-<slug>.md`, numbered from `01` in creation order, with the question in the body. Three header lines above it:
  - `Type: research|prototype|grilling|task`
  - `Status: open|claimed|resolved|out-of-scope`
  - `Blocked by: NN, NN` — or `None`.
- **Blocking** — the `Blocked by:` line. A ticket is unblocked when every file it lists is `resolved`. Wire these in a second pass, after the tickets exist and have numbers.
- **Frontier** — scan `issues/` for files that are `Status: open` and unblocked; lowest number wins.
- **Find existing maps** — `ls .pi/wayfinder/*/map.md`.
- **Claim** — set `Status: claimed`, save, and only then start work.
- **Resolve** — append the answer under an `## Answer` heading, set `Status: resolved`, then append the gist plus link to Decisions-so-far in `map.md`.
- **Rule out of scope** — set `Status: out-of-scope`, append the gist plus link to the map's Out of scope section. Never to Decisions-so-far.

Ticket file template:

```markdown
# NN — <Ticket title>

Type: grilling
Status: open
Blocked by: None

## Question

<the decision or investigation this ticket resolves>
```

## GitHub (opt-in)

Native issue dependencies render the frontier visually in the GitHub UI, which is the reason to choose this over local. **Gate before charting**: run `gh auth status`, and confirm the repo answers on the sub-issues and `dependencies/blocked_by` endpoints. If either is unavailable, fall back to local and say so — do not chart half onto GitHub.

- **Map** — one issue labelled `wayfinder:map`: `gh issue create --label wayfinder:map`.
- **Child ticket** — an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues are not enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Label `wayfinder:<type>` — one of `research`, `prototype`, `grilling`, `task`.
- **Blocking** — native issue dependencies:

  ```bash
  gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>
  ```

  `<blocker-db-id>` is the blocker's numeric **database id** — `gh api repos/<owner>/<repo>/issues/<n> --jq .id` — **not** the `#number` and **not** the `node_id`. GitHub then reports `issue_dependencies_summary.blocked_by`, counting open blockers only. Where dependencies are unavailable, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body.
- **Frontier** — list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues or task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`) or an assignee; first in map order wins.
- **Find existing maps** — `gh issue list --label wayfinder:map --state open`.
- **Claim** — `gh issue edit <n> --add-assignee @me`, the session's first write. The assignee *is* the claim: an open, unassigned ticket is unclaimed.
- **Resolve** — `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append the gist plus link to Decisions-so-far in the map body.
- **Rule out of scope** — close the issue and append the gist plus link to the map's Out of scope section. Never to Decisions-so-far.
