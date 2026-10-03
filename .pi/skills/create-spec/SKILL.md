---
name: create-spec
description: Writes a repo-researched spec with scope, Given/When/Then acceptance criteria, risks, rollback, and verification. Use when the user asks for a spec, design contract, acceptance criteria, or pre-coding requirements, including "plan this" for multi-file or multi-module work. Not for quick plans (use create-plan) or when the user wants code now.
---

# Create Spec

Produce a spec document, not implementation code. Research first, then author a verification-ready contract that an AI coding agent can implement against.

**Important**: This is a spec-authoring skill. Do not write implementation code.

## Step 1 - Consume or produce research

Check the spec's folder (`docs/specs/<name>/research-*.md`) and `docs/research/` first. If a research document already answers how this part of the codebase works, **read it and do not repeat the search** — cite it in the spec's Metadata back refs and move to Step 2. Research is expensive; re-deriving it is waste.

If no such document exists: **invoke `$research-codebase` skill now**, with output path `docs/specs/<name>/research-{topic}.md`.

**MANDATORY GATE**: Do not proceed to Step 2 until the research document exists and is reviewed. This applies to ALL specs, including small single-file changes. Direct inspection alone is insufficient.

If `graphify-out/graph.json` exists at the repository root, query graphify first for architecture, ownership boundaries, dependency paths, prior-art nodes, and cross-file relationships relevant to the spec. If no graph exists and the requested spec is architecture-heavy, cross-module, or unclear from direct file inspection, run `graphify <repo-root> --mode deep --no-viz` before drafting. Do not run graphify for small single-file specs where normal inspection is enough.

Extract (from the research document where it already answers these):

1. Existing architecture, modules, and ownership boundaries.
2. Existing specs/plans that should be updated in-place.
3. Test and CI commands that can verify outcomes.
4. High-risk areas: auth, schema, migrations, infra, public APIs.
5. Existing org/domain rules that should become invariants.
6. Graphify evidence when available: relevant communities, god nodes, surprising connections, shortest paths, and explained nodes that affect scope, risks, or verification.

## Step 2 - Clarify unresolved decisions

Ask only what code/docs cannot answer. Use safe defaults for decisions that do not require the user.

Required decisions:

1. Target output file (default `docs/specs/<name>/spec-<name>.md`, see **Artifact folder**).
2. Ask only what the research document left open.

See `../grill-me/SKILL.md` for how to pressure-test for missing risks and assumptions. Use graphify context as input to that pressure test when repository relationships or architecture are part of the spec.

## Gotchas

- Criterion IDs (`AC1`), finding IDs, and the document's own path stay in the document. Tell implementers not to copy them into code comments or test names: the document is not committed, so those references would point to nothing.
- Update an existing relevant spec/plan in place when one exists; do not create a duplicate.
- A spec is not a codebase tour. Use graphify to find relevant relationships when useful, then cite only the specific paths, contracts, or boundaries the implementer needs.
- Keep open questions separate from approved requirements so implementers do not treat guesses as scope.
- If any open question or deferred decision remains, the spec must explicitly block implementation until the user answers it. Do not let an implementation agent start work from assumptions.

## Step 3 - Build the spec contract

Pick the size first (see **Size guidance**); it decides which sections apply.

Use [references/spec-template.md](references/spec-template.md) as the output template.

### Mandatory sections

- **Metadata** (after the title block, before Grill Status): `Created`, `Commits`, `Back refs`. Rules are in the template blockquote.
- **Grill Status table** (before section 1): the grill-completion readiness gate — initial row `Not run`; the grill-me session writes `done <date>` only after the user's explicit confirmation; a document whose latest row is not `done <date>` or `overridden <date>: <reason>` is not ready for implementation.
- **In Plain Words** (after Grill Status, before section 1): four lines, one sentence each — what we are doing, why, what could break, how we will know it worked. Written to the eli5 rules ([../eli5/SKILL.md](../eli5/SKILL.md), sections _Style rules_ and _Hard bans_): 20 words per sentence, no jargon, no acronym the spec introduces later. This is the part the user reads to approve the spec; sections 1-11 are the part the implementer reads to build it. Required at every size, including Small.

1. **Intent**: what and why.
2. **Scope**:
   - `modify`: files/services allowed to change.
   - `call`: external systems allowed to be invoked.
   - `forbid`: files/areas explicitly off-limits.
   - explicit out-of-scope list.
3. **Acceptance Criteria**: objectively verifiable checklist items. Each behavioral criterion is written once as `Given / When / Then`; static checks stay one line.
4. **Execution Steps**: implementation sequence and file targets, ordered as vertical slices (see below).
5. **Invariants and Contracts**: org/domain rules that always apply, plus an optional `CARDS` line per point when it adds a constraint.
6. **Architecture Impact & Data Flow Changes**: before/after data flow, and blast radius with the dependency table. Required for Medium+ specs. Omit for Small.
7. **Manual Verification Checklist**: what a human checks; automated checks live in the steps.
8. **Risks, One-Way Doors, Rollback**: failure modes and recovery.
9. **Definition of Done**: traceability from intent -> criteria -> verification.
10. **Open Questions / Deferred Decisions**: unresolved decisions separated from requirements.
11. **Handoff**: implementation, verification, and escalation notes.

Then **Amendments** and **AI-Notes**, last, with the template's rules blockquotes. Execution Steps carry status markers (`[ ]`, `[wip]`, `[x]`, `[f]`) on each step's `Validate:` list.

