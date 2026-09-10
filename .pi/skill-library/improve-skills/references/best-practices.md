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

## Invocation

Decide how the skill is reached before editing it:

- **Model-invoked** — keeps its `description`, so the agent can fire it autonomously and other skills can reach it. Costs **context load**: the description sits in the window every turn. Mechanics: omit `disable-model-invocation`.
- **User-invoked** — sets `disable-model-invocation: true`; only a human typing its name reaches it (no other skill can). Zero context load, but it spends **cognitive load**: the human is the index that must remember it exists.

Pick model-invocation only when the agent must reach the skill on its own, or another skill must. If it only ever fires by hand, make it user-invoked.

When user-invoked skills pile up past what can be remembered, that cognitive load is cured by a **router skill**: one user-invoked skill that names the others and when to reach for each.

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

## Leading Words

A **leading word** is a compact concept already living in the model's pretraining that the agent thinks with while running the skill (e.g. _lesson_, _fog of war_, _tracer bullets_). Reused in the text, it anchors a whole region of behaviour in the fewest tokens by recruiting priors the model already holds.

It serves predictability twice: in the body it anchors _execution_ (same behaviour each time the word appears); in the description it anchors _invocation_ (shared language between prompts, docs, and code fires the skill more reliably).

Hunt for restatements that a leading word retires — a quality spelled out at three sites, a description spending a sentence on one idea. Each is a passage begging to collapse into a single token (e.g. "fast, deterministic, low-overhead" -> _tight_; "a loop you believe in" -> _red_, a fuzzy gate turned into a binary observable state). Fewer tokens, and a sharper hook. Assume every skill carries them; go find them.

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

## Pruning

Keep each meaning in a **single source of truth**: one authoritative place, so changing behaviour is a one-place edit.

Check every line for **relevance**: does it still bear on what the skill does?

Then hunt **no-ops** sentence by sentence, not just line by line: run the no-op test on each sentence in isolation — does it change behaviour versus the default? — and when one fails, delete the whole sentence rather than trim words from it. Be aggressive; most failing prose should go, not be rewritten.

## Anti-Patterns

- Generic advice: "handle errors properly", "write clean code", "follow best practices".
- Long architecture history that does not change the next action.
- Many warnings without preferred alternatives.
- Equal-choice tool menus without a default.
- Broad root docs that apply to every task and no task.
- References with no load condition.
- Large examples that encourage copy-paste of irrelevant details.
- Trigger descriptions optimized for exact eval wording instead of intent categories.
