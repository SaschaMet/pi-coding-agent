---
name: pr-quiz
description: Use this skill when the user wants to be quizzed on a pull request, branch, or diff to prove they understand it — a "whiteboard defense" of what changed, why, the trade-offs, the failure points, and the architecture, whoever wrote the code. Also use it when a project's AGENTS.md asks for a quiz after a PR is created, or when the user wants to re-run a quiz on their weak spots. Do not use to find defects in code (code-review), to pressure-test a plan before coding (grill-me), or to create or describe a PR (pull-request).
---

# PR Quiz

Run a **whiteboard defense**: the user must explain and defend a change as if pulled aside at a whiteboard. You are the examiner. It does not matter whether a human or an AI wrote the code.

The test is design-level understanding, not recall. The user never needs a function name or a line number. They must answer "why X instead of Y?", "what happens if this actor is malicious?", "which data structure, and why?", and "where does this fail?" with confidence.

## Definition of Done

- Every key decision in the change was asked about, or listed as left over at the cap.
- Every answer got a grade and, where needed, a correction backed by evidence.
- The scorecard was shown and the results file was written.

## Workflow

### 1. Resolve the input

Use the first that applies, and state in one line which one you picked:

1. PR number or URL given → `gh pr view <pr> --json number,title,body,headRefOid,baseRefName,commits` and `gh pr diff <pr>`.
2. Commit or range given → `git show <sha>` or `git diff <a>..<b>` with `git log <a>..<b>`. Name the results file after the short SHA or range.
3. Current branch is not the default branch → `git diff <default>...HEAD` and `git log <default>..HEAD`.
4. Otherwise → the uncommitted diff (`git diff HEAD`) plus untracked files (`git status --short`, then read each `??` file).

Empty diff and no untracked files → say so and stop.

**Done when**: one diff and its commit range are fixed.

### 2. Check for a previous run

Look for `docs/pr-quiz/<pr-number-branch-or-sha>.md` (branch names: `/` → `-`). If it exists, this is a re-run. Start with its Partial and Gap decisions, then decisions added by commits after its stored head SHA. Skip decisions graded Solid.

**Done when**: you know whether this is a first run or a re-run, and your starting decisions are set.

### 3. Silent research: build the answer key

Read the diff, PR body, commit messages, and any spec or plan in `docs/` that the change links to or matches. Read the changed files and their direct callers only, not the whole repo.

Write down, hidden from the user, each **key decision** with:

- what was chosen, and what the alternatives were
- the trade-off: what it costs and what it rules out
- where it fails: edge cases, scale, dependency outages, rollback
- trust boundaries: who can call it, what input is untrusted
- what it touches: callers, data, users, other systems
- evidence: `file:line`, commit, or doc section

Research with a read-only sub-agent, so the answer key stays hidden from the user. It returns evidence only: for each decision, what changed, plus a verbatim quote with location for any stated reason. No quote → `undocumented`. It returns no trade-offs or failure modes; derive those yourself from the code. Before a grade relies on a quote, confirm it exists with a quiet search that prints only a match count (`grep -c`).

**The key holds evidence only.** When no source records _why_ a choice was made, mark the decision `undocumented`. Never invent the author's reason. Grade an undocumented decision on whether the user's reasoning is sound and fits the code.

**Done when**: every non-trivial choice in the diff is a key decision with evidence, or is marked `undocumented`.

### 4. Open the quiz

Send this, then stop and wait:

```
**Whiteboard defense: <PR title or branch>**
- Scope: <input from step 1, files changed, commits>
- Questions: about <N>, one at a time. Answer in your own words. "I don't know" is a real answer.
- Reply "skip" to skip a question, or "stop" to end with a scorecard.
```

N = about one question per key decision, capped at 15. Do not pad a small change to reach a number.

### 5. Ask, one question at a time

Pick the next decision by impact: security and data loss first, then architecture, then everything else. Aim each question at one category:

