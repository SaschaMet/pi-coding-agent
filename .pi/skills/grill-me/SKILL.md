---
name: grill-me
description: Use this skill when the user asks to grill, pressure-test, or challenge a documented plan, design, architecture, proposal, or technical decision. Find contradictions, unstated assumptions, missing edge cases, and high-impact risks through concise adversarial questioning. Do not use for code review or implementation.
---

Interview the user relentlessly about this plan until you reach a shared understanding.
You are the last gate before this goes to production.

Model the plan as a **design tree**: every decision branches into the decisions that hang off it.
Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already
settled — the questions you can ask _now_ without guessing at answers you have not heard yet.
Ask the whole frontier in one round, then wait. Each round of answers pushes the frontier outward.

Spend the session on high-impact uncertainty. Fewer, sharper questions beat exhaustive coverage —
but never stretch a frontier across multiple rounds to look economical.

## Step 1 — Silent Research

Do the homework before you ask or flag a single thing. Your credibility is that you never ask what the codebase already answers.

1. Read the idea / plan / design in full. Note every claim the user makes about how something works — you verify these against the code during questioning.
2. Repo-bound plan: read project context in a single parallel batch — `AGENTS.md`, `CONTEXT.md` (or `CONTEXT-MAP.md`), `CONTRIBUTING.md`, architecture docs, ADRs, README, key config.
3. Map the affected area: `rg --files` for the named or nearest project areas, `rg` for text searches. Then read entry points, data flow, existing tests, deployment config, and prior plans in `docs/plans/`.
4. Check prior art: similar features, past decisions, existing patterns.
5. Name the **blast radius** — what breaks if this design is wrong.
6. Architecture-heavy plan: write a silent CARDS note.
   - Clarity: ambiguous concepts, names, or responsibilities.
   - Alignment: dependency direction and ownership boundaries.
   - Resilience: whether likely small changes stay local.
   - Domain Integrity: invalid states the design allows or prevents.
   - Separation: whether domain policy, orchestration, IO, and presentation are mixed.

**Graphify gate**: if `graphify-out/graph.json` exists at the repository root, query it for the plan's named systems, dependency paths, owner modules, god nodes, surprising connections, and community boundaries. If no graph exists and the plan is architecture-heavy or cross-module, run `graphify <repo-root> --mode deep --no-viz` first. Skip graphify for non-repo-bound plans and small localized plans. Use its output for two things: prioritizing which files and relationships to inspect, and deriving dependency edges for the decision graph in Step 4 — a decision about module A that module B depends on must settle before B's decisions can be asked. Never let it replace direct verification.

**Done when**: every system named in the plan maps to concrete files, and every user claim about existing behavior is either verified or queued for questioning.

## Step 2 — Risk Assessment

Categorize risks silently using [references/risk-taxonomy.md](references/risk-taxonomy.md). For architecture prompts, apply CARDS and graphify evidence — dependency direction, ownership, invariants, separation, god-node concentration, cross-community coupling — before any question.

- **Critical** — data loss, security breach, or system outage. Resolve before the session closes.
- **High** — significant rework, performance degradation, or user-facing bugs. Resolve or explicitly accept as risk.
- **Medium** — design smell, maintainability concern, unclear edge case. Never a question — Default Change, or drop it.

**Budget rounds, not questions.** Question count is unbounded; a wide plan legitimately produces a wide
first round. Three to five rounds is a normal session. If you are past round five and the frontier is
still growing, the finding is _the scope is too big_ — say so, propose splitting the plan, and grill the
pieces separately. An unspent budget is a good outcome: if you already have enough to recommend safe
defaults, go to the summary.

Skip low-risk nitpicks entirely. Focus time on what hurts most.

**Done when**: every risk carries a tier and is routed to a decision node (Step 4) or a default change (Step 3).

## Step 3 — Apply Common Sense Before Asking

Before turning any risk into a question, ask yourself:
_"Does industry best practice, common sense, or a well-known default already answer this?"_

**If yes — do not ask. Record the default change you would make.**

Use this format:

> [High] Missing retry/backoff on an external API call.
> Default change: add idempotent exponential backoff with jitter.
> No question needed unless the team has a known reason to avoid retries.

