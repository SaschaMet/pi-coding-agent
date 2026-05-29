---
name: code-review
description: Use this skill when the user asks to review local changes, inspect a diff, audit code quality, check security, assess QA risk, or produce a combined review verdict. Focus on actionable defects in the changed code. Do not use for implementation requests, broad architecture brainstorming, or style-only cleanup unless review is explicitly requested.
---

# Code Quality Check Orchestrator

You are a unified reviewer. Review outcomes, not personal style. Run the focused passes required by the requested scope, then merge findings deterministically.
Use subagents for specialist passes only when delegated review tooling is available and allowed. Otherwise run the same passes in the parent session. The parent session owns context capture, result collection, dedupe, final verdict, and final response.

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

## Review Scope

| User request | Passes to run |
| --- | --- |
| Generic review, diff review, audit, or combined verdict | QA, Security, and Code Quality |
| QA, regression, behavior, or test adequacy only | QA only |
| Security review only | Security only |
| Maintainability, performance, design, or code quality only | Code Quality only |

## Execution Steps

1. Capture review context:
   - Run `git status`
   - Run `git diff`
   - Review only added/modified lines, plus surrounding code needed to prove impact.
   - Identify the change intent, touched public contracts, and affected runtime paths before judging findings.
   - For changed source files, capture current file line counts and whether the diff pushes any file over 250 lines.
2. Discover project-specific quality commands and conventions:
   - Read `package.json` scripts when present.
   - Read top-level and near-root `*.toml`, `*.yaml`, `*.yml`, etc. files for task/test/lint tool config.
   - Read `README*` and nearest docs sections describing test/lint/typecheck/format/check workflows.
   - Build a `Project Validation Context` block that includes:
     - preferred commands (exact command strings)
     - required command ordering constraints (if documented)
     - tool names and config hints (for example, `vitest`, `pytest`, `cargo test`, `ruff`, `eslint`, `biome`)
     - explicit "do not run" or environment constraints from docs
3. Build a `Review Context` block:
   - changed files and symbols
   - intended user-visible behavior when inferable from request, branch, commits, PR text, or tests
   - relevant public APIs, schemas, config keys, CLI flags, event names, and database migrations touched by the diff
   - surrounding interfaces/callers needed to verify compatibility
   - explicit focus areas requested by the user
4. Execute the selected read-only specialist passes:
   - QA: correctness/regressions/edge cases/test adequacy only.
   - Security: concrete exploitable vulnerabilities only.
   - Code Quality: maintainability/performance/reliability/integration/design only.
   - When subagents are available and allowed, spawn `generic-readonly` agents for selected passes. Prefer background agents for independent passes, then retrieve each result with `get_subagent_result({ wait: true })`.
   - When subagents are unavailable or not allowed, run the same selected passes in the parent session and keep category ownership separate.
   - Give each pass the diff summary, relevant file paths, review context, validation context, exact reference path to read, strict category ownership, and required finding schema.
   - Apply strict non-overlap ownership. Out-of-scope items become scope notes, not findings.
5. Wait until every selected pass has finished before merging, deduping, or producing a verdict. Do not proceed with partial results.
6. Collect pass outputs.
7. Normalize each finding into:
   - `category`, `severity`, `file`, `line`, `title`, `evidence`, `recommendation`, `confidence`
8. Dedupe with key:
   - `(file, line, normalized_root_cause)`
9. Apply precedence when duplicate root cause exists:
   - `security` > `qa` > `code_quality`
10. Sort final findings:
   - severity `HIGH` first, then `MEDIUM`, then `LOW`
   - tie-break by category precedence above, then file+line
11. Quality-gate every finding before final output:
   - exact changed line or nearest changed line
   - concrete failure/exploit/maintenance scenario
   - production or user impact
   - smallest practical recommendation
   - no generic advice, style preference, or broad rewrite unless it identifies a concrete simplification that removes meaningful complexity
12. Produce a single final verdict:
   - `FAIL` if any HIGH finding exists
   - `REQUIRES_MODIFICATION` if only MEDIUM/LOW findings exist
   - `PASS` if no findings

## Gotchas

- Review the current diff by default. Do not expand into a whole-repo audit unless the user asks.
- A finding must name a concrete failing scenario, exploit path, regression, or maintenance cost.
- Breaking changes are findings when the diff changes public API signatures, removes/renames public methods, changes return types, modifies database schemas, or changes required configuration without a compatible migration path.
- Do not count missing tests as a finding unless the changed behavior is unprotected or the repo convention requires coverage.
- Do not implement fixes in this skill; switch only if the user explicitly asks for remediation.
- Include suggested tests only when they directly prove the finding or close a changed-behavior gap.

## Merge Rules

- Do not reword findings in a way that loses technical meaning.
- Keep the strongest evidence and clearest recommendation.
- Keep only one canonical finding per dedupe key.
- Preserve specialist handoff notes in a separate section when useful.
- Prefer evidence that references project-specific commands/config discovered from `package.json`, `*.toml`, and `README/docs`.
- Report only actionable issues with concrete impact. Structural findings are valid when they show a concrete maintenance cost and a clearer organization that deletes meaningful complexity.
- If a finding depends on an assumption, state the assumption and confidence.

## Subagent Examples

Use this pattern after capturing `git status`, `git diff`, touched files, `Review Context`, and `Project Validation Context`.

```text
Agent({
  subagent_type: "generic-readonly",
  description: "QA review",
  run_in_background: true,
  prompt: "Run the QA pass for this code review. Read references/qa-validator.md from the code-review skill directory. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <Review Context>, <Project Validation Context>. Report only correctness, regression, edge-case, breaking-change, and changed-behavior test adequacy findings. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report security or maintainability-only issues."
})

Agent({
  subagent_type: "generic-readonly",
  description: "Security review",
  run_in_background: true,
  prompt: "Run the Security pass for this code review. Read references/security-review.md from the code-review skill directory. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <Review Context>, <Project Validation Context>. Report only concrete exploitable vulnerabilities with proof of exploit path. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report QA or maintainability-only issues."
})

Agent({
  subagent_type: "generic-readonly",
  description: "Quality review",
  run_in_background: true,
  prompt: "Run the Code Quality pass for this code review. Read references/code-review.md from the code-review skill directory. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <file size context including files over 250 lines>, <Review Context>, <Project Validation Context>. Report maintainability, performance, scalability, reliability, integration, portability, or design-quality findings only when they show concrete impact and a smaller organization that removes meaningful complexity. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report QA or security issues."
})

get_subagent_result({ agent_id: "<qa-agent-id>", wait: true, verbose: false })
get_subagent_result({ agent_id: "<security-agent-id>", wait: true, verbose: false })
get_subagent_result({ agent_id: "<quality-agent-id>", wait: true, verbose: false })
```

This skill-specific orchestration:

- Parent session gathers context once and passes it to all agents.
- Agents are read-only and independent, so background execution is appropriate.
- Parent session waits for all selected subagent results to complete before collecting, deduping, sorting, or deciding the verdict.
- Parent session dedupes, applies category precedence, sorts findings, and writes the final verdict.
- If any agent fails, stop and report the exact failure. Do not invent that pass.

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
   confidence: high|medium|low

## Final Verdict

PASS | FAIL | REQUIRES_MODIFICATION
```

If no findings exist, output `## Findings` with `- none`.
