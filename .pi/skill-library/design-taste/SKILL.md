---
name: design-taste
description: Use this skill when the user wants frontend visual design that does not look AI-generated - a landing page, portfolio, marketing or product page, an editorial site, a redesign of one of those pages, or a named aesthetic direction ("make it look expensive", "Linear-style", "minimalist", "editorial"). Routes to one workflow skill and at most one aesthetic overlay from the taste-skill family, and always enforces complete output. Do not use for dashboards, data tables, admin panels, or multi-step product UI - not even to redesign one; those need a different method. Do not use for pure copywriting, SEO, or conversion research.
license: MIT
metadata:
  source: https://github.com/Leonxlnx/taste-skill
  copied: 2026-09-11
---

# Design Taste

Index skill for the taste-skill family. Its only job: pick the right sub-skills, load them, and keep
them from fighting each other. It carries no design rules of its own — the sub-skills do.

## Core Principle

**One workflow skill, at most one aesthetic overlay, output enforcement always.** Loading two
aesthetic skills at once produces mush: their banned-element lists and font rules contradict.

**And: the project's existing stack always wins.** See the Stack Rule below.

## Scope Gate

Run this before anything else. `taste-skill` and its family cover landing pages, portfolios,
marketing and product pages, editorial sites, and redesigns of those. They explicitly do **not**
cover dashboards, data tables, or multi-step product UI. If the request is one of those, say so and
stop — do not stretch these skills to fit.