Only ask an open question when:

- The answer depends on a decision only the user can make (e.g., business trade-offs, team constraints)
- The codebase contradicts the standard approach and you need to understand why
- The standard approach is ambiguous for this specific context

Defaults to apply without asking:

- API surface changed and no documentation approach is named: use OpenAPI/Swagger unless the repo already uses something else
- External API call with no resiliency noted: add timeouts, retries, and backoff if the operation is safe to retry
- New async/background work with no visibility noted: add structured logging and success/failure metrics
- New write path with no tests noted: add focused regression tests for the write and failure path
- New rollout risk with no deployment guidance: prefer a feature flag or other reversible rollout if the stack supports it

Replace generic prompts with concrete findings:

| Instead of asking                 | Do this                                                       |
| --------------------------------- | ------------------------------------------------------------- |
| "Have you considered pagination?" | Flag the missing pagination as a default change               |
| "What about error handling?"      | Name the specific unhandled error path                        |
| "Did you think about security?"   | Name the exact attack surface                                 |
| "What's your testing strategy?"   | No tests in the plan is the finding — record the tests to add |

**Done when**: the remaining list contains only decisions the user alone can make — everything else is a default change.

## Language Discipline

These behaviors run in parallel throughout the entire session — not as a discrete step.

**Challenge against the glossary**: When the user uses a term that conflicts with an existing definition in `CONTEXT.md`, call it out immediately before continuing. Do not let the ambiguity accumulate. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

**Sharpen fuzzy language**: When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things." Do not accept "it depends" as a resolution.

## Step 4 — Build the Decision Graph

Turn the surviving decision-forcing risks into a graph before asking anything.

- **Nodes** are decisions only the user can make. One decision per node.
- **Edges** are dependencies: draw `A → B` when B's answer would change depending on how A is answered.
  Derive edges from the plan's own structure, from graphify dependency paths, and from ownership
  boundaries — a decision about a module settles before decisions in the modules that depend on it.
- **Frontier** = every node whose prerequisites are all settled. That is the next round, in full.
- A node that depends on another node still open belongs to a _later_ round. Never both in one round.

The frontier is your judgement, not a computed graph. You will sometimes put two nodes in one round
and only afterwards find that one answer should have changed the other. When that happens — or when
the user points it out — reopen the affected branch in the next round and say which node you are
reopening. Do not silently keep the stale answer.

**Done when**: every remaining risk is a node, every node has its prerequisites drawn, and the first
frontier is non-empty or the whole graph is empty.

## Step 5 — Questioning in Rounds

Ask the whole frontier. Wait for the answers. Recompute the frontier. Repeat.

### Rules

- **One round at a time, the full frontier in it.** Never drip-feed a frontier across rounds, and never
  ask a node whose prerequisite is still open.
- Number the questions within a round. Order by tier: `[Critical]` first, highest impact within the
  tier first, then `[High]`. Medium never becomes a question.
- **Every question carries your recommended answer.** A question without a recommendation is unanswerable
  by number and pushes work back onto the user.
- **If the harness offers a structured question tool or extension — `ask-user-question`, `user-input`, or
  equivalent — use it.** One call per round, one entry per question, the recommendation as the default or
  pre-selected option. Fall back to the chat format below only when no such tool is available.
- Chat fallback format, one block per question:

  ```
  ❓ **Q1** — **[Critical] <short title>**: <question body, including the concrete options>
     [Explanation & Context] <A concise 'Eli5' explanation with context for the user, so they can answer the question with all the information they need to make an informed decision.>
  ➡️ <your recommended answer, and the one-line reason>
  ```

- **Phrase every question as an explicit choice**, so the recommendation names one of the options. Never
  word a question so that agreeing with the recommendation means answering "no" to the question itself.
- Keep questions concrete and specific. No abstract "what about scalability?" — instead:
  "This stores session state in memory. What happens to in-flight requests during a rolling deploy?"
- Keep the explanation concise. The user should be able to answer the question without reading the entire plan again.
- **Facts are your job, decisions are the user's.** When a frontier question needs a fact from the
  environment (filesystem, tools, dependency versions, prod config), dispatch a sub-agent to find it —
  never ask the user something you could look up. Do not block on it: a running exploration is an
  unsettled prerequisite, so only the nodes downstream of it wait. Ask the rest of the frontier now.
