# Grilling Summary Template

Use this structure when producing the final summary after all questioning is complete.

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
- **Risks Accepted**: The user explicitly acknowledged the risk and chose to proceed.
  Include their reasoning so the decision is auditable.
- **Open Issues**: Questions that could not be resolved in this session.
  Include a concrete next step (e.g., "benchmark under load", "check with security team").
- **Recommended Next Steps**: Ordered by priority. Keep to 3–5 items.
  If the user has the `interactive-planner` skill, suggest handing off there.
