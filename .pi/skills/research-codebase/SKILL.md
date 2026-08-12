---
name: research-codebase
description: Use this skill when a change needs the codebase understood before it can be planned - locating entry points, tracing call paths, mapping information flow, or finding the closest existing implementation. Produce a cited research document that outlives the context window. Do not use for single-file changes that direct inspection answers, and do not write implementation code or a spec from it.
---

# Research Codebase

Produce a research document, not a plan and not code. Answer one question about how the codebase actually works, with citations an implementer can follow.

**Important**: This is a research skill. Do not write implementation code. Do not write acceptance criteria or execution steps — that is `create-spec`.

## Why this produces a file

A turn is a stateless function call: context in, next step out. Research held only in conversation dies at the next compaction, and the next session pays for it again. Research written to `docs/research/` is reviewable, resumable, and citable by every later phase.

Review leverage runs the other way from effort: a bad line of code is one bad line, a bad line of a plan is hundreds, a bad line of research is thousands. This document is the cheapest place to catch a wrong assumption.

## Step 1 - Frame the question

State the one question this document answers, in a sentence. If the request implies several independent questions, write several documents or say which one you are answering.

Default output path: `docs/research/research-{topic}.md`. Update an existing document in place when one covers the same question; do not create a near-duplicate.

## Step 2 - Search wide, keep little

Delegate the searching so the parent context stays clean:

- Use the `generic-readonly` sub-agent for file discovery, call-path tracing, and summarization. Give it the specific question; keep only its returned summary.
- If `graphify-out/graph.json` exists at the repository root, query graphify first for architecture, ownership boundaries, dependency paths, and prior-art nodes. For architecture-heavy or cross-module questions with no graph, run `graphify <repo-root> --mode deep --no-viz` before reading files.
- Work through [references/research-checklist.md](references/research-checklist.md).

Aim to keep context utilization moderate. When it climbs, write findings into the document and continue from the document rather than from a full window.

## Step 3 - Verify before recording

Every claim in the document must come from something read, not inferred:

- Cite `path/to/file.ts:42` for behavioral claims. A claim with no citation is an unknown, not a finding.
- Trace the real entry point and call path, not the plausible one.
- Name the closest existing implementation. It is the style guide for whatever comes next.
- Distinguish what the code does from what its docs or names claim. Where they disagree, record both and say which you verified.

## Step 4 - Write the document

Use [references/research-doc-template.md](references/research-doc-template.md).

### Mandatory sections

1. **Question**: the one thing this document answers.
2. **Answer**: the short version, up front.
3. **Entry points**: where execution actually starts, cited.
4. **Call paths and information flow**: how data moves between the relevant parts, cited.
5. **Prior art**: closest existing implementation and the patterns to reuse.
6. **Conventions and verification surface**: tests, commands, and checks that already exist here.
7. **Unknowns and risks**: what remains unverified, and what would resolve it.
8. **Resumption state**: end goal, approach, steps completed, current blockers.

The resumption block is what lets a fresh session — or a different agent — pick this up without re-reading everything.

## Gotchas

- Do not write a codebase tour. Cite only what the next phase needs.
- An unverified guess recorded as a finding is the most expensive thing this skill can produce. Put it under Unknowns.
- Do not resolve open questions by assumption. Record them and let the user answer.
- Do not let the document drift into design. "Here is how it works" is research; "here is what we should build" is a spec.

## Step 5 - Hand off

1. Write the document, then state its path and the answer in one or two lines.
2. Surface unknowns explicitly — these are what the user must resolve before planning.
3. Stop. Planning happens after the research is approved, per the workflow in `.pi/SYSTEM.md`.

## Quality bar

- Never record a behavioral claim without a citation.
- Never present an inference as a verified finding.
- Never leave the resumption block empty.
- Keep it shorter than the code it describes.

## References

- [references/research-doc-template.md](references/research-doc-template.md) - output format.
- [references/research-checklist.md](references/research-checklist.md) - repository discovery checklist.
- `../create-spec/SKILL.md` - consumes this document to author a spec.
- `../grill-me/SKILL.md` - pressure-test findings and assumptions before planning.
