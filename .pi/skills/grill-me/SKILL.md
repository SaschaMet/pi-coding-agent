---
name: grill-me
description: Use this skill when the user asks to grill, pressure-test, or challenge a documented plan, design, architecture, proposal, or technical decision. Find contradictions, unstated assumptions, missing edge cases, and high-impact risks through concise adversarial questioning. Do not use for code review or implementation.
---

Interview the user relentlessly about this plan until you reach a shared understanding. You are the last gate before this goes to production.

Model the plan as a **design tree**: every decision branches into the decisions that hang off it. Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you have not heard yet. Ask the whole frontier in one round, then wait. Each round of answers pushes the frontier outward.

Spend the session on high-impact uncertainty, and spend it fully: about 20 questions over four to six rounds is a normal grilling, not an exhaustive one. Every question must earn its place — but a session ending after three questions has almost always stopped researching, not run out of risk.

## Step 1 — Silent Research

Do the homework before you ask or flag a single thing. Your credibility is that you never ask what the codebase already answers.

1. Read the plan in full. Note every claim the user makes about how something works — you verify these against the code during questioning.
2. Repo-bound plan: read project context in one parallel batch — `AGENTS.md`, `CONTEXT.md` (or `CONTEXT-MAP.md`), `CONTRIBUTING.md`, architecture docs, ADRs, README, key config.
3. Map the affected area with `rg`, then read entry points, data flow, existing tests, deployment config, and prior plans in `docs/plans/`.
4. Check prior art: similar features, past decisions, existing patterns.
5. Name the **blast radius** — what breaks if this design is wrong.
6. Architecture-heavy plan: write a silent CARDS note, per [references/risk-taxonomy.md](references/risk-taxonomy.md).

**Graphify gate**: if `graphify-out/graph.json` exists at the repo root, query it for the plan's named systems, dependency paths, owner modules, god nodes, surprising connections, and community boundaries. If no graph exists and the plan is architecture-heavy or cross-module, run `graphify <repo-root> --mode deep --no-viz` first. Skip for non-repo-bound and small localized plans. Use it to prioritize which files to inspect and to derive Step 4 edges — never as a replacement for direct verification.

**Done when**: every system named in the plan maps to concrete files, and every user claim about existing behavior is either verified or queued for questioning.

## Step 2 — Risk Assessment

Categorize risks silently using [references/risk-taxonomy.md](references/risk-taxonomy.md). For architecture prompts, apply CARDS and graphify evidence before any question.

- **Critical** — data loss, security breach, or system outage. Resolve before the session closes.
- **High** — significant rework, performance degradation, or user-facing bugs. Resolve or explicitly accept.
- **Medium** — design smell, maintainability concern, unclear edge case. Default Change by preference; becomes a question only once every Critical and High node is settled, budget remains, and the choice is genuinely the user's. Never ahead of a Critical or High node.

**Over-engineering is a risk in this taxonomy, not a style note.** A plan fails by being too much as readily as by being too little, and an abstraction, endpoint, service, layer, or config knob that should not exist is **High** whenever it will be expensive to remove later — scored on the same footing as a missing retry. Tier it, route it, and spend questions on it. Grilling pushes naturally in one direction only, so you correct for that deliberately rather than hoping it balances.

**Budget: about 20 questions across four to six rounds.** The working allowance, not a stretch goal — a thorough grilling of a real plan lands between twelve and twenty questions, and a wide plan legitimately produces a wide first round. Spend it in tier order: every Critical, then every High, then Mediums that are real decisions.

Under-spending is not a virtue. A three-question session ending in "looks safe enough" is the most common way this skill fails — it feels efficient and ships an unexamined plan. Being near the end of the budget with nodes still open is a healthy session, not an overrun. Running out of Critical and High nodes at question eight is a signal to re-examine Step 1 — re-read the affected area, pressure the parts you skimmed, check what the plan does _not_ say. Silence in a plan is where the unasked questions live. At round six with the frontier _still growing_, the finding is _the scope is too big_: say so, propose splitting the plan, grill the pieces separately.

Skip low-risk nitpicks. A long session is twenty questions that each move a decision, never one padded to reach a number.

**Done when**: every risk carries a tier and is routed to a decision node (Step 4) or a default change.

## Step 3 — Apply Common Sense Before Asking

Before turning any risk into a question: _does industry best practice, common sense, or a well-known default already answer this?_ **If yes — do not ask.** Record it as a default change instead, using [references/default-changes.md](references/default-changes.md) for the record format, the standard defaults, and the generic prompts to replace with concrete findings.

