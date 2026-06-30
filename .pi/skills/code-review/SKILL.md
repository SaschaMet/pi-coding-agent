---
name: code-review
description: Use this skill when the user asks to review local changes, inspect a diff, audit code quality, check security, assess QA risk, or produce a combined review verdict. Focus on actionable defects in the changed code. Do not use for implementation requests, broad architecture brainstorming, or style-only cleanup unless review is explicitly requested.
---

# Code Quality Check Orchestrator

You are a unified reviewer. Review outcomes, not personal style. Run the focused passes required by the requested scope, then merge findings deterministically.
Always use subagents for every selected specialist pass. The parent session is the coordinator only: it owns context capture, pass selection, prompt construction, result collection, dedupe, final verdict, and final response. The parent session must not perform specialist review itself.

## Goal

- One unified report.
- No duplicated findings.
- Strict category ownership:
  - `qa` owns correctness/regressions/edge cases/test adequacy
  - `security` owns exploitable security vulnerabilities
  - `code_quality` owns maintainability/performance/design quality and lint/typecheck bypasses

## Reference Material

Load only the references needed for the requested review scope:

- `references/qa-validator.md` for correctness, regression, edge-case, and test adequacy review.
- `references/security-review.md` for exploitable vulnerability review.
- `references/code-review.md` for maintainability, performance, and design review.
- `references/threat-model.md` only when the Security pass is selected: build the diff-scoped Threat Context that tells the Security pass what counts as a vulnerability here.
- `references/security-verification.md` only when the Security pass returns at least one finding: separate discovery from verification and triage severity before the verdict.

## Review Scope

| User request                                               | Passes to run                  |
| ---------------------------------------------------------- | ------------------------------ |
| Generic review, diff review, audit, or combined verdict    | QA, Security, and Code Quality |
| QA, regression, behavior, or test adequacy only            | QA only                        |
| Security review only                                       | Security only                  |
| Maintainability, performance, design, or code quality only | Code Quality only              |

## Execution Steps

Before Step 1, check whether `graphify-out/graph.json` exists at the repository root. If it exists, use `graphify query`, `graphify path`, or `graphify explain` to build review context for changed architecture, dependency paths, public contracts, ownership boundaries, or cross-file behavior. If no graph exists and the diff is architecture-heavy or touches unclear cross-module flows, run `graphify <repo-root> --mode deep --no-viz` before spawning specialist passes. Do not run graphify for small localized diffs where direct file inspection is sufficient. Treat graphify output as context passed to specialists, not as a finding by itself.

1. Capture review context:
   - Run `git status`
   - Run `git diff`
   - Review only added/modified lines, plus surrounding code needed to prove impact.
   - Identify the change intent, touched public contracts, and affected runtime paths before judging findings.
   - Classify whether the diff is test-only: tests, snapshots, or fixtures changed while no implementation files changed.
   - For changed source files, capture current file line counts and whether the diff pushes any file over 250 lines.
   - Scan added/modified lines and config for new or expanded lint ignore rules, lint-disable comments, ignored type errors, weakened lint config, broad ignore patterns, and equivalents such as `eslint-disable`, `biome-ignore`, `// @ts-ignore`, `// @ts-expect-error`, `type: ignore`, and `# noqa`.
   - When the Security pass will run, determine whether the diff touches a trust boundary (new/changed entry point, authn/authz, input parsing/validation/deserialization, file/network/subprocess I/O, secret/credential/token handling, or a security-relevant config default), and check for `THREAT_MODEL.md` at the repository root. Use these to build Threat Context in Step 4.
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
   - CARDS architecture notes when the diff touches design: clarity of intent, dependency direction, change isolation, invalid-state prevention, and separation of domain/orchestration/IO concerns
   - graphify context when available: relevant paths, explained nodes, god nodes, surprising connections, and community-boundary crossings touched by the diff
   - explicit focus areas requested by the user
