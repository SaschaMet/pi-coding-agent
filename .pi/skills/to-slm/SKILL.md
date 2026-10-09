---
name: to-slm
description: 'Turns a task written for a frontier model into a spelled-out working brief, waits for the sender to approve it, then works from it. Use when the prompt or task message contains the keyword "toSlm" (or `/to-slm`), on any model, or the model is `iqRouter/grunt`; read this skill before any other tool call. Not for prompts that only edit, review, or quote the to-slm skill or the keyword.'
---

# toSlm

Spell it out. A prompt written for a frontier model leaves steps, choices, and formats unsaid. Before you work, write them down as a **working brief**. The sender checks the brief. Then you work from the brief, not from the original prompt.

## Who approves

- The approver is whoever sent the task: a human, or an orchestrator agent.
- The keyword "toSlm" in the task is the sender's request for this brief-first protocol. It is the approval scope for stopping at the brief. It does not conflict with subagent rules that say "do not wait for approval".
- Approving the brief never replaces another approval gate. Gates in `SYSTEM.md` or in a loaded skill still run.

## Workflow

Always write the brief first, even when the task looks easy. Your first answer is the brief, never the result.

Do the steps in order. Finish each step's Done-when check, then start the next.

- [ ] **1. Read.** Read the task, the system prompt rules that apply to this task, and every loaded skill. Compare each rule with the task: if the task asks for something a rule forbids (for example a language, a file write, a format), that is a conflict. Done when you can name each "must", "never", and "always" that touches this task, and every conflict.
- [ ] **2. Check the goal.** If you cannot say the goal in one sentence, ask the sender one question about the goal and wait. Ask nothing else here. Done when the goal fits in one sentence.
- [ ] **3. Write the brief.** Fill every section of the template below. Apply the rewrite rules. Done when every section is filled (write "none" if empty).
- [ ] **4. Show the brief and stop.** Show the brief. End your turn. Done when the approver replies.
- [ ] **5. Handle the reply.**
  - Reply is `yes`, `approved`, or `go` → go to step 6. Use the default for every open question the approver did not answer.
  - Reply answers questions or changes the brief → update the brief, show it again, go back to step 4.
  - Any other reply → treat it as a change, not as approval.
- [ ] **6. Work.** Do the Steps from the brief, one at a time, in order. Tick each step when it is done. Follow every Hard rule. Done when every step is ticked.
- [ ] **7. Self-check.** Before your final answer, check each item:
  - Every Hard rule was followed.
  - The answer matches the Output format.
  - Nothing from Out of scope was done.
  - No fact was added that the task or the files do not support.

## Brief template

Copy this template. Keep the headings exactly.

```markdown
## Goal

<one sentence: what the result is>

## Hard rules

- "<quote each must / never / always from the task, system prompt, or skill that touches this task>"

## Steps

1. <one action per step, in order>

## Defaults

- <open choice> → <the choice you will make>

## Output format

<exact shape of the final answer: sections, file names, code block, length>

## Out of scope

- <what you will not do>

## Open questions

- <question> — default if unanswered: <answer>

## Too hard for me

- <part you may get wrong, and why> — or "none"
```

## Rewrite rules

Use these when you fill the brief:

| The task says                       | Write in the brief                               |
| ----------------------------------- | ------------------------------------------------ |
| A step it does not name             | A numbered step                                  |
| "choose", "decide", "as needed"     | A Default                                        |
| "good", "clean", "appropriate"      | A test you can check (count, name, format)       |
| "don't do X"                        | "Do Y instead" next to it                        |
| Several goals in one sentence       | One step per goal                                |
| Background that changes no action   | Leave it out                                     |
| Two rules that conflict             | An Open question, with the safer rule as default |
| A missing input (file, value, name) | An Open question, with a default or "stop"       |

## Example

Task: "toSlm: add a retry to the fetch helper, keep it clean."

```markdown
## Goal

`fetchJson` retries failed requests before it throws.

## Hard rules

- "Write the test first."

## Steps

1. Find `fetchJson` and its tests.
2. Write a failing test: the first call fails, the second call succeeds.
3. Add the retry to `fetchJson`.
4. Run the tests.

## Defaults

- Retries → 3, fixed 200 ms delay, only on network errors and 5xx.

## Output format

Changed files, plus the test command and its result.

## Out of scope

- Other HTTP helpers.

## Open questions

- Should 429 responses retry? — default if unanswered: no.

## Too hard for me

- none
```

## Gotchas

- Never add facts or change what the task asks for. The brief restates the task; it does not improve it.
- Never drop a Hard rule to make the brief shorter. Quote it instead.
- Keep the user's terms. Use the same names for files, functions, and concepts.
- "Too hard for me" is a flag only. The approver decides what to do. Do not hand the work to another model.
- As a subagent: return the brief as your result and stop. The orchestrator approves by resuming or steering you. Never approve your own brief.
