---
name: init-project
description: Use this skill when the user asks to initialize, bootstrap, or scaffold a repository's agent-instruction layer — generate a root AGENTS.md from the project's SYSTEM.md and repo state, build a DOX-style tree of sub AGENTS.md files for durable boundaries, create an Architecture.md overview, and wire in a coding standard. Use it for first-time project onboarding of agent docs, not ordinary feature work, single-file edits, or refreshing one existing AGENTS.md section.
---

# Init Project

Bootstrap a repository's agent-instruction layer in one pass: a root `AGENTS.md` distilled from the project `SYSTEM.md` and the actual repo, a `docs/Architecture.md` structural overview, a DOX-structured tree of child `AGENTS.md` files for durable boundaries, and a wired-in coding standard.

## Trigger Boundary

Use when a repo has no agent-instruction layer (or only a scattered one) and the user wants it initialized end-to-end. Also covers requests phrased as "Agent.md" — this skill produces `AGENTS.md`, the DOX and ecosystem convention.

Do not use for ordinary feature work, isolated edits to one existing `AGENTS.md`, or generic documentation. If the repo already has a maintained DOX tree, prefer a targeted edit over re-initialization.

## Definition of Done

- The project `SYSTEM.md` and repo shape were inspected before writing anything.
- A root `AGENTS.md` exists at the repo root with the six DOX sections, distilling durable rules from `SYSTEM.md` (referencing it, not duplicating it verbatim).
- `docs/Architecture.md` exists with a tech-stack summary, component map, and dependency direction (skipped for flat repos).
- Child `AGENTS.md` files exist for each durable boundary, each with the six DOX sections and a populated Child DOX Index.
- Every parent's Child DOX Index links to its direct children; the tree is walkable from root.
- A coding standard is wired into Work Guidance: an existing standard is referenced, or `add-coding-standard` was run (or proposed) to create one.
- A `.claudeignore` exists at the repo root excluding `node_modules`, build artifacts, and lockfiles.
- The project's `.pi/settings.json` has an `ignorePatterns` array excluding the same paths as a tool-layer guardrail.
- The result was verified: the DOX chain is consistent and links resolve.

## Workflow

Before Step 1, check whether `graphify-out/graph.json` exists at the repo root. If it does, use `graphify query` for module boundaries, ownership, and dependency direction when deciding where child `AGENTS.md` files belong. If no graph exists and the repo is large or its boundaries are unclear from direct inspection, run `graphify <path> --mode deep --no-viz` first. Treat graph output as supporting evidence, not a replacement for reading the files you document.

1. Inspect before writing:
- Locate `SYSTEM.md` (check `.pi/SYSTEM.md`, `agent/SYSTEM.md`, repo root). If absent, ask the user where it is or whether to proceed from repo inspection alone.
- Repo shape: languages, package manager, frameworks, source/test layout, top-level directories.
- Existing agent docs: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `README` engineering sections. Preserve and extend; do not clobber.
- Existing coding standard: `AGENTS.md` standard sections, engineering-standard docs, lint/format/test/CI config, hooks.
- When inspecting, don't `cat` entire large files — grep for the relevant symbols or sections and read targeted line ranges instead.
2. Read [references/dox-framework.md](references/dox-framework.md) for the exact section templates, Child DOX Index syntax, and closeout rules.
3. Create the root `AGENTS.md` (adapt [templates/AGENTS-root.md](templates/AGENTS-root.md)):
- Distill `SYSTEM.md`'s durable rules (communication, safety, principles, coding workflow) into Local Contracts and Work Guidance. Reference `SYSTEM.md` by path for the full source; do not paste it wholesale.
- Fill Purpose and Ownership from the repo's actual structure and owners.
- Leave Work Guidance / Verification minimal if no standard exists yet — Step 5 fills them.
3b. Create `docs/Architecture.md` (adapt [templates/Architecture.md](templates/Architecture.md)):
- Run `$graphify` to build a dependency graph of the repo. If `graphify-out/graph.json` already exists, query it; otherwise build it first.
- Use the graph to populate the component map, dependency direction, and identify module boundaries.
- Supplement graph data with manual inspection: tech stack from `package.json`, key decisions from `README.md` and configuration files.
- Keep it concise — structural facts, not a design document.
- Skip this step for flat or single-purpose repos where the root `AGENTS.md` Purpose section suffices.
4. Build the DOX tree (adapt [templates/AGENTS-child.md](templates/AGENTS-child.md)):
- Identify durable boundaries: folders with their own purpose, contracts, ownership, or quality bar (e.g. `src/api`, `packages/*`, `infra`). Skip transient or trivial folders.
- Create one child `AGENTS.md` per boundary with the six DOX sections. Put broad rules in parents, concrete local details in children.
- Populate each parent's Child DOX Index with links to its direct children. Make the tree walkable from root.
5. Wire in the coding standard:
- If a usable standard already exists, reference it from Work Guidance (root and relevant children).
- Otherwise invoke the `add-coding-standard` skill to install one, then reference what it produced. If the user did not ask for a standard, propose it and continue without blocking.
6. Set up `.claudeignore`:
- If a `.claudeignore` already exists at the repo root, extend it rather than overwriting.
- Otherwise create one excluding `node_modules`, build artifacts (e.g. `dist`, `build`, `.next`, `out`), and lockfiles (e.g. `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`).
7. Set up `ignorePatterns` in `.pi/settings.json`:
- This is a hard guardrail at the tool layer: `read`/`edit`/`write` refuse to touch matching paths, unlike `.claudeignore` which only affects what gets surfaced.
- If `.pi/settings.json` already exists, add or extend its `ignorePatterns` array rather than overwriting the file.
- Otherwise create `.pi/settings.json` with an `ignorePatterns` array covering the same exclusions as `.claudeignore`, e.g.:
```json
{
  "ignorePatterns": [
    "**/.svn/**",
    "**/node_modules/**",
    "**/.venv/**",
    "**/dist/**",
    "**/*.pem"
  ]
}
```
- `~/.pi/agent/settings.json` holds global rules across all projects; `.pi/settings.json` in the repo holds local rules. Use `!pattern` to re-include a specific file and `+path` to force-include an exact path when a broad pattern is too aggressive.
8. Verify and report:
- Confirm every Child DOX Index link resolves and the chain reads consistently from root to leaves.
- Report created/changed files, the boundaries chosen, and the coding-standard decision.

