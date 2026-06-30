---
name: security-verification
description: Independently verify Security-pass findings and triage severity before they reach the final verdict
---

Discovery and verification must be separated. A second agent that only sees the finding and the cited code — never the discovery agent's reasoning — catches plausible-but-wrong findings that the original author rationalizes away. Running this independent pass roughly halves false positives.

Use this reference after the Security discovery subagent returns findings, when at least one security finding exists. Skip it when the Security pass produced no findings.

## Verification pass

For the security findings (one verification subagent per finding, or one batched verifier for ≤3 findings), give the verifier **only**:

- the finding: file, line, title, claimed exploit path
- read access to the cited code and its immediate callers/callees

Do **not** give the verifier the discovery agent's evidence narrative or confidence. The verifier re-derives the conclusion independently.

The verifier's task, stated as disproof:

1. Re-read the cited code and the path from attacker-controlled input to the sink.
2. Try to refute the finding. Default to `unconfirmed` when the exploit path cannot be traced in the actual code.
3. Check common false-positive patterns: input is not attacker-controlled, framework auto-escapes/parameterizes, value is validated upstream, sink is not reachable on this path, code path is test-only or dead.
4. Return a verdict and confidence.

```text
verdict: confirmed | unconfirmed
confidence: 0.00-1.00
reason: one line — the exploit path you traced, or why it does not hold
```

## Triage severity rubric

Set severity from three factors, not gut feel:

- **Reachability** — can attacker input actually reach the sink on a real path?
- **Attacker control** — how much of the dangerous input does the attacker control?
- **Preconditions** — what must already be true (auth, specific config, race) to exploit?

| Severity | Rule |
| --- | --- |
| HIGH | Reachable, attacker controls the sink input, few/no preconditions. |
| MEDIUM | Reachable but needs meaningful preconditions, or partial attacker control. |
| LOW | Reachable only under unlikely preconditions, or minimal attacker control. |

## How the parent uses results

- Drop findings the verifier marks `unconfirmed` with confidence < 0.5; demote borderline ones to LOW and label them clearly.
- Keep `confirmed` findings; set final severity from the triage rubric, not the discovery agent's first guess.
- Deduplicate by **root cause**, not per call site: one canonical finding for a shared sink or shared missing control, listing the other locations as affected sites.
- Record dropped/demoted findings as a one-line scope note so the decision is auditable.
