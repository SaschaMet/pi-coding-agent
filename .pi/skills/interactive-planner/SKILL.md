---
name: interactive-planner
description: Deep repository research and phased implementation planning before coding. Use when the user wants a feature, bug fix, refactor, migration, epic, or story planned first; when the AI should inspect the codebase, clarify scope, assess risks, and write a plan document (docs/plans/plan-*.md) instead of implementing code.
---

# Interactive Planner

Produce plans, not implementation code. Research the repository first, ask only
the missing questions, then write a phased plan that minimizes change scope and
token usage for the later implementation session.

**Important**: This is a planning-only skill. You do not write code.
You create detailed plans that a coding agent can follow. Your output is a plan document.

## Step 1 — Deep Research

Before asking the user anything, build a complete picture of the codebase.
Follow [references/research-checklist.md](references/research-checklist.md) and capture findings
in a mental context snapshot.

### What to Examine

1. **Repository shape**: languages, frameworks, monorepo vs. single-project, package managers,
   build tools, CI/CD config, deployment targets.
2. **Project guidance**: `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`,
   `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/rules`, `.github/agents/*.agent.md`,
   `.github/skills/*/SKILL.md`, `.github/prompts/*.prompt.md`, `GEMINI.md`,
   `CONTRIBUTING.md`, architecture docs, ADRs.
3. **Prior planning artifacts**: `docs/plans/`, `.copilot-tracking/`, `*.plan.md`, `*.spec.md`, `PRD.md`.
   If a plan for the same feature exists, plan to update it in-place unless the user asks for a new file.
4. **Implementation area**: trace affected modules, similar features, shared utilities,
   data models, and their dependencies.
5. **Test landscape**: test framework, directory layout, naming conventions, existing coverage,
   test commands. This becomes the testing guidance for the plan.
6. **Deployment & rollback**: how is the app deployed? Can changes be feature-flagged?
   Is there a rollback mechanism?

### What to Extract

For each area, note:

- What exists and how it works.
- What patterns are reused that the plan should follow.
- What constraints or conventions the plan must respect.
- What is missing (no tests, no docs, no CI) that the plan should address.

Use subagents for targeted research when the environment allows delegation.

## Step 2 — Clarify with the User

Ask questions **only about things the codebase cannot answer**.

### First Round — Scope & Preferences

Cover these topics. Offer concrete defaults for each; let the user accept or override.

| Topic                       | Example Default                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope confirmation          | "Based on my research, this affects X, Y, Z. Correct?"                                                                                             |
| External docs or references | "Do you have a spec, PRD, or design doc to include?"                                                                                               |
| Testing strategy            | "Unit tests with pytest + 70% coverage. Integration tests needed?"                                                                                 |
| Manual verification         | "I'll include curl/browser steps for API changes."                                                                                                 |
| Plan output location        | `docs/plans/plan-{feature}.md`                                                                                                                     |
| Phasing preference          | "I'll break this into N phases. Want fewer/more?"                                                                                                  |
| Risk tolerance              | "There's a data migration involved. Want a rollback plan?"                                                                                         |
| Architecture diagram        | Only if the plan introduces major structural changes — default is to include one automatically in that case. Otherwise ask whether one is desired. |

### Follow-up Rounds

Ask follow-up rounds when:

- Ambiguity or architectural choices remain.
- The user's answers raise new questions.
- Trade-offs need an explicit decision (offer options with pros/cons).

### Shortcuts

Respect `skip`, `use defaults`, `LGTM`, and equivalent signals. Do not re-ask.

## Step 3 — Size the Work

Determine the plan granularity based on complexity:

| Size       | Signals                                    | Phases | Typical Scope                              |
| ---------- | ------------------------------------------ | ------ | ------------------------------------------ |
| **Small**  | Single file, one behavior, clear spec      | 1      | Bug fix, config change, small feature      |
| **Medium** | 2-5 files, some edge cases, test additions | 1-2    | Feature, refactor, migration of one module |
| **Large**  | 5-15 files, cross-module, schema changes   | 2-4    | Multi-module feature, major refactor       |
| **Epic**   | 15+ files, new subsystem, multi-sprint     | 3-6    | New service, platform migration, rewrite   |

For small tasks, collapse the plan template and skip unnecessary sections.
For epics, consider splitting into sub-plans per subsystem.

## Step 4 — Assess Risks & Dependencies

