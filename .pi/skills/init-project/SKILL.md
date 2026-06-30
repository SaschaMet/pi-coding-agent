---
name: init-project
description: Use this skill when the user asks to initialize, bootstrap, or scaffold a repository's agent-instruction layer — generate a root AGENTS.md from the project's SYSTEM.md and repo state, build a DOX-style tree of sub AGENTS.md files for durable boundaries, and wire in a coding standard. Use it for first-time project onboarding of agent docs, not ordinary feature work, single-file edits, or refreshing one existing AGENTS.md section.
---

# Init Project

Bootstrap a repository's agent-instruction layer in one pass: a root `AGENTS.md` distilled from the project `SYSTEM.md` and the actual repo, a DOX-structured tree of child `AGENTS.md` files for durable boundaries, and a wired-in coding standard.

## Trigger Boundary

Use when a repo has no agent-instruction layer (or only a scattered one) and the user wants it initialized end-to-end. Also covers requests phrased as "Agent.md" — this skill produces `AGENTS.md`, the DOX and ecosystem convention.

Do not use for ordinary feature work, isolated edits to one existing `AGENTS.md`, or generic documentation. If the repo already has a maintained DOX tree, prefer a targeted edit over re-initialization.

## Definition of Done

- The project `SYSTEM.md` and repo shape were inspected before writing anything.
- A root `AGENTS.md` exists at the repo root with the six DOX sections, distilling durable rules from `SYSTEM.md` (referencing it, not duplicating it verbatim).
- Child `AGENTS.md` files exist for each durable boundary, each with the six DOX sections and a populated Child DOX Index.
- Every parent's Child DOX Index links to its direct children; the tree is walkable from root.
- A coding standard is wired into Work Guidance: an existing standard is referenced, or `add-coding-standard` was run (or proposed) to create one.
- The result was verified: the DOX chain is consistent and links resolve.

## Workflow

Before Step 1, check whether `graphify-out/graph.json` exists at the repo root. If it does, use `graphify query` for module boundaries, ownership, and dependency direction when deciding where child `AGENTS.md` files belong. If no graph exists and the repo is large or its boundaries are unclear from direct inspection, run `graphify <path> --mode deep --no-viz` first. Treat graph output as supporting evidence, not a replacement for reading the files you document.

1. Inspect before writing:
   - Locate `SYSTEM.md` (check `.pi/SYSTEM.md`, `agent/SYSTEM.md`, repo root). If absent, ask the user where it is or whether to proceed from repo inspection alone.
   - Repo shape: languages, package manager, frameworks, source/test layout, top-level directories.
   - Existing agent docs: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `README` engineering sections. Preserve and extend; do not clobber.
   - Existing coding standard: `AGENTS.md` standard sections, engineering-standard docs, lint/format/test/CI config, hooks.
2. Read [references/dox-framework.md](references/dox-framework.md) for the exact section templates, Child DOX Index syntax, and closeout rules.
3. Create the root `AGENTS.md` (adapt [templates/AGENTS-root.md](templates/AGENTS-root.md)):
   - Distill `SYSTEM.md`'s durable rules (communication, safety, principles, coding workflow) into Local Contracts and Work Guidance. Reference `SYSTEM.md` by path for the full source; do not paste it wholesale.
   - Fill Purpose and Ownership from the repo's actual structure and owners.
   - Leave Work Guidance / Verification minimal if no standard exists yet — Step 5 fills them.
4. Build the DOX tree (adapt [templates/AGENTS-child.md](templates/AGENTS-child.md)):
   - Identify durable boundaries: folders with their own purpose, contracts, ownership, or quality bar (e.g. `src/api`, `packages/*`, `infra`). Skip transient or trivial folders.
   - Create one child `AGENTS.md` per boundary with the six DOX sections. Put broad rules in parents, concrete local details in children.
   - Populate each parent's Child DOX Index with links to its direct children. Make the tree walkable from root.
5. Wire in the coding standard:
   - If a usable standard already exists, reference it from Work Guidance (root and relevant children).
   - Otherwise invoke the `add-coding-standard` skill to install one, then reference what it produced. If the user did not ask for a standard, propose it and continue without blocking.
6. Verify and report:
   - Confirm every Child DOX Index link resolves and the chain reads consistently from root to leaves.
   - Report created/changed files, the boundaries chosen, and the coding-standard decision.

## Decision Table

| Situation | Default action |
| --- | --- |
| No `SYSTEM.md` found | Ask for its location; if none exists, proceed from repo inspection and note the gap. |
| `AGENTS.md` already exists at a path | Extend its sections to DOX shape; never overwrite content blindly. |
| Repo is flat / single-purpose | Create root `AGENTS.md` only; add children only when a real boundary exists. |
| Monorepo with packages | Root `AGENTS.md` + one child per package (and per sub-boundary that warrants it). |
| Existing coding standard present | Reference it from Work Guidance; do not install a second one. |
| No coding standard, user didn't request one | Propose `add-coding-standard`; create the DOX tree regardless. |
| `SYSTEM.md` rule conflicts with repo reality | Document repo reality in the local contract; flag the conflict rather than inventing rules. |

## Gotchas

- Do not duplicate `SYSTEM.md` verbatim into `AGENTS.md`. Distill durable rules and reference the source path; `SYSTEM.md` stays the single origin.
- Do not create a child `AGENTS.md` for every folder. Create one only for a durable boundary with its own purpose, contracts, or quality bar.
- Do not leave a parent's Child DOX Index stale after adding a child. Refresh every affected index so the tree stays walkable.
- Do not put concrete local details in the root or broad project rules in a leaf. Broad in parents, specific in children.
- Do not install a second coding standard when one exists. Reference the existing one from Work Guidance.
- Do not overwrite an existing `AGENTS.md`. Extend it into DOX shape and preserve current content.

## Skill Layout

- [agents/openai.yaml](agents/openai.yaml): UI metadata and default prompt.
- [references/dox-framework.md](references/dox-framework.md): DOX section templates, Child DOX Index syntax, pre-edit and closeout protocol. Read in Step 2.
- [templates/AGENTS-root.md](templates/AGENTS-root.md): starting point for the root file. Adapt; do not copy blindly.
- [templates/AGENTS-child.md](templates/AGENTS-child.md): starting point for child files. Adapt; do not copy blindly.

## Output

When planning or reporting, use:

```markdown
## Inspection
- SYSTEM.md:
- Repo shape:
- Existing agent docs:
- Existing coding standard:

## DOX Tree
- root AGENTS.md
- [path]/AGENTS.md — [boundary purpose]

## Coding Standard
- [referenced existing | ran add-coding-standard | proposed]

## Verification
- Index links resolve:
- Residual gaps:
```
