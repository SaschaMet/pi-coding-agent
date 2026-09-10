# Skill Library

Manual, on-demand skill store. Skills here are **not** auto-discovered and cost nothing until named.

## What this is

- A parking spot for skills used rarely — too valuable to delete, too seldom needed to auto-load.
- Every subdirectory is a self-contained skill: `SKILL.md` plus a `references/` folder.
- Nothing here is registered, symlinked, or indexed by any agent runtime.

## How this differs from `../skills/`

|                                        | `../skills/`             | this directory |
| -------------------------------------- | ------------------------ | -------------- |
| Symlinked into `~/.claude/skills/`     | yes                      | no             |
| Auto-discovered by the agent           | yes                      | no             |
| Description in every session's context | yes                      | no             |
| Invoked by                             | the agent, automatically | you, by name   |

The whole point: the 22 skills here add **zero** tokens to a session that does not use them. Move a skill to `../skills/` only when you want it triggered without asking.

## How an agent uses a skill from here

1. The user names a skill ("use the refactoring-ui skill on this component").
2. Read `<skill-name>/SKILL.md` **first**, in full, before acting.
3. `SKILL.md` names the reference files to read for the task at hand. Read **only** those. The references are large on purpose — reading all of them defeats the point.
4. Relative links inside a skill (`[x](references/foo.md)`) resolve against **that skill's own folder**, not against this directory and not against the project.
5. Skills never write into this directory. Their artifacts go to the current project's `docs/` folder.

If a named skill is not in the index below, say so — do not improvise a replacement.

## Index

### Website improvement

Source: <https://github.com/wondelai/skills>, MIT, copied 2026-09-10 from the repository **root** directories.

Note for updates: the repo also has a `plugins/` directory. It is generated build output — `scripts/generate-plugins.sh` runs `rm -rf plugins` and rebuilds it by copying the root directories. Always re-copy from the **root**, never from `plugins/`.

| Skill                      | What it does                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `improve-website`          | Metaskill. Guided 8-phase journey turning an underperforming live site into a ranked, evidence-backed fix backlog. Orchestrates the skills below. |
| `cro-methodology`          | Audit pages for conversion issues; map funnels, build objection/counter-objection tables, design evidence-based A/B tests.                        |
| `ux-heuristics`            | Heuristic usability evaluation against Nielsen's 10 heuristics with 0-4 severity ratings; Trunk Test.                                             |
| `refactoring-ui`           | Fix visual hierarchy, spacing scales, color systems, and depth in web UIs. Grayscale-first workflow.                                              |
| `web-typography`           | Select and pair typefaces; fix size, measure, line height; modular scales and font-loading strategy.                                              |
| `storybrand-messaging`     | Clarify brand messaging with the SB7 narrative structure; one-liners and above-the-fold copy.                                                     |
| `high-perf-browser`        | Web performance via network protocols, resource loading, and rendering internals. Core Web Vitals.                                                |
| `made-to-stick`            | Make messages memorable using the SUCCESs checklist; beat the Curse of Knowledge.                                                                 |
| `design-everyday-things`   | Norman's principles — affordances, signifiers, constraints, feedback; design errors out instead of warning about them.                            |
| `influence-psychology`     | Cialdini's seven principles of ethical persuasion applied to copy, product, and sales, with explicit ethical limits.                              |
| `steve-jobs-design-review` | Brutal end-to-end design review: ruthless simplicity, focus, saying no, binary verdicts.                                                          |
| `microinteractions`        | Triggers, rules, feedback, loops, and modes — the small details of interaction design.                                                            |
| `top-design`               | Awwwards-level immersive web experiences: scroll animation, cinematic storytelling.                                                               |

#### Orchestration map for `improve-website`

All of these resolve inside this directory, so no phase falls back to its condensed "Brief".

| Phase    | Skill                                                                                 |                   |
| -------- | ------------------------------------------------------------------------------------- | ----------------- |
| 1        | `cro-methodology`                                                                     | GATE — never skip |
| 2        | `ux-heuristics`                                                                       |                   |
| 3        | `refactoring-ui`                                                                      |                   |
| 4        | `web-typography`                                                                      |                   |
| 5        | `storybrand-messaging`                                                                |                   |
| 6        | `high-perf-browser`                                                                   |                   |
| 7        | `made-to-stick`                                                                       |                   |
| 8        | `design-everyday-things`                                                              |                   |
| optional | `influence-psychology`, `microinteractions`, `top-design`, `steve-jobs-design-review` |                   |

`improve-website` writes to the **current project's** `docs/` folder: `IMPROVE-WEBSITE-PLAN.md` (tracker), `WEBSITE.md`, `DESIGN.md`, `POSITIONING.md`, `METRICS.md`, `EXPERIMENTS.md`.

### Customer discovery

