# Question Format

How to write a question so the user can decide from it alone. Read before the first round.

## The four-part explanation

Every question carries all four, in this order. Independent of output format.

Write them to the eli5 rules — [../../eli5/SKILL.md](../../eli5/SKILL.md), sections _Style rules_ and
_Hard bans_. One idea per sentence. Twenty words per sentence. Active voice. No metaphors, no hedges.
Any term the user has not used themselves gets defined once, in a short clause, at first use.

1. **What the plan says now** — the anchor. Name the section, file, or line the question attacks, and
   quote or paraphrase what it currently says. One sentence. Without this the user has to hunt for the
   subject of your question before they can think about it, and a question they cannot locate is a
   question they cannot answer. "Plan §4 says the worker retries three times, then drops the job."
2. **What this is** — the mechanism or decision in plain language. No jargon, no acronym the plan
   introduced, no term the user has not already used themselves.
3. **Why it matters** — the concrete consequence of getting it wrong. What breaks, who notices it and
   when (deploy? 3am page? silent data drift six months out?), what it costs to undo. Reuse the blast
   radius named in Step 1, in plain words. "This is important" is not a consequence; "orders placed
   during the rolling deploy are lost, and there is no way to detect it after the fact" is.
4. **What you need to know to choose** — the facts that actually separate the options, from your own
   research, with `file:line` references where they exist. This is where the Step 1 homework gets spent.

### Never narrate your process

The user did not ask why the question exists — they asked what happens if they choose wrong. Strip every
sentence whose subject is you or the grilling.

> ✗ "I should have flagged this during research, but the plan does not specify a retry policy, so I want
>    to check with you before assuming one."
> ✓ "Every checkout calls the payment provider once with no retry. When their API blips — it did twice
>    last quarter — the customer sees a generic failure and the cart empties. The order is never written,
>    so nothing shows up in reconciliation and support has no record to refund against."

## Options and recommendation

Each option states what it does, what it costs, and what it rules out — two to three sentences. The user
chooses between the descriptions, so a difference that does not appear in them cannot be weighed. If two
options read the same, they are not finished.

**Every question carries a recommendation. No exceptions, no path-specific excuses.** It is one piece of
text with three facts — the winning option, why it beats _the specific runner-up_, and when it would be
the wrong call. Write that text once, then place it where the output path puts it: option #1's
description on the tool path, the `➡️` line on the chat path. The wording does not change between them.

> ✗ "Recommended: A, it's simpler."
> ✗ "Both are defensible — it depends on your priorities."
> ✓ "Recommended: A. B buys per-tenant isolation you do not need until you have a second tenant, and
>    costs a migration to get out of. A is wrong if you already know tenant two lands this quarter."

A question you cannot recommend an answer to is a question you have not finished researching. Go back to
Step 1 for that node. If the choice genuinely turns on a priority only the user holds, name the priority
you assumed and recommend under it — "assuming you would rather ship late than migrate twice, A".

## Structured question tools

`ask_user_question` and equivalents have **no explanation field**. Map onto what they do have:

- **Explanation** → all four parts inside the question string itself: question → explanation → the
  concrete choice. Never the short header field (typically capped at 16 characters). The tool having no
  explanation field is not permission to drop the explanation; it only decides where it goes.
- **Per-option trade-off** → that option's `description`.
- **Recommendation** → option #1, labelled `(Recommended)`, with the reasoning in its description.
- **Ask-back** → the last authored option (below).
- **Option cap** (commonly four) → the ask-back occupies one slot, so **three substantive choices at
  most**. A question needing more is two questions.

## The ask-back option

The last option on every question is an ask-back — label `Ask me back / go deeper`, described as _"You
have a question, need more detail, or I have misread something. Nothing is decided; I answer first, then
re-ask this one."_

A free-text row alone is not enough: it makes the user guess whether typing a question reads as a
decision, and makes you guess what they meant. Naming the intent removes both guesses.

Choosing it is **not an answer**. The protocol is fixed:

1. Do not settle the node, do not advance the frontier past it, and do not count it as one of the three
   escalation rounds. A user asking for detail is not a user failing to decide.
2. Answer them in chat first, in full. If they attached a note, that note _is_ the question — respond to
   it literally before anything else.
