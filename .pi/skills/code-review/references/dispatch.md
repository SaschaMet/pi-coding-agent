# Dispatch Clauses

The diff-handoff rule, budget accounting, model selection, pass-specific prompt text, and the collect call.
The spawn templates stay in `SKILL.md` — fill a template and append the relevant clause below.

Two agents run per review, in two waves:

1. **Reviewer** — `references/reviewer.md`. All three lenses (QA, Security discovery, Code Quality) over one
   read of the changed code.
2. **Security verification** — `references/security-verification.md`. Only when the reviewer returned at
   least one `security` finding.

## Diff handoff

**Never inline the diff into a spawn prompt.** The agent runs its own scoped diff as its first tool call:

```text
git diff HEAD -U1 -- <changed files>
```

Inlining costs the parent output tokens for every byte of diff, at roughly 5× the price of input, and the
agent pays for the bytes again on its side. Having the agent fetch the diff itself is the same bytes at input
price, once. There is no quality difference — it is the same output either way.

- The spawn prompt carries the **file list**, never the diff body.
- Use `-U0` instead of `-U1` only when the changed-line count exceeds 300.
- No agent ever runs the unscoped `git status` or `git diff` — the parent already holds them.
- The verifier never sees the diff at all, in any form: only the finding and the cited code.

## Budget accounting

| Agent | Turns | Review tool calls |
| --- | --- | --- |
| Reviewer | 10 | 16 |
| Security verification | 8 | 12 |

Reading its own reference, `finding-explanation.md`, `severity.md` (reviewer only), and the one scoped diff
call do not count against the tool budget. Those are mandatory overhead; counting them leaves too few usable
calls, and an exhausted agent forces a scope note that blocks `PASS`.

Instruct every agent to **batch independent reads into one turn**. Turns, not calls, drive cost — each turn
re-sends the whole context.

## Model selection

Default: **inherit the orchestrator model** — pass no `model`. Per `README.md`, a skill may require a model,
and this is the one place where it pays: the reviewer is the highest-token agent in the skill.

Available cheap option in this environment: `grunt` (provider `iqRouter`). `claude-sonnet-5` and
`claude-haiku-4-5` are **not** in this pi build's Anthropic catalog — do not pass them; the spawn fails or
silently falls back.

| Agent | Model |
| --- | --- |
| Reviewer | Inherit by default. Pass `model: "grunt"` **only when the user asks for a cheap or fast review.** |
| Security verification | Always inherit. Never delegate exploit reasoning to a cheaper model. |
| Graphify digest | `model: "grunt"` — pure summarization of build output, near-zero quality risk. |

Fail-safe: if a spawn is rejected for an unknown model, retry once with no `model` field and add a scope note
that the review ran on the orchestrator model. Never skip a pass because a model was unavailable.

## Finding caps

- **Blocking findings** (`qa` + `code_quality`): at most 8, ranked by severity. Overflow to one-line scope
  notes.
- **Security**: uncapped. Every candidate meeting the Finding Bar keeps its full schema and exploit path — a
  candidate compressed to a one-line note cannot be verified.
- **Optional** (naming, formatting, comments, documentation drift): uncapped, one line each, in `## Optional`.
  Never counted against the 8. Without this split, the "always flag all documentation drift" rule fills the
  blocking slots with LOWs and pushes real findings into scope notes.

## Pass-specific prompt clauses

**Reviewer**

> "Answer from the diff, the changed files, the existing tests, and the existing code. Run at most one test
> command, only when a finding needs execution proof that reading cannot give and Project Validation Context
> supplies the exact command string; no retries if it fails to run — record the assumption and lower
> confidence instead. End your verdict with one line per lens (qa, security, code_quality) naming what you
> checked, even where you found nothing."

**Security verification**

> "You are given only the finding and the cited code; you have not seen the reviewer's reasoning. Re-read the
> cited code and its immediate callers/callees, try to refute the finding, and check the triage factors.
> Return: verdict (confirmed|unconfirmed), confidence (high|medium|low), severity (HIGH|MEDIUM|LOW from the
> rubric), reason (one line)."

## Collect

```text
get_subagent_result({ agent_id: "<agent-id>", wait: true })
```

Collect every dispatched agent with `wait: true` before assembling the report or producing a verdict.
