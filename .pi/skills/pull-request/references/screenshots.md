# Screenshot Capture Workflow

Use this when the PR changes UI, layout, styling, or any user-visible behavior.

## Steps

1. Identify the affected screen(s) from the PR diff.
2. Open the app on the **base branch** (e.g., `main`):
   - If possible, use a separate worktree: `git worktree add ../app-base main`
   - Take the "before" screenshot.
3. Switch to or open the **PR branch**:
   - Take the "after" screenshot.
4. Save files:
   - `docs/pr_screenshots/pr-{pr_number}/before.png`
   - `docs/pr_screenshots/pr-{pr_number}/after.png`
5. Stage and commit screenshots with the PR changes.
6. Reference them in the PR description using markdown image links.

## When Before Is Not Possible

If capturing the "before" state is impractical (no running base branch, complex setup):

- Capture "after" only.
- In the PR description, note: "Before screenshot unavailable — [reason]."

## When Screenshots Are Not Needed

Write "Not applicable — no UI changes" in the PR description when:

- Changes are backend-only (API, database, config).
- Changes are internal refactoring with no visual impact.
- Changes are documentation or test-only.
