---
name: eli5
description: Use this skill when the user did not understand the last message, says they are lost, or asks to hear it in simpler terms. Stop the task and re-pitch the last message from scratch in plain language (ELI5 / ASD-STE100 Simplified Technical English), with the context that led to it. Do not use to summarize a long result, to shorten output on request, or to translate.
disable-model-invocation: true
---

# ELI5

The user lost the thread. The last message did not land. Re-pitch it from scratch.

## Procedure

1. **Stop.** Pause the task. Open no new topics. Run no tools unless a fact is missing.
2. **State where things are at.** One or two sentences: what the task is, where you stopped.
3. **Re-pitch, do not re-format.** Rewrite the last message, do not reword it. Simpler content, not just simpler words. Keep only what the next step needs. Add the context that led to it.
4. **Stay true.** Simpler must not mean wrong. If a detail cannot be both simple and correct, drop it and say so in one line: "There is more detail here. I left it out for now."
5. **Check it landed.** End with one yes/no question about the explanation. Nothing else.

## Style rules

- One idea per sentence. Maximum 20 words per sentence.
- Active voice. Present tense where possible.
- Simple words: "use" not "utilize", "start" not "commence", "so" not "consequently".
- Positive form: "the guard blocks writes outside the scope", not "the guard does not allow writes outside the scope".
- Same word for the same thing every time. Never switch synonyms.
- Jargon only when the next step needs it. Define it once, in a short clause: "a rebase (replaying your commits on top of the new base)".
- Whole output is at most 10 lines, and always shorter than the message that failed.

## Hard bans

- No apology. No "sorry that was unclear". No account of why the last message failed.
- No idioms, no metaphors, no analogies, no hedges.
- No tables, no headings, no bullet nesting deeper than one level.
- No re-pasting the same code block. Describe what it does instead.
- No new information that was not in the failed message, except the context from step 3.

## If it still does not land

Go one rung down the ladder and repeat the procedure. Do not repeat the same rung.

1. The message — what you just said.
2. The concept behind it — the one idea the message assumed.
3. The goal — what this step is for.
4. The task — what we are doing at all, and why.

## Used by other skills

The **Style rules** and **Hard bans** above are the single origin for plain language in `.pi/skills/`. Other skills link here instead of restating them. When a skill says "written to the eli5 rules", it means those two sections, and nothing else in this file.

Skills that link here: `../grill-me/SKILL.md`, `../create-spec/SKILL.md`, `../create-plan/SKILL.md`.

## Example

Failed message:

> The write-boundary guard auto-arms on spec write, so implementation is scoped to the Modify list; re-arm via `/scope off` then `/scope <path>` if the grill session mutated Scope.

Re-pitch:

> We are adding the login fix. I stopped before editing any file.
> A guard decides which files I am allowed to edit. It reads that list from the spec file.
> The list was changed after the guard read it. So the guard now holds the old list.
> You need to reload it. Run `/scope off`, then `/scope docs/specs/spec-login.md`.
> Does that make sense?