3. If the ask-back reveals you misread the plan or the code, repair the research — re-read the files,
   re-run the graphify query. Never rephrase a question built on a wrong premise.
4. Re-ask that node alone, correction folded into the explanation. Other nodes answered in the same round
   stay settled.
5. Multi-select: ask-back selected alone means "answer me first". Selected alongside real options, treat
   those selections as provisional and confirm them on the re-ask.

## Chat fallback format

Only when no structured question tool is available. One block per question.

```
❓ **Q1** — **[Critical] <short title>**: <the question itself, ending in a question mark>

   **The plan says now** — <section or file:line, and what it currently says>
   **What this is** — <the mechanism in plain language, no jargon>
   **Why it matters** — <what breaks, who notices and when, what it costs to undo>
   **What you need to know** — <the deciding facts from your research, with file:line refs>

   **A)** <label> — <what it does, what it costs, what it rules out>
   **B)** <label> — <same>
   **C)** Ask me back / go deeper — <you have a question, need more detail, or I misread something>

➡️ **Recommended: <A or B>** — <why it beats the other named option, and when it would be wrong>
```

## A complete question

Everything above, applied once. Copy the shape, not the subject.

```
❓ **Q2** — **[Critical] Refunds during a failed sync**: When the payment provider confirms a refund but
our write fails, what should the system do?

   **The plan says now** — Plan §5 says the refund worker calls the provider, then writes the refund row.
   It does not say what happens if the write fails.
   **What this is** — A refund happens in two steps. First we tell the provider to send the money back.
   Then we write a row saying we did. Right now nothing links the two steps.
   **Why it matters** — The money leaves, and our records do not show it. Support sees an open refund and
   issues a second one. We found two of these by hand last quarter. Nothing detects them automatically.
   **What you need to know** — The provider accepts the same idempotency key twice and does not pay twice
   (`src/payments/provider.ts:88`). The refund table has no unique key on the order id today.

   **A)** Write the row first, then call the provider — The row is written as "pending" before any money
   moves. A failed call leaves a pending row you can retry or cancel. Costs one extra write per refund.
   Rules out refunds that exist only at the provider.
   **B)** Keep the order, add a reconciliation job — The worker stays as it is. A nightly job compares
   our rows to the provider's. Cheaper to build now. Gaps stay invisible for up to 24 hours.
   **C)** Ask me back / go deeper — You have a question, need more detail, or I have misread something.
   Nothing is decided; I answer first, then re-ask this one.

➡️ **Recommended: A** — B leaves a window where the money is gone and nothing in our system knows, and
that window is exactly where the two manual cases last quarter came from. A is wrong if refunds are rare
enough that a nightly job is acceptable and you need the worker unchanged this sprint.
```

## Questioning techniques

- **Unstated assumptions**: "You're assuming X. What if that's wrong?"
- **Trade-off probes**: "You chose A over B. What did you give up?"
- **Contradictions**: "Earlier you said X, but this implies Y."
- **Failure modes**: "What happens when Z fails at 3am with no one on-call?"
- **Scale pressure**: "This works for 100 users. What changes at 100,000?"
- **Security surface**: "Who can call this? What stops an attacker from doing Y?"
- **Dependency risk**: "You depend on X. What's your fallback if it's down/deprecated/slow?"
- **Reversibility**: "If this is wrong, how expensive is it to undo?"
- **Subtraction**: "What breaks if we ship without this entirely?" and "who is the second implementation of
  this abstraction?" — see [simplification.md](simplification.md) for the full set. Every other technique
  here pressures the plan to grow; these are the only ones that pressure it to shrink, so reach for them
  first on a plan that is already large.
- **Concrete scenarios**: force precision about boundaries between concepts. "What happens if a Customer
  places an Order and then the User account is deleted mid-fulfillment?"
- **Code contradiction**: surface it directly. "Your code cancels entire Orders, but you just said partial
  cancellation is possible — which is right?"
- **CARDS pressure**: turn architecture risks into concrete trade-offs. "This moves payment policy into a
  queue adapter. Is the adapter now allowed to own domain decisions, or should the policy stay in the
  payment domain service?"
