---
name: design-foundation
description: Use this skill before any visual design or UI work to settle what the project designs with. Three cases trigger it - the project has no styling foundation at all (no component library, no Tailwind or CSS token setup), or it has a stack but nothing written down, or its styling has drifted into several competing systems (Tailwind next to styled-components, two spacing scales, three icon sets). It detects what the project already uses and adopts it, writes the decisions into docs/DESIGN-SYSTEM.md plus tokens in the stack's own format, and only when the project is genuinely empty does it help the user pick a stack and establish the token set. Do not use it to redesign an existing UI, to pick an aesthetic direction, or when the stack is already established and recorded in docs/DESIGN-SYSTEM.md - the foundation already exists then.
license: MIT
metadata:
  shadcn_path_source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
---

# Design Foundation

Establishes what a project designs *with*, before anyone designs anything. Output is a written
contract plus a working token set, so later runs build instead of re-deciding.

## Core Principle

**Detect before you propose. Propose before you write.** Most projects already have a stack; the
common failure is an agent introducing a second one beside it. An empty project is the only case
where a choice is yours to offer, and even then the user picks.

## Why this is a gate

Design decisions compound. A type scale chosen in session one shapes every component after it. If
each session re-decides, the project accumulates three spacing scales, two icon sets, and a palette
nobody can name — and every later "make it look better" fights the last one. Decide once, write it
down, build against it.

## Step 1 — Detect

Read, do not ask:

| Probe | Tells you |
|---|---|
| `package.json` + lockfile | Framework, component library, styling deps, animation library, icon packages |
| `Gemfile`, `composer.json`, `requirements.txt`, `go.mod` | **A project with no `package.json` still has a stack.** Rails, Laravel, Django, Hugo, WordPress — reading these as "nothing exists" and offering to pick a stack is this skill's worst failure mode |
| `*.blade.php`, `*.erb`, `templates/`, `_layouts/`, `*.twig` | Server-rendered templates, and usually Bootstrap or hand-rolled CSS in them |
| `tailwind.config.*`, or a CSS `@theme` block | Tailwind, and which major version — v4 is CSS-first, v3 is the JS config |
| `postcss.config.*`, `vite.config.*` | How styling is wired |
| `**/*.css`, `**/*.scss`, `:root {` blocks | Existing custom properties — often the real token set |
| Component imports across `src/` or `app/` | What is actually used, which can differ from what is installed |
| `docs/DESIGN-SYSTEM.md` | A foundation already recorded — this is the only file that satisfies the gate |
| `docs/DESIGN.md`, `docs/brand-guidelines.md` | Useful **context**, not a foundation. `DESIGN.md` is usually `improve-website`'s findings file and carries no stack, no Tailwind version, no breakpoints, and no contrast verification; a brand guideline supplies color and type but not the token wiring. Read them, then still write `DESIGN-SYSTEM.md` |

Then branch:

- **A stack exists and is recorded** → the gate is already satisfied. Say what you found and stop. Do not re-establish it.
- **A stack exists but is unrecorded** → skip step 2. Go to step 3 and document what is there, filling only the genuine gaps. You are writing down decisions already made, not making new ones.
- **Several competing systems exist** → do not pick silently. Report what you found, name which is dominant, and ask which one survives. Consolidation is the user's call. Measure dominance by how the code actually uses each system, not by what is installed: count `className=` utility occurrences for Tailwind, tagged-template definitions for styled-components or Emotion, imported components per library, `.module.css` files for CSS Modules. Say the counts; they make the answer obvious to the user.
- **Nothing exists** → step 2. Only conclude this after the non-JS probes above come back empty too.

Also record, because it changes every later step: **which Tailwind major version.** A `tailwind.config.js`
means v3, a CSS `@theme` block means v4. Writing a v4 `@theme` block into a v3 project produces exactly
nothing, silently — and the reverse leaves a config file v4 does not read. Whatever you write in step 4
must match the version you found here.

Done when the project's current state is stated in three lines or fewer, with the branch named.

## Step 2 — Choose (empty project only)

Ask the framework first — it is upstream of every styling choice, and nothing earlier established it:
React/Next, Vue/Nuxt, Svelte, Astro, a server-rendered template stack, or plain HTML with no build
step. Then present the styling options that fit that answer, with a recommendation, and let the user
pick. **Never auto-select, and there is no house default** — the right answer depends on what is
being built.

| Option | Recommend it when | Cost |
|---|---|---|
| **Tailwind only** | Marketing sites, landing pages, portfolios — anything where components are bespoke and few. **This is the usual fit for the work `design-taste` routes**, so it is the usual recommendation here. | You build every component, including its accessible behavior |
| **shadcn/ui + Tailwind** | A React or Next app that needs real interactive components soon — dialogs, menus, forms. Accessible Radix primitives, copied into the repo so they stay editable. | Tailwind in the markup, plus a components directory you now own and maintain |
| **CSS custom properties, no framework** | Small or embedded surfaces, strict bundle limits, a non-JS template stack, or a team that prefers plain CSS | No utilities, no component library; the most to write by hand |

If the framework answer is not React, the shadcn row is out — say so rather than bending it. For Vue,
Svelte, or Astro, the honest options are Tailwind-only or plain CSS, plus that ecosystem's own
component library if the user names one.

Then ask two more, because they change the setup rather than the choice:

1. Is there an existing brand — colors, fonts, a logo — or are we defining one?
2. Does this need dark mode? Deciding later doubles the palette.

