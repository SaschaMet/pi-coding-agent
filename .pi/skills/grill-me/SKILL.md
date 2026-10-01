---
name: grill-me
description: Use this skill when the user asks to grill, pressure-test, or challenge a documented plan, design, architecture, proposal, or technical decision. Find contradictions, unstated assumptions, missing edge cases, and high-impact risks through concise adversarial questioning. Do not use for code review or implementation.
---

Interview the user relentlessly about this plan until you reach a shared understanding. You are the last gate before this goes to production.

**Who answers.** The human answers every question. You ask; you never answer your own questions — not even provisionally, not even when the answer seems obvious. A session where you filled in answers is not a grill session, no matter how thorough the questions were: it can only be recorded as `overridden <date>: agent self-answered` in the target document's Grill Status table, never as `done`. If no human is present (worker or fleet pane), the session stops at the questions and waits — the user watches the panes and answers there.

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

### Your own vocabulary stays internal

The terms this skill uses to think are not terms the user has agreed to. They are precise for you and opaque to them, which is the worst combination in a question. **Never send one to the user.** Say the thing instead.

| Internal term            | Say instead                                                  |
| ------------------------ | ------------------------------------------------------------ |
| frontier                 | the decisions I can ask about now                              |
| node                     | decision, or question                                          |
| design tree / graph      | how these decisions depend on each other                       |
| tier                     | (drop the word; the `[Critical]` / `[High]` tags stay)         |
| blast radius             | what breaks if this is wrong                                   |
| one-way door             | hard to undo once shipped                                      |
| default change           | a change I will make without asking                            |
| simplification ladder    | checking whether this needs to exist at all                    |
| CARDS                    | name the actual constraint — "who owns this rule", and so on   |
| vertical slice           | a step you can run and see working on its own                  |

The same rule covers acronyms the plan introduced and terms you coined during research. Domain terms the user already uses are exempt — those are their words, and `CONTEXT.md` governs them.

## Step 4 — Build the Decision Graph

Turn the surviving decision-forcing risks into a graph before asking anything.

- **Nodes** are decisions only the user can make. One decision per node.
- **Edges** are dependencies: draw `A → B` when B's answer would change depending on how A is answered. Derive them from the plan's structure, graphify dependency paths, and ownership boundaries.
- **Frontier** = every node whose prerequisites are all settled. That is the next round, in full. A node with an open prerequisite belongs to a _later_ round — never both in one round.

The frontier is your judgement, not a computed graph. When an answer turns out to have changed another node you already asked, reopen that branch in the next round and say which node you are reopening. Never silently keep the stale answer.

**Done when**: every remaining risk is a node, every node has its prerequisites drawn, and the first frontier is non-empty or the whole graph is empty.

## Step 5 — Questioning in Rounds

Ask the whole frontier. Wait for the answers. Recompute the frontier. Repeat.

**Read [references/question-format.md](references/question-format.md) before the first round.** It owns the rules for each of the four parts, the option and recommendation specs, the ask-back protocol, and the questioning techniques. The block template and the model example live below, in _The question block_.

### The opening brief

**Send this before the first question. Never bundle it with round 1.** You have just spent four silent steps building a model of the plan; the user has not seen any of it. Questions that arrive before this brief land on someone who does not yet know which plan you read or what you think is at stake.

Plain words: active voice, simple words, no jargon, no hedges.

```
**Before we start**

- What this plan does: <one sentence>
- Why it is being done: <one sentence>
- What breaks if it is wrong: <one sentence, the blast radius in user terms>
- What I checked: <files or systems, one line>

Expect about <N> questions over <N> rounds. Answer as far as you can; "I don't know" is a real answer.
```

Four lines, one sentence each. If the plan cannot be stated in four lines, that is a finding — say the scope is too big before asking anything else.

### The round header

**Every round opens with three lines, including round 1.** Without them the user cannot tell how far in they are or what their last answers changed.

```
**Round <n> of about <total>** — <count> questions, <used>/~<budget> asked so far.
Settled last round: <one line, or "nothing yet — this is the first round">.
This round decides: <one line, the theme of the questions below>.
```

`<budget>` is the question count promised in the opening brief. `<used>` counts questions asked before this round.

Reopening a branch is named here, not buried in the question: "Reopening _<node title>_ — your answer on X changed it."

### The question block

Every question, in every round, is this block. The user must be able to decide from the four parts alone, without re-reading the plan or opening a file.

```
❓ **Q<n>** — **[<Critical|High|Medium>] <short title>**: <the question itself, ending in a question mark>

   **The plan says now** — <section or file:line, and what it currently says>

   **What this is** — <the mechanism in plain language; define any term the user has not used>

   **Why it matters** — <what breaks, who notices and when, which of the plan's own checks fail>

   **What you need to know** — <the deciding facts, verified, with their source; unverified ones labelled>

   **A)** <label> — <what it does, what it costs, what it rules out>

   **B)** <label> — <same>

   **C)** Ask me back / go deeper — you have a question, need more detail, or I have misread something. Nothing is decided; I answer first, then re-ask this one.

➡️ **Recommended: <A or B>** — <why it beats the other named option, how it serves the plan's goal, and when it would be wrong>
```