Source: <https://github.com/wondelai/skills>, MIT, copied 2026-09-10.

| Skill             | What it does                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mom-test`        | Run customer interviews without leading the witness: talk about their life not your idea, ask about specifics in the past, seek commitment over compliments. |
| `jobs-to-be-done` | Find the "job" a customer hires the product to do; analyze switching behavior, functional vs emotional jobs, and jobs-oriented roadmaps.                     |

`mom-test` and `jobs-to-be-done` are standalone customer-discovery skills — no metaskill here orchestrates them, and they orchestrate nothing. They cross-reference each other in prose (both installed) and mention `design-sprint` and `obviously-awesome`, which are **not** installed.

### Agent infrastructure

Source: mixed, copied 2026-09-10 — `inspect-skill` wraps [nvidia/skillspector](https://github.com/nvidia/skillspector); the rest are agent-skill-ecosystem skills.

| Skill                 | What it does                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init-project`        | Bootstraps a repo's agent-instruction layer in one pass: root `AGENTS.md` from `SYSTEM.md` plus repo state, DOX child `AGENTS.md` tree, `docs/Architecture.md`, wired-in coding standard. |
| `add-coding-standard` | Install or audit a profile-based engineering standard: formatter, linter, typing, tests, coverage, mutation testing, copy/paste detection, security checks, hooks, CI, AI guardrails.     |
| `improve-skills`      | Create, revise, audit, and optimize agent skills, `AGENTS.md` files, and agent-facing docs; tighten trigger behavior and reliability from traces and eval feedback.                       |
| `inspect-skill`       | Security scanner for AI agent skills (wraps nvidia/skillspector): detect vulnerabilities and malicious patterns before install.                                                           |

`init-project` wires in `add-coding-standard` as a prose cross-reference (both installed).

### Prototyping

Source: agent-skill ecosystem, copied 2026-09-10.

| Skill       | What it does                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `prototype` | Throwaway code that answers a design, state-model, or UI question faster than arguing on paper. |

## Adding a new skill

Required shape:

```
skill-library/
└── <skill-name>/
    ├── SKILL.md          # required
    └── references/       # optional
        └── *.md
```

The shape above is the minimum, not the ceiling — skills may bundle `scripts/`, `agents/`, `templates/`, or other folders as long as they stay self-contained (rule 2).

Required frontmatter in `SKILL.md`:

```yaml
---
name: <skill-name>
description: <what it does + when to use it>
---
```

Rules:

1. **`name` must equal the folder name.** A mismatch breaks every lookup.
2. **Keep it self-contained.** All internal links relative (`references/foo.md`). No absolute paths, no links into sibling skills, no links outside the folder.
3. **Cross-skill mentions stay prose.** Writing "for usability, see ux-heuristics" is fine. Linking to `../ux-heuristics/SKILL.md` is not — it breaks when either skill moves.
4. **No secrets, no credentials.** These files are read into model context.
5. **Add a row to the relevant cluster table in the index above.** A skill absent from the index is invisible.
6. **Run the link check** (below) before considering it installed.

### Link check

Verifies every relative Markdown link resolves to a file that exists:

```bash
cd ~/.pi/agent/skill-library && find . -name '*.md' -not -name 'AGENTS.md' | while read -r f; do grep -oE '\]\([^)#][^)]*\)' "$f" | sed 's/^](//;s/)$//' | grep -vE '^https?://|^#|^mailto:' | while read -r l; do [ -e "$(dirname "$f")/$l" ] || echo "DANGLING: $f -> $l"; done; done; echo "link check done"
```

Silent output except the final line means clean. This file is excluded on purpose — it contains example links that are not meant to resolve.

### Updating a skill from its upstream repo

```bash
git clone --depth 1 <repo-url> /tmp/skill-src && cp -R /tmp/skill-src/<skill-name> ~/.pi/agent/skill-library/<skill-name> && rm -rf /tmp/skill-src
```

Then re-run the link check.

## Promoting a skill to auto-loaded

Makes the agent trigger it without being asked. Cost: its full `description` joins **every** session's context from then on.

```bash
ln -s ~/.pi/agent/skill-library/<skill-name> ~/.claude/skills/<skill-name>
```

Note the asymmetry with `../skills/`: those live in `../skills/` and are symlinked into `~/.claude/skills/`. A promoted library skill stays here and is symlinked from here. Either works.

To demote, delete the symlink only — never the target:

```bash
rm ~/.claude/skills/<skill-name>
```

## Removing a skill

1. `rm ~/.claude/skills/<skill-name>` if a symlink exists (check with `ls -la ~/.claude/skills`).
2. `rm -rf ~/.pi/agent/skill-library/<skill-name>`.
3. Delete its row from the index above.
4. If `improve-website` listed it as a phase, that phase falls back to its built-in "Brief" — degraded, not broken.