4. Execute the selected read-only specialist passes through subagents:
   - When the Security pass is selected, first read `references/threat-model.md` and build a diff-scoped Threat Context block (from `THREAT_MODEL.md` if present, else a lightweight 4-question sketch, else a one-line "no new trust boundary" note). Pass this block to the Security discovery subagent so it knows what counts as a vulnerability here.
   - QA: correctness/regressions/edge cases/test adequacy only.
   - Security: concrete exploitable vulnerabilities only. Run as two waves: (a) a discovery subagent that reports candidate findings, then (b) an independent verification pass per `references/security-verification.md` that re-reads only the cited code, returns confirmed/unconfirmed + confidence, and sets severity from the triage rubric. Do not give the verifier the discovery agent's reasoning.
   - Code Quality: maintainability/performance/reliability/integration/design only, including CARDS regressions with concrete impact.
   - Code Quality also owns lint/typecheck bypass findings: flag new or expanded lint ignore rules, lint-disable comments, ignored type errors, weakened lint config, broad ignore patterns, and equivalent bypasses unless the diff shows explicit repository-owner/user approval.
   - Spawn one read-only subagent per selected pass using `multi_agent_v1.spawn_agent`.
   - Use `agent_type: "qa-validator"` for the QA pass.
   - Use `agent_type: "reviewer"` for Security and Code Quality passes, with the prompt restricting category ownership.
   - Run selected passes in parallel whenever more than one pass is selected.
   - If subagent tooling is unavailable, blocked, or any selected agent fails, stop and report the exact blocker. Do not run the missing pass in the parent session and do not invent that pass.
   - Give each pass the diff summary, relevant file paths, review context, graphify context when available, CARDS architecture notes when present, validation context, exact reference path to read, strict category ownership, and required finding schema.
   - Apply strict non-overlap ownership. Out-of-scope items become scope notes, not findings.
5. Wait for every selected pass with `multi_agent_v1.wait_agent` before merging, deduping, or producing a verdict. Do not proceed with partial results. When the Security pass ran, wait for its discovery subagent, then run and wait for the verification wave before merging: drop `unconfirmed` security findings with confidence < 0.5, demote borderline ones to LOW, and record dropped/demoted findings as a one-line scope note.
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
- unapproved test-only AI diffs are HIGH QA findings when tests, snapshots, or fixtures changed without implementation changes
- unapproved lint/typecheck bypasses are Code Quality findings; broad config/file-level ignores or weakened lint config are HIGH, line-local undocumented suppressions are at least MEDIUM

12. Produce a single final verdict:

- `FAIL` if any HIGH finding exists
- `REQUIRES_MODIFICATION` if only MEDIUM/LOW findings exist
- `PASS` if no findings

## Gotchas

- Review the current diff by default. Do not expand into a whole-repo audit unless the user asks; graphify queries must stay scoped to changed files, callers, contracts, and directly affected paths.
- A finding must name a concrete failing scenario, exploit path, regression, or maintenance cost.
- Breaking changes are findings when the diff changes public API signatures, removes/renames public methods, changes return types, modifies database schemas, or changes required configuration without a compatible migration path.
- Do not count missing tests as a finding unless the changed behavior is unprotected or the repo convention requires coverage.
- Do not accept test-only diffs that claim implementation behavior changed. If tests, snapshots, or fixtures changed and no implementation files changed, fail the review unless the user explicitly requested test-only maintenance.
- Do not accept AI-added lint/typecheck bypasses. New or expanded ignore rules, disable comments, ignored type errors, weakened lint config, or broad ignore patterns must be flagged unless the user or repository owner explicitly approved the exact exception.
- Do not let the Security discovery agent verify its own findings. Verification must be an independent subagent that sees only the finding and cited code, never the discovery reasoning; this is what keeps false positives down. Set final security severity from the triage rubric, not the discovery agent's first guess.
- Do not treat a missing `THREAT_MODEL.md` as a finding. When the diff touches no trust boundary, pass a one-line "no new trust boundary" note and skip the 4-question sketch.
- Do not implement fixes in this skill; switch only if the user explicitly asks for remediation.
- Include suggested tests only when they directly prove the finding or close a changed-behavior gap.
- Set thresholds to current measured totals so future changes cannot lower coverage. Increase only when the measured score improves.

