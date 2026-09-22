---
name: create-plan
description: Use this skill when the user asks for a quick plan, light plan, or short plan for a small change (1-3 files, single behavior). Produce a concise document with changes, tests, and verification — skipping full spec ceremony. Do not use when the user asks for a full spec, design doc, or when the change spans multiple modules.
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

If no graph exists, run `graphify <repo-root> --mode deep --no-viz` before drafting.

Do not proceed to Step 2 until graphify context is gathered.

## Step 2 - Inspect affected files

Read the files that will change. Confirm:

1. The change is truly small (1-3 files, single behavior).
2. No existing plan or spec already covers this change — if one exists, update it in place instead of creating a duplicate.
3. Test commands and verification paths are known.

If the change is larger than expected, escalate to `$create-spec` instead.

## Step 3 - Build the plan

Use [references/plan-template.md](references/plan-template.md) as the output template.

### Mandatory sections

- **Grill Status table** (before section 1): the grill-completion readiness gate — initial row `Not run`; the grill-me session writes `done <date>` only after the user's explicit confirmation; a document whose latest row is not `done <date>` or `overridden <date>: <reason>` is not ready for implementation.
- **In Plain Words** (after Grill Status, before section 1): four lines, one sentence each — what we are doing, why, what could break, how we will know it worked. Written to the eli5 rules ([../eli5/SKILL.md](../eli5/SKILL.md), sections _Style rules_ and _Hard bans_): 20 words per sentence, no jargon. This is the part the user reads to approve the plan. It does not count toward the line limit below.

1. **What & Why**: one-liner.
2. **Scope**: modify, forbid, out of scope.
3. **Changes**: checklist of file-level changes.
4. **Tests**: what to add or run.
5. **Verification**: automated + manual steps.
6. **Risks & Rollback**: failure modes and recovery.
7. **Done When**: traceability checklist.

Keep it under 50 lines. No BDD, no CARDS, no architecture diagrams.

### Plan quality requirements

- Every change must have a corresponding test or verification step.
- Scope must be minimal (1-3 files).
- No vague criteria (`fast`, `better`, `clean`).
- If the change is irreversible, note the rollback path.
- Cite graphify findings when they affect scope or risk.
- **Any decision left to the user carries a recommended answer** and what changes if they pick otherwise. A plan that hands back open choices without a recommendation has moved the work back to the user instead of doing it.

## Step 4 - Run the quality gate

Validate against [references/plan-quality-checklist.md](references/plan-quality-checklist.md) before finalizing.

If a check fails, fix the plan instead of adding narrative explanation.

## Step 5 - Deliver

1. Write the plan to `docs/plans/plan-{task-name}.md`.
2. Keep implementation out of scope. Do not write implementation code.
3. Include a one-line handoff: which files to change and which tests to run.
4. If the Grill Status table's latest row is not `done <date>` or `overridden <date>: <reason>`, the handoff must state: "Implementation is blocked until the grill-me session records a done row (or a recorded override) in the Grill Status table."

## Gotchas

- Criterion IDs (`AC1`), finding IDs, and the document's own path stay in the document. Tell implementers not to copy them into code comments or test names: the document is not committed, so those references would point to nothing.
- Update an existing plan/spec in place when one exists; do not create a duplicate.
- If the change grows beyond 3 files or touches multiple modules, stop and use `$create-spec`.
- Graphify is mandatory — never skip it. A plan without context is a guess.
- If a verification step cannot be written, the plan is incomplete.

## Quality bar

- Never skip graphify. Always query before drafting.
- Never ship a plan without explicit scope boundaries.
- Never leave criteria unverifiable.
- Never allow implementation to start while the Grill Status table's latest row is not `done <date>` or `overridden <date>: <reason>`.
- Keep the plan concise; point to graphify paths instead of copying broad background.
- Do not include broad codebase overviews that an implementation agent can rediscover.

## References

- [references/plan-template.md](references/plan-template.md) - output format.
- [references/plan-quality-checklist.md](references/plan-quality-checklist.md) - validation gate.
- [../create-spec/SKILL.md](../create-spec/SKILL.md) - full spec skill (escalate if change is too large).