Before building the plan, identify:

1. **Blockers**: Does this depend on something that doesn't exist yet? Another team's API? A pending migration?
2. **Data risks**: Schema changes, data loss potential, migration complexity.
3. **Integration risks**: External service dependencies, API contract changes.
4. **Reversibility**: Is any step a one-way door? (public API, schema migration, data format change.)
5. **Performance risks**: Will this change affect hot paths or query performance?

Record risks in the plan. Flag one-way doors explicitly.

If the user has the `grill-me` skill, suggest a grilling session for large or risky plans
before implementing.

## Step 5 — Build the Plan

### Structure Each Phase

- Make each phase independently testable and deployable.
- End every phase with a review checkpoint.
- For every task, name exact files to create or modify.
- Capture behavior, edge cases, and a definition of done.

### Testing Guidance Per Phase

- Include automated test expectations: unit tests, integration tests (if requested), commands to run.
- Include manual verification steps: specific inputs, expected outputs, URLs, CLI commands.
- Include a regression check: what existing tests to run to confirm nothing broke.

### Token-Efficiency Notes

For each phase, include a "Context for Implementation" section:

- Files the coding agent should read first.
- Files that can be skipped.
- Patterns to follow (with file:line references).
- Dependencies/imports to reuse.

This saves the implementation session from redundant exploration.

### Visual Architecture Artifacts (Optional)

Include a Mermaid diagram in the plan when:

- The **user requests one** at any point, or
- The plan introduces **major structural changes**: a new service, a new major data flow,
  significant module restructuring, a new API surface, or a schema migration that changes
  how data moves through the system.

For small or additive changes (new endpoint, bug fix, minor refactor), skip diagrams by default.

Choose the diagram type that best communicates the change:

| Change type                | Diagram type         | Mermaid syntax             |
| -------------------------- | -------------------- | -------------------------- |
| Data / request flow        | Flowchart            | `flowchart TD`             |
| Service interactions       | Sequence diagram     | `sequenceDiagram`          |
| Module/component structure | Architecture / block | `graph LR` or `block-beta` |
| Data model                 | Class diagram        | `classDiagram`             |

Place the diagram in a dedicated `## Architecture Overview` section immediately after `## Summary`.
If the change modifies an _existing_ flow, show the before and after states as two separate diagrams
labeled **Before** and **After**.

### Manual Test Checklist

At the end of the plan, include a `## Manual Test Checklist` section that **consolidates all
manual verification steps from every phase into a single flat checklist**.

- One checkbox per verifiable action.
- Ordered end-to-end as a tester would work through them.
- Each item must be specific: include exact commands, URLs, inputs, and expected results.
- Group by phase with a one-line heading if there are more than 5 items.

This is the section a human tester or reviewer uses to sign off on the implementation without
needing to read the full plan.

- **For implementation**: "Use `tdd-coding` via `subagent` to implement each phase in TDD order."
- **For review**: "Use `grill-me` via `subagent` to stress-test this plan before implementing." (if the plan is large or risky)
- **For integration tests**: "During implementation, the TDD skill will ask about integration test input/output pairs."

## Step 6 — Write the Output

1. Default to `docs/plans/plan-{feature-name}.md` unless the user specifies otherwise.
2. Use the structure in [references/plan-template.md](references/plan-template.md).
3. If a plan for the same feature exists, update it in-place unless the user asks for a new file.
4. Add sub-plans only when the task is epic-sized and benefits from separation.

## Questioning Rules

- Do not ask questions the repository can answer.
- Always ask whether the user has extra documentation or examples.
- Offer concrete defaults — don't force the user to define everything.
- Keep questions decision-oriented, not open-ended.
- Respect shortcuts (`skip`, `defaults`, `LGTM`).

## Quality Bar

- Never write implementation code.
- Never skip codebase research, even for "simple" requests.
- Never assume project structure, tests, or tooling without reading files.
- Always make manual verification specific: commands, URLs, inputs, expected results.
- Always include a Manual Test Checklist at the end of every plan.
- Always include open questions or deferred decisions when they remain.
- Always flag one-way doors and data risks explicitly.
- Include an architecture diagram whenever the plan introduces major structural changes or the user requests one.

## References

- [references/plan-template.md](references/plan-template.md) — plan document structure.
- [references/research-checklist.md](references/research-checklist.md) — what to examine during research.
