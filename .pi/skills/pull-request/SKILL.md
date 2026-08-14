---
name: pull-request
description: Use this skill when the user asks to create, update, or prepare a GitHub pull request from local changes, including PR body, clean git history, screenshots, or reviewer context. Validate gh, branch safety, staged scope, and push state before creating or editing the PR. Do not use for generic git help or when the user only wants to commit without a PR.
disable-model-invocation: true
---

# Pull Request

Make every PR **review-ready**: clean history, clear description, concrete verification. The reviewer should answer four questions in under two minutes: what changed, why, how to verify, what can go wrong.

## Definition of Done

- Branch is not `main`, `master`, default branch, or detached HEAD.
- Git history must be clean, linear, and meaningful. Squash commits if needed, amend commits are the default. Focused commits only, no merge noise, no WIP messages.
- PR exists (created or updated) with a body that matches the pushed code.
- Description answers: what changed, why, user impact, verification steps, residual risk.
- Verification checklist is checked (`- [x]`) only when actually passing.
- Screenshots attached for UI-visible changes (or explicitly noted as N/A).

## Gotchas

- Never stage with `git add .` — stage explicit files from `git status`.
- Do not commit or push from `main`, `master`, the default branch, or detached HEAD.
- PR text must match pushed code — push before editing the PR body when local commits are ahead.
- Do not stage sensitive files: `.env*`, `*.pem`, `*.key`, `id_rsa*`, credential files.

## Workflow

### 1. Environment and Branch Gate

- Check `gh` is available: `gh --version`. Abort if not.
- Check current branch: `git branch --show-current`. Abort on detached HEAD.
- Resolve default branch: `gh repo view --json defaultBranchRef`.
- If current branch equals default branch, `main`, or `master`: abort. Suggest `git checkout -b <feature-branch-name>`.
- Do not create the branch automatically. Create it only if the user explicitly asks.

**Completion:** Branch is safe for PR work.

### 2. Resolve or Create PR

- Check for existing PR: `gh pr view --json number,url,state,baseRefName,headRefName`
- If no PR exists and user wants one: create it.
  - `gh pr create --title "<short title>" --body-file <description_path>`
  - Use a placeholder body initially; fill it in later steps.
- If PR exists: note its number and continue.
- If no PR exists and user did not ask to create one: stop after reporting branch state.

**Completion:** PR number is resolved.

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
  - Offer to squash: `git reset --soft $(git log --oneline --no-merges | tail -1 | cut -d' ' -f1)`
  - Let the user confirm before rebasing.
  - After squash, amend the commit message to reflect all changes.
- If the user asks for interactive rebase: guide them through `git rebase -i`.
- Never force-push without explicit user confirmation: `git push --force-with-lease`.

**Completion:** History is linear, focused, and readable.

### 5. Push

- Fetch latest: `git fetch origin`.
- Check sync: `git status -sb`.
- Push unpushed commits:
  - With upstream: `git push`
  - Without upstream: `git push -u origin HEAD`
- If push is not desired: abort and report that PR description may not match remote code.

**Completion:** Remote branch matches local commits.

### 6. Capture Screenshots (UI changes only)

- Applicable when changes affect UI, layout, styling, or user-visible behavior.
- Read `references/screenshots.md` for capture workflow.
- Save to `docs/pr_screenshots/pr-{pr_number}/` (before.png, after.png).
- Add screenshot files to the commit if created.
- If not applicable or capture fails: note "N/A" in the PR description.

**Completion:** Screenshots captured and committed, or marked N/A.

### 7. Generate Description

- Initialize from `references/pr_description_template.md` if no description exists.
- If a description file exists at `./.pi/pr_descriptions/{pr_number}_description.md`: read and update it.
- Gather PR context:
  - Diff: `gh pr diff {pr_number}`
  - Commits: `gh pr view {pr_number} --json commits`
  - Changed files: `git diff --name-status origin/{base_branch}...HEAD`
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