## Decision Table

| Situation | Default action |
| --- | --- |
| No `SYSTEM.md` found | Ask for its location; if none exists, proceed from repo inspection and note the gap. |
| `AGENTS.md` already exists at a path | Extend its sections to DOX shape; never overwrite content blindly. |
| Repo is flat / single-purpose | Create root `AGENTS.md` only; skip `docs/Architecture.md` and child `AGENTS.md` files. |
| Monorepo with packages | Root `AGENTS.md` + one child per package (and per sub-boundary that warrants it). |
| Existing coding standard present | Reference it from Work Guidance; do not install a second one. |
| No coding standard, user didn't request one | Propose `add-coding-standard`; create the DOX tree regardless. |
| `SYSTEM.md` rule conflicts with repo reality | Document repo reality in the local contract; flag the conflict rather than inventing rules. |
| `.claudeignore` already exists | Extend it with any missing exclusions; do not overwrite. |
| `.pi/settings.json` already exists | Add/extend its `ignorePatterns` array; preserve the rest of the file. |

## Gotchas

- Do not duplicate `SYSTEM.md` verbatim into `AGENTS.md`. Distill durable rules and reference the source path; `SYSTEM.md` stays the single origin.
- Do not create a child `AGENTS.md` for every folder. Create one only for a durable boundary with its own purpose, contracts, or quality bar.
- Do not leave a parent's Child DOX Index stale after adding a child. Refresh every affected index so the tree stays walkable.
- Do not put concrete local details in the root or broad project rules in a leaf. Broad in parents, specific in children.
- Do not install a second coding standard when one exists. Reference the existing one from Work Guidance.
- Do not overwrite an existing `AGENTS.md`. Extend it into DOX shape and preserve current content.
- Do not skip `.claudeignore`. Exclude `node_modules`, build artifacts, and lockfiles so agents don't waste context reading them.
- Do not `cat` an entire large file during inspection. Grep for what's relevant and read specific line ranges instead.
- Do not rely on `.claudeignore` alone for sensitive paths (e.g. `*.pem`, `.env`). Mirror those in `.pi/settings.json`'s `ignorePatterns` so tools are hard-blocked, not just steered away.
- Do not overwrite an existing `.pi/settings.json` wholesale when adding `ignorePatterns`. Merge into it and preserve any other keys already present.
- Do not create `docs/Architecture.md` for flat or trivial repos. The root `AGENTS.md` Purpose section covers it.
- Do not skip `$graphify` when creating `docs/Architecture.md`. Build the graph first, then use it to populate the component map and dependency direction.

## Skill Layout

- [agents/openai.yaml](agents/openai.yaml): UI metadata and default prompt.
- [references/dox-framework.md](references/dox-framework.md): DOX section templates, Child DOX Index syntax, pre-edit and closeout protocol. Read in Step 2.
- [templates/AGENTS-root.md](templates/AGENTS-root.md): starting point for the root file. Adapt; do not copy blindly.
- [templates/AGENTS-child.md](templates/AGENTS-child.md): starting point for child files. Adapt; do not copy blindly.
- [templates/Architecture.md](templates/Architecture.md): starting point for the architecture overview. Adapt; do not copy blindly.

## Output

When planning or reporting, use:

```markdown
## Inspection
- SYSTEM.md:
- Repo shape:
- Existing agent docs:
- Existing coding standard:

## Architecture.md
- [created | skipped (flat repo)]

## DOX Tree
- root AGENTS.md
- [path]/AGENTS.md — [boundary purpose]

## Coding Standard
- [referenced existing | ran add-coding-standard | proposed]

## .claudeignore
- [created | extended | already present]

## .pi/settings.json ignorePatterns
- [created | extended | already present]

## Verification
- Index links resolve:
- Residual gaps:
```
