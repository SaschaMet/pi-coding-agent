# Skill Failure Modes

Use this reference when auditing or troubleshooting a skill. Name the failure mode first, then apply its smallest defence. Diagnosis drives the edit; do not reach for prose rewrites until the mode is named.

## Premature completion

Ending a step before it is genuinely done — attention slips to _being done_ rather than the work.

Defence, in order (cheap, local first):

1. Sharpen the completion criterion so it is _checkable_ (and where it matters, _exhaustive_).
2. Only if it stays irreducibly fuzzy _and_ you observe the rush, hide the remaining steps (split by sequence, below) so they cannot tempt the agent forward.

## Duplication

The same meaning in more than one place. Costs maintenance and tokens, and inflates that meaning's prominence past its real rank.

Defence: keep one source of truth and reference it; collapse synonyms that rename a single branch.

## Sediment

Stale layers that settle because adding feels safe and removing feels risky. The default fate of any skill without a pruning discipline.

Defence: run the pruning discipline on every change — relevance check per line, then the no-op test per sentence.

## Sprawl

The skill is simply too long, even when every line is live and unique. Hurts readability and wastes tokens.

Defence: the ladder — disclose reference behind pointers, and split by branch or sequence so each path carries only what it needs.

## No-op

A line the agent already obeys by default, so you pay load to say nothing. Test: does it change behaviour versus the default? A weak leading word (_be thorough_ when the agent is already thorough) is a no-op — the fix is a stronger word (_relentless_), not a different technique.

## Negation

Steering by prohibition backfires: naming the banned behaviour makes it more available. Prompt the **positive** — state the target behaviour so the banned one is never spoken. Keep a prohibition only as a hard guardrail you cannot phrase positively, and even then pair it with what to do instead.