**Scaffold before you write tokens.** Steps 4 and 5 assume a project that builds. If there is none —
the empty-directory case that got you here — create it first with the ecosystem's own tool
(`npm create vite`, `npx create-next-app`, `npx shadcn@latest init`, or the framework's equivalent),
install the styling dependencies, and confirm the dev server starts. Tokens written into a project
that cannot build are unverifiable.

For the shadcn path, the setup steps and component conventions in the `ui-ux-pro-max-skill` repo
(MIT, `nextlevelbuilder`) are a useful reference; its `ui-styling` skill covers `shadcn@latest init`,
theming, and accessibility patterns in depth.

Done when the framework and styling choice are both stated, the two questions are answered, and the
project builds.

## Step 3 — Establish the tokens

Decide these before any component exists. Every one gets a value and a reason.

| Token group | Decide |
|---|---|
| **Color** | Background, foreground, muted, border, and one accent — each with a dark-mode counterpart if dark mode is in scope. Check every text-on-background pair against WCAG AA now, not later: **4.5:1 for body text, 3:1 for large text (18.66px bold or 24px) and for UI borders and icons.** Compute the contrast ratio rather than eyeballing it — a two-line script or a contrast checker, either is fine; an unverified "looks fine" is not. |
| **Dark mode mechanism** | Not just the values — *how it switches.* Tailwind v4 uses a custom variant against a `data-theme` or `.dark` selector; v3 uses `darkMode: 'class'` or `'media'`; plain CSS uses `prefers-color-scheme` plus an override attribute. Pick one and write it down, because half of dark-mode bugs are two mechanisms fighting. |
| **Breakpoints** | The widths at which layout changes, and the `< 768px` collapse rule for multi-column sections. Every page in this family's scope needs these, and a design with no stated breakpoints gets them invented per-component. |
| **Type** | One or two families with real fallback stacks, and a scale as explicit steps, not "whatever looks right". State the ratio. |
| **Spacing** | One scale, one base unit. Everything else is a multiple. |
| **Radius** | Two or three values maximum. A project with seven radii has none. |
| **Shadow** | Two or three levels, or an explicit none. |
| **Motion** | Two durations and one easing curve, plus the `prefers-reduced-motion` fallback. |

Rules: no value without a token, no token without a name, and no name invented twice. If the project
has a brand, the brand supplies color and type — you are recording, not designing.

Done when every group above has a value, a name, and contrast verified.

## Step 4 — Write the contract

Two artifacts, both in the **current project**, never in this library. If the working directory *is*
this library — or any path under `~/.pi/agent/` — stop and ask which project this is for. Writing a
design system into the skill library is the one output this skill must never produce.

1. **`docs/DESIGN-SYSTEM.md`** — the human-and-agent contract: the stack and its version, each token group with values and the reasoning, the component conventions (where components live, how variants are named), and what is deliberately *not* decided yet.
2. **The machine-readable tokens, in the detected or chosen stack's own format** — a Tailwind v4 `@theme` block, a v3 `tailwind.config` theme extension, a `:root` custom-property block, or the component library's theme object (`createTheme` for MUI, and the equivalent elsewhere). Match the version you recorded in step 1. One source of truth: do not also emit a parallel JSON token file, because two sources drift and neither wins.

Read before writing. If either file exists, extend it — add your sections, preserve everyone else's.

**Then make it discoverable.** Add one line referencing `docs/DESIGN-SYSTEM.md` to the repo's
`AGENTS.md` (or `CLAUDE.md`) — in the `## Work Guidance` section if the file uses the DOX six-section
shape. A contract no agent finds is a contract that gets re-derived: the engineering standard and the
architecture doc are both wired into agent discovery this way, and the design system should be too.

**Note on `docs/DESIGN.md`.** If the project has one, it is probably from `improve-website` and holds
*findings and direction* — audit results, UX issues, design rationale. It is not a token store and
does not satisfy this gate: it carries no stack, no Tailwind version, no breakpoints, no contrast
verification. Read it for context, record tokens here.

Done when both artifacts exist and the tokens in the code match the values in the document.

## Step 5 — Prove it

Build one small real component using only the tokens — a button with its variants and states, or a
card. Then actually look at it: start the project's dev server and open it in whatever preview or
browser tooling the runtime offers. It proves three things at once: the tokens compile, the scale
looks right at real size, and the conventions are usable. A `@theme` block that silently does nothing
— the v3/v4 mismatch from step 1 — is caught here and nowhere else.

If the runtime cannot render, say so and fall back to building or typechecking the component, which
still catches a token that does not resolve.

Done when it renders and uses no hard-coded color, size, or spacing value.

## Completion Criterion

A different agent, in a later session with none of this context, can read `docs/DESIGN-SYSTEM.md` and
build a new page that looks like it belongs — without asking a single question this skill already
answered. If they would still have to guess at the type scale or the accent color, the foundation is
not done.

## Hand-off

With the foundation in place, visual design work proceeds: `design-taste` routes it, and every
workflow skill under it builds against these tokens rather than inventing values. Point later runs at
`docs/DESIGN-SYSTEM.md` instead of re-deriving the system.

## Anti-Patterns

- **Proposing a stack before reading `package.json`.** The single most common failure, and it produces a project with two styling systems.
- **Adding Tailwind to a Material UI project** because the reference image looks like Tailwind. The project wins, always.
- **Writing tokens nobody uses.** A token file plus hard-coded hexes in the components is worse than no token file — it looks decided and is not.
- **Deciding dark mode later.** It doubles the palette. Decide in step 2 or explicitly defer it in writing.
- **A 12-step type scale for a 3-page site.** Decide what the project needs, not what a design system template contains.
- **Writing into this library.** Artifacts go to the project's `docs/`.
