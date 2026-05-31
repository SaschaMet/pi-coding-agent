# Reference: Initialization Workflow

Use this reference on every run. It controls sequencing and prevents premature questions.

## Required order

Every assistant using this skill should work in this order:

1. Inspect the repository.
2. Identify what is missing or conflicting.
3. Ask only targeted clarification questions for material unknowns.
4. Add or update files, scripts, hooks, docs, and CI so the coding standard actually works.
5. Verify by running checks and summarize results.

## Inspection checklist

Inspect at minimum:
- root files and package managers
- source layout
- test layout
- CI/workflow files
- existing hook files
- existing agent hook files, including `.github/hooks`, `.claude/settings.json`, `.codex` or Codex plugin hooks, and `.pi/extensions`
- existing AGENTS, CLAUDE, or instruction files
- coverage and mutation setup
- type strictness settings and broad type escape hatches
- lint-disable comments and weakened lint configuration
- data-sensitivity clues

## Gap analysis checklist

Report these before editing:

- Existing: working tools, commands, workflows, and docs.
- Preserve: conventions to keep because they already satisfy the standard.
- Missing: checks, docs, hooks, CI jobs, templates, and guard scripts to add.
- Conflicts: duplicate or competing tools to consolidate.
- Cleanup: stale tests, fixtures, snapshots, mocks, generated files, and helper scripts to inspect.
- Type safety: strictness gaps, broad types, casts, ignored type errors, and trust-boundary validation gaps.
- Lint integrity: disabled rules, ignore comments, staged-check bypasses, and whether each has a narrow documented reason.
- AI hooks: whether Claude, Codex, and PI have a post-change lint/check hook and a `.env` access guard.
- Questions: only material unknowns that the repository cannot answer.

## Good clarification questions

Ask only when inspection cannot answer:
- profile level
- canonical package manager in a mixed repo
- CI placement for mutation tests
- blocking vs warning mode for heuristic guard scripts
- scope in a monorepo

## Mandatory repo instruction reference

Part of implementation must be a local `AGENTS.md` or equivalent instruction file that tells future assistants:
- this coding standard exists
- where the main engineering docs live
- that the assistant must inspect the repo first
- that it must perform a gap analysis
- that it must ask targeted questions only when necessary
- that it must use the strictest practical types and avoid `any`/`unknown` unless no safer type is available
- that it must not weaken or disable linting/typechecking just to pass local, staged, or CI checks
- that AI file changes must trigger the installed post-change lint/check hook when a linter exists
- that existing `.env` files are off-limits to AI read, search, list, and mutation tools
- that it must then implement and verify the standard

## Standard executor

If the target repo lacks one command that agents and humans can run, add a small executor script based on `scripts/run-coding-standard.sh`.

Required behavior:

- `--help` documents modes, defaults, examples, and exit codes.
- `--dry-run` prints planned checks without executing them.
- `--mode fast` runs the local fast check.
- `--mode full` runs coverage and broader local checks.
- `--mode ci` runs the CI verification command.
- `--mode pre-commit` runs pre-commit hooks or the git hook directly.
- stdout is structured summary data; subprocess output goes to stderr.
