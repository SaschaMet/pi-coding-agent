# Skill Authoring Best Practices

Use this reference for new skills and substantial skill rewrites. Keep `SKILL.md` short; move details here only when they are not needed on every run.

## Source Material

- Start from real agent work: successful traces, failed traces, human corrections, review comments, incidents, runbooks, schemas, and landed patches.
- Prefer project-specific facts over generic advice. A skill should contain what the model would otherwise miss or get wrong.
- Extract reusable procedure, not one task's answer.
- Add a gotcha when a human correction would likely recur.

## Scope

- Make one coherent unit of work. Too narrow forces many skills to load; too broad triggers incorrectly.
- State boundaries directly: use cases, non-use cases, and adjacent skills/docs.
- Do not use a skill to store broad background knowledge. Store only operational context the agent needs to act.

## Description

The frontmatter `description` is the trigger contract.

- Start with imperative phrasing: `Use this skill when...`
- Describe user intent, not implementation internals.
- Include common implicit cases, not only exact keyword matches.
- Add near-boundaries for false positives.
- Keep it concise and under 1024 characters.
- Avoid descriptions so broad they trigger for ordinary coding tasks.

## Body Structure

Recommended order:

1. Goal: what this skill changes in agent behavior.
2. Definition of Done: observable completion criteria.
3. Workflow: short numbered procedure.
4. Pattern selector or decision table when choices are ambiguous.
5. Gotchas: concrete mistakes and the preferred action.
6. References: directly linked files with exact load conditions.
7. Output format when the user expects a specific report.

Keep `SKILL.md` under 500 lines. Prefer much shorter when possible.

## Progressive Disclosure

- Keep always-needed instructions in `SKILL.md`.
- Move detailed examples, variants, schemas, long templates, and advanced troubleshooting to `references/`.
- Link every reference from `SKILL.md` with a condition: "Read X when Y."
- Avoid nested reference chains. A reader should discover required material from `SKILL.md`.
- Do not create `README.md`, changelogs, installation guides, or extra docs inside a skill unless the runtime requires them.

## Instruction Patterns

Use the smallest pattern that solves the observed problem:

| Need | Pattern |
| --- | --- |
| Required sequence | Numbered workflow |
| Complex multi-step process | Checklist with validation gates |
| Ambiguous local choices | Decision table |
| Reuse established code | 3-10 line production examples |
| Repeated human corrections | Gotchas |
| Required report shape | Markdown output template |
| Fragile batch operation | Plan-validate-execute |
| Repeated deterministic logic | Bundled script |

## Defaults

- Pick a default tool or path. Mention alternatives only as escape hatches.
- Explain why only when it helps the agent choose correctly in context.
- Pair every prohibition with the desired action:
  - Weak: "Do not instantiate HTTP clients directly."
  - Strong: "Do not instantiate HTTP clients directly. Use `lib/http/apiClient` with retry middleware."

## Scripts

Add scripts only when they improve reliability or token economy.

Good script candidates:

- deterministic validation
- structured extraction
- repeated format conversion
- stable API wrappers
- trigger eval runners
- transformations the agent would otherwise rewrite each run

Avoid scripts for:

- one-off commands
- simple file reads
- highly variable logic
- interactive flows

Script requirements:

- non-interactive
- accepts flags, stdin, or environment variables
- has concise `--help`
- outputs structured data to stdout
- sends diagnostics to stderr
- has clear, actionable errors
- uses idempotent defaults
- supports `--dry-run`, `--confirm`, or `--force` for risky operations
- bounds output with `--limit`, `--offset`, or `--output` when needed

## AGENTS.md Guidance

When improving `AGENTS.md`, optimize for automatic discovery and low context load.

- Keep the file focused on the surrounding module.
- Prefer 100-150 lines when possible.
- Reference only high-value docs, usually fewer than 10-15.
- State what each reference contains and when to open it.
- Avoid architecture essays. State ownership boundaries and current patterns.
- Use workflows for repeated tasks and decision tables for competing conventions.
- Reuse existing docs only after trimming human-oriented background.
- Keep orphan docs searchable if they remain outside `AGENTS.md`.
- For net-new architecture that conflicts with existing patterns, write a spec instead of bending old instructions.

## Anti-Patterns

- Generic advice: "handle errors properly", "write clean code", "follow best practices".
- Long architecture history that does not change the next action.
- Many warnings without preferred alternatives.
- Equal-choice tool menus without a default.
- Broad root docs that apply to every task and no task.
- References with no load condition.
- Large examples that encourage copy-paste of irrelevant details.
- Trigger descriptions optimized for exact eval wording instead of intent categories.
