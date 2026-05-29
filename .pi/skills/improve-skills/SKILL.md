---
name: improve-skills
description: Use this skill when the user asks to create, revise, audit, optimize, or troubleshoot Codex/agent skills, AGENTS.md files, agent instruction files, skill descriptions, bundled scripts, trigger behavior, or agent-facing documentation. Apply it when improving an agent's reliability from traces, review feedback, eval prompts, or documentation sprawl. Do not use for ordinary coding docs unless the target reader is an agent.
---

# Improve Skills

Improve agent-facing instructions with the smallest useful change. Treat skills, `AGENTS.md`, and similar files as execution context, not human documentation.

## Definition of Done

- The artifact targets a specific agent task or failure mode.
- The main file is short enough to be loaded on every relevant run.
- Required decisions are resolved by defaults, workflows, or decision tables.
- Rare details are moved behind clear load conditions.
- Trigger behavior, format, and scripts are validated when applicable.

## Workflow

1. Identify the target artifact and its runtime:
   - Skill: inspect `SKILL.md`, `agents/openai.yaml`, scripts, references, and assets.
   - `AGENTS.md`: inspect nearest file, parent files, referenced docs, and nearby code conventions.
   - Unknown format: inspect existing project examples before drafting.
2. Classify the requested mode:
   - `audit`: inspect only and return findings; do not edit files for review, audit, plan, or no-edit requests.
   - `plan`: produce an implementation plan; do not edit files.
   - `edit`: make the smallest useful change directly and report changed files plus validation.
3. Define the agent task the artifact must improve:
   - user intents that should trigger or apply it
   - adjacent intents that should not
   - target metric: correctness, completeness, reuse, convention adherence, speed, or reduced over-exploration
   - recurring mistakes, missing context, or over-exploration it must prevent
4. Gather real source material before writing:
   - successful task traces, failed runs, review comments, issue fixes, runbooks, code examples, schemas, tests, or existing docs
   - prefer project-specific facts over general best practices
   - for audits, inspect target runtime files, metadata, and directly linked references first; load traces or broad docs only when needed to prove a finding
5. Rewrite for agent execution:
   - concise procedural workflow first
   - concrete defaults instead of equal-choice menus
   - decision tables when multiple local patterns compete
   - short production examples when reuse matters
   - gotchas only when they prevent likely mistakes
   - every "do not" paired with the preferred "do"
6. Apply progressive disclosure:
   - keep always-needed rules in the main file
   - move detailed, variant-specific, or rarely used material to directly referenced files
   - state exactly when to load each reference
7. Validate:
   - use `references/testing.md` for trigger tests, validation loops, and skill output evaluation
   - revise based on failures, not assumptions

Read `references/best-practices.md` when creating a new skill, doing a substantial rewrite, choosing between inline guidance and references, or deciding whether a script belongs in a skill.

## Pattern Selector

Use the pattern that matches the observed problem:

| Problem | Preferred pattern |
| --- | --- |
| Agent misses required wiring or sequence | Numbered workflow with validation gates |
| Agent chooses the wrong local pattern | Decision table with the approved default |
| Agent invents code instead of reusing code | 3-10 line production examples |
| Agent ignores domain-specific hazards | Short gotchas in the main file |
| Agent becomes cautious or exploratory | Pair each "do not" with the preferred "do" |
| Main file causes context bloat | Progressive disclosure with focused references |
| Repeated fragile logic is rewritten each run | Bundle a script with a stable CLI |
| New architecture conflicts with old patterns | Create a spec; do not stretch old guidance |

## Skill-Specific Rules

- `description` is the trigger contract. Write it as "Use this skill when..." and describe user intent, not internal implementation.
- Include explicit near-boundaries: when to use the skill and when not to.
- Keep descriptions under 1024 characters.
- Keep `SKILL.md` under 500 lines unless there is a strong reason; split references before it becomes a knowledge dump.
- Do not add `README.md`, changelogs, installation guides, or broad auxiliary docs inside a skill unless the runtime explicitly requires them.
- Regenerate or update `agents/openai.yaml` when UI metadata becomes stale.
See `references/best-practices.md` for detailed skill authoring rules, examples, and anti-patterns.

## Script Rules

Add a script only when it improves reliability or token economy. Use [references/best-practices.md](references/best-practices.md) before adding or substantially changing scripts.

Gate every script on: non-interactive inputs, deterministic behavior, useful `--help`, structured bounded stdout, diagnostics on stderr, actionable errors, and `--dry-run`/`--confirm`/`--force` for risky operations.

## AGENTS.md-Specific Rules

Keep `AGENTS.md` focused on the surrounding module, critical discovery paths, ownership boundaries, current patterns, and workflows that agents need on most runs. Use [references/best-practices.md](references/best-practices.md) for detailed AGENTS guidance.

For net-new architecture that conflicts with existing patterns, create a spec instead of forcing old instructions to fit.

## Quality Gate

Before finalizing, verify:

- The artifact improves a real agent task, not human browsing.
- The main file contains only context the agent is likely to need on most runs.
- Detailed references are directly linked with load conditions.
- The workflow tells the agent what to do next, not just what to know.
- Gotchas are specific, enforceable, and paired with preferred actions.
- Scripts, if any, are deterministic and documented by `--help`.
- Script output is structured, bounded, and split between stdout data and stderr diagnostics.
- Validation follows `references/testing.md`, or a concrete manual verification path is documented.

## Output

For reviews or improvement plans, return:

```markdown
## Findings
- [artifact/path]: [specific issue] -> [smallest fix]

## Recommended Changes
- [concrete edit]

## Validation
- [check or eval to run]
```

For edits, make the change directly and report changed files plus validation.
