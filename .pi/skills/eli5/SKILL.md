---
name: eli5
description: Use this skill when the user did not understand the last message, says they are lost, or asks to hear it in simpler terms. Stop the task and re-pitch the last message from scratch at high-school level (what "ELI5" means in this repo), with the context that led to it. Do not use to summarize a long result, to shorten output on request, or to translate.
disable-model-invocation: true
---

# ELI5

"ELI5" is the word people use to ask for a simpler explanation. Here it means **high-school level**: write for a smart 17-year-old who is new to this project. Too simple loses the meaning; too dense loses the reader. Keep the real terms and the reasons, and explain them.

Re-pitch the last message from scratch.

## Procedure

1. **Stop.** Pause the task. Open no new topics. Run no tools unless a fact is missing.
2. **State where things are at.** What the task is, and where you stopped.
3. **Re-pitch, do not re-format.** Rewrite the last message from scratch, not just with easier words. Keep what the next step needs. Add the context that led to it, and an example or a missing reason when it helps. Do not re-paste the same code block; say what it does.
4. **Stay true.** Simpler must not mean wrong. If a detail cannot be both simple and correct, keep it correct and explain it.
5. **Check it landed.** End with one yes/no question about the explanation.

## Style rules

Base: the ELI5 rule in `.pi/SYSTEM.md` › Communication (high-school level, real terms defined once, reasons kept, what/why/check per step). These rules add to it:

- Use concrete names: the file, the command, the exact error text.
- Same word for the same thing every time.
- A short-clause definition looks like this: "a rebase (replaying your commits on top of the new base)".
- Examples help. An analogy is fine while it stays correct.
- Tables, headings, lists, and code blocks are fine when they make the text easier to follow.
- No fluff: no apology, no hedge, no account of why an earlier message failed.

## If it still does not land

A second ELI5 request, or a "no" to the check question, means it did not land. Go one rung down the ladder and repeat the procedure. Each pass uses a new rung.

1. The message — what you just said.
2. The concept behind it — the one idea the message assumed.
3. The goal — what this step is for.
4. The task — what we are doing at all, and why.

## Used by other skills

The **Style rules** above, on top of the SYSTEM.md rule, are the single origin for plain language in `.pi/skills/`. Other skills link here instead of restating them. When a skill says "written to the eli5 rules" or "eli5 style", it means that section, and nothing else in this file.

Skills that link here: `../grill-me/references/summary-template.md`, `../create-spec/SKILL.md`, `../create-plan/SKILL.md`.

## Example

Failed message:

> The write-boundary guard auto-arms on spec write, so implementation is scoped to the Modify list; re-arm via `/scope off` then `/scope <path>` if the grill session mutated Scope.

Re-pitch:

> We are adding the login fix. I stopped before editing any file.
> A guard (a check that runs before every file write) decides which files I may edit. It reads that list from the Scope section of the spec, `docs/specs/login/spec-login.md`, at the moment the spec is written.
> The grill session changed the Scope list after the guard read it. So the guard still holds the old list, and it would block files the new list allows.
> To reload it, run `/scope off`, then `/scope docs/specs/login/spec-login.md`. The guard then reads the new list.
> Does that make sense?