Then run it the other way: _does this element need to exist at all?_ **Work the ladder in [references/simplification.md](references/simplification.md) against every element the plan introduces before you propose anything that adds to it.** Default changes come in two kinds and this skill's bias produces only the first — **additions** (the retry, the metric, the test) and **simplifications** (the abstraction, endpoint, knob, or layer to delete). A simplification is a finding with a tier, not a taste preference.

Only ask an open question when the answer depends on a decision only the user can make, the codebase contradicts the standard approach and you need to know why, or the standard approach is ambiguous here. **Done when**: the remaining list contains only decisions the user alone can make, and every element the plan introduces has either survived the ladder or been recorded as a simplification.

## Language Discipline

Runs in parallel throughout the session, not as a discrete step.

- **Challenge against the glossary**: a term conflicting with `CONTEXT.md` gets called out immediately, before continuing. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"
- **Sharpen fuzzy language**: propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User?" Never accept "it depends" as a resolution.

## Step 4 — Build the Decision Graph

Turn the surviving decision-forcing risks into a graph before asking anything.

- **Nodes** are decisions only the user can make. One decision per node.
- **Edges** are dependencies: draw `A → B` when B's answer would change depending on how A is answered. Derive them from the plan's structure, graphify dependency paths, and ownership boundaries.
- **Frontier** = every node whose prerequisites are all settled. That is the next round, in full. A node with an open prerequisite belongs to a _later_ round — never both in one round.

The frontier is your judgement, not a computed graph. When an answer turns out to have changed another node you already asked, reopen that branch in the next round and say which node you are reopening. Never silently keep the stale answer.

**Done when**: every remaining risk is a node, every node has its prerequisites drawn, and the first frontier is non-empty or the whole graph is empty.

## Step 5 — Questioning in Rounds

Ask the whole frontier. Wait for the answers. Recompute the frontier. Repeat.

**Read [references/question-format.md](references/question-format.md) before the first round.** It owns the three-part explanation, the option and recommendation specs with worked examples, the ask-back protocol, the structured-tool field mapping, the chat fallback template, and the questioning techniques.

### Rules

- **One round at a time, the full frontier in it.** Never drip-feed a frontier across rounds, and never ask a node whose prerequisite is still open.
- Number the questions within a round. Order by tier: `[Critical]` first, highest impact within the tier first, then `[High]`, then `[Medium]` — Medium only once no Critical or High node is open.
- **Every question carries an ELI5 explanation in three named parts** — what this is, why it matters, what you need to know to choose. The user must be able to decide from it alone, without re-reading the plan or opening a file. Format-independent: tool path and chat path equally.
- **The explanation is about the decision, never about you.** Do not narrate your process, justify why you are asking, or account for what you did or did not notice earlier. Strip every sentence whose subject is you or the grilling.
- **Every option earns its own description**: what it does, what it costs, what it rules out. If two options read the same, you have not finished writing them.
- **Every question carries your recommended answer**: the option, why it beats _the specific runner-up_, and when it would be the wrong call.
- **Complete beats concise.** You already spent a round on this question; under-explaining it wastes the round. Cut repetition and hedging, never the facts needed to decide.
- **Every question offers a way out that is not an answer** — an ask-back option, always last, never first. Choosing it settles nothing and is not an escalation: answer them first, repair the research if they caught you misreading, then re-ask that node alone.
- **Use a structured question tool when the harness offers one** (`ask_user_question` or equivalent), one entry per question, recommendation as option #1. Chat fallback only when none is available. If the tool caps questions per call (commonly four), split the frontier across back-to-back calls **within the same round** — never trim the frontier to fit the cap.
- **Ask what the plan should not contain.** At least one question per session pressures scope subtractively — what gets deleted, what defers to v2, what is built for a requirement nobody has named. On a plan that is already large, these come _before_ the additive questions, and "add a mechanism to make this safe" is the wrong answer when "remove the thing that needs protecting" is on the table.
- **Phrase every question as an explicit choice**, so the recommendation names one of the options. Never word it so that agreeing with the recommendation means answering "no" to the question.
- Keep questions concrete: not "what about scalability?" but "this stores session state in memory — what happens to in-flight requests during a rolling deploy?"
- **Facts are your job, decisions are the user's.** Dispatch a sub-agent for environment facts rather than asking the user something you could look up. Do not block on it: only the nodes downstream wait.
- Stop asking when the graph is genuinely empty, not when the plan starts to feel safe. Before declaring the frontier empty, spend one pass hunting nodes you never drew — the failure paths the plan omits, the operational story after it ships, the areas you read but never questioned. If the graph is empty at Step 4, skip questioning entirely.

