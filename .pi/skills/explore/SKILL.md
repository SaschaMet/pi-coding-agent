---
name: explore
description: Start a task from first principles before any draft. Asks for the goal and context if missing, then walks the user through parties, facts, terms, goals, non-goals, premises, and derivation, one question at a time, until a confirmed brief states the artifact's single job and skeleton. Use at the start of a writing, planning, or design task, or when the user says "explore", "lass uns das durchdenken", "where do we start". For a task already going in circles, use step-back.
disable-model-invocation: true
---

# Explore

Build the brief before the first draft. step-back rebuilds it after drafts failed; explore builds it before they can.

## Rules

- One question per turn, with a default and one line on why it matters. Skip what the user already gave.
- Keep a running brief; each turn shows only what changed.
- Every fact names its source. Label inferences "inferred" and general rules "principle".
- Write no draft until the user approves the brief.
- Plain language per the eli5 Style rules. Reply in the conversation's language.

## Procedure

1. **Goal and context.** Ask for the goal, the artifact, and its reader, if missing. Collect source material (emails, files, notes).
2. **Parties.** Everyone the artifact affects: the user, the reader, others.
3. **Facts.** Only what the sources say, one per bullet.
4. **Terms.** Define each key term once; one word per meaning. Flag words used for two things.
5. **Goals per party.** Stated goals, the need under them, inferred goals, each labelled. The user confirms.
6. **Non-goals and limits.** What the artifact must not do, say, or promise. Ask explicitly; otherwise these surface only after drafts break them.
7. **Premises.** P1, P2, … one sentence each, with source or "principle".
8. **Derivation.** "From P1 + P3: …". Drop every element no premise supports.
9. **Brief.** The artifact's single job in one sentence, its skeleton (one part per line, mapped to premises), and open decisions with defaults.
10. **Check.** One yes/no question: does the brief hold, so drafting can start?

## Done when

- Every section is filled or marked "none".
- No fact lacks a source; no conclusion lacks premises.
- The user approved the brief, and no draft was written before.