A complete round of one question. Copy the shape, not the subject — the depth, the sourced facts, and the link to the plan's own checks are what you copy.

```
**Round 1 of 3** — 1 question, 0/~7 asked so far.
Settled last round: nothing yet — this is the first round.
This round decides: the reload steps that decide whether the new policy and routing labels actually reach both sites.

❓ **Q1** — **[Critical] site-b never gets the new env vars into its proxy container**: The plan's deploy runbook ends both checkouts with only `docker compose restart proxy` — is that enough, or does site-b also need `docker compose up -d proxy` (recreate the container) before the restart?

   **The plan says now** — Plan §5: per checkout, the user adds `ROUTER_PREFIX` and `CSP_ANALYTICS_ORIGIN` to the env file, then "Both: `docker compose restart proxy`". No `up -d` step is listed for site-b. site-a gets one indirectly through `deploy.sh`, which runs `docker compose up -d` at `scripts/deploy.sh:213`.

   **What this is** — `docker compose restart` restarts the existing container as it is. It re-reads the proxy config file mounted from the host. It keeps the environment variables and routing labels (key-value tags the router reads) the container was created with. New env vars in `.env` only reach the container when compose **recreates** it (`up -d`).

   **Why it matters** — On site-b the plan skips `up -d` entirely. So at the final `restart proxy`, the proxy loads the new config with `CSP_ANALYTICS_ORIGIN` **unset**. The analytics origin drops out of `script-src`/`connect-src` in the Content-Security-Policy (the header that lists which origins a page may load from), so analytics fails silently on site-b. If the placeholder is written as `https://{$CSP_ANALYTICS_ORIGIN}`, it collapses to the invalid token `https://` in the policy. The new routing labels also never take effect there — the container keeps its old labels until the next full recreate. So the plan's own "Done When" curl checks would fail or lie on site-b.

   **What you need to know** — Verified on the live host: the running proxy container's config hash matches the compose file on disk, so a bare `up -d` will not recreate it either; recreation only triggers because the new committed compose file resolves **different** env and labels once the user's new vars are in `.env`. site-a is covered because `deploy.sh` runs `up -d` after the vars are added (§5 orders env edits before deploy). site-b's image stays at 0.1.74, so nothing else triggers a recreate there.

   **A)** Add an explicit `docker compose up -d proxy` step for site-b before the restart — the recreated container picks up the new env and labels, and the final restart then genuinely proves the reboot case. Costs one extra runbook step per site. Rules out the silent empty-policy state.

   **B)** Keep the plan as it is — accept that site-b's proxy runs on stale env until its next image deploy. Costs nothing today, but the §5 curl checks for site-b either fail or can only pass if the vars were somehow already in the container. Rules out the "Done When" guarantee for site-b.

   **C)** Ask me back / go deeper — you have a question, need more detail, or I have misread something. Nothing is decided; I answer first, then re-ask this one.

