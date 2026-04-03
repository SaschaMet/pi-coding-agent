---
name: pair-programming
description: Scaffold a plan or plan phase into real files and stub functions ready for a human to implement. Takes a plan (or a single phase), creates or selects the exact files, and writes all necessary functions/classes/methods as stubs with a "To Be Implemented" comment. Produces no working logic — only the skeleton. Use before a TDD or implementation session to let a human co-author fill in the bodies.
---

# Pair Programming

Scaffold the structure, not the logic. You read a plan (or a phase of one) and produce
all the files and stubs a developer needs to start implementing. You are the senior engineer
who sets up the scaffolding so the junior developer can focus on the interesting parts.

**You do not implement any logic.** Every function, method, or class body is a stub.

## When NOT to Use This Skill

- Do not use this skill when the user asks for working implementation logic.
- Do not use this skill for plan-only requests that do not require file scaffolding.
- Prefer `tdd-coding` or `gan-coder` when the user wants code that compiles and runs now.

## Core Rules

- Read the plan (or the specified phase) completely before touching any file.
- Batch-read all existing files you need to understand in a single parallel batch before writing.
- Use `apply_patch` for all file edits and creates.
- Use `rg --files` to map the project; use `rg` for fast text searches.
- Match the project's existing language, naming conventions, import style, and file layout exactly.
- Never write working implementation logic. Every body must be a stub.
- Never modify existing tests. Never delete existing code.

## Stub Convention

Use the language-appropriate stub pattern. The comment must always include "To Be Implemented".

### Python

```python
def function_name(param: Type) -> ReturnType:
    # To Be Implemented
    raise NotImplementedError
```

### TypeScript / JavaScript

```typescript
function functionName(param: Type): ReturnType {
  // To Be Implemented
  throw new Error("Not implemented");
}
```

### Go

```go
func FunctionName(param Type) (ReturnType, error) {
    // To Be Implemented
    panic("not implemented")
}
```

### Other languages

Follow the same pattern: a "To Be Implemented" comment on the first line of the body,
followed by the language-idiomatic way to signal unimplemented (raise, throw, panic, etc.).

## Workflow

### Step 1 — Read the Plan

1. Read the full plan file (default: `docs/plans/plan-*.md`) or the specified phase.
2. Identify every file, class, function, method, and interface the phase requires.
3. Note which files already exist and which must be created.

### Step 2 — Map the Project

1. Use `rg --files` to verify the project layout.
2. Read all existing files that will be extended in a single parallel batch.
3. Note:
   - Existing imports and how they are structured.
   - Naming conventions (snake_case, camelCase, etc.).
   - Module/package structure to follow.
   - Base classes or interfaces already defined that stubs should extend or implement.

### Step 3 — Scaffold Files and Stubs

For each file in scope:

1. **New file**: Create it with the correct package/module declaration, required imports
   (inferred from the plan and existing code), and all required stubs.
2. **Existing file**: Append or insert the new stubs at the correct location — after existing
   functions, in the correct class body, or in the correct module section.

For each stub:

- Use the correct signature from the plan (name, parameters, return type).
- Add a docstring or JSDoc comment if the project uses them — summarize what the function
  _will_ do, not how. Mark it clearly: `"""To Be Implemented: <one-line intent>"""`.
- Follow the stub convention for the language.

### Step 4 — Validate Structure

After writing all stubs:

1. Run the project's type-checker or linter if available (`mypy`, `tsc --noEmit`,
   `go build ./...`, `cargo check`) using `shell_command` to confirm the scaffolding
   is syntactically valid.
2. Run existing tests using `shell_command` to confirm nothing was broken.
3. If any check fails, fix only the structural/syntax issue — do not implement logic.

### Step 5 — Report

Return:

**Files created**: each new file with a one-line summary.
**Files modified**: each existing file with a list of stubs added.
**Stubs scaffolded**: total count; list by name.
**Checks run**: type-check/lint command and result; test command and result.
**Ready for**: name of the next step (e.g., "TDD Red phase", "implementation session").

## Handoff Guidance

After scaffolding is complete, suggest the natural next step:

- **Human co-author session**: "All stubs are scaffolded. Open the files and fill in each
  'To Be Implemented' body one at a time."
- **TDD Red phase**: "Use `tdd-coding` via `subagent` to write failing tests against these stubs, then
  implement them green."
- **GAN Coder**: "Use `gan-coder` via `subagent` to implement each stub as a separate slice with
  generator-critic review."

## What Not to Do

- Do not write any working logic inside a stub body.
- Do not infer and implement behavior even if it seems obvious.
- Do not modify or delete existing code outside the scaffolded stubs.
- Do not write tests.
- Do not silently skip stubs — every function/method called for in the plan must appear.
- Do not add dependencies or libraries not already present in the project.