The gate outranks the routing table. "Redesign our onboarding wizard" is a redesign *and* out of
scope: the page kind decides, not the verb. Say what is out of scope and why, then offer the nearest
fit instead of improvising: `refactoring-ui` for the visual design of product UI (dashboards, forms,
tables — it owns those values and they differ from this family's), `ux-heuristics` for usability
problems and Norman's affordance vocabulary, `microinteractions` for single-control interaction
details. Those are separate skills in this library, not part of this family.

**One more thing this family does not do: find out whether the page is the problem.** If the user is
asking *why* visitors don't convert — "we get traffic but nobody signs up", "why do they leave",
"which fix moves the most money" — that is `improve-website`: a resumable journey that starts with a
conversion diagnosis, produces evidence, and ranks fixes as pre-committed experiments in `docs/`.
This family starts writing code, which on an unaddressed objection produces a prettier page that
converts identically.

The split, and it only chains in one direction:

| The user wants | Route |
|---|---|
| To know why it underperforms, with evidence | `improve-website` |
| The visual fixed now — "looks generic", "make it expensive", "build this screenshot" | **here** |
| Both | `improve-website` first, then bring its ranked visual findings back here to implement |

Done when the request is confirmed in scope, or the user has been told it is not.

## Foundation Gate — before the routing table, not after

Nothing below this section may write code until this gate is answered **out loud, in one sentence**.
A gate satisfied silently is a gate that did not run.

1. **Read, do not assume.** Probe the project for an existing stack (the Stack Rule below lists the
   probes), and check for `docs/DESIGN-SYSTEM.md`.
2. **If `docs/DESIGN-SYSTEM.md` exists, read it now, in full.** Checking that the file exists and
   then not opening it is the most expensive mistake available here: the contract names the stack,
   tokens, and conventions this page must match, and re-deriving them produces a page that does not
   belong. Build against what it says.
3. Branch:

| Project state | Action |
|---|---|
| Stack exists **and** is recorded in `docs/DESIGN-SYSTEM.md` | Gate satisfied. Say the stack and the token source, then proceed. |
| Stack exists, **nothing recorded** | Run `design-foundation` in document-only mode — it writes down what is already there and fills only genuine gaps. It decides nothing that the code already decided. This is the most common real repo state; do not skip it because "a stack exists." |
| **Several competing systems** — e.g. Tailwind and styled-components both present | Run `design-foundation`. Its competing-systems branch reports both, names the dominant one, and asks the user which survives. Never pick silently, never add a third. |
| **Nothing exists** — no stack, no tokens, no records | Run `design-foundation` in full. There is nothing to design *into* yet. |

The gate is deferrable only if the user, asked directly, chooses to proceed without it — and then say
what that costs: every later decision compounds on values nobody wrote down.

Done when the project state is stated in a sentence and the branch is named.

## Routing Table

Pick exactly one workflow skill:

| Workflow skill | Use when | Cost |
|---|---|---|
| `taste-skill` | Default, and the only choice for a page built from a brief rather than an image. Covers **both** modes: a new page, and a redesign of an existing one — its section 11 is the redesign protocol (mode detection, audit-before-touching, preservation rules, SEO and analytics safety, the targeted-evolution vs full-redesign decision). Also the right pick for adding a section to an existing page. | ~87 KB / 1200 lines |
| `image-to-code-skill` | A design image drives the build. **Mode A:** the user supplies the image — screenshot, mockup, Figma export, moodboard — and it is converted into a web design. **Mode B:** no image supplied and the runtime can generate one, so it generates the reference first. Either way: deep analysis, extraction, then implementation to match. | ~40 KB / 1500 lines |

Then, only if the user named a look, add one overlay:

| Overlay skill | Use when the user asks for |
|---|---|
| `top-design` | "expensive", "premium", "agency", "Awwwards", "Apple-like", depth, cinematic motion, scroll storytelling, haptic feel. Also usable standalone for a whole-site immersive build — as an overlay, its Pillar 8 (premium component architecture) and motion rules are the parts that matter. |
| `minimalist-skill` | "minimal", "clean", "editorial", "Notion-like", "Linear-like", monochrome, flat, bento |

**Comparatives are complaints, not directions.** "Cleaner", "more minimal", "less busy" match the
`minimalist-skill` trigger words *and* the complaint rule below, and the complaint rule wins: a
comparative says the current state is wrong, not that editorial monochrome is wanted. Ask one line.
"Make it minimal" is a direction; "make it cleaner" is a symptom.

Always add:

| Always-on skill | Why |
|---|---|
| `output-skill` | Bans `// ...`, `// TODO`, "rest follows the same pattern", and skeleton-instead-of-implementation. Design work is long-file work; truncation is the common failure. |

### Workflow tie-breakers

The common phrasings do not map cleanly. Resolve them with these, in order:

| Signal | Route | Why |
|---|---|---|
| A page named with "the" or "our" — "the homepage", "our pricing page" | Ask: work in the existing code, or build the page fresh? | The definite article implies a page that already exists but does not say whether the code is in play. Asking costs one line; guessing costs a wrong 87 KB load. |
| The existing page is in the current repo and the user wants it fixed | `taste-skill`, "Redesign - Preserve" mode | Its section 11 detects the mode, audits before touching, and holds slugs, anchor IDs, nav labels, form field names, and analytics events stable. |
| The page exists but the user wants it replaced, or there is no repo to work in | `taste-skill`, new-page mode | Nothing to preserve; this is a page from a brief. |
| "Don't make it look AI-generated", "not like every other site", "anti-slop" | Not a redesign signal | It is a quality bar on any output. `taste-skill` is built around it; it does not mean an existing page is involved. |
| Existing codebase **and** a reference image | Ask which wins | `taste-skill` (redesign mode) and `image-to-code-skill` both claim the run. Never load both — they disagree on enough rules that loading both produces output failing one of them. |
| The user attaches or points at an image — screenshot, mockup, Figma export, "build this" | `image-to-code-skill`, Mode A | The strongest signal there is. An image beats every inferred direction; do not route it to `taste-skill` and describe the image back in prose. |

## Stack Rule

**The project decides the stack. Not this skill, not the image, not your preference.** Run this
before any workflow skill writes code.

1. **Detect.** The probe list lives in `design-foundation` step 1 and is maintained there — one copy,
   so it cannot rot in two places. Read it from there. The short version, for a quick check:
   `package.json` plus lockfile, `tailwind.config.*` or a CSS `@theme` block, existing custom
   properties, component-library imports. **The one thing worth repeating here: no `package.json`
   does not mean no stack.** A Rails, Laravel, Django, or Hugo site with Bootstrap has a stack;
   reading it as empty and offering to pick one is the exact failure this rule exists to prevent.
2. **Adopt.** A stack that exists wins outright. Say what you found and build in it. Never migrate
   it, never add a second styling system, never introduce a component library next to an existing
   one. A project on MUI gets MUI. A project on Bootstrap gets Bootstrap. This holds regardless of
   what the reference image looks like, what is fashionable, what the overlay skill prefers, and what
   you would choose on a blank page. If the existing system is unnamed in this library — Bulma,
   Chakra, Mantine, Ant, Vuetify, CSS Modules, Sass, vanilla-extract, Panda — adopt it anyway; read
   how the project already uses it and follow that.
3. **Recommend only when the project is genuinely empty.** Then there is nothing to build *into*. Run
   `design-foundation` first; the design run resumes once `docs/DESIGN-SYSTEM.md` exists.

**When the user asks for a different stack than the project uses**, that is theirs to decide, not
yours to refuse — but do not do it silently. Say in one line what it costs: two styling systems in one
tree, two sources of truth for tokens, and every future component having to choose. Offer the
alternative of building it in the existing system. If they confirm, proceed and record the decision
and its reason in `docs/DESIGN-SYSTEM.md`. What is forbidden is introducing the second system on your
own initiative, not honoring an explicit instruction.

**When there is no user to ask** — a subagent run, a non-interactive invocation — do not stall and do
not guess silently. Adopt the detected stack, take the safest branch, and state every assumption you
made in the output so the caller can correct it. An unanswerable question becomes a stated assumption,
never a silent one.

Done when the stack is named out loud, sourced as detected, chosen, or user-overridden.

`taste-skill` carries an opinionated stack section (React/Next, Tailwind v4, Motion, Phosphor-class
icons, one design system per project). Treat it as a **greenfield recommendation, not this family's
default.** Where it disagrees with what the project already uses, the project wins.

Done when the stack is named out loud, sourced as detected or chosen.

## Workflow

0. **Gate the foundation.** Apply the Foundation Gate above, including reading
   `docs/DESIGN-SYSTEM.md` when it exists. Done when the project state is stated in a sentence and
   the branch is named — in the announcement at step 4 at the latest, never only in your head.
1. **Gate the scope.** Apply the Scope Gate above. Done when in-scope or stopped.
2. **Pick the workflow skill.** Use the Routing Table. If the signals are split — e.g. an existing
   site *and* a reference image — ask the user which one wins; do not load both. Done when exactly
   one is chosen.
3. **Decide the overlay.** Only when the user named the look they *want*. A complaint about the
   current look — "looks cheap", "too generic", "boring" — names what they are escaping, not where
   they are going; do not infer the overlay from its opposite. Instead offer the two directions in
   one line ("expensive and cinematic, or minimal and editorial?") and let them pick. No look named
   and no answer → no overlay; `taste-skill` infers the direction itself, and an overlay would
   replace that inference with a fixed aesthetic. Done when the choice is made and stated.
4. **Announce before loading.** In two or three lines: the project's stack and where its tokens come
   from, the skills chosen, and why. The user can correct the route before the context is spent.
   Done when announced — this is where step 0 and the Stack Rule become audible.
5. **Load and run.** Read each chosen `SKILL.md` in full, in this order: workflow skill, overlay,
   `output-skill`. The workflow skill drives; the overlay constrains its palette, type, and motion
   choices; `output-skill` governs how the code is emitted. Done when the deliverable exists.
6. **Check against the loaded rules.** Each sub-skill carries its own pre-flight or banned-element
   list. Run it before presenting. Done when every list the run loaded has been checked.
7. **Verify the delivered page, not just the rules.** Build or typecheck it, render it, and look at
   it at desktop and at `< 768px`. Check text and interactive contrast against WCAG AA. Confirm every
   color, size, and spacing value resolves to a token rather than a literal. Done when it renders and
   the three checks pass, or when you have said which one you could not run and why.

**Never fabricate content to fill a layout.** Customer testimonials, company logos, prices, user
counts, review scores, and performance claims are facts about the user's business — ask for them, or
leave a labeled placeholder (`<!-- TODO: 3 testimonials, ~30 words each -->`). Inventing a named
quote from a fictional company, or a price nobody approved, puts a falsehood into something the user
may ship. Placeholder *slots* are fine and should be clearly marked (`<!-- TODO: headline, ~45 chars -->`).
Lorem ipsum itself is not: `taste-skill` bans it outright, along with "John Doe" and "Acme Corp", and
that ban holds — write real draft copy, or leave a labeled empty slot. Latin filler also hides real
problems with line length and rhythm, so it fails as a layout test too.

## Conflict Rules

- **Overlay never overrides the brief.** If the user said "minimal" and `taste-skill`'s brief
  inference also lands on minimal, the overlay is redundant — skip it and save the context.
- **Two overlays never load together.** `top-design` demands depth, shadow, and cinematic motion;
  `minimalist-skill` bans shadows, gradients, and large pill shapes. Pick one, name the trade-off.
- **`taste-skill` in redesign mode plus an overlay is legal** — section 11 finds the problems, the
  overlay decides what the fixed version looks like. Two known frictions when that overlay is
  `minimalist-skill`: it *wants* pill-shaped status badges and a stripped accordion FAQ, both of which
  `taste-skill` treats as generic patterns to replace. The overlay wins on its own components; the
  family ban still governs everything else.
- **`top-design` as an overlay yields on two points.** Its micro-typography rule allows correct
  en/em dashes and its Pillar 7 credits custom cursors; the family bans the dash characters outright
  and treats custom cursors as opt-in only. When it drives a standalone build, its own rules hold.

### Shared family rules

These hold on every run, whichever workflow skill drives. They are duplicated verbatim into
`image-to-code-skill` section 0.A, because the router loads exactly one workflow skill per run —
a cross-reference would point at a file that is not in context. **Change one, change both.**

1. No em-dash or en-dash in user-visible output. Zero, not "sparingly".
2. Fonts: `Inter` discouraged as default; `Fraunces` and `Instrument Serif` banned as display defaults; serif-because-the-brief-said-editorial is the most-tested AI tell. Prefer `Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi`.
3. Icons: one family per project from Phosphor / Hugeicons / Radix / Tabler; `lucide-react` discouraged; stroke width standardized; never hand-rolled.
4. Shadows: nothing `shadow-md`-class or heavier, no pure-black shadows on light grounds.
5. Hero headline 2 lines max on desktop, subtext ≤ 20 words, CTAs visible without scroll, ≤ 4 hero text elements.
6. Eyebrow labels: at most one per three sections.
7. No div-based fake screenshots. Real image, or a labeled placeholder slot.
8. Dark mode designed in both modes for consumer-facing pages; motion honors `prefers-reduced-motion`.

Plus: no pure `#000000` or `#ffffff`, no AI-purple/blue gradient default, transform-and-opacity-only
animation, `IntersectionObserver` over scroll listeners, WCAG AA.

**The one legitimate override:** `image-to-code-skill`'s **Replicate** contract, where the user asked
for a faithful reproduction of a supplied image. It overrides rules 2, 4, 5, and 6 — and the deviation
must be named out loud, never taken silently. Rules 1, 3, 7, and 8 have no override.

## Runtime Caveats

- **`image-to-code-skill` has two modes; pick one out loud.** Mode A converts an image the user
  supplied. Mode B generates the reference first, and needs a runtime that can generate images —
  check your available tools for one rather than assuming either way; at the time of writing, base
  Claude Code has none without an image-generation MCP. With no image and no generation, say so and fall
  back to `taste-skill` from a written brief. Never invent a reference from memory and never narrate
  a generation step that did not happen. Read every "in Codex" instruction in that file as "in the
  agent runtime".
- **`taste-skill` and `image-to-code-skill` are ~1200 lines each.** Load them only when the route
  actually selects them — never speculatively, and never both.

## Provenance

All six sub-skills come from <https://github.com/Leonxlnx/taste-skill> (MIT, Leonxlnx), copied
2026-09-11 from the repo's `skills/` subdirectory. Bodies are upstream-verbatim, except each
`SKILL.md` frontmatter `name`, rewritten to match its folder name as this library requires, and a
marked local patch in `image-to-code-skill` that adds the provided-image mode. See the library
`AGENTS.md` for what to re-apply after an upstream pull.
