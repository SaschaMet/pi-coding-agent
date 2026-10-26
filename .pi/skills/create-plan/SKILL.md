---
name: create-plan
description: Writes a lightweight plan for a small change (1-3 files, one behavior) with changes, tests, and verification. Use when the user asks for a quick, light, or short plan. Not for full specs, design docs, or changes across modules (use create-spec).
---

# Create Plan

Produce a lightweight plan document for small changes. Research first with graphify, then author a concise verification-ready document.

**Important**: This is a plan-authoring skill. Do not write implementation code.

## Step 1 - Query graphify

**MANDATORY GATE**: If `graphify-out/graph.json` exists at the repository root, query graphify before drafting. Use it to find:

1. Relevant communities and ownership boundaries.
2. Dependencies and callers of the affected files.
3. Prior art or similar changes.
4. High-risk areas near the change.

If no graph exists, skip graphify and set the header to `Graphify: not available`.

Do not proceed to Step 2 until the graph has been queried, when one exists.

## Step 2 - Inspect affected files

Read the files that will change. Confirm:

1. The change is truly small (1-3 files, single behavior).
2. No existing plan or spec already covers this change — if one exists, update it in place instead of creating a duplicate.
3. Test commands and verification paths are known.

If the change is larger than expected, escalate to `$create-spec` instead.

## Step 3 - Build the plan

Use [references/plan-template.md](references/plan-template.md) as the output template.

### Mandatory sections

- **Metadata** (after the header, before Grill Status): `Created`, `Commits`, `Back refs`. Rules are in the template blockquote.
- **Grill Status table** (before section 1): the grill-completion readiness gate — initial row `Not run`; the grill-me session writes `done <date>` only after the user's explicit confirmation; a document whose latest row is not `done <date>` or `overridden <date>: <reason>` is not ready for implementation.
- **TLDR** (after Grill Status, before Changes at a Glance): the summary for humans and stakeholders, at high-school level ([../eli5/SKILL.md](../eli5/SKILL.md), section _Style rules_). It holds: what and why, how it works, one line per Change (what happens — why — how we check it), what could break, how we will know it worked, and one line per open decision with the recommended answer. The lines match section 3 and the open decisions one to one. As short as the change allows, enough to decide. The user reads this to approve the plan. It does not count toward the line limit below.
- **Changes at a Glance** (after TLDR, before section 1): every diff preview and the optional diagram, one caption line per diff. Sections 1-7 stay fully detailed; they are the implementer's contract.

This layout applies to plans created from now on. A plan that still has `## In Plain Words` keeps its layout until the user asks to move it.

1. **What & Why**: one-liner.
2. **Scope**: modify, forbid, out of scope.
3. **Changes**: checklist of file-level changes.
4. **Tests**: what to add or run.
5. **Verification**: automated + manual steps.
6. **Risks & Rollback**: failure modes and recovery.
7. **Done When**: traceability checklist.

Then **Amendments** and **AI-Notes**, last, with the template's rules blockquotes. Changes carry status markers (`[ ]`, `[wip]`, `[x]`, `[f]`).

Keep it under 150 lines, not counting TLDR, Metadata, Amendments, and AI-Notes. No BDD, no CARDS. A diagram is optional, only when a flow changes, and lives only in Changes at a Glance.

### Plan quality requirements

- Every change must have a corresponding test or verification step.
- Scope must be minimal (1-3 files).
- No vague criteria (`fast`, `better`, `clean`).
- If the change is irreversible, note the rollback path.
- Cite graphify findings when they affect scope or risk.
- **Every change has a diff preview** in Changes at a Glance: one `diff` block per file per change, captioned `Change N — path — what changes`, real path in a `@@ path` line, up to 3 context lines, at most 40 lines per file; past 40 lines, the key hunks and a one-line list of the rest. No preview needs a one-line reason (new file over 40 lines, generated code, binary). The preview is a sketch, not the contract: if the shipped code behaves differently, the implementer adds a `decision` AI-Note.
- **Any decision left to the user carries a recommended answer** and what changes if they pick otherwise. A plan that hands back open choices without a recommendation has moved the work back to the user instead of doing it.

## Step 4 - Run the quality gate

Validate against [references/plan-quality-checklist.md](references/plan-quality-checklist.md) before finalizing.

If a check fails, fix the plan instead of adding narrative explanation.

## Step 5 - Deliver

1. Write the plan to `docs/plans/<name>/plan-<name>.md`. Every other file made for this plan goes into the same folder, named per **Artifact folder** in [../create-spec/SKILL.md](../create-spec/SKILL.md).
2. Keep implementation out of scope. Do not write implementation code.
3. Include a one-line handoff: which files to change and which tests to run.
4. If the Grill Status table's latest row is not `done <date>` or `overridden <date>: <reason>`, the handoff must state: "Implementation is blocked until the grill-me session records a done row (or a recorded override) in the Grill Status table."
5. Render the page: `node <plan-view-dir>/scripts/plan-view.mjs render docs/plans/<name>/plan-<name>.md`, where `<plan-view-dir>` is `../plan-view` from this skill's folder. Add `--no-open` when no human watches. Give the user the printed page path.

## Gotchas

- Criterion IDs (`AC1`), finding IDs, and the document's own path stay in the document. Tell implementers not to copy them into code comments or test names: the document is not committed, so those references would point to nothing.

## References

- [references/plan-template.md](references/plan-template.md) - output format.
- [references/plan-quality-checklist.md](references/plan-quality-checklist.md) - validation gate.
- [../create-spec/SKILL.md](../create-spec/SKILL.md) - full spec skill (escalate if change is too large).
