---
name: step-back
description: Pause a task that is going in circles and rebuild it from first principles. States where things stand, lists every party's goals, sets premises with sources, derives conclusions Euclid-style, and ends with the single job of the next artifact plus open decisions. Use when the user says "step back", "Schritt zurück", "wir kommen nicht weiter", "first principles", "neu rangehen", or after several drafts the user rejected. Not for a first draft or a plain summary.
disable-model-invocation: true
---

# Step back

Stop iterating on the artifact. Rebuild the task from what is known, then derive what the next version must do.

## Rules

- Write no new draft in this step. The analysis is the output; the next turn builds on it.
- Every fact names its source (a message, a file, a quote). Label inferences "inferred" and general rules "principle".
- Every conclusion names the premises it follows from.
- Plain language per the eli5 Style rules. Reply in the conversation's language.

## Procedure

1. **Where we are.** The task, how many rounds, and why it is stuck (often: one artifact doing several jobs).
2. **Terms.** Define each key term once, in one short clause.
3. **Facts.** Only what the sources say, one per bullet.
4. **Goals per party.** For each party: stated goals, the need under them, inferred goals, each labelled.
5. **Premises.** P1, P2, … one sentence each, with source or the label "principle".
6. **Derivation.** "From P1 + P3: …". Drop every element no premise supports.
7. **Conclusion.** The artifact's single job in one sentence, then its skeleton: one part per line, each mapped to premises.
8. **Open decisions.** Each with evidence, what it changes, and a default.
9. **Check.** End with one yes/no question: do goals and derivation hold, so the next version can build on them?

## Done when

- All nine sections exist, in this order.
- No fact lacks a source; no conclusion lacks premises.
- No new draft was written.
- The last line is the yes/no question.
