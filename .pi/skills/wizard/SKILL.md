---
name: wizard
description: Use when the user must perform a multi-step procedure and wants to go through it step by step: a plan, checklist, setup, migration, or cutover — provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or a one-off state change. Walk them one step at a time with context, exact actions, progress tracking, and confirmation gates. Generate a bash wizard script (template.sh) only when the procedure is long and mechanical or the user wants a repeatable artifact; default to walking through it in the conversation. Don't invoke for steps the agent can perform itself.
---

# Wizard

A **wizard** is a guided, step-by-step walkthrough of a procedure only the human can perform — a plan, a checklist, a setup, a migration, a cutover. The agent drives: one step at a time, each with context, the exact action, progress tracking, and a confirmation before the next step.

Two delivery modes:

- **Conversational** (default) — the agent walks the user through the steps in the chat, writes captured values where they belong, and adapts to the user's answers.
- **Script** — a bash script generated from [template.sh](template.sh) that runs the same walkthrough in the terminal. Use only when necessary (table below).

## Choosing the mode

| Signal | Mode |
| --- | --- |
| Plan, checklist, or any procedure the user wants to go through with the agent | conversational |
| Few steps, conditional branches, or discussion along the way | conversational |
| Long, linear, mechanical procedure (many URL opens, many captured values) | script |
| User wants a repeatable artifact (commit to repo, onboarding for teammates) | script |
| User will run it without the agent present | script |

Default: conversational.

## 1. Scope the procedure

Work out every step the human must take and every value that gets captured along the way. Read the repo first — don't ask cold:

- For setup: `.env`, `.env.example`, `.env.*`, `README`, `docker-compose*`, framework config, and `.github/workflows/*` (every `secrets.*` / `vars.*` reference is a value the wizard must produce).
- For a migration or cutover: the current state, the target state, and the irreversible actions between them.
- For a plan or checklist: the ordered steps as the user stated them, plus the values or decisions each step produces.

Where you don't actually know the current UI or the exact command, say so and ask the user or check the docs — never invent steps that may not exist.

Then show the user the ordered list of steps and the values each produces, and confirm — they may add, drop, or reorder.

**Done when:** every step is named in order, and for each captured value you know (a) where the human gets it, (b) where it's written (`.env`, a GitHub secret, a config file, or nowhere — some steps are pure actions), and (c) whether it's secret.

## 2. Conversational walk-through

Walk one step at a time, in order. For each step:

1. **Progress** — open with `Step X of N · <name>` so the user always knows where they are.
2. **Context** — one or two lines: why this step, what it produces, what depends on it.
3. **Action** — the exact path: which URL to open, what to click, what to copy, which command to run.
4. **Capture** — if the step produces a value, ask for it in this step and write it where scoping said it belongs (`.env`, a config file, a GitHub secret via `gh`). Never echo a secret back.
5. **Gate** — confirm explicitly before any irreversible action; wait for the user's confirmation that the step is done before moving on.

If the user's answer changes the path (a branch, a skip, a reorder), update the remaining steps and say what changed.

**Done when:** every step was confirmed by the user in order, every captured value landed where scoping said, and the user has a closing summary — what was done, what was written where, and what's left.

## 3. Script mode (only when the table above says script)

The delightful UX is already solved by [template.sh](template.sh) — stage-by-stage progress, confirmation gates, cross-platform URL opening (including WSL), hidden secret entry, idempotent `.env` upserts, `gh secret`/`gh variable` writes, and a closing summary. **Your job is only to scope the procedure and author its stages.** The library above the `STAGES` marker is identical in every wizard; that consistency is the point — never hand-edit it.

### Map each stage's journey

For each stage, write the precise path a human follows: which URL to open, what to do there, where a value is shown, which variable it fills — e.g. "Dashboard → Developers → API keys → Reveal test key → copy".

**Done when:** every stage traces to concrete instructions a stranger could follow.

### Author the wizard

Copy `template.sh` to the target path. Replace the example stage with one `stage` per step, in dependency order. Use the library helpers — `stage`, `say`/`step`, `open_url`, `ask`/`ask_secret`, `write_env`, `set_secret`/`set_var`, `pause`/`confirm` — and set `TOTAL_STAGES` to the number of stages you wrote.

Hold the bar the template sets: open the URL before asking for its value, use `ask_secret` for anything secret, `write_env` every persisted value, `set_secret` only the values CI actually needs, and `confirm` before any irreversible action. Each `stage` clears the screen so only the current step is visible — keep a stage to one focused task so nothing the human needs scrolls away. Don't touch the library above the marker.

### Verify and hand off

- `bash -n <script>`; run `shellcheck` if available.
- `chmod +x <script>`.
- Don't run it end-to-end yourself — it opens browsers and blocks on human input. Trace it statically instead: every value from scoping is captured and lands where scoping said, and every `set_secret` name exactly matches a `secrets.*` reference in CI.
- Tell the user how to run it.

A script is ephemeral by default — built for one run, saved to a scratch or `scripts/` path, deleted when the job's done. Commit it only when the user wants a repeatable setup path that should live in the repo — then link it from the README so the next person runs the script instead of asking an AI.
