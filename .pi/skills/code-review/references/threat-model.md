---
name: threat-model-context
description: Build lightweight threat context so the Security pass knows what counts as a vulnerability in this diff
---

You produce a short **Threat Context** block that grounds the Security pass. A defined threat model up front (trust boundaries, attacker, assets) is the single biggest lever on finding quality: when reviewers know what counts as a vulnerability, their findings are exploitable far more often and theoretical noise drops.

Scope is the current diff, not the whole repository. Do not audit unchanged code.

## When to build it

Build Threat Context only when the Security pass is selected. Pick the cheapest source:

| Situation | Action |
| --- | --- |
| `THREAT_MODEL.md` exists at repo root | Load it. Extract only the threats/boundaries the diff touches. |
| No threat model, diff touches a trust boundary | Build a lightweight 4-question sketch (below). |
| No threat model, diff is internal-only with no boundary change | Skip; pass a one-line "no new trust boundary" note instead. |

A diff "touches a trust boundary" when it adds or changes any of: an entry point (route, handler, CLI arg, message consumer), authn/authz, input parsing/validation/deserialization, file/network/subprocess I/O, secret/credential/token handling, or a security-relevant config default.

## The four-question sketch

Answer briefly, only for what the diff changes. Frame each as "what are we working on / what can go wrong / what do we do about it / did we do enough" — actionable, not exhaustive.

1. **What are we working on?** — The changed component, its assets (data, credentials, capabilities), and the new or modified entry points in this diff.
2. **What can go wrong?** — For each entry point: who the attacker is, what input they control, which sink or boundary it reaches. These become the Security pass's hunting list.
3. **What are we going to do about it?** — Controls the diff is expected to enforce (validation, authz checks, encoding, least privilege). Missing or weakened controls are candidate findings.
4. **Did we do a good job?** — Open questions and unverified assumptions to hand to the Security pass and report at the end.

## Output

Emit a compact block (not a file) for the parent to pass into the Security subagent:

```text
Threat Context (diff-scoped)
- Source: THREAT_MODEL.md | 4-question sketch | none (no new trust boundary)
- Assets: <data/capabilities at risk in changed code>
- Entry points changed: <routes/handlers/CLI/consumers>
- Attackers + controlled input: <who controls what reaches a sink>
- Expected controls: <validation/authz/encoding the diff should enforce>
- Open questions: <assumptions to verify>
```

Treat this as context that focuses the Security pass. It is not a finding by itself, and a missing threat model is not a finding.
