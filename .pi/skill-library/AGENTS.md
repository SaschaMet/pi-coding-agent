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

The whole point: the 24 skills here add **zero** tokens to a session that does not use them. Move a skill to `../skills/` only when you want it triggered without asking.

## How an agent uses a skill from here

1. The user names a skill ("use the refactoring-ui skill on this component").
2. Read `<skill-name>/SKILL.md` **first**, in full, before acting.
3. `SKILL.md` names the reference files to read for the task at hand. Read **only** those. The references are large on purpose — reading all of them defeats the point.
4. Relative links inside a skill (`[x](references/foo.md)`) resolve against **that skill's own folder**, not against this directory and not against the project.
5. Skills never write into this directory. Their artifacts go to the current project's `docs/` folder.

If a named skill is not in the index below, say so — do not improvise a replacement.

## Index

### Single ownership

Every topic below has exactly one owner. Non-owners cross-reference it in prose and do **not** restate
its rules — that discipline is what keeps two skills from contradicting each other. Consolidated
2026-09-11: four skills were retired into their owners (`redesign-skill` → `taste-skill` §11,
`soft-skill` → `top-design` Pillar 8, `design-everyday-things` → `ux-heuristics/references/norman-*`,
`inspect-skill` → `improve-skills` Validate).

| Topic | Owner |
| --- | --- |
| Marketing-page generation, redesigns, the anti-slop tells | `taste-skill` |
| Converting a design image into code | `image-to-code-skill` |
| Product/app UI visuals — dashboards, tables, forms, admin | `refactoring-ui` |
| Typeface evaluation, pairing, loading, licensing, subsetting | `web-typography` |
| Usability evaluation + Norman's affordance vocabulary | `ux-heuristics` |
| Single-control interaction design, loops, modes | `microinteractions` |
| Scroll narrative, signature moments, premium components, the "expensive" look | `top-design` |
| The editorial-minimal look | `minimalist-skill` |
| Cutting scope; ship / no-ship verdicts | `steve-jobs-design-review` |
| Stack detection and the design-token contract | `design-foundation` |
| Routing and conflict arbitration for design work | `design-taste` |
| The resumable conversion journey — diagnose, rank, ship as experiments | `improve-website` |
| Evidence, sample size, no-peeking, ICE, the 10x screen | `cro-methodology` |
| Persuasion principles **and the ethics/regulatory layer** | `influence-psychology` |
| Comprehension, memory, the Curse of Knowledge | `made-to-stick` |
| Page order, the protagonist, the wireframe, email sequences | `storybrand-messaging` |
| Interview hygiene, the commitment ladder | `mom-test` |
| Demand theory, forces, cross-category competition | `jobs-to-be-done` |
| Web performance and transport | `high-perf-browser` |
| Agent instruction quality, triggers, skill security scanning | `improve-skills` |
| Repo instruction topology (DOX tree) | `init-project` |
| Executable engineering standards, hooks, CI | `add-coding-standard` |
| Deliberately disposable code | `prototype` |
| Complete, untruncated output | `output-skill` |

Two cross-family boundaries worth stating once:

- **`improve-website` vs `design-taste`.** The first asks *why* visitors don't convert and produces documents; the second asks *what it should look like* and produces code. They chain in that order when both apply, never the reverse. Both files now carry this paragraph, because `AGENTS.md` is not in context when either is named directly.
- **`refactoring-ui` vs `taste-skill`.** Behind a login, `refactoring-ui`. Trying to sell something, `taste-skill`. Their values genuinely conflict — shadows, spacing, centered heroes, `grid-cols-3` — and that is a scope boundary, not a bug.


### Website improvement

Source: <https://github.com/wondelai/skills>, MIT, copied 2026-09-10 from the repository **root** directories.

Note for updates: the repo also has a `plugins/` directory. It is generated build output — `scripts/generate-plugins.sh` runs `rm -rf plugins` and rebuilds it by copying the root directories. Always re-copy from the **root**, never from `plugins/`.