- If the answers resolve the remaining high risks through an obvious default, stop asking and move to the summary.
- If the graph is empty at Step 4, skip questioning entirely and go straight to the summary.

### Questioning Techniques

- **Unstated assumptions**: "You're assuming X. What if that's wrong?"
- **Trade-off probes**: "You chose A over B. What did you give up?"
- **Contradictions**: "Earlier you said X, but this implies Y."
- **Failure modes**: "What happens when Z fails at 3am with no one on-call?"
- **Scale pressure**: "This works for 100 users. What changes at 100,000?"
- **Security surface**: "Who can call this? What stops an attacker from doing Y?"
- **Dependency risk**: "You depend on X. What's your fallback if it's down/deprecated/slow?"
- **Reversibility**: "If this is wrong, how expensive is it to undo?"
- **Concrete scenarios**: When domain relationships are discussed, invent specific scenarios that force precision about boundaries between concepts. "What happens if a Customer places an Order and then the User account is deleted mid-fulfillment?"
- **Code contradiction**: When a user claim contradicts the code or graphify paths, surface it directly. "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"
- **CARDS pressure**: Turn architecture risks into concrete trade-offs. "This moves payment policy into a queue adapter. Is the adapter now allowed to own domain decisions, or should the policy stay in the payment domain service?"

### Escalation Protocol

Escalation happens _between_ rounds, not mid-round. Process the whole batch of answers, then decide what
each node becomes in the next frontier.

- **Strong answer**: node settled. Acknowledge in one line at the top of the next round.
- **Partial answer**: the gap becomes a new node in the next frontier, stated precisely. "That handles the happy path. What about [specific failure]?"
- **Vague or hand-wavy answer**: re-ask next round with narrower options. "That's not specific enough — pick one: A, B, or C."
- **"I don't know"**: a real answer. If talking cannot settle it, say so and recommend prototyping or a spike instead of rephrasing it a third time.
- **User explicitly accepts the risk**: record it and drop the node. Don't re-ask.
- **Three rounds on the same node with no resolution**: mark as open issue and drop it.

**Done when**: the frontier is empty — every Critical and High risk resolved, explicitly accepted, or marked as an open issue.

## CONTEXT.md Maintenance

`CONTEXT.md` is the project's shared glossary of terms.

- **Glossary only**: every entry defines what a term IS, in one or two sentences. Implementation detail, specs, and design decisions stay out.
- **Approval-gated**: propose each resolved term as a `CONTEXT.md` entry in the summary. Edit the file inline only when the user explicitly approves glossary edits.
- **Create on approval**: if `CONTEXT.md` does not exist, create it from [references/CONTEXT-FORMAT.md](references/CONTEXT-FORMAT.md) once the user approves glossary edits.

## Step 6 — Confirmation Gate

An empty frontier ends the _questioning_, not the session. Before writing the summary, state that the
frontier is empty and ask the user to confirm you have reached a shared understanding. If they reopen
anything, that branch becomes the next round — go back to Step 4.

Do not act on the plan until they confirm. Writing code or a spec at this point is a failed session,
regardless of how complete the understanding looks to you.

## Step 7 — Summary

Read [references/summary-template.md](references/summary-template.md) and write the summary in that structure: questions asked, answers given, default changes, risks accepted, open issues, recommended next steps.

**Done when**: every question asked has its answer and round recorded, every unresolved risk appears under Risks Accepted or Open Issues, and every next step is a concrete action.

## Gotchas

- This is a grilling, not planning. Produce implementation code or a plan only if the user asks for one after the summary.
- Answering your own decision questions breaks the skill. Look up facts; wait for decisions.
- Alternative architectures stay out of scope. Obvious baseline fixes belong in `Default Changes`.
- Deliver critical feedback straight. Softened findings get ignored.
- Once the plan is safe enough, stop and summarize. If the only nodes left would resolve to obvious defaults, drop them into `Default Changes` instead of asking another round.
- Count rounds, not questions. A wide round is healthy; a long chain of narrow rounds means the graph edges were drawn wrong.
