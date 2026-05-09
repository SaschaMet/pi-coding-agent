---
name: gan-generative-adversarial
description: Use this skill when the user explicitly asks for a GAN-style, generator/evaluator, adversarial, critic loop, or competing-agent workflow for a plan, spec, implementation, or design. Orchestrate one generator subagent and one evaluator subagent in bounded iterations. Do not use for ordinary coding, simple reviews, or when delegation was not requested.
---

# Generative Adversarial

Run a bounded generator/evaluator loop inspired by GAN workflows: one agent proposes or implements, the other evaluates strictly, then the generator revises from concrete feedback until the acceptance threshold is met or the iteration budget is exhausted.

This skill coordinates the workflow. It does not replace domain skills such as `tdd-coder`, `frontend-design`, `code-quality-check`, or `create-spec`; reference those inside generator/evaluator prompts when they fit the task.

## Roles

- `gan-generator`: produces the candidate output or implementation. It must address evaluator feedback item by item and avoid self-scoring.
- `gan-evaluator`: stress-tests the candidate against the original request, acceptance criteria, repo conventions, tests, and risk. It scores and returns actionable feedback.

Use `Agent` from `@tintinweb/pi-subagents` to spawn both roles.

## When to use

- The user explicitly asks for "GAN", "generator/evaluator", "adversarial agents", "critic loop", "red team then revise", or "two agents against each other."
- The task is substantial enough that independent generation and critique reduce risk.
- The user wants iterative improvement, not a one-shot answer.

## When NOT to use

- Do not use just because the task is complex; explicit delegation/adversarial-loop intent is required.
- Do not use for small edits, quick explanations, or routine code review.
- Do not spawn overlapping workers that edit the same files concurrently.
- Do not continue iterations after the evaluator reports `PASS` unless the user asks.

## Gotchas

- Generator and evaluator must share the same objective and acceptance criteria, or the loop drifts.
- Evaluator feedback must be specific enough for the generator to act on. Vague criticism is a failed evaluation.
- A low score is not a failure of the workflow; it is signal for the next iteration.
- Keep iteration count bounded. Default to 2 iterations, maximum 3 unless the user asks.
- Never simulate missing subagent output. If a subagent fails, stop and report the failure.

## Workflow

1. Define the contract.
   Extract the objective, in-scope files/areas, out-of-scope boundaries, acceptance criteria, verification commands, and max iterations. If the request is ambiguous or high-risk, ask before spawning agents.

2. Choose mode.
   - `proposal`: generator writes a plan/spec/design in chat; evaluator critiques it; no file writes.
   - `implementation`: generator edits files; evaluator reviews diff and test results.
   - `review`: generator proposes fixes from an existing diff/spec; evaluator checks the fix plan before implementation.

   Default to `proposal` unless the user asked for implementation.

3. Spawn generator first with `Agent`.
   Give `gan-generator`:
   - the original user request
   - mode
   - exact scope and forbidden areas
   - acceptance criteria
   - expected output format
   - verification commands or manual checks
   - for implementation mode, file ownership and "do not revert others' edits"

4. Spawn evaluator with `Agent` after generator output is available.
   Give `gan-evaluator`:
   - original user request and acceptance criteria
   - generator output or diff summary
   - expected scoring rubric
   - instruction to return `PASS` or `FAIL`
   - requirement that every issue includes evidence and a concrete fix

5. Iterate only on failures.
   If evaluator returns `FAIL`, send the full evaluator feedback back to `gan-generator`. Require it to address every critical and major item explicitly. Then re-run `gan-evaluator`.

6. Stop.
   Stop when evaluator returns `PASS`, max iterations is reached, or a blocker appears. Report the final status, remaining risks, files changed, and verification results.

## Scoring rubric

Use this default rubric unless the user provides one:

