# Finding Explanation

Every finding carries an `explanation` field, placed **above** `recommendation`. It exists so the reader can
make an informed decision — fix it, defer it, or accept the risk — without reading the diff, opening the
file, or knowing the subsystem.

## Explanation is not evidence

These two fields have different readers and must not duplicate each other.

- **`evidence`** proves the finding is real, to a reviewer. Code paths, exploit chains, failing scenarios,
  line references. Technical, terse, verifiable.
- **`explanation`** makes the stakes legible, to a decision-maker. Plain language, consequences, trade-offs.
  No line numbers needed.

If the explanation reads like a restatement of the evidence, it has not been written yet.

## The three parts

Write all three, in this order, as one short paragraph each or three labelled sentences.

1. **What this is** — the defect in plain language. No jargon, no acronym, no internal symbol name the
   reader would have to look up. Someone who has never opened this file should follow it.
2. **Why it matters** — the concrete consequence. What breaks, who hits it (end user? on-call? the next
   developer in this file?), when (next deploy? under load? silently, months later?), and how far it
   spreads. Use the blast-radius notes from Review Context. "This is a bug" is not a consequence;
   "every password reset issued during the retry window stays valid after use" is.
3. **Why fix it now** — what fixing costs against what leaving it costs, and what makes it urgent or
   safely deferrable. This is the part that lets the reader legitimately accept a LOW or defer a MEDIUM.
   Name the cheap fix when there is one; say plainly when the fix is invasive.

## Never narrate the review

The reader did not ask how the finding was discovered, which pass found it, or how confident the agent felt
— `confidence` already carries that. Strip every sentence whose subject is the review or the reviewer.

> ✗ "During the QA pass I noticed while tracing the retry logic that this might be an issue, so I flagged
>    it for closer inspection."
> ✓ "Password reset tokens are looked up but never marked used. Anyone who obtains a reset link — from a
>    forwarded email, a shared inbox, or browser history — can reuse it indefinitely to take over the
>    account, and nothing in the logs distinguishes a replay from a first use. The fix is one write in the
>    existing transaction; leaving it means every link ever issued stays a live credential."

## Calibrate to severity, not word count

A HIGH finding usually needs all three parts spelled out — that is the one the reader will act on today.
A LOW can be tighter, but still says what it costs to ignore. Brevity is never the reason a reader cannot
decide: an explanation too thin to weigh has failed at its only job.

## Worked examples

**security / HIGH**

> explanation: What this is — the new `/export` endpoint accepts a user id and returns that user's records,
> but never checks the caller is that user. Why it matters — any authenticated account can read any other
> account's export by changing one number in the URL; this is the whole customer table, reachable from a
> browser, and access logs look like normal traffic. Why fix it now — the endpoint ships in this release
> and the check is three lines next to the existing session lookup; after release, every exposure is a
> disclosure you have to notify on.

**qa / MEDIUM**

> explanation: What this is — the retry wrapper treats every failure as retryable, including the validation
> errors the API returns for bad input. Why it matters — a malformed request now hits the provider four
> times instead of once and fails four times slower, and the caller sees the timeout rather than the real
> validation message, so the actual cause is invisible in support tickets. Why fix it now — one predicate
> on the error type, in the wrapper you already touched; deferring means every future caller inherits the
> same misleading failure mode.

**code_quality / LOW**

> explanation: What this is — the new threshold constant is defined here but the two other call sites in
> this module still use their own literals. Why it matters — the next change to this value silently applies
> to one of three paths, and the divergence is invisible at the call site. Why fix it now — the two call
> sites are in this file and the swap is mechanical; the cost of leaving it is paid later by whoever assumes
> one constant governs all three.
