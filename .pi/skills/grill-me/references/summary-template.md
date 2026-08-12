# Grilling Summary Template

Use this structure when producing the final summary after all questioning is complete.

The full table format below is the default — a normal session runs 12-20 questions, and at that size the
tables are what make the decisions traceable.

Use the compact variant only for genuinely small sessions of 0-3 questions:

```markdown
# Grilling Summary: {Design/Plan Title}

## Questions Asked
- [Round N] [Tier] Question -> Answer / decision.

## Default Changes
- [Tier] Change to make by default, with reason.

## Simplifications
- [Tier] Element to delete or collapse, and what it was serving, or `None`.

## Risks Accepted
- Risk and user rationale, or `None`.

## Open Issues
- Issue and next step, or `None`.

## Recommended Next Steps
1. ...
```

Otherwise use the full table format:

```markdown
# Grilling Summary: {Design/Plan Title}

> Date: {date}
> Scope: {one-line description of what was reviewed}

## Questions Asked

| #   | Round | Tier | Question | Why It Was Worth Asking |
| --- | ----- | ---- | -------- | ----------------------- |
| 1   | 1     | High | ...      | ...                     |
| 2   | ...   | ...  | ...      | ...                     |

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

## Simplifications

| #   | Tier | Element To Delete Or Collapse | What It Was Serving | Reinstate When |
| --- | ---- | ----------------------------- | ------------------- | -------------- |
| 1   | High | ...                           | ...                 | ...            |

## Net Effect On Plan Size

One line: what this session added, what it removed. If it only added, say so.

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

- **Questions Asked**: List only the questions that were truly necessary, in the round they were asked.
  `SKILL.md` owns the budget — about 20 questions across four to six rounds.
- **Answers Given**: Map answers directly to the questions. Do not add unrelated commentary.
- **Default Changes**: This is where obvious best-practice actions go. Example: OpenAPI/Swagger for API docs when the plan changes an API and the repo does not specify another standard.
  Include CARDS defaults when architecture risks did not require a user decision: clarity, alignment, resilience, domain integrity, or separation.
- **Simplifications**: elements the plan should drop or collapse, per the ladder in `simplification.md`.
  `None` is a legitimate entry — an empty table on a large plan is not. Default Changes and Simplifications
  pull opposite ways on purpose; a summary with a full Default Changes table and an empty Simplifications
  one means the plan was only ever pressured to grow.
- **Risks Accepted**: The user explicitly acknowledged the risk and chose to proceed.
  Include their reasoning so the decision is auditable.
- **Open Issues**: Questions that could not be resolved in this session.
  Include a concrete next step (e.g., "benchmark under load", "check with security team").
- **Recommended Next Steps**: Ordered by priority. Keep to 3–5 items.
  When the plan is ready to be written up, suggest handing off to `$create-spec`.
