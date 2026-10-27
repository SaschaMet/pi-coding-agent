---
name: deslop
description: Removes AI slop from prose (never from code) and tightens it. Finds formulaic patterns (contrast and colon reveals, stock openers, filler, hedges, reflex triplets), fixes what keeps the meaning, proposes what changes it, and never invents content. Use when the user asks to deslop, de-AI, or humanize a text, to tighten or shorten a draft, or whether a draft sounds AI-written, in English or German, and before you hand over prose you wrote for a reader, such as a PR description, release note, or plan. If a project skill owns the text's voice or audience, use that skill instead. Not for code cleanup, diffs, commit messages, or translation; to re-explain your own last message use eli5.
---

# Deslop

Find the **slop** in a text and take it out. Slop is a sentence written for its sound, with no fact behind it: the reveal, the stock opener, the slogan close, the hedge. The fix is a plain report of what is there and what follows.

## Goal

Same process every run: diagnose, fix what keeps the meaning, propose what changes it, check mechanically. The output says what the input said, in fewer and plainer words, and contains only what the writer supplied.

## Definition of Done

- The check script prints CLEAN for every language in the text, or each remaining `✗` line is reported as a false positive. In review mode, its hits on the input are reported instead.
- Every claim in the output comes from the input or the user.
- Substance-level changes were proposed; only the ones the user approved were applied.
- The reader's next step is at least as clear as before.
- The output follows the mode's shape (Output section).

## The rule that outranks everything

**Never invent content.** No claim, number, result, quote, example, name, or anecdote that is not in the input or given by the user. Where the text needs material it does not have, mark the gap in place, `[SOURCE NEEDED: what is missing]`, and list it under Gaps. In author mode, never insert a marker; leave the claim as written.

## Two classes of change

Sort every edit before you make it. **When in doubt, it is substance-level.**

| Text-level: apply | Substance-level: propose, numbered |
|---|---|
| Cutting slop patterns, filler, doublets, meta-discourse | Adding or removing a claim, number, example, section, or heading |
| Word order, sentence joins, Nominalstil → verb, exact word | Reordering, merging, or splitting sections |
| Typography and punctuation the text already uses | Changing the main point, the offer, the price, or the call to action |
| Making one term consistent across the text | Cutting a qualifier that carries uncertainty ("usually", „meist“) |
| A run of lines into a list, if the list is already implied | Turning a refusal or warning into a positive |
| | Switching register: du/Sie, you/one, formal/casual |

## Modes

| The request | Mode | What you return |
|---|---|---|
| "deslop / tighten / humanize this", a pasted text | improve | Rewritten text, then Findings |
| "does this sound AI-written?", "don't rewrite" | review | Findings only; lead with what works |
| A file the user names | improve, file | A `diff` block of text-level changes plus numbered proposals; apply on the user's go |
| Your own unsent draft for a reader (PR body, plan, release note) | author | Edit the draft directly; see Author mode |

## Workflow

Each step ends on a condition you can check. Start the next step only when it is met.

### 1. Brief

Settle five things. Ask only what the text and its context leave open.

| Question | Default |
|---|---|
| Which text, and where does it live? | The pasted text or named file |
| Who reads it? | Infer from the text; state the inference |
| Mode? | From the Modes table |
| What must not change? | Numbers, names, prices, legal wording, quotes |
| Voice guide? | None. If the user names one, its rules win over this skill's |

*Done when:* each is answered or defaulted in writing (one line each in your notes, not in the output).

### 2. Diagnose, top-down

A fault high on the list makes the ones below it irrelevant.

1. **Point and claims:** one central claim? If not, that is a substance finding. Every number or result the text gives no source for gets a numbered proposal asking for the source. Keep it as written; never delete it, and never pass it silently.
2. **Structure:** Skim Test: read only the first line of each section; that skeleton must tell the story.
3. **Slop:** read `references/slop.md` and walk S1–S22. Apply each "fine when" line before you flag.
4. **Compression** (improve and author mode): read `references/compression.md`. Count ideas, not words.
5. **Concrete over abstract:** each abstract noun replaced by what was seen, if the text says what that was. If it does not, that is a gap, not an invention.

