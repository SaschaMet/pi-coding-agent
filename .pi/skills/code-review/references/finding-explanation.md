# Finding Explanation

Every finding carries an `explanation` field, placed **above** `recommendation`. It lets the reader decide —
fix it, defer it, or accept the risk — without reading the diff or knowing the subsystem.

## Explanation is not evidence

- **`evidence`** proves the finding is real, to a reviewer: code paths, exploit chains, failing scenarios,
  line references. Technical, terse, verifiable.
- **`explanation`** makes the stakes legible, to a decision-maker: plain language, consequences, trade-offs.
  No line numbers needed.

If the explanation reads like a restatement of the evidence, it has not been written yet.

## Length is set by severity

The three-part form exists for a reader deciding *today*. LOW findings are not that decision.

| Severity | Form |
| --- | --- |
| HIGH, MEDIUM | All three parts, in order — one short paragraph each or three labelled sentences |
| LOW | **One sentence** naming what it costs to ignore. No three-part structure |

Writing a three-part paragraph for a LOW is wasted work in both directions: nobody weighs a release against
a LOW, and the urgency register borrowed from a HIGH misrepresents it. If a LOW genuinely needs three parts to
be understood, it is not a LOW — re-rate it.

## The three parts

For HIGH and MEDIUM, write all three, in this order, as one short paragraph each or three labelled sentences.

1. **What this is** — the defect in plain language. No jargon, no internal symbol name the reader would have
   to look up. Someone who has never opened this file should follow it.
2. **Why it matters** — the concrete consequence: what breaks, who hits it (end user? on-call? the next
   developer in this file?), when (next deploy? under load? silently, months later?), and how far it spreads.
   Use the blast-radius notes from Review Context. "This is a bug" is not a consequence.
3. **Why fix it now** — what fixing costs against what leaving it costs, and what makes it urgent or safely
   deferrable. Name the cheap fix when there is one; say plainly when the fix is invasive.

## Never narrate the review

Strip every sentence whose subject is the review or the reviewer — the reader did not ask how the finding was
discovered, and `confidence` already carries that.

> ✗ "During the QA pass I noticed while tracing the retry logic that this might be an issue, so I flagged it
> for closer inspection."
> ✓ "Password reset tokens are looked up but never marked used. Anyone who obtains a reset link can reuse it
> indefinitely to take over the account. The fix is one write in the existing transaction; leaving it
> means every link ever issued stays a live credential."

## Worked examples

Two registers. Do not borrow the HIGH's urgency language for a LOW finding.

**security / HIGH**

> explanation: What this is — the new `/export` endpoint accepts a user id and returns that user's records,
> but never checks the caller is that user. Why it matters — any authenticated account can read any other
> account's export by changing one number in the URL; this is the whole customer table, reachable from a
> browser, and access logs look like normal traffic. Why fix it now — the endpoint ships in this release and
> the check is three lines next to the existing session lookup; after release, every exposure is a
> disclosure you have to notify on.

**code_quality / LOW** — one sentence, no three-part structure:

> explanation: The new threshold constant governs one of three call sites in this module while the other two
> keep their own literals, so the next change to this value silently applies to a third of the paths.