| Category   | Example shape                                                 |
| ---------- | ------------------------------------------------------------- |
| Decision   | Why X instead of Y? What did you give up?                     |
| Adversary  | What happens if this caller or input is malicious?            |
| Data       | Which data structure or storage holds this, and why that one? |
| Failure    | Where does this break? What happens when Z is down or slow?   |
| Impact     | Who or what else changes behavior because of this?            |
| Flow       | Draw it: walk the request or data end to end.                 |
| Safety net | How was this verified? How do you roll it back?               |
| Misc       | Anything else worth asking (Optional category)                |

Spread questions across categories. The Flow question comes early when the change spans more than one component.

Send each question in this format:

```
**Question <n> of ~<N>: <Category>**
Context: <1–2 short sentences on what the change did. No answer-key facts.>
Question: <one question, one sentence, one "?">
```

The `Question:` line holds exactly one question mark and no "and" joining two asks. A second ask becomes the next question or the follow-up.

Write each question with concrete names from the change ("the retry in the webhook handler"), never line numbers or function names as the thing to recall. Ask in plain text. Use simple, active language in eli5 style. Never offer answer options or a structured multiple-choice tool: options give the answer away.

**Done when**: one question is sent and you are waiting for the reply.

### 6. Grade each answer

| Grade   | Meaning                                           | Next                                             |
| ------- | ------------------------------------------------- | ------------------------------------------------ |
| Solid   | Correct, and they could defend it on a whiteboard | One line of confirmation, move on                |
| Partial | Right direction, but a gap or a wrong detail      | One follow-up aimed at the gap, then grade again |

A follow-up uses the step 5 format with the header `**Follow-up: <Category>**`.
| Gap     | Wrong, or "I don't know"                          | Short correction, move on                        |

After the final grade, show a correction of no more than three sentences when the grade is not Solid. Cite the evidence (`file:line`, commit, or doc). For an `undocumented` decision, say that no source records the reason, then name the trade-off the code shows. Then ask the next question.

**Done when**: every decision is graded, skipped, or left over at the cap, or the user said "stop".

### 7. Scorecard and results file

Show:

```
**Scorecard: <PR title or branch>**
| Decision | Category | Grade |
|---|---|---|
- Strong: <categories they defended well>
- Weak spots: <decisions graded Partial or Gap, one line each>
- Undocumented decisions: <list, or "none">. Record the reason in the PR or a doc.
- Re-read: <files or docs, most important first>
- Left over: <decisions not asked because of the cap, or "none">
- Next: <"re-run pr-quiz" when there are weak spots or leftovers; otherwise "ready to defend">
```

Then write the same content to `docs/pr-quiz/<pr-number-branch-or-sha>.md`, with the head SHA and date at the top. Overwrite it on a re-run, but keep Solid grades from the earlier run.

Before the first write in a project, run `git check-ignore -q docs/pr-quiz/x.md`. If the path is not ignored, ask once: "Add `docs/pr-quiz/` to `.gitignore`?" If yes, add the line, then write the file. If no, write the file and warn that it is tracked and can land in a commit.

**Done when**: the scorecard is shown and the results file is written.

## Rules

- **Who answers.** The user answers every question. Never answer your own questions. With no human present (a subagent or an unattended run), stop after step 3 and report that the quiz needs a human.
- **Never reveal the answer before the user tries.** A question contains no fact from the answer key that the question tests.
- **Design level only.** Do not ask about names, syntax, or line-level details. Ask about the decision behind them.
- **Reply in the user's language.** The results file uses the same language.

## Gotchas

- When the choice itself is what you test, naming the options ("was it A or B?") leaks the answer. Ask "what was chosen here, and why?" instead. "Why X instead of Y?" is fine once X is known and the reason is what you test.
- Three asks under one label are three questions. Split them, or keep the one that tests the decision.
- Grading against a guessed reason teaches wrong facts. If there is no evidence, mark the decision `undocumented` and grade the reasoning.
- A small change has few decisions. Asking four good questions beats asking ten, and the extra questions turn into trivia.
- A long, vague answer is not Solid. Ask one follow-up that pins down the gap, e.g. "and what happens to the in-flight request?"
- Corrections are for learning, not lecturing. Keep them to three sentences with evidence, then move on.
