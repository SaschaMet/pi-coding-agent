# Grilling Summary Template

Use this structure when producing the final summary after all questioning is complete.

For short sessions with 0-3 questions, use this compact variant:

```markdown
# Grilling Summary: {Design/Plan Title}

## Questions Asked
- [Tier] Question -> Answer / decision.

## Default Changes
- [Tier] Change to make by default, with reason.

## Risks Accepted
- Risk and user rationale, or `None`.

## Open Issues
- Issue and next step, or `None`.

## Recommended Next Steps
1. ...
```

Use the full table format only when the session has enough questions or decisions that tables improve traceability.

```markdown
# Grilling Summary: {Design/Plan Title}

> Date: {date}
> Scope: {one-line description of what was reviewed}

## Questions Asked

| #   | Tier | Question | Why It Was Worth Asking |
| --- | ---- | -------- | ----------------------- |
| 1   | High | ...      | ...                     |
| 2   | ...  | ...      | ...                     |

## Answers Given

| #   | Question # | User Answer | Resulting Decision |
| --- | ---------- | ----------- | ------------------ |
| 1   | 1          | ...         | ...                |
| 2   | ...        | ...         | ...                |

## Default Changes

| #   | Tier | Change The AI Would Make By Default | Why No Question Was Needed |
| --- | ---- | ----------------------------------- | -------------------------- |
| 1   | High | ...                                 | ...                        |
| 2   | ...  | ...                                 | ...                        |

## Risks Accepted

| #   | Risk | Tier                 | User's Reasoning |
| --- | ---- | -------------------- | ---------------- |
| 1   | ...  | Critical/High/Medium | ...              |

## Open Issues

| #   | Issue | Tier | Suggested Next Step |
| --- | ----- | ---- | ------------------- |
| 1   | ...   | ...  | ...                 |

## Recommended Next Steps

1. ...
2. ...
3. ...
```

## Guidelines

- **Questions Asked**: Keep this short. If you asked more than 3 questions, you should have a strong reason.
- **Answers Given**: Map answers directly to the questions. Do not add unrelated commentary.
- **Default Changes**: This is where obvious best-practice actions go. Example: OpenAPI/Swagger for API docs when the plan changes an API and the repo does not specify another standard.
  Include CARDS defaults when architecture risks did not require a user decision: clarity, alignment, resilience, domain integrity, or separation.
- **Risks Accepted**: The user explicitly acknowledged the risk and chose to proceed.
  Include their reasoning so the decision is auditable.
- **Open Issues**: Questions that could not be resolved in this session.
  Include a concrete next step (e.g., "benchmark under load", "check with security team").
- **Recommended Next Steps**: Ordered by priority. Keep to 3–5 items.
  If the user has the `interactive-planner` skill, suggest handing off there.
