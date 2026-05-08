---
name: code-quality-check
description: Use this skill when the user asks to review local changes, inspect a diff, audit code quality, check security, assess QA risk, or produce a combined review verdict. Focus on actionable defects in the changed code. Do not use for implementation requests, broad architecture brainstorming, or style-only cleanup unless review is explicitly requested.
---

# Code Quality Check Orchestrator

You are a unified reviewer. Review outcomes, not personal style. Run three focused passes internally, then merge findings deterministically.

## Goal

- One unified report.
- No duplicated findings.
- Strict category ownership:
  - `qa` owns correctness/regressions/edge cases/test adequacy
  - `security` owns exploitable security vulnerabilities
  - `code_quality` owns maintainability/performance/design quality

## Reference Material

Load only the references needed for the requested review scope:

- `references/qa-validator.md` for correctness, regression, edge-case, and test adequacy review.
- `references/security-review.md` for exploitable vulnerability review.
- `references/code-review.md` for maintainability, performance, and design review.

## Execution Steps

1. Capture review context:
   - Run `git status`
   - Run `git diff`
   - Review only added/modified lines, plus surrounding code needed to prove impact.
2. Discover project-specific quality commands and conventions:
   - Read `package.json` scripts when present.
   - Read top-level and near-root `*.toml`, `*.yaml`, `*.yml`, etc. files for task/test/lint tool config.
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

## Gotchas

- Review the current diff by default. Do not expand into a whole-repo audit unless the user asks.
- A finding must name a concrete failing scenario, exploit path, regression, or maintenance cost.
- Do not count missing tests as a finding unless the changed behavior is unprotected or the repo convention requires coverage.
- Do not implement fixes in this skill; switch only if the user explicitly asks for remediation.

## Merge Rules

- Do not reword findings in a way that loses technical meaning.
- Keep the strongest evidence and clearest recommendation.
- Keep only one canonical finding per dedupe key.
- Preserve specialist handoff notes in a separate section when useful.
- Prefer evidence that references project-specific commands/config discovered from `package.json`, `*.toml`, and `README/docs`.
- Report only actionable issues with concrete impact. Skip preferences, speculative rewrites, and broad architecture commentary without a failing scenario.
- If a finding depends on an assumption, state the assumption and confidence.

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
