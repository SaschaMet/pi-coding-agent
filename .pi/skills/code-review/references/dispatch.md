# Dispatch Clauses

Pass-specific prompt text and the collect call. The dispatch table and the spawn template stay in
`SKILL.md` — append the relevant clause below to the spawn prompt for that pass.

## Pass-specific prompt clauses

**QA**

> "Answer from the diff, the changed files, and the existing tests. Run at most one test command, only when
> a finding needs execution proof that reading cannot give and Project Validation Context supplies the exact
> command string; no retries if it fails to run — record the assumption and lower confidence instead."

**Security verification**

> "You are given only the finding and the cited code; you have not seen the discovery agent's reasoning.
> Re-read the cited code and its immediate callers/callees, try to refute the finding, and check the triage
> factors. Return: verdict (confirmed|unconfirmed), confidence (0.00-1.00), severity (HIGH|MEDIUM|LOW from
> the rubric), reason (one line)."

Security discovery and Code Quality take no extra clause beyond the spawn template and their table inputs.

## Collect

```text
get_subagent_result({ agent_id: "<agent-id>", wait: true })
```

Collect every dispatched agent with `wait: true` before merging, deduping, or producing a verdict.