| Skill                      | What it does                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `improve-website`          | Metaskill. Guided 8-phase journey turning an underperforming live site into a ranked, evidence-backed fix backlog. Orchestrates the skills below. |
| `cro-methodology`          | Audit pages for conversion issues; map funnels, build objection/counter-objection tables, design evidence-based A/B tests.                        |
| `ux-heuristics`            | Heuristic usability evaluation against Nielsen's 10 heuristics with 0-4 severity ratings; Trunk Test. **Also owns Norman's vocabulary** — affordances, signifiers, the two gulfs, Seven Stages, human error — in `references/norman-*.md`, absorbed from the retired `design-everyday-things`. |
| `refactoring-ui`           | Fix visual hierarchy, spacing scales, color systems, and depth in **product/app UI** — dashboards, tables, forms, admin. Grayscale-first workflow. Re-scoped 2026-09-11: its values are correct behind a login and wrong on a marketing page, where `taste-skill` rules. |
| `web-typography`           | Select and pair typefaces; fix size, measure, line height; modular scales and font-loading strategy.                                              |
| `storybrand-messaging`     | Clarify brand messaging with the SB7 narrative structure; one-liners and above-the-fold copy.                                                     |
| `high-perf-browser`        | Web performance via network protocols, resource loading, and rendering internals. Core Web Vitals.                                                |
| `made-to-stick`            | Make messages memorable using the SUCCESs checklist; beat the Curse of Knowledge.                                                                 |
| `influence-psychology`     | Cialdini's seven principles of ethical persuasion applied to copy, product, and sales, with explicit ethical limits.                              |
| `steve-jobs-design-review` | Brutal end-to-end design review: ruthless simplicity, focus, saying no, binary verdicts.                                                          |
| `microinteractions`        | Triggers, rules, feedback, loops, and modes — the small details of interaction design.                                                            |
| `top-design`               | Awwwards-level immersive web experiences: scroll animation, cinematic storytelling, premium component architecture. **Also the "expensive / premium / agency" overlay** for a `design-taste` run, absorbed from the retired `soft-skill`. |

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
| 8        | `ux-heuristics` + its `references/norman-*.md`                                        |                   |
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

Source: agent-skill-ecosystem skills, copied 2026-09-10.

