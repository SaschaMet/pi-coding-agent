# Grilling Summary Template

Use this structure when producing the final summary after all questioning is complete.

```markdown
# Grilling Summary: {Design/Plan Title}

> Date: {date}
> Scope: {one-line description of what was reviewed}

## Decisions Made

| #   | Decision | Rationale |
| --- | -------- | --------- |
| 1   | ...      | ...       |
| 2   | ...      | ...       |

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

- **Decisions Made**: Include only decisions that were actively discussed and resolved.
  Don't list things that were obvious or uncontested.
- **Risks Accepted**: The user explicitly acknowledged the risk and chose to proceed.
  Include their reasoning so the decision is auditable.
- **Open Issues**: Questions that could not be resolved in this session.
  Include a concrete next step (e.g., "benchmark under load", "check with security team").
- **Recommended Next Steps**: Ordered by priority. Keep to 3–5 items.
  If the user has the `interactive-planner` skill, suggest handing off there.
