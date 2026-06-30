# DOX Framework Reference

Source: https://github.com/agent0ai/dox (`AGENTS.md`). This is the bundled, runtime-stable summary. Re-fetch the source only if behavior looks out of date.

DOX is a hierarchical agent-governance system. Each `AGENTS.md` is a **binding work contract** for its subtree. All work in a folder must stay understandable through the nearest `AGENTS.md` plus every parent `AGENTS.md` above it.

## Section Template (root and child, in order)

Both root and child files use the same six sections. Leave Work Guidance / Verification empty (or a one-line "none yet") if no standard exists.

```markdown
# AGENTS.md — <scope name>

## Purpose
What this scope is for. One short paragraph or a few bullets.

## Ownership
Who/what owns this scope; boundaries with sibling scopes.

## Local Contracts
Binding rules for work in this subtree. Concrete, named, enforceable.

## Work Guidance
How to do work here: standards, conventions, workflows. May reference SYSTEM.md / coding standard.

## Verification
How to prove work is correct here: commands, checks, gates. May be empty if no framework exists yet.

## Child DOX Index
Links to direct child AGENTS.md files (see syntax below).
```

## Child DOX Index Syntax

DOX requires the index to list direct children but does not mandate a literal format. Use this convention — one bullet per direct child, linking the child file with a short scope description:

```markdown
## Child DOX Index
- [src/api/AGENTS.md](src/api/AGENTS.md) — HTTP API surface and request contracts
- [src/db/AGENTS.md](src/db/AGENTS.md) — persistence layer and migrations
```

Leaf files with no children write: `## Child DOX Index\n- None.`

## Placement Rule (parent vs child)

- Broad, project-wide rules live in parent (ultimately root) docs.
- Concrete, local details live in the child doc closest to the work.
- Avoid duplication across files unless each scope genuinely needs its own version.
- The closer doc controls local work details, but no child doc may weaken a parent contract.

## When to Create a Child AGENTS.md

Create one when a folder becomes a **durable boundary** with its own purpose, rules, responsibilities, workflow, materials, or quality standards. Do not create one for transient or trivial folders.

## Pre-Edit Protocol

1. Read the root `AGENTS.md`.
2. Identify every file/folder the task will touch.
3. Walk from repo root to each target.
4. Read every `AGENTS.md` along each route.
5. Use the nearest `AGENTS.md` as the local contract; parents still bind.

## Closeout Protocol (run after meaningful changes)

1. Re-check changed paths against the DOX chain.
2. Update the nearest owning docs and any affected parents/children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text (delete history; keep docs current and operational).
5. Run existing verification when relevant.
6. Report docs left intentionally unchanged, with rationale.

## Style

- Concise, current, operational. Document stable contracts, not history.
- Direct bullets with explicit names. Delete stale text rather than explaining it.
