---
name: explain-changes
description: Use this skill when the user wants to understand a plan, spec, proposal, diff, AI-generated change set, or implementation idea in plain language. Explain each proposed change, why it matters, code and architecture implications, risks, tests, and open questions for a software developer. Default to text-only output in chat. Do not write files or implement changes unless explicitly asked.
---

# Explain Changes

Turn a plan, spec, idea, diff, or AI-generated proposal into a plain-language developer briefing. The goal is "do not make me think": make every proposed change easy to understand, evaluate, and review.

Default output is pure chat text with Markdown code snippets when useful. Do not create files, edit code, stage changes, commit, or update PRs unless the user explicitly asks.

## When to use

- The user asks "explain this plan/spec/change" or "help me understand what this AI wants to do."
- The user has output from `create-spec`, a PR plan, an architecture proposal, or an implementation idea.
- The user wants implications, tradeoffs, risks, architecture impact, code impact, or review focus.
- The user wants a commentary on each proposed change, not a new plan or implementation.

## When NOT to use

- Do not use for writing the spec itself; use `create-spec`.
- Do not use for finding bugs in a diff; use `code-quality-check`.
- Do not use for implementation, refactoring, or test writing.
- Do not use for PR body creation; use `pull-request`.

## Gotchas

- Do not merely summarize. Comment on each meaningful proposed change.
- Distinguish facts from inference. Label inferred implications clearly.
- Do not assume the proposal is correct. Point out ambiguous, risky, or missing pieces.
- Do not over-explain basic programming terms; the user is a developer.
- Do define project-specific jargon, hidden coupling, ownership boundaries, and non-obvious consequences.
- If the source material is missing, ask for it or inspect the referenced local file before explaining.

## Workflow

1. Identify the source material.
   Use the provided text, linked local file, current diff, referenced spec, or plan. If the source is a URL or external document not in context, fetch/read it only when allowed by the active environment.

2. Read only what is needed.
   If the proposal names files, APIs, tests, schemas, or architecture docs, inspect those local references enough to explain implications accurately. Avoid broad repository tours.

3. Extract proposed changes.
   Group them by behavior, module, file area, data/API contract, architecture, tests, rollout, and risk. Merge duplicates. Preserve order when the proposal has an intended sequence.

4. Explain each change.
   For every meaningful proposed update, cover:
   - What changes in plain language.
   - Why it is being proposed.
   - What code, files, APIs, data, or architecture it likely touches.
   - What behavior changes for users, developers, or operators.
   - What could break, become harder, or need migration.
   - How to verify it.

5. Highlight implications.
   Call out cross-cutting effects such as auth, persistence, data shape, concurrency, performance, error handling, observability, testing, deployment, backwards compatibility, and rollback.

6. End with review focus.
   Give the user the smallest set of questions or checks that would let them approve, reject, or revise the proposal confidently.

## Default output

Use this structure unless the user asks for another format:

```markdown
## Short Version

One concise paragraph explaining the proposal and its net effect.

## Change-by-Change

### 1. {Change name}

What changes:

Why it matters:

Code impact:

Architecture impact:

Risks / tradeoffs:

How to verify:

## Cross-Cutting Implications

- Data/API contracts:
- Tests:
- Operations/deployment:
- Backwards compatibility:
- Rollback:

## Open Questions

- ...

## Review Focus

- ...
```

## Style

- Plain English. Short paragraphs. No hype.
- Prefer concrete nouns over vague labels like "enhancement" or "improvement."
- Use code snippets only to clarify a specific proposed change.
- Mention file paths, function names, commands, and contracts when known.
- Keep speculation useful: "Likely means..." or "This implies..." only when the source does not prove it.