| Skill                 | What it does                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init-project`        | Bootstraps a repo's agent-instruction layer in one pass: root `AGENTS.md` from `SYSTEM.md` plus repo state, DOX child `AGENTS.md` tree, `docs/Architecture.md`, wired-in coding standard. |
| `add-coding-standard` | Install or audit a profile-based engineering standard: formatter, linter, typing, tests, coverage, mutation testing, copy/paste detection, security checks, hooks, CI, AI guardrails.     |
| `improve-skills`      | Create, revise, audit, and optimize agent skills, `AGENTS.md` files, and agent-facing docs; tighten trigger behavior and reliability from traces and eval feedback. **Also owns security scanning** of third-party skills via `skillspector` in its Validate step, absorbed from the retired `inspect-skill`. |

`init-project` wires in `add-coding-standard` as a prose cross-reference (both installed).

### Prototyping

Source: agent-skill ecosystem, copied 2026-09-10.

| Skill       | What it does                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `prototype` | Throwaway code that answers a design, state-model, or UI question faster than arguing on paper. |

### Frontend design taste

Source: <https://github.com/Leonxlnx/taste-skill>, MIT, copied 2026-09-11 from the repository's **`skills/`** subdirectory.

Note for updates: the repo keeps its skills in `skills/<name>/`, **not** at the root — do not copy from the root, and ignore `.claude-plugin/`, `research/`, `assets/`, and `scripts/`. Two things must be re-applied after every re-copy:

1. **The `name` fix.** Every upstream `SKILL.md` ships a `name` that does not match its folder (e.g. folder `minimalist-skill`, `name: minimalist-ui`), which violates rule 1 below. Rewrite line 2 of each so `name` equals the folder name. **Only four of the six are still installed** — `taste-skill`, `image-to-code-skill`, `minimalist-skill`, `output-skill`. `redesign-skill` and `soft-skill` were retired on 2026-09-11 into `taste-skill` §11 and `top-design` Pillar 8; do not re-copy them, or the duplication and contradictions come back.
2. **The provided-image patch, `image-to-code-skill` only.** Upstream makes self-generated images mandatory, so a user-supplied screenshot or mockup cannot drive the build. The local patch adds Mode A without rewriting upstream's rules. Before overwriting, capture it: `cd ~/.pi/agent/skill-library && git diff --no-index` against a fresh upstream copy, or at minimum `grep -n 'LOCAL ADDITION\|Mode A\|Mode B only' image-to-code-skill/SKILL.md`. Re-apply in two parts:
   - **The block:** a rewritten `description`, and sections `0. MODE SELECTOR` plus `0.B PROVIDED-IMAGE MODE` (0.B.1 through 0.B.9) inserted before section 1. 0.B.5 is the load-bearing piece — a translation table that neutralizes every generate-first instruction later in the file.
   - **The inline gates**, because upstream repeats the generate-first mandate in a dozen places and the last one read wins: the CORE DIRECTIVE job statement and its "do not skip image generation" line, section 1 (`IMAGE_GENERATION_EAGERNESS` inert), section 2 (Mode B only), section 8 ("generate another image"), section 11 (Mode A overrides), section 21 (closer extraction image), section 24 (closer image), section 28 (steps 5-6), section 35 (Mode B only), section 36 (Mode B only), section 37 (Example 4), section 38 (goal restated for Mode A).

   An audit found the block alone was not enough — sections 35, 36, and 38 sit at the end of the file and overrode it on recency. Do not skip the inline gates.

**`image-to-code-skill` is no longer upstream-verbatim.** Beyond the Mode A patch it was de-duplicated on 2026-09-11: upstream restated its generate-enough-images rule in ten places and its taste rules in three closing sections, so sections 3, 4, 6, 7, 13, 15, 17, 18, 19, 29, 30, 31, 32, 35, 36, 37, 38 were collapsed in place (1532 to 1156 lines). **All 38 section headings were kept as anchors on purpose** — `0.B.6` routes sections by number and `0.B.7` names sections 14-17 and 29, so renumbering silently breaks the Mode A patch. A future upstream re-copy means redoing this, or deciding the local version is now the source of truth. `taste-skill`, `minimalist-skill`, and `output-skill` remain upstream-verbatim apart from the `name` fix.

| Skill                 | What it does                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-taste`        | Metaskill. Routes a design request to one workflow skill plus at most one aesthetic overlay, and keeps them from contradicting each other.          |
| `design-foundation`   | GATE before any design work. Detects the project's existing stack and adopts it; only when the project is empty does it help choose one, set the tokens, and write `docs/DESIGN-SYSTEM.md`. |
| `taste-skill`         | Default generator **and the redesign protocol**. Reads the brief, infers the design language, tunes VARIANCE / MOTION / DENSITY, ships landing pages and portfolios; its section 11 handles redesigns with SEO, IA, and analytics preservation. Absorbed the retired `redesign-skill`. |
| `image-to-code-skill` | Image-first, two modes: convert an image the user supplies into a web design, or generate the reference first when none is given and the runtime can. |
| `minimalist-skill`    | Aesthetic overlay: editorial monochrome, typographic contrast, flat bento grids, muted pastels, `<kbd>` and window-chrome components. No gradients, no heavy shadows. The "expensive" counterpart is `top-design`. |
| `output-skill`        | Cross-cutting: bans truncation, placeholder comments, and skeleton-instead-of-implementation. Loaded on every `design-taste` run.                   |

#### Orchestration map for `design-taste`

| Slot             | Skill                                                     |                                       |
| ---------------- | --------------------------------------------------------- | ------------------------------------- |
| step 0           | `design-foundation`                                       | GATE — no stack, none recorded, or two competing systems |
| workflow         | `taste-skill`                                             | new page from a brief, **or** a redesign (its section 11) |
| workflow         | `image-to-code-skill`                                     | a design image drives the build       |
| overlay          | `top-design` **or** `minimalist-skill`                    | only when the user names a look       |
| always           | `output-skill`                                            | never skipped                         |

