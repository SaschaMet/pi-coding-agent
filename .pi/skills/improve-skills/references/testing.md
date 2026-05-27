# Skill Testing and Validation

Use this reference when validating a new skill, improving trigger behavior, checking scripts, or revising a skill from failed runs.

## Validation Levels

Choose the narrowest validation that proves the change:

1. Format validation: required files, YAML frontmatter, name, description length, UI metadata.
2. Trigger validation: whether the skill loads for the right user prompts.
3. Output validation: whether the skill improves task results once loaded.
4. Script validation: whether bundled scripts are deterministic, documented, and safe for agents.
5. Trace validation: whether real runs show less confusion, missed wiring, or over-exploration.

## Format Checks

For skills:

- `SKILL.md` exists.
- Frontmatter has `name` and `description`.
- `name` is lower hyphen-case.
- `description` is under 1024 characters.
- `SKILL.md` is under 500 lines unless justified.
- `agents/openai.yaml` matches the current skill purpose when present.
- Every reference linked from `SKILL.md` exists.
- No stray README/changelog/guide files were added unless required.

Run the local validator when available. If dependencies are missing, use an equivalent YAML parse and length check.

## Trigger Evaluation

Use this when changing a skill description.

1. Create realistic eval prompts:
   - 8-10 should-trigger prompts
   - 8-10 should-not-trigger near misses
   - include casual wording, typos, file paths, concrete project context, terse prompts, and multi-step prompts
2. Include should-trigger prompts where the skill helps but is not named directly.
3. Include should-not-trigger prompts with overlapping keywords but different intent.
4. Split train/validation when iterating more than once.
5. Keep a proportional mix of positives and negatives in both sets.
6. Run each prompt multiple times if the client is nondeterministic; use trigger rate instead of one run.
7. Treat a positive as passing when trigger rate clears the chosen threshold.
8. Treat a negative as passing when trigger rate stays below the threshold.

## Description Optimization Loop

1. Evaluate current description on train and validation sets.
2. Use only train failures to revise.
3. For false negatives, broaden the intent category or add implicit use cases.
4. For false positives, add scope boundaries or adjacent non-use cases.
5. Do not copy exact failed prompt wording into the description.
6. Re-run train and validation.
7. Stop after about five iterations or when results stop improving.
8. Select the best validation result, not necessarily the last rewrite.
9. Sanity-check with 5-10 fresh prompts not used during optimization.

## Output Quality Evaluation

Use this when the skill triggers but results are weak.

- Build task cases from real work, not synthetic toy prompts.
- Include at least one easy, typical, edge, and near-boundary case.
- Define pass/fail criteria before running.
- Compare against a baseline without the skill when practical.
- Inspect traces, not only final answers.
- Look for wasted exploration, skipped steps, wrong defaults, unnecessary abstractions, and ignored references.
- Revise the smallest instruction that explains the failure.

Common fixes:

- Missed step: add or tighten a workflow/checklist item.
- Wrong local convention: add a decision table.
- Invented code: add a short production example.
- Repeated correction: add a gotcha.
- Over-exploration: remove broad context, split references, or pair warnings with actions.
- Fragile repeated logic: add a script.

## Script Validation

For every bundled script:

- `--help` runs without side effects.
- Required args fail fast with actionable errors.
- Invalid enum/value errors show accepted values and received value.
- Normal output is structured and parseable.
- Diagnostics go to stderr.
- Exit codes distinguish success, invalid input, missing dependency, auth/config failure, and runtime failure when useful.
- Re-running the command is safe or explicitly guarded.
- Destructive or stateful behavior supports `--dry-run` and explicit confirmation.
- Large outputs are summarized, paginated, or written to a file.

## Manual Validation Report

When finishing, report:

```markdown
## Validation
- Format: [command or manual check]
- Trigger: [eval/manual prompts or not applicable]
- Output: [task cases or not applicable]
- Scripts: [script checks or not applicable]
- Residual risk: [what was not tested]
```
