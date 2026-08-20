---
name: severity
description: Canonical severity rubric for code review findings — floors, compounding escalation, and pre-existing code
---

# Severity Rubric

Read by the reviewer (it assigns severity) and by the parent (it applies the floors at assembly and produces the verdict). Single source of truth for severity.

## Base Levels

- `HIGH` — ships a concrete production or user-visible failure, an exploitable vulnerability, or a quality-gate regression that disables future detection.
- `MEDIUM` — real defect or maintenance cost with a bounded blast radius, or a `HIGH`-shaped risk that depends on an unverified assumption.
- `LOW` — narrow, local, or contained impact; correct to raise if the diff makes it load-bearing.

Severity is a statement about production impact if the diff ships as-is. It is not a statement about diff size, author intent, or how easy the fix is.

## Floors

These are minimums. A finding may be rated higher when its impact warrants it, never lower.

- Unapproved test-only AI diffs are HIGH QA findings when tests, snapshots, or fixtures changed without implementation changes.
- Unapproved lint/typecheck bypasses are Code Quality findings; broad config/file-level ignores or weakened lint config are HIGH, line-local undocumented suppressions are at least MEDIUM.
- A cache introduced to protect a downstream rate limit or reduce latency that cannot activate under the real runtime call pattern on a hot path is HIGH (QA), cited against the specific caller.
- A cached or reused value constructed at a scope that does not match its intended lifetime is rated by the production impact it causes — added latency, rate-limit exposure — not by the fact that it is "only" an optimization.
- Findings on symbols with high blast radius (wide call-site count, or exported/public API) weight upward when the diff also changes that symbol's signature or behavior.
- Security severities come from the triage rubric in `references/security-verification.md`, set by the verification wave and not by the discovery agent's first guess. Drop `unconfirmed` findings below 0.5 confidence; demote borderline ones to LOW.

## Compounding Findings

When the most likely fix for finding A would activate or worsen finding B, raise B's severity to reflect the combined failure scenario and state the causal chain in B's evidence field.

Limits, all of which must hold:

- The **reviewer** applies this, over the union of its own findings across all three categories — it holds the code context the judgement needs. The parent does not redo it and does not undo it.
- At most one level per named causal link — LOW to MEDIUM, or MEDIUM to HIGH. Never two levels in one step.
- No transitive chaining. If A escalates B, B may not then escalate C on the strength of that same chain.
- Escalation only. This rule never lowers a severity.
- The evidence field must name the specific dependency ("fixing A makes B reachable because…"). A finding with no named dependency cannot be escalated under this rule.

## Pre-existing Code

Do not cap a finding at LOW because the code causing it predates the diff. "This behavior already existed" is a scope note, not a severity discount, when the diff's own new code is what makes the defect reachable, relied-upon, or newly load-bearing.

This applies only to defects the diff's new code makes load-bearing. Unrelated pre-existing issues the diff never touches stay out of scope entirely — they are not findings at any severity.

## When These Rules Do Not Fire

Each rule has a trigger precondition. If the precondition is absent, the rule produces nothing — do not reach for it to justify a severity you already picked.

- No new shared constant, threshold, or invariant in the diff → no inconsistent-adoption finding.
- No cache, pooled resource, or memoized value introduced or relocated by the diff → no cache-lifetime or cache-activation finding.
- No named causal link between two findings → no compounding escalation.
- The diff does not make a pre-existing defect reachable or load-bearing → the pre-existing-code rule does not apply.
