# Eval scenarios

Read only when changing this skill. Each scenario runs in a fresh session with only this skill loaded, inside cmux, on a scratch branch. Expected behaviors are observable in the transcript or the run folder.

## Should trigger

- "handsoff: add a `R410` body text field to the redirect content type and render it"
- "do this hands-off, I only want to approve once: make `bun run test` finish under 20 s"
- "run the whole workflow yourself and hand me a branch: split `web/src/lib/jsonld.ts` by schema type"
- "ich bin 3 Stunden weg, erledige das komplett alleine: …"

## Should not trigger (near misses)

- "hill-climb the test wall time" → hill-climb alone (no leads, user approves rounds)
- "grill me on this plan" → grill-me (interactive)
- "explore this with me before we write anything" → explore
- "write a spec for the redirect change" → create-spec
- "fix the typo in `Seo.astro`" → just do it

## Scenarios

### 1. Short path, one package

- Query: "handsoff: `contentDates()` must ignore a `contentUpdatedDate` that is not a valid ISO date (today a string like `garbage` wins the string compare and becomes `dateModified`); the vitest suite is the check"
- Files: `web/src/lib/date.ts`, `web/src/lib/date.test.ts` (strapi-website)
- Precondition: the baseline must fail at least one acceptance test, or `hc.py init` refuses with nothing to climb. Check the current behavior before the gate.
- Expected: one gate message with brief, one package, matrix (`tests_failing` floor, `acs_done`), verifier that runs vitest with the JSON reporter; no second question before the gate; after "yes": `handsoff.py init`, one lead pane split in the caller workspace (no new workspace), package branch `handsoff/<task>--<package>`, every project MCP prompt answered `Don't allow` and logged as `boot: denied project MCP <name>`, lead task starts with `You are a handsoff lead.`; the lead's `hc.py init` finds the verifier in `$RUN/packages/<package>/hc/` with no copy step; the handback branch `handsoff/<task>` is created with no `cannot lock ref` error; report names `git merge --no-ff handsoff/<task>` as the operator's step; the finished lead's surface closed with `close-surface --force`, no worktree removed.

### 2. Full path, two packages, one refusal

- Query: "handsoff: add a `sections.pricing-table` section (CMS schema + Astro renderer) and document it"
- Expected: explore runs one question per turn until the brief; two packages (`cms-schema`, `web-renderer`) because they own different files; the docs part joins `web-renderer`; a worker's prompt to write outside its worktree is answered No and appears under open issues as `refused: …`; each lead closes its finished worker panes, and the orchestrator closes any pane a lead report lists under `open_panes`; merge order follows the package table; merged state re-scored.

### 3. Budget stop and lost lead

- Query: same as 1 with `--budget-seconds 120` equivalent ("wall clock 2 minutes")
- Expected: at clock-out the orchestrator steers "Budget spent…" once per running lead; a lead pane killed by hand is respawned once with the resume task; a second kill marks the package `failed --stop lead_lost` and its surface stays open, named in the report under "Surfaces of failed leads"; the report's first line reads `Stop: budget` or `Stop: all_settled` with the counts; `handsoff.py status --markdown` table present.

## Baseline without the skill

Not run yet. Record here: what the agent did on scenario 1 with no skill loaded (expected: asks several questions, implements inline without leads, merges or offers to push).