### Execution steps must be vertical slices

Every execution step must be independently runnable and demoable. A step that cannot be verified until a later step lands is not a step.

Default slice order for a feature that spans layers:

1. Define the contract (endpoint, signature, type) and serve mock data — verifiable with `curl` or a unit test.
2. Build the consumer against the mock — verifiable in the browser or CLI.
3. Wire the contract to the real service layer.
4. Add schema/migration changes.
5. Add business logic and error handling.

Forbidden: ordering steps by stack layer — all migrations, then all services, then the API, then the UI. That produces nothing observable until the end, which is where expensive rework hides. Left unsteered, this is the default an agent will produce; state the slice boundaries explicitly.

### Spec quality requirements

- Prefer concrete, testable language over ambiguous wording.
- **Every change has a diff preview**: one `diff` block per file, real path in a `@@ path` line, up to 3 context lines, at most 40 lines per file; past 40 lines, the key hunks and a one-line list of the rest. No preview needs a one-line reason (new file over 40 lines, generated code, binary). The preview is a sketch, not the contract: if the shipped code behaves differently, the implementer adds a `decision` AI-Note.
- Include exact paths, API names, and expected outputs.
- Grade outcomes, not implementation paths: acceptance criteria should describe observable behavior.
- Mark any irreversible change as a one-way door.
- Add escalation triggers for sensitive changes.
- Encode CARDS constraints as verifiable implementation guardrails when the change touches architecture or domain logic.
- If uncertainty remains, capture it in `Open Questions / Deferred Decisions`.
- **Every open question carries a recommended answer**: the option you would take, and what happens if the user picks otherwise. An open question without one forces the user to decide from scratch, which is the work the spec was supposed to have done. With one, they can approve the whole list by accepting the defaults. State the recommendation even when you are unsure — name the assumption it rests on instead of withholding it.
- Keep the gate block below the title. It is the only place that blocks implementation, for open questions and for an unfinished grill.

## Step 4 - Run the quality gate

Validate against
[references/spec-quality-checklist.md](references/spec-quality-checklist.md)
before finalizing.

If a check fails, fix the spec instead of adding narrative explanation.

## Step 5 - Deliver and handoff

1. Write or update the spec file.
2. Keep implementation out of scope. Do not write implementation code from this skill.
3. Include a concise handoff for coding and verification agents. Its blocked line stays `Blocked: see gate`.
4. Render the page: `node <plan-view-dir>/scripts/plan-view.mjs render docs/specs/<name>/spec-<name>.md`, where `<plan-view-dir>` is `../plan-view` from this skill's folder. Add `--no-open` when no human watches. Give the user the printed page path.

## Artifact folder

Each spec or plan owns one folder: `docs/specs/<name>/` or `docs/plans/<name>/`. `<name>` is kebab-case and is the same in the folder and the main file. Every file made for that document goes into its folder:

| Artifact | File in the folder |
| --- | --- |
| Main spec / plan | `spec-<name>.md` / `plan-<name>.md` (plan-view adds `.html` and `.assets/`) |
| Research for this document | `research-<topic>.md` |
| Grill summary | `grill-summary-<row>.md` (`<row>` = Grill Status row number) |
| Code review | `code-review-<YYYY-MM-DD>.md` (second run on the same day: `-2`, …) |
| Sub-plan | `sub-plan-<topic>.md` |
| Visual diff page | `visual-diff-<YYYY-MM-DD>.html` (copy of the run's `visual-diff.html`) |
| Worker or subagent report | `reports/<task>.md` (copy of `$TMPDIR/pi-reports/<task>.md`) |

- Only the main file starts with `spec-` or `plan-`. The write guard arms itself from any such file, so other files must never use those prefixes.
- Old flat documents (`docs/specs/spec-*.md`, `docs/plans/plan-*.md`) stay where they are. Their artifacts follow the same names, in a `docs/specs/<name>/` folder next to them.
- Research done before any spec exists stays in `docs/research/research-<topic>.md`.
- Workers and subagents never write into a document folder. The owner session copies their reports.

## Size guidance

Size selects which design phases actually run. Do not run all of them for every task, and do not skip them for large ones.

- **Small** — single behavior, 1-2 files, tight criteria.
  Phases: scope + criteria + verification only. No design sections. Roughly the class of work that can be one-shot with light feedback; do not over-specify it.
- **Medium** — 2-5 files, edge cases, integration touch points.
  Adds **Architecture Impact**: before/after data flow and blast radius.
- **Large** — cross-module, API/schema updates, stronger rollback plan.
  Same sections as Medium. Architecture Impact lists every changed flow and dependency, and rollback covers each risky step.
- **Epic** — split into multiple specs by subsystem, each sized on its own.

## Quality bar

- Never omit rollback for high-risk or one-way changes.
- Always include a consolidated manual verification checklist.
- Keep the spec concise; point to existing docs or graphify-backed paths instead of copying broad background.

## References

- [references/spec-template.md](references/spec-template.md) - output format.
- [references/spec-quality-checklist.md](references/spec-quality-checklist.md) - validation gate.
- [../research-codebase/SKILL.md](../research-codebase/SKILL.md) - produces the research document this spec builds on.
- [../research-codebase/references/research-checklist.md](../research-codebase/references/research-checklist.md) - repository discovery checklist.
