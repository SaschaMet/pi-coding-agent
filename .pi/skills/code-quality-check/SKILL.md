---
name: code-quality-check
description: Run QA, security, and code-quality passes in one skill, then merge into one deduplicated prioritized report.
argument-hint: Optional focus area, files, or review constraints
---

# Code Quality Check Orchestrator

You are a unified reviewer.
Run three focused passes internally, then merge findings deterministically.

## Goal

- One unified report.
- No duplicated findings.
- Strict category ownership:
  - `qa` owns correctness/regressions/edge cases/test adequacy
  - `security` owns exploitable security vulnerabilities
  - `code_quality` owns maintainability/performance/design quality

## Reference Material

Use these local references as guidance for each pass:

- `references/qa-validator.md`
- `references/security-review.md`
- `references/code-review.md`

## Execution Steps

1. Capture review context:
   - Run `git status`
   - Run `git diff`
   - Review only added/modified lines
2. Discover project-specific quality commands and conventions:
   - Read `package.json` scripts when present.
   - Read top-level and near-root `*.toml` files for task/test/lint tool config.
   - Read `README*` and nearest docs sections describing test/lint/typecheck/format/check workflows.
   - Build a `Project Validation Context` block that includes:
     - preferred commands (exact command strings)
     - required command ordering constraints (if documented)
     - tool names and config hints (for example, `vitest`, `pytest`, `cargo test`, `ruff`, `eslint`, `biome`)
     - explicit "do not run" or environment constraints from docs
3. Execute three passes in parallel conceptually (or sequentially if tools limit parallelism):
   - QA pass: correctness/regressions/edge cases/test adequacy only.
   - Security pass: concrete exploitable vulnerabilities only.
   - Code-quality pass: maintainability/performance/design only.
   - Apply strict non-overlap ownership. Out-of-scope items become scope notes, not findings.
4. Collect pass outputs.
5. Normalize each finding into:
   - `category`, `severity`, `file`, `line`, `title`, `evidence`, `recommendation`, `confidence`
6. Dedupe with key:
   - `(file, line, normalized_root_cause)`
7. Apply precedence when duplicate root cause exists:
   - `security` > `qa` > `code_quality`
8. Sort final findings:
   - severity `HIGH` first, then `MEDIUM`, then `LOW`
   - tie-break by category precedence above, then file+line
9. Produce a single final verdict:
   - `FAIL` if any HIGH finding exists
   - `REQUIRES_MODIFICATION` if only MEDIUM/LOW findings exist
   - `PASS` if no findings

## Merge Rules

- Do not reword findings in a way that loses technical meaning.
- Keep the strongest evidence and clearest recommendation.
- Keep only one canonical finding per dedupe key.
- Preserve specialist handoff notes in a separate section when useful.
- Prefer evidence that references project-specific commands/config discovered from `package.json`, `*.toml`, and `README/docs`.

## Required Output

Return markdown with this exact structure:

```markdown
## Scope Notes

- [optional merged handoff notes]

## Findings

1. category: security|qa|code_quality
   severity: HIGH|MEDIUM|LOW
   file: path/to/file
   line: 123
   title: short title
   evidence: concrete proof
   recommendation: smallest corrective action

## Final Verdict

PASS | FAIL | REQUIRES_MODIFICATION
```

If no findings exist, output `## Findings` with `- none`.
