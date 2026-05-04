---
name: create-spec
description: Build a spec-driven development document before coding. Use when the user wants a structured spec (or implementation plan) with intent, scope boundaries, acceptance criteria, execution steps, invariants, and verification gates.
---

# Create Spec

Produce a spec document, not implementation code. Research first, then author a
verification-ready contract that an AI coding agent can implement against.

**Important**: This is a spec-authoring skill. Do not write implementation code.

## Step 1 - Research the repository

Before asking questions, inspect project structure and constraints with
[references/research-checklist.md](references/research-checklist.md).

Extract:

1. Existing architecture, modules, and ownership boundaries.
2. Existing specs/plans that should be updated in-place.
3. Test and CI commands that can verify outcomes.
4. High-risk areas: auth, schema, migrations, infra, public APIs.
5. Existing org/domain rules that should become invariants.

## Step 2 - Clarify unresolved decisions

Ask only what code/docs cannot answer. Offer defaults.

Required decisions:

1. Target output file (default `docs/specs/spec-{feature-name}.md`).
2. Scope strictness (default explicit `modify` + `call` + `forbid`).
3. Acceptance rigor (default measurable criteria with BDD cases).
4. Verification depth (default automated checks + manual checklist).
5. Risk posture (default include rollback and escalation triggers).

See `../skills/grill-me/SKILL.md` for how to pressure-test for missing risks and assumptions.

## Step 3 - Build the spec contract

Use [references/spec-template.md](references/spec-template.md).

### Mandatory sections

1. **Intent**: what and why.
2. **Scope**:
   - `modify`: files/services allowed to change.
   - `call`: external systems allowed to be invoked.
   - `forbid`: files/areas explicitly off-limits.
   - explicit out-of-scope list.
3. **Acceptance Criteria**: checklist items that are objectively verifiable.
4. **BDD Scenarios**: `Given / When / Then` for each criterion.
5. **Execution Steps**: implementation sequence and file targets.
6. **Verification Plan**: criterion-to-check mapping with commands/evidence.
7. **Invariants and Contracts**: org/domain rules that always apply.
8. **Risks, One-Way Doors, Rollback**: failure modes and recovery.
9. **Definition of Done**: traceability from intent -> criteria -> verification.

### Spec quality requirements

- Prefer concrete, testable language over ambiguous wording.
- Include exact paths, API names, and expected outputs.
- Mark any irreversible change as a one-way door.
- Add escalation triggers for sensitive changes.
- If uncertainty remains, capture it in `Open Questions / Deferred Decisions`.

## Step 4 - Run the quality gate

Validate against
[references/spec-quality-checklist.md](references/spec-quality-checklist.md)
before finalizing.

If a check fails, fix the spec instead of adding narrative explanation.

## Step 5 - Deliver and handoff

1. Write/update the spec file.
2. Keep implementation out of scope.
3. Include a concise handoff for coding and verification agents.

## Size guidance

- **Small**: single behavior, 1-2 files, tight criteria.
- **Medium**: 2-5 files, edge cases, integration touch points.
- **Large**: cross-module, API/schema updates, stronger rollback plan.
- **Epic**: split into multiple specs by subsystem.

## Quality bar

- Never skip repository research.
- Never ship a spec without explicit scope boundaries.
- Never leave criteria unverifiable.
- Never omit rollback for high-risk or one-way changes.
- Always include a consolidated manual verification checklist.

## References

- [references/spec-template.md](references/spec-template.md) - output format.
- [references/spec-quality-checklist.md](references/spec-quality-checklist.md) - validation gate.
- [references/research-checklist.md](references/research-checklist.md) - repository discovery checklist.
