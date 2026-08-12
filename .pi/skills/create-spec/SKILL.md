---
name: create-spec
description: Use this skill when the user asks for a spec, implementation plan, design contract, acceptance criteria, or pre-coding requirements, even if they say "plan this" instead of "write a spec." Produce a repo-researched contract with scope, BDD scenarios, risks, rollback, and verification. Do not use when the user wants code now.
---

# Create Spec

Produce a spec document, not implementation code. Research first, then author a verification-ready contract that an AI coding agent can implement against.

**Important**: This is a spec-authoring skill. Do not write implementation code.

## Step 1 - Consume or produce research

Check `docs/research/` first. If a research document already answers how this part of the codebase works, **read it and do not repeat the search** — cite it in the spec's Traceability section and move to Step 2. Research is expensive; re-deriving it is waste.

If no such document exists:

- For anything beyond a small single-file change, run the `$research-codebase` skill and let it produce `docs/research/research-{topic}.md`. Return here with that document.
- For a small single-file spec, inspect directly using
  [../research-codebase/references/research-checklist.md](../research-codebase/references/research-checklist.md).

If `graphify-out/graph.json` exists at the repository root, query graphify first for architecture, ownership boundaries, dependency paths, prior-art nodes, and cross-file relationships relevant to the spec. If no graph exists and the requested spec is architecture-heavy, cross-module, or unclear from direct file inspection, run `graphify <repo-root> --mode deep --no-viz` before drafting. Do not run graphify for small single-file specs where normal inspection is enough.

Extract (from the research document where it already answers these):

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
5. **Execution Steps**: implementation sequence and file targets, ordered as vertical slices (see below).
6. **Verification Plan**: criterion-to-check mapping with commands/evidence.
7. **Invariants and Contracts**: org/domain rules that always apply.
8. **CARDS Architecture Contract**: design constraints for clarity, alignment, resilience, domain integrity, and separation.
9. **Risks, One-Way Doors, Rollback**: failure modes and recovery.
10. **Traceability and Audit**: source, approval, and criteria-to-evidence mapping.
11. **Definition of Done**: traceability from intent -> criteria -> verification.
12. **Open Questions / Deferred Decisions**: unresolved decisions separated from requirements.
13. **Handoff**: implementation, verification, and escalation notes.

Important: Use a sub-agent for writing the spec to not clutter the context window. The sub-agent should be given the spec template and the research context, and should produce a draft spec for review.

### Execution steps must be vertical slices

Every execution step must be independently runnable and demoable. A step that cannot be verified until a later step lands is not a step.

Default slice order for a feature that spans layers:

1. Define the contract (endpoint, signature, type) and serve mock data — verifiable with `curl` or a unit test.
2. Build the consumer against the mock — verifiable in the browser or CLI.
3. Wire the contract to the real service layer.
4. Add schema/migration changes.
5. Add business logic and error handling.

Forbidden: ordering steps by stack layer — all migrations, then all services, then the API, then the UI. That produces nothing observable until the end, which is where expensive rework hides. Left unsteered, this is the default an agent will produce; state the slice boundaries explicitly.

Reviewing 100-200 lines per slice is cheaper than fixing 2000 lines afterwards.

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

Size selects which design phases actually run. Do not run all of them for every task, and do not skip them for large ones.

- **Small** — single behavior, 1-2 files, tight criteria.
  Phases: scope + criteria + verification only. No design sections. Roughly the class of work that can be one-shot with light feedback; do not over-specify it.
- **Medium** — 2-5 files, edge cases, integration touch points.
  Adds a **System Design** section: how services, endpoints, schemas, and stores interact. Sequence of calls and contract shapes, no implementation detail.
- **Large** — cross-module, API/schema updates, stronger rollback plan.
  Adds **Product Intent** (the user problem in user terms, and what success looks like) and **Program Design** (call-stack outline in pseudocode, file-tree diff, type signatures for key functions) before execution steps.
- **Epic** — split into multiple specs by subsystem, each sized on its own.

Front-loading alignment is the trade: an hour of design turns a six-hour review into twenty minutes. Cheap for Medium and up, waste for Small.

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
- [../research-codebase/SKILL.md](../research-codebase/SKILL.md) - produces the research document this spec builds on.
- [../research-codebase/references/research-checklist.md](../research-codebase/references/research-checklist.md) - repository discovery checklist.
