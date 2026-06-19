---
name: create-spec
description: Use this skill when the user asks for a spec, implementation plan, design contract, acceptance criteria, or pre-coding requirements, even if they say "plan this" instead of "write a spec." Produce a repo-researched contract with scope, BDD scenarios, risks, rollback, and verification. Do not use when the user wants code now.
---

# Create Spec

Produce a spec document, not implementation code. Research first, then author a verification-ready contract that an AI coding agent can implement against.

**Important**: This is a spec-authoring skill. Do not write implementation code.

## Step 1 - Research the repository

Before asking questions, inspect project structure and constraints with
[references/research-checklist.md](references/research-checklist.md). If `graphify-out/graph.json` exists at the repository root, query graphify first for architecture, ownership boundaries, dependency paths, prior-art nodes, and cross-file relationships relevant to the spec. If no graph exists and the requested spec is architecture-heavy, cross-module, or unclear from direct file inspection, run `graphify <repo-root> --mode deep --no-viz` before drafting. Do not run graphify for small single-file specs where normal inspection is enough.

Extract:

1. Existing architecture, modules, and ownership boundaries.
2. Existing specs/plans that should be updated in-place.
3. Test and CI commands that can verify outcomes.
4. High-risk areas: auth, schema, migrations, infra, public APIs.
5. Existing org/domain rules that should become invariants.
6. CARDS architecture constraints: clarity, dependency alignment, resilience to small changes, domain integrity, and separation of concerns.
7. Graphify evidence when available: relevant communities, god nodes, surprising connections, shortest paths, and explained nodes that affect scope, risks, or verification.

## Step 2 - Clarify unresolved decisions

Ask only what code/docs cannot answer. Use safe defaults for decisions that do not require the user.

Required decisions:

1. Target output file (default `docs/specs/spec-{feature-name}.md`).
2. Output mode: write/update a spec file when the user asks for a document/artifact; otherwise return the spec in chat and ask before creating files.
3. Scope strictness (default explicit `modify` + `call` + `forbid`).
4. Acceptance rigor (default measurable criteria with BDD cases).
5. Verification depth (default automated checks + manual checklist).
6. Risk posture (default include rollback and escalation triggers).

See `../grill-me/SKILL.md` for how to pressure-test for missing risks and assumptions. Use graphify context as input to that pressure test when repository relationships or architecture are part of the spec.

## Gotchas

- Update an existing relevant spec/plan in place when one exists; do not create a duplicate.
- A spec is not a codebase tour. Use graphify to find relevant relationships when useful, then cite only the specific paths, contracts, or boundaries the implementer needs.
- If a requirement cannot be verified, rewrite it before finalizing.
- Keep open questions separate from approved requirements so implementers do not treat guesses as scope.
- If any open question or deferred decision remains, the spec must explicitly block implementation until the user answers it. Do not let an implementation agent start work from assumptions.

## Step 3 - Build the spec contract

Use [references/spec-template.md](references/spec-template.md) as the output template.

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
8. **CARDS Architecture Contract**: design constraints for clarity, alignment, resilience, domain integrity, and separation.
9. **Risks, One-Way Doors, Rollback**: failure modes and recovery.
10. **Traceability and Audit**: source, approval, and criteria-to-evidence mapping.
11. **Definition of Done**: traceability from intent -> criteria -> verification.
12. **Open Questions / Deferred Decisions**: unresolved decisions separated from requirements.
13. **Handoff**: implementation, verification, and escalation notes.

### Spec quality requirements

- Prefer concrete, testable language over ambiguous wording.
- Include exact paths, API names, and expected outputs.
- Grade outcomes, not implementation paths: acceptance criteria should describe observable behavior.
- Mark any irreversible change as a one-way door.
- Add escalation triggers for sensitive changes.
- Encode CARDS constraints as verifiable implementation guardrails when the change touches architecture or domain logic.
- If uncertainty remains, capture it in `Open Questions / Deferred Decisions`.
- When `Open Questions / Deferred Decisions` is non-empty, write a visible implementation guard that says implementation must stop and prompt the user for answers before any code, config, migration, or test changes begin.

## Step 4 - Run the quality gate

Validate against
[references/spec-quality-checklist.md](references/spec-quality-checklist.md)
before finalizing.

If a check fails, fix the spec instead of adding narrative explanation.

## Step 5 - Deliver and handoff

1. In file-output mode, write/update the spec file. In chat-output mode, return the complete spec in the response.
2. Keep implementation out of scope. Do not write implementation code from this skill.
3. Include a concise handoff for coding and verification agents.
4. If open questions remain, the handoff must state: "Implementation is blocked until the Open Questions / Deferred Decisions section is answered by the user."

## Size guidance

- **Small**: single behavior, 1-2 files, tight criteria.
- **Medium**: 2-5 files, edge cases, integration touch points.
- **Large**: cross-module, API/schema updates, stronger rollback plan.
- **Epic**: split into multiple specs by subsystem.

## Quality bar

- Never skip repository research.
- Never ship a spec without explicit scope boundaries.
- Never leave criteria unverifiable.
- Never allow implementation to start while any open question or deferred decision remains unanswered.
- Never omit rollback for high-risk or one-way changes.
- Always include a consolidated manual verification checklist.
- Keep the spec concise; point to existing docs or graphify-backed paths instead of copying broad background.
- Do not include broad codebase overviews that an implementation agent can rediscover.

## References

- [references/spec-template.md](references/spec-template.md) - output format.
- [references/spec-quality-checklist.md](references/spec-quality-checklist.md) - validation gate.
- [references/research-checklist.md](references/research-checklist.md) - repository discovery checklist.
