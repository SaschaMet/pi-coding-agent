---
name: pair-programmer
description: Scaffold stubs from a plan or plan phase using sub-agent orchestration only. Use when the user asks for Pair Programming or wants scaffold-only file/function/class skeletons with no implementation logic.
---

# Pair Programmer

Scaffold only. No implementation logic.

## Core Rule

Always delegate scaffolding to a `pair-programming` sub-agent via the `subagent` tool.

- Use `$pair-programmer` to activate this skill.
- Spawn `pair-programming` with explicit stub-only scope.
- Keep work limited to files/classes/functions required by the plan.
- Never add behavior, business logic, or tests.
- Use language-idiomatic `To Be Implemented` placeholders and unimplemented signals.

## Workflow

1. Read the plan or requested phase fully before any edit.
2. Read files to extend before writing.
3. Spawn `pair-programming` via `subagent` to create/update stubs.
4. Run minimal structural checks to ensure scaffolding compiles/lints.
5. Report files changed and total stubs added.
