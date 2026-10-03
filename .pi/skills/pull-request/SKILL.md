---
name: pull-request
description: Creates or updates a GitHub pull request from local changes with focused commits, clean history, a push, and a reviewer-ready body. Use when the user asks to create, update, or prepare a PR. Not for plain git help or commit-only requests.
disable-model-invocation: true
---

# Pull Request

Make every PR **review-ready**: clean history, clear description, concrete verification. The reviewer should answer four questions in under two minutes: what changed, why, how to verify, what can go wrong.

## Definition of Done

- Branch is not `main`, `master`, default branch, or detached HEAD.
- Git history is clean and linear: one focused commit per concern, no merge noise, no WIP messages. Squash only when Step 4 triggers.
- PR exists (created or updated) with a body that matches the pushed code.
- Description answers: what changed, why, user impact, verification steps, residual risk.
- Screenshots attached for UI-visible changes (or explicitly noted as N/A).

## Gotchas

- Never stage with `git add .` — stage explicit files from `git status`.
- PR text must match pushed code — push before editing the PR body when local commits are ahead.
- Do not stage sensitive files: `.env*`, `*.pem`, `*.key`, `id_rsa*`, credential files.

## Workflow

### 1. Environment and Branch Gate

- Check `gh` is available: `gh --version`. Abort if not.
- Check current branch: `git branch --show-current`. Abort on detached HEAD.
- Resolve `<base_branch>`: `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`.
- If current branch equals default branch, `main`, or `master`: abort. Suggest `git checkout -b <feature-branch-name>`.
- Do not create the branch automatically. Create it only if the user explicitly asks.

**Completion:** Branch is safe for PR work.

### 2. Resolve PR

- Check for existing PR: `gh pr view --json number,url,state,baseRefName,headRefName`
- Non-zero exit from `gh pr view` = no PR.
- If a PR exists: note its number and use its `baseRefName` as `<base_branch>`.
- If no PR exists and the user wants one: continue; Step 5 creates it.
- If no PR exists and user did not ask to create one: stop after reporting branch state.

**Completion:** Existing PR resolved, or confirmed none.

### 3. Stage and Commit (if local changes exist)

- Check for changes: `git status --short`.
- If clean: skip to step 5 (description-only mode).
- Inspect diff: `git diff`.
- Plan commit boundaries:
  - One focused commit for a single concern.
  - Multiple commits only for clearly separate concerns.
- Stage explicit files: `git add <file1> <file2> ...`
- Review staged diff: `git diff --staged`.
- Write commit message:
  - Subject: imperative mood, 72 chars max, optional scope prefix (`api:`, `ui:`, `docs:`).
  - Body: why, key changes, risk or migration notes.
  - No AI attribution or `Co-Authored-By` trailers.
- Commit: `git commit -m "<subject>" -m "<body>"`.

**Completion:** Changes committed with focused, descriptive messages.

### 4. Clean Git History (if needed)

- If the branch has more than 3 commits or contains WIP or merge noise:
  - Fetch first: `git fetch origin`.
  - Offer to squash: `git reset --soft $(git merge-base origin/<base_branch> HEAD)`
  - Let the user confirm before rebasing.
  - After squash, run a new `git commit` (never amend: HEAD is now the base commit) with a message that covers all changes.
- If the user asks for interactive rebase: guide them through `git rebase -i`.
- Never force-push without explicit user confirmation: `git push --force-with-lease`.

**Completion:** History is linear, focused, and readable.

### 5. Push

- Check sync: `git status -sb`.
- Push unpushed commits:
  - With upstream: `git push` (after a squash of pushed commits: `git push --force-with-lease`, only after user confirmation)
  - Without upstream: `git push -u origin HEAD`
- If push is not desired: abort and report that PR description may not match remote code.
- If no PR exists: `gh pr create --title "<short title>" --base <base_branch> --fill`, then `gh pr view --json number,url` to get `{pr_number}`.

**Completion:** Remote branch matches local commits.

### 6. Capture Screenshots (UI changes only)

- Applicable when changes affect UI, layout, styling, or user-visible behavior.
- Read `references/screenshots.md` for capture workflow.
- Save to `docs/pr_screenshots/pr-{pr_number}/` (before.png, after.png).
- Add screenshot files to the commit if created.
- If screenshots were committed, `git push` again so the PR matches the pushed code.
- If not applicable or capture fails: note "N/A" in the PR description.

**Completion:** Screenshots captured and committed, or marked N/A.

### 7. Generate Description

- Initialize from `references/pr_description_template.md` if no description exists.
- If a description file exists at `./.pi/pr_descriptions/{pr_number}_description.md`: read and update it.
- Gather PR context:
  - Diff: `gh pr diff {pr_number}`
  - Commits: `gh pr view {pr_number} --json commits`
  - Changed files: `git diff --name-status origin/<base_branch>...HEAD`
- Analyze for: problem solved, user impact, implementation approach, breaking changes, risks, reviewer focus areas.
- Fill every section from the template. Write in ELI5 style:
  - Use simple language a junior developer understands.
  - Explain "why" before "how".
  - Use bullet points, not paragraphs.
  - Include concrete examples, not abstract descriptions.
- For verification checklist:
  - Auto-run only safe, read-only commands.
  - For mutating commands: require explicit user confirmation.
  - Mark `- [x]` only when passing. Leave `- [ ]` on failure with a note.
- Include at least one concrete `Given / When / Then` scenario for manual testing.

**Completion:** Description file written with all sections filled.

### 8. Update PR Body

- Update existing PR: `gh pr edit {pr_number} --body-file <description_path>`
- Confirm success and call out any unchecked verification steps.
- Report the PR URL.

**Completion:** PR body matches the description file. PR is review-ready.