| Criterion       | Weight | Evaluator checks                                                       |
| --------------- | -----: | ---------------------------------------------------------------------- |
| Correctness     |    35% | Meets acceptance criteria and preserves required behavior              |
| Integration     |    20% | Fits repo architecture, APIs, data flow, and ownership boundaries      |
| Risk            |    20% | Handles edge cases, errors, security, rollback, and migration concerns |
| Verification    |    15% | Tests/checks are appropriate and reproducible                          |
| Maintainability |    10% | Small scoped change, readable structure, no avoidable complexity       |

`PASS` requires no critical issues and weighted score >= 8/10. Anything below that is `FAIL`.

## Script

Use foreground agents because evaluator input depends on generator output.

Examples:

### Generator

```text
Agent({
  subagent_type: "gan-generator",
  description: "Generate candidate",
  prompt: "Objective: <objective>\nMode: <proposal|implementation|review>\nScope: <allowed files/areas>\nForbidden: <out-of-scope areas>\nAcceptance criteria: <criteria>\nEvaluator rubric: <rubric>\nIteration: <N> of <max>\n\nProduce the smallest candidate that satisfies the objective. If this is not the first iteration, address every evaluator issue explicitly. Return summary, files changed/proposed, acceptance mapping, verification, and known limitations."
})
```

### Evaluator

```text
Agent({
  subagent_type: "gan-evaluator",
  description: "Evaluate candidate",
  prompt: "Original objective: <objective>\nAcceptance criteria: <criteria>\nMode: <proposal|implementation|review>\nGenerator output: <generator-agent-output>\nRubric: <rubric>\n\nEvaluate strictly. Return PASS or FAIL, scores, strengths, issues by severity, required fixes, and residual risks."
})
```

### Revision

```text
Agent({
  subagent_type: "gan-generator",
  description: "Revise candidate",
  prompt: "Objective: <objective>\nPrevious generator output: <generator-agent-output>\nEvaluator feedback: <evaluator-agent-output>\nIteration: <N> of <max>\n\nRevise the candidate. Address every critical and major evaluator issue explicitly. Return updated summary, files changed/proposed, acceptance mapping, verification, and unresolved items."
})
```

This skill-specific orchestration:

- Parent session defines objective, scope, rubric, and max iterations.
- Generator and evaluator run sequentially.
- Evaluator must see generator output or diff summary.
- On `FAIL`, parent sends full evaluator feedback to generator.
- If any agent fails, stop and report the exact failure. Do not invent that role output.

## Subagent prompt templates

### Generator prompt

```text
You are `gan-generator`.

Objective: {objective}
Mode: {proposal|implementation|review}
Scope: {allowed files/areas}
Forbidden: {out-of-scope areas}
Acceptance criteria: {criteria}
Evaluator rubric: {rubric}
Iteration: {N} of {max}

Task:
- Produce the smallest candidate that satisfies the objective.
- If this is not the first iteration, address every evaluator issue explicitly.
- Do not self-score. The evaluator owns judgment.
- For implementation mode, edit only your owned files and do not revert unrelated changes.

Return:
- Summary of what you produced.
- Files changed or proposed files.
- Acceptance criteria mapping.
- Verification run or proposed verification.
- Known limitations.
```

### Evaluator prompt

```text
You are `gan-evaluator`.

Original objective: {objective}
Acceptance criteria: {criteria}
Mode: {proposal|implementation|review}
Generator output: {output or diff summary}
Rubric: {rubric}

Task:
- Evaluate strictly against the original objective, not effort.
- Steel-man the candidate briefly before critique.
- Identify critical, major, and minor issues.
- Every issue must include evidence, impact, and a concrete fix.
- Score each rubric criterion from 1-10 and compute the weighted score.

Return:
- Verdict: PASS or FAIL.
- Scores table.
- Strengths.
- Issues by severity.
- Required fixes for the next generator iteration.
- Residual risks if accepted.
```

## Final response

Report in this order:

1. `Verdict`: `PASS`, `FAIL`, or `STOPPED`.
2. `Iterations`: number completed and why the loop stopped.
3. `What changed`: candidate output or files changed.
4. `Evaluator findings`: remaining critical/major/minor items.
5. `Verification`: commands run and results, or manual checks.
6. `Next action`: the smallest concrete next step.