## Merge Rules

- Do not reword findings in a way that loses technical meaning.
- Keep the strongest evidence and clearest recommendation.
- Keep only one canonical finding per dedupe key.
- Preserve specialist handoff notes in a separate section when useful.
- Prefer evidence that references project-specific commands/config discovered from `package.json`, `*.toml`, and `README/docs`; use graphify evidence only when it points to a concrete changed path, caller, dependency, or boundary.
- Report only actionable issues with concrete impact. Structural findings are valid when they show a concrete maintenance cost and a clearer organization that deletes meaningful complexity.
- If a finding depends on an assumption, state the assumption and confidence.

## Subagent Examples

Use this pattern after capturing `git status`, `git diff`, touched files, graphify context when available, `Review Context`, and `Project Validation Context`. Adapt only the pass list to the requested scope.

```text
multi_agent_v1.spawn_agent({
  agent_type: "qa-validator",
  message: "Run the QA pass for this code review. Read <absolute code-review skill dir>/references/qa-validator.md. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <Review Context>, <Project Validation Context>. Report only correctness, regression, edge-case, breaking-change, and changed-behavior test adequacy findings. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report security or maintainability-only issues."
})

// Security wave (a): discovery
multi_agent_v1.spawn_agent({
  agent_type: "reviewer",
  message: "Run the Security discovery pass for this code review. Read <absolute code-review skill dir>/references/security-review.md. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <Threat Context>, <Review Context>, <Project Validation Context>. Use the Threat Context to decide what counts as a vulnerability here. Report only concrete exploitable vulnerabilities with proof of exploit path. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report QA or maintainability-only issues."
})

// Security wave (b): independent verification, one per finding (or batched for <=3). Pass ONLY the finding and cited file paths, never the discovery reasoning.
multi_agent_v1.spawn_agent({
  agent_type: "reviewer",
  message: "Verify one security finding. Read <absolute code-review skill dir>/references/security-verification.md. You are given only the finding and the cited code; you have not seen the discovery agent's reasoning. Finding: <file>, <line>, <title>, <claimed exploit path>. Re-read the cited code and its immediate callers/callees, try to refute the finding, and check the triage factors. Return: verdict (confirmed|unconfirmed), confidence (0.00-1.00), severity (HIGH|MEDIUM|LOW from the rubric), reason (one line)."
})

multi_agent_v1.spawn_agent({
  agent_type: "reviewer",
  message: "Run the Code Quality pass for this code review. Read <absolute code-review skill dir>/references/code-review.md. Scope: current diff only. Inputs: <git status>, <diff summary>, <touched files>, <file size context including files over 250 lines>, <lint/typecheck bypass scan>, <Review Context>, <CARDS architecture notes when present>, <Project Validation Context>. Report maintainability, performance, scalability, reliability, integration, portability, design-quality, and lint/typecheck bypass findings only when they show concrete impact or add/expand a quality-gate bypass. Include CARDS regressions only when they create a concrete maintenance, correctness, or integration cost. Flag unapproved new/expanded lint ignore rules, lint-disable comments, ignored type errors, weakened lint config, broad ignore patterns, and equivalents as findings. Use this schema per finding: category, severity, file, line, title, evidence, recommendation, confidence. Do not report QA or security issues."
})

multi_agent_v1.wait_agent({ targets: ["<qa-agent-id>", "<security-agent-id>", "<quality-agent-id>"], timeout_ms: 3600000 })
```

This skill-specific orchestration:

- Parent session gathers context once and passes it to all agents.
- Agents are read-only and independent, so parallel execution is required for multi-pass reviews.
- Parent session waits for all selected subagent results to complete before collecting, deduping, sorting, or deciding the verdict.
- Parent session dedupes, applies category precedence, sorts findings, and writes the final verdict.
- If any agent fails or subagent tooling is unavailable, stop and report the exact failure. Do not perform fallback specialist review in the parent session and do not invent that pass.

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
