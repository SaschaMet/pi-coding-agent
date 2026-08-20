---
name: security-verification
description: Independently verify Security-pass findings and triage severity before they reach the final verdict
---

Discovery and verification must be separated. A second agent that only sees the finding and the cited code — never the reviewer's reasoning — catches plausible-but-wrong findings that the original author rationalizes away. Running this independent pass roughly halves false positives. This is the one place in the skill where isolating an agent buys quality that nothing else can, which is why it survives as its own wave.

Use this reference after the reviewer returns findings, when at least one `security` finding exists. Skip it entirely when the Security lens was dropped or produced no findings.

## Budget

- 8 turns and 12 tool calls of review work. Reading this reference does not count against the 12.
- Reads are bounded by the Standard/Complex route below; do not explore beyond the routed depth.
- Batch independent reads into one turn.
- This pass never receives the diff and never runs one. It sees the findings and the cited code only — that is the whole point of the separation.
- Always run on the orchestrator model. Never delegate exploit reasoning to a cheaper model.
- When the budget runs out, return the verdicts you have plus a scope note naming what you did not verify.

## Route: Standard vs Complex

Before verifying, classify each finding:

- **Standard** — single file/function, a well-understood bug class (injection, missing auth check, hardcoded secret, etc.), no concurrency in the trigger. Verify with one read of the cited code plus immediate callers/callees.
- **Complex** — spans 3+ files/modules, involves concurrency/race/TOCTOU, or the root cause is ambiguous. Trace one additional hop of callers/callees beyond the immediate ones, and check for existing tests or comments describing the intended behavior, before defaulting to `unconfirmed`. A shallow look at a Complex finding is not sufficient grounds to refute it.

## Verification pass

Dispatch **one verifier per file that has findings**, with that file's findings grouped — not one verifier per finding. Independence comes from withholding the reviewer's reasoning, not from the number of agents; three verifiers on the same file each pay to read that file again for nothing.

Give each verifier **only**:

- the findings for its file: file, line, title, claimed exploit path
- read access to the cited code and its immediate callers/callees (plus one further hop for Complex findings, per the routing above)

Do **not** give the verifier the reviewer's evidence narrative or confidence. Verify each finding on its own; do not let one finding's verdict color the next. The verifier re-derives every conclusion independently.

The verifier's task, stated as disproof:

1. Re-read the cited code and the path from attacker-controlled input to the sink, tracing the depth required by the Standard/Complex route.
2. Try to refute the finding. Default to `unconfirmed` when the exploit path cannot be traced in the actual code at the required depth.
3. Check common false-positive patterns: input is not attacker-controlled, framework auto-escapes/parameterizes, value is validated upstream, sink is not reachable on this path, code path is test-only or dead.
4. Return a verdict and confidence.

Return one block per finding:

```text
file: path/to/file
line: 123
verdict: confirmed | unconfirmed
confidence: high | medium | low
severity: HIGH | MEDIUM | LOW
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

- Drop findings the verifier marks `unconfirmed` with low confidence; demote borderline ones to LOW and label them clearly.
- Keep `confirmed` findings; set final severity from the triage rubric, not the reviewer's first guess.
- Keep the reviewer's finding text verbatim. A demoted finding is the one exception: re-calibrate its "why fix it now" to the new severity, since an urgency argument written for a HIGH is wrong on a LOW. At LOW, that means collapsing the explanation to one sentence per `finding-explanation.md`.
- Deduplicate by **root cause**, not per call site: one canonical finding for a shared sink or shared missing control, listing the other locations as affected sites.
- Record dropped/demoted findings as a one-line scope note so the decision is auditable.
