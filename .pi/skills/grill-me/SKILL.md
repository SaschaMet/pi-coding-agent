---
name: grill-me
description: Use this skill when the user asks to grill, pressure-test, or challenge a documented plan, design, architecture, proposal, or technical decision. Find contradictions, unstated assumptions, missing edge cases, and high-impact risks through concise adversarial questioning. Do not use for code review or implementation.
---

Interview the user relentlessly about this plan until you reach a shared understanding.
Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
You are the last gate before this goes to production.

Spend the session on high-impact uncertainty. Fewer, sharper questions beat exhaustive coverage.

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

**Graphify gate**: if `graphify-out/graph.json` exists at the repository root, query it for the plan's named systems, dependency paths, owner modules, god nodes, surprising connections, and community boundaries. If no graph exists and the plan is architecture-heavy or cross-module, run `graphify <repo-root> --mode deep --no-viz` first. Skip graphify for non-repo-bound plans and small localized plans. Use its output to prioritize which files and relationships to inspect, never to replace direct verification.

**Done when**: every system named in the plan maps to concrete files, and every user claim about existing behavior is either verified or queued for questioning.

## Step 2 — Risk Assessment

Categorize risks silently using [references/risk-taxonomy.md](references/risk-taxonomy.md). For architecture prompts, apply CARDS and graphify evidence — dependency direction, ownership, invariants, separation, god-node concentration, cross-community coupling — before any question.

| Tier         | Definition                                                                   | Action                                        |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------------- |
| **Critical** | Would cause data loss, security breach, or system outage                     | Resolve before moving on                      |
| **High**     | Would cause significant rework, performance degradation, or user-facing bugs | Resolve or explicitly accept as risk          |
| **Medium**   | Design smell, maintainability concern, unclear edge case                     | Never a question — Default Change, or drop it |

**Budget: 0-20 questions for the whole session — 20 is a hard cap.** At the cap, record any still-unresolved risk as an open issue and summarize. An unspent budget is a good outcome: if you already have enough to recommend safe defaults, go to the summary.

Skip low-risk nitpicks entirely. Focus time on what hurts most.

**Done when**: every risk carries a tier and is routed to a question (Step 4) or a default change (Step 3).

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

| Instead of asking               | Do this                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| "Have you considered pagination?" | Flag the missing pagination as a default change              |
| "What about error handling?"    | Name the specific unhandled error path                        |
| "Did you think about security?" | Name the exact attack surface                                 |
| "What's your testing strategy?" | No tests in the plan is the finding — record the tests to add |

**Done when**: the remaining question list contains only decisions the user alone can make.

## Language Discipline

These behaviors run in parallel throughout the entire session — not as a discrete step.

**Challenge against the glossary**: When the user uses a term that conflicts with an existing definition in `CONTEXT.md`, call it out immediately before continuing. Do not let the ambiguity accumulate. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

**Sharpen fuzzy language**: When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things." Do not accept "it depends" as a resolution.

## Step 4 — Questioning

Work the remaining decision-forcing risks one at a time. Keep the session short.

### Rules

- **ONE question or flag at a time.** Wait for the answer before moving to the next.
- Ask Critical first, highest impact within the tier first, then High. Medium never becomes a question.
- Start each with the risk tier label: `[Critical]` or `[High]`.
- Keep questions concrete and specific. No abstract "what about scalability?" — instead:
  "This stores session state in memory. What happens to in-flight requests during a rolling deploy?"
- Use the available user-input tool when present; otherwise ask one concise chat question.
- If an answer resolves the remaining high risks through an obvious default, stop asking and move to the summary.
- If there are no decision-forcing questions, skip questioning entirely and go straight to the summary.

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

- **Strong answer**: Acknowledge briefly ("Good, that covers it."), move to next risk.
- **Partial answer**: Identify the gap precisely. "That handles the happy path. What about [specific failure]?"
- **Vague or hand-wavy answer**: Push harder. "That's not specific enough. Give me the exact mechanism for handling X."
- **User explicitly accepts the risk**: Record it and move on. Don't re-ask.
- **Three rounds on the same point with no resolution**: Mark as open issue and move on.

**Done when**: every Critical and High risk is resolved, explicitly accepted, or marked as an open issue.

## CONTEXT.md Maintenance

`CONTEXT.md` is the project's shared glossary of terms.

- **Glossary only**: every entry defines what a term IS, in one or two sentences. Implementation detail, specs, and design decisions stay out.
- **Approval-gated**: propose each resolved term as a `CONTEXT.md` entry in the summary. Edit the file inline only when the user explicitly approves glossary edits.
- **Create on approval**: if `CONTEXT.md` does not exist, create it from [references/CONTEXT-FORMAT.md](references/CONTEXT-FORMAT.md) once the user approves glossary edits.

## Step 5 — Summary

Read [references/summary-template.md](references/summary-template.md) and write the summary in that structure: questions asked, answers given, default changes, risks accepted, open issues, recommended next steps.

**Done when**: every question asked has its answer recorded, every unresolved risk appears under Risks Accepted or Open Issues, and every next step is a concrete action.

## Gotchas

- This is a grilling, not planning. Produce implementation code or a plan only if the user asks for one after the summary.
- Alternative architectures stay out of scope. Obvious baseline fixes belong in `Default Changes`.
- Deliver critical feedback straight. Softened findings get ignored.
- Once the plan is safe enough, stop and summarize — even with budget left.
