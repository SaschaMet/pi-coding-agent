---
name: code-review
description: Use this skill when the user asks to review local changes, inspect a diff, audit code quality, check security, assess QA risk, or produce a combined review verdict. Focus on actionable defects in the changed code. Do not use for implementation requests, broad architecture brainstorming, or style-only cleanup unless review is explicitly requested.
---

# Code Quality Check Orchestrator

You are a unified reviewer. Review outcomes, not personal style. Run three focused passes with subagents, then merge findings deterministically.
Use `Agent` from `@tintinweb/pi-subagents` for the specialist passes. The parent session owns context capture, result collection, dedupe, final verdict, and final response.

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
   - Identify the change intent, touched public contracts, and affected runtime paths before judging findings.
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
4. Execute three read-only specialist passes with subagents:
   - Spawn `generic-readonly` for QA: correctness/regressions/edge cases/test adequacy only.
   - Spawn `generic-readonly` for Security: concrete exploitable vulnerabilities only.
   - Spawn `generic-readonly` for Code Quality: maintainability/performance/reliability/integration/design only.
   - Prefer background agents for independent passes, then retrieve each result with `get_subagent_result({ wait: true })`.
   - Give each agent the diff summary, relevant file paths, review context, validation context, exact reference path to read, strict category ownership, and required finding schema.
   - Apply strict non-overlap ownership. Out-of-scope items become scope notes, not findings.
5. Collect pass outputs.
6. Normalize each finding into:
   - `category`, `severity`, `file`, `line`, `title`, `evidence`, `recommendation`, `confidence`
7. Dedupe with key:
   - `(file, line, normalized_root_cause)`
8. Apply precedence when duplicate root cause exists:
   - `security` > `qa` > `code_quality`
9. Sort final findings:
   - severity `HIGH` first, then `MEDIUM`, then `LOW`
   - tie-break by category precedence above, then file+line
10. Quality-gate every finding before final output:
   - exact changed line or nearest changed line
   - concrete failure/exploit/maintenance scenario
   - production or user impact
   - smallest practical recommendation
   - no generic advice, style preference, or broad rewrite
11. Produce a single final verdict:
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
- Report only actionable issues with concrete impact. Skip preferences, speculative rewrites, and broad architecture commentary without a failing scenario.
- If a finding depends on an assumption, state the assumption and confidence.

## Script

Use this pattern after capturing `git status`, `git diff`, touched files, `Review Context`, and `Project Validation Context`.

```text
Agent({
  subagent_type: "generic-readonly",
  description: "QA review",
  run_in_background: true,
  prompt: "Run the QA pass for this code review. Read .pi/skills/code-review/references/qa-validator.md. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <Review Context>, <Project Validation Context>. Report only correctness, regression, edge-case, breaking-change, and changed-behavior test adequacy findings. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report security or maintainability-only issues."
})

Agent({
  subagent_type: "generic-readonly",
  description: "Security review",
  run_in_background: true,
  prompt: "Run the Security pass for this code review. Read .pi/skills/code-review/references/security-review.md. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <Review Context>, <Project Validation Context>. Report only concrete exploitable vulnerabilities with proof of exploit path. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report QA or maintainability-only issues."
})

Agent({
  subagent_type: "generic-readonly",
  description: "Quality review",
  run_in_background: true,
  prompt: "Run the Code Quality pass for this code review. Read .pi/skills/code-review/references/code-review.md. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <Review Context>, <Project Validation Context>. Report only maintainability, performance, scalability, reliability, integration, portability, and design-quality findings with concrete impact. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report QA or security issues."
})

get_subagent_result({ agent_id: "<qa-agent-id>", wait: true, verbose: false })
get_subagent_result({ agent_id: "<security-agent-id>", wait: true, verbose: false })
get_subagent_result({ agent_id: "<quality-agent-id>", wait: true, verbose: false })
```

This skill-specific orchestration:

- Parent session gathers context once and passes it to all agents.
- Agents are read-only and independent, so background execution is appropriate.
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

## Final Verdict

PASS | FAIL | REQUIRES_MODIFICATION
```

If no findings exist, output `## Findings` with `- none`.