Exactly one workflow skill — the two disagree on enough rules that loading both produces output failing one of them. Never two overlays: `top-design` demands depth and shadow, `minimalist-skill` bans them.

**Scope gate first, always.** The whole family covers landing pages, portfolios, marketing and product pages, editorial sites, and redesigns of those. It does **not** cover dashboards, data tables, or multi-step product UI — and "redesign" does not buy an exception. Route `design-taste` through its own Scope Gate before believing the table above; the verb never outranks the page kind.

**Tie-breaks against other clusters** — these overlap on keywords and nothing else resolves them:

| Request | Route | Not |
|---|---|---|
| "Awwwards-level", immersive scroll storytelling, or "make it expensive" | `top-design` — standalone for a whole-site build, or loaded as the overlay inside a `design-taste` run | Two separate skills; since `soft-skill` was retired into it, one file serves both cases |
| "The site underperforms / doesn't convert" — wants evidence, then a ranked backlog | `improve-website` | `design-taste`, which writes code without seeking evidence |
| "The site looks generic / cheap" — wants the code-level visual fixed now | `design-taste` | `improve-website`, which starts with CRO research |

The word "Awwwards" alone decides nothing — scope does. One page is an overlay; a whole site with scroll choreography is `top-design`. If the phrasing does not settle it, ask.

The last row routes to `design-taste`, not to a workflow skill: which workflow skill runs is decided by the tie-breakers in `design-taste/SKILL.md`, which outrank this table. "Looks generic" says nothing about whether there is a codebase to work in.

Rule of thumb: `improve-website` asks *why* visitors don't convert and produces documents; `design-taste` asks *what it should look like* and produces code. They chain in that order when both apply — diagnose first, then hand the ranked visual findings to `design-taste`.

Two caveats live in `design-taste/SKILL.md` and are repeated here because they decide whether a run is viable: `image-to-code-skill` runs in Mode A (the user supplies the image) or Mode B (it generates one, which needs an image-gen MCP in this runtime) — with neither, fall back to `taste-skill` and a written brief rather than inventing a reference; and `taste-skill` and `image-to-code-skill` are ~1200 lines each, deliberately **not** split into references so upstream re-copies stay near-merge-free. Load them only when the route selects them.

**An attached image routes to `image-to-code-skill`, Mode A.** It is the strongest routing signal in the family — stronger than any inferred direction. Do not send it to `taste-skill` and describe the image back in prose.

**The project's existing stack always wins.** Every skill in this cluster detects the project's stack and adopts it — never migrates it, never adds a second styling system or component library beside it. `taste-skill` ships an opinionated stack section (React/Next, Tailwind v4, Motion, Phosphor-class icons); that is a **greenfield recommendation, not this family's default**. Where it disagrees with what the project already uses, the project wins. With no stack at all, `design-foundation` establishes one with the user first. If the user explicitly asks for a different stack than the project uses, that is their call — name the cost of two systems in one tree, then honor it and record why.

**A direct invocation of a workflow skill does not escape the gate.** `taste-skill` and `image-to-code-skill` are named directly often, and none of them contains the Foundation Gate — it lives in `design-taste`. So when one of them is invoked by name for design work, read `design-taste`'s Foundation Gate and Stack Rule first anyway: detect the stack, read `docs/DESIGN-SYSTEM.md` if it exists, and route to `design-foundation` when the project has nothing, nothing recorded, or two competing systems. It is a few hundred words against the cost of a page built on invented values. This is the family's known weak point: the gate is only as strong as this paragraph.

`design-foundation` is sourced differently from the rest of this cluster: written locally, MIT, 2026-09-11. Its shadcn/ui path credits <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill> (MIT) in prose; nothing is vendored from it, so there is nothing to re-copy on update.

Like everything here, `design-taste` never fires on its own — name it, or reach it through the `use-skill-library` router. It is called `design-taste`, not `design`, because an auto-loaded `design` skill (the Claude Design canvas) already owns that word; "use the design skill" is ambiguous, "use design-taste" is not.

These skills write nothing to this directory — their output is code in the current project.

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