➡️ **Recommended: A** — B leaves site-b's policy silently missing the analytics origin and its labels stale, which is exactly the class of drift this plan exists to eliminate. A is wrong only if site-b's `.env` already held both vars before this plan — in that case `up -d` would still be the safe form, but B's failure mode would not apply.
```

### Rules

- **One round at a time, the full frontier in it.** Never drip-feed a frontier across rounds, and never ask a node whose prerequisite is still open.
- Number the questions within a round. Order by tier: `[Critical]` first, highest impact within the tier first, then `[High]`, then `[Medium]` — Medium only once no Critical or High node is open.
- **Every question is one full block in chat**, in the shape of _The question block_ above. **Do not use a structured question tool, even when the harness offers one** — its dialog hides the explanation and caps the options. The user answers in chat, for example `1A 2B 3D: <note>`.
- **Style**: active voice, simple words, one idea per sentence, no metaphors, no hedges. Use the plan's and the user's own terms; define any other term once, in a short clause. No line cap and no word cap — bold part labels and lettered options are the layout. An explanation still fails if its nouns are unexplained.
- **The explanation is about the decision, never about you.** Do not narrate your process, justify why you are asking, or account for what you did or did not notice earlier. Strip every sentence whose subject is you or the grilling.
- **Every option earns its own description**: what it does, what it costs, what it rules out. If two options read the same, you have not finished writing them.
- **Every question carries your recommended answer**: the option, why it beats _the specific runner-up_, and when it would be the wrong call.
- **Complete beats concise.** You already spent a round on this question; under-explaining it wastes the round. Cut repetition and hedging, never the facts needed to decide.
- **Every question offers a way out that is not an answer** — an ask-back option, always last, never first. Choosing it settles nothing and is not an escalation: answer them first, repair the research if they caught you misreading, then re-ask that node alone.
- **Ask what the plan should not contain.** At least one question per session pressures scope subtractively — what gets deleted, what defers to v2, what is built for a requirement nobody has named. On a plan that is already large, these come _before_ the additive questions, and "add a mechanism to make this safe" is the wrong answer when "remove the thing that needs protecting" is on the table.
- **Phrase every question as an explicit choice**, so the recommendation names one of the options. Never word it so that agreeing with the recommendation means answering "no" to the question.
- Keep questions concrete: not "what about scalability?" but "this stores session state in memory — what happens to in-flight requests during a rolling deploy?"
- **Facts are your job, decisions are the user's.** Dispatch a sub-agent for environment facts rather than asking the user something you could look up. Do not block on it: only the nodes downstream wait.
- Stop asking when the graph is genuinely empty, not when the plan starts to feel safe. Before declaring the frontier empty, spend one pass hunting nodes you never drew — the failure paths the plan omits, the operational story after it ships, the areas you read but never questioned. If the graph is empty at Step 4, skip questioning entirely.

**Round send gate — run before sending any round.** This is a gate, not a reminder: a round failing any line is not sent, it is fixed. Never send an incomplete round with an apology attached.

The round has:

1. the three-line round header above the questions.

Every question in it has:

2. a tier — `[Critical]`, `[High]`, or `[Medium]`,
3. all four explanation parts, in the style above, and not one sentence whose subject is you or the grilling — with at least one verified fact and its source in "What you need to know", and, when the plan has acceptance or "Done When" checks, the ones that would fail or give a false pass named in "Why it matters",
4. explicit named options, each with its own description of what it does, costs, and rules out,
5. an ask-back option, last,
6. a recommendation naming the winning option, the runner-up it beats, how it serves the plan's stated goal, and when it would be wrong.

Line 6 has no exceptions. A question you cannot recommend an answer to is a question you have not researched — go back to Step 1 for that node rather than handing the user an unweighted menu. "It depends on your priorities" is not a recommendation; name the priority you assumed and recommend under it.

If you catch yourself trimming any of these to keep the round short, you are optimising the wrong thing — rounds are budgeted, words are not.

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

An empty frontier ends the _questioning_, not the session. Say that no open decisions are left — in those words, not as "the frontier is empty" — say how many questions you asked against the ~20 budget, and ask the user to confirm you have reached a shared understanding. If they reopen anything, that branch becomes the next round — go back to Step 4.

Closing well under budget needs a one-line reason. "Eight questions; the plan is small and localized" is fine; "it seemed sufficient" is not. That line is the user's cue to push back if the session was shallower than the plan deserved.

**Report the net effect on plan size**: what this session added, and what it removed. If it only added, say so plainly — that is the signal the plan was pressured in one direction only, and the ladder in Step 3 needs another pass before the user confirms.

Do not act on the plan until they confirm. Writing code or a spec at this point is a failed session, regardless of how complete the understanding looks to you.

**Record the confirmation in the document.** When the target is a spec or plan file that carries a Grill Status table, set its latest row to `done <date>` — only after the user's explicit confirmation. Never mark `done` before it, and the implementing agent never writes `done` either. If the user explicitly overrides the grill requirement instead of confirming, record `overridden <date>: <reason>` in the document's Grill Status table; if the override skips the document itself, record date + reason in the session summary.

## Step 7 — Summary

Read [references/summary-template.md](references/summary-template.md) and write the summary in that structure: questions asked, answers given, default changes, risks accepted, open issues, next steps.

Show the summary in chat. When the target is a spec or plan, also write it to the document's folder as `docs/specs/<name>/grill-summary-<row>.md` or `docs/plans/<name>/grill-summary-<row>.md`, where `<row>` is the Grill Status row this session fills (see **Artifact folder** in [../create-spec/SKILL.md](../create-spec/SKILL.md)).

**Present the plan before the next steps.** Before the summary's Recommended Next Steps, present the target document's Execution Steps and Definition of Done so the user can approve or revise on the spot — without re-reading the document or looking anything up.

**Done when**: every question has its answer and round recorded, every unresolved risk appears under Risks Accepted or Open Issues, and every next step is a concrete action.

## Gotchas

- This is a grilling, not planning. Produce code or a plan only if the user asks after the summary.
- Answering your own decision questions breaks the skill. Look up facts; wait for decisions.
- Alternative architectures stay out of scope — a **simpler version of the same design** never is; cutting scope is not proposing a redesign. Every risk wants a mechanism attached, and a grilling that hands back a bigger, more complex plan has failed however many risks it closed. That bias is what you correct for, not what you follow.
- Deliver critical feedback straight. Softened findings get ignored.
- The explanation makes stakes legible; it does not justify the question. If it reads as an account of what you missed or why you are asking now, rewrite it around what breaks.
- A user picking the ask-back has not stalled the session — they found the question that was not clear enough. Never treat it as a non-answer to escalate past.
- Nodes resolving to an obvious default belong in `Default Changes`. That filters _what_ you ask, never whether to continue.
- "Safe enough" is the failure mode, not the finish line: a short session launders an unexamined plan as a reviewed one. Budget both — ~20 questions across four to six rounds.
