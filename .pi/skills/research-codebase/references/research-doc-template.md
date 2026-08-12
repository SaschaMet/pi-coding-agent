# Research Doc Template

Use this structure for the output document. Collapse sections that do not apply,
but never drop Unknowns or Resumption State.

```md
# Research: {Question in a few words}

> Date: {date}
> Scope: {what this covers}
> Status: In Progress | Ready for Review | Superseded by {path}

## 1. Question

The one question this document answers.

## 2. Answer

Two to five lines. The short version, stated up front.

## 3. Entry Points

- `path/to/file.ts:42` - what starts here and when it runs.

## 4. Call Paths and Information Flow

- `caller.ts:88` -> `service.ts:120` -> `store.ts:31` - what is passed, what comes back.
- Where state is held, and who may mutate it.

## 5. Prior Art

- Closest existing implementation: `path/to/similar.ts:10`
- Patterns to reuse: naming, error handling, test shape.
- Why this is the right model to copy (or why it is not).

## 6. Conventions and Verification Surface

- Test command(s): `...`
- Existing tests that cover this area: `path/to/test.ts`
- Lint/typecheck/CI checks that gate this path.
- Manual verification available (CLI, API, UI).

## 7. Unknowns and Risks

| Unknown | Why it matters | How to resolve |
| --- | --- | --- |
| ... | ... | read X / ask user / run Y |

Anything unverified belongs here, not above.

## 8. Resumption State

- **End goal**: what this research is in service of.
- **Approach**: how it is being investigated.
- **Steps completed**: what has been verified so far.
- **Current blockers**: what is stopping progress right now, if anything.

## 9. Citations

Every behavioral claim above maps to a `path:line` read during this research.
```

Keep the document shorter than the code it describes. Cite; do not summarize the
whole repository.