*Done when:* every finding is written down and classified text-level or substance-level.

### 3. Gate

Apply the text-level findings. Number the substance-level ones, unapplied, each with what you found, what it costs the reader, and what you would do. Ask at most three questions, each with a default.

**Stop before rewriting** only if a proposal reorders, merges, splits, adds, or removes a section: polishing sentences in a structure that is about to change wastes the pass. Otherwise continue in the same turn.

*Done when:* text-level fixes are applied and every substance finding is numbered.

### 4. Rewrite

Only approved items and text-level fixes. Structure first, then paragraphs, then sentences. Keep the writer's register and every keep-list item. For a named file, show the change as a `diff` block and apply it on the user's go.

*Done when:* every approved item is done, and only approved items changed.

### 5. Check

Run the script on the output, once per language in it (review mode: on the input, and report the hits). `<skill-dir>` is the folder of this file. It matches one line at a time, so a phrase wrapped across two lines is yours to catch.

```bash
node <skill-dir>/scripts/slop-check.mjs --lang en|de <file>     # or: --stdin for pasted text
```

`✗` lines fail the check: fix them and run again. `~` lines are advisory: read each line and fix it or confirm it is a "fine when" case. Then read for the patterns the script cannot see (S3, S7–S12, S14, S17–S21; S6 in English, S22 in German), and diff the output against the input for added claims, numbers, or names.

*Done when:* the script prints CLEAN or every remaining `✗` line is a reported false positive, the reading pass found nothing open, and nothing was added. If one fails, return to step 4.

## Author mode

For prose you drafted and have not sent: a PR description, a plan, a release note.

- Skip the brief and the gate. Ask no questions.
- Read `references/slop.md` and `references/compression.md`. Apply text-level fixes directly. Run the step 5 check.
- Wording only: never add, remove, or question a claim, and never insert a gap marker. Facts belong to the skill that drafted the text.
- Keep bullets as bullets, and inline code, paths, and commands exactly as written.

## Gotchas

- **Compression is not shortness.** A long sentence where every word carries an idea stays. Chopping it into stubs creates S9 staccato.
- **Do not swap one slop word for another.** "optimise" for "improve" is a synonym, not a fix. Name the concrete thing, or cut.
- **Qualifiers and refusals are the honest part.** "usually", "in most cases", "We can't promise X" stay. Cutting them turns an estimate into a promise.
- **Do not over-correct.** Return a clean text unchanged, and say so.
- **A rule firing on clearly right text is a false positive.** Leave the text, and name the rule and the line in Findings so the rule can be fixed.
- **Keep the register.** du stays du, Sie stays Sie, contractions stay contractions. Changing it is substance-level.
- **German quotes, dashes, and "!" are voice choices.** Change them only when a voice guide says so.

## References

| File | Read it when |
|---|---|
| [references/slop.md](references/slop.md) | Every mode, at diagnose step 3 and in author mode |
| [references/compression.md](references/compression.md) | Improve and author mode, at diagnose step 4. Not in review mode |
| [scripts/slop-check.mjs](scripts/slop-check.mjs) | Run it at step 5. `--help` lists the options |

## Output

Improve mode, text first:

```markdown
## Text

<the rewritten text, complete, ready to paste>

## Findings

**Fixed:** <what changed, by kind, 3–6 bullets>

**Proposed (not applied):** <numbered; what, why it matters, what I would do — or "none">

**Gaps:** <every [SOURCE NEEDED] marker — or "none">

**Check:** <CLEAN per language, plus any advisory line kept on purpose>
```

Review mode: a one-line verdict, what already works, then the Findings block without Fixed. Author mode: the finished draft, then one line naming what was removed.