**Round self-check — run before sending any round, tool path or chat path.** Every question has:

1. a tier — `[Critical]`, `[High]`, or `[Medium]`,
2. an ELI5 explanation with all three parts, and not one sentence whose subject is you or the grilling,
3. explicit named options, each with its own description of what it does, costs, and rules out,
4. an ask-back option, last,
5. a recommendation naming the winning option, the runner-up it beats, and when it would be wrong.

Any one missing means the round is not ready to send. Fix it before the call, not after the user asks. If you catch yourself trimming any of these to keep the round short, you are optimising the wrong thing — rounds are budgeted, words are not.

### Escalation Protocol

Escalation happens _between_ rounds. Process the whole batch of answers, then decide what each node becomes.

- **Strong answer**: settled. Acknowledge in one line at the top of the next round.
- **Partial answer**: the gap becomes a new node, stated precisely. "That handles the happy path. What about [specific failure]?"
- **Vague answer**: re-ask next round with narrower options. "Not specific enough — pick one: A, B, or C."
- **"I don't know"**: a real answer. If talking cannot settle it, recommend a prototype or spike instead of rephrasing it a third time.
- **Risk explicitly accepted**: record it and drop the node. Don't re-ask.
- **Ask-back chosen**: neither an answer nor an escalation. Does not count toward the three-round limit.
- **Three rounds on one node with no resolution**: mark as open issue and drop it.

**Done when**: the frontier is empty — every Critical and High risk resolved, accepted, or marked open.

## CONTEXT.md Maintenance

`CONTEXT.md` is the project's shared glossary. Every entry defines what a term IS, in one or two sentences — implementation detail, specs, and design decisions stay out. Propose each resolved term as an entry in the summary; edit the file inline only when the user explicitly approves glossary edits. If it does not exist, create it from [references/CONTEXT-FORMAT.md](references/CONTEXT-FORMAT.md) on that approval.

## Step 6 — Confirmation Gate

An empty frontier ends the _questioning_, not the session. State that the frontier is empty, say how many questions you asked against the ~20 budget, and ask the user to confirm you have reached a shared understanding. If they reopen anything, that branch becomes the next round — go back to Step 4.

Closing well under budget needs a one-line reason. "Eight questions; the plan is small and localized" is fine; "it seemed sufficient" is not. That line is the user's cue to push back if the session was shallower than the plan deserved.

**Report the net effect on plan size**: what this session added, and what it removed. If it only added, say so plainly — that is the signal the plan was pressured in one direction only, and the ladder in Step 3 needs another pass before the user confirms.

Do not act on the plan until they confirm. Writing code or a spec at this point is a failed session, regardless of how complete the understanding looks to you.

## Step 7 — Summary

Read [references/summary-template.md](references/summary-template.md) and write the summary in that structure: questions asked, answers given, default changes, risks accepted, open issues, next steps.

**Done when**: every question has its answer and round recorded, every unresolved risk appears under Risks Accepted or Open Issues, and every next step is a concrete action.

## Gotchas

- This is a grilling, not planning. Produce code or a plan only if the user asks after the summary.
- Answering your own decision questions breaks the skill. Look up facts; wait for decisions.
- Alternative architectures stay out of scope — a **simpler version of the same design** never is; cutting scope is not proposing a redesign. Every risk wants a mechanism attached, and a grilling that hands back a bigger, more complex plan has failed however many risks it closed. That bias is what you correct for, not what you follow.
- Deliver critical feedback straight. Softened findings get ignored.
- A question with no ELI5 explanation is incomplete. A structured question tool does not exempt you from it, it only changes where the explanation goes.
- The explanation makes stakes legible; it does not justify the question. If it reads as an account of what you missed or why you are asking now, rewrite it around what breaks.
- A user picking the ask-back has not stalled the session — they found the question that was not clear enough. Never treat it as a non-answer to escalate past.
- Nodes resolving to an obvious default belong in `Default Changes`. That filters _what_ you ask, never whether to continue.
- "Safe enough" is the failure mode, not the finish line: a short session launders an unexamined plan as a reviewed one. Budget both — ~20 questions across four to six rounds.
