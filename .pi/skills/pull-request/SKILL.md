---
name: pull-request
description: Build a high-context pull request update from local changes. Validates gh CLI and branch safety first, updates commits safely, and generates reviewer-friendly PR descriptions.
---

# Pull Request

Goal: create a high-signal PR with enough context for human reviewers to validate and control AI-generated code.
Trigger: only when user explicitly invokes this skill.

## Required Inputs

- PR description template: `references/pr_description_template.md`.

## Workflow

1. Invocation gate

- User invokes this skill.

2. Environment and branch gate

- Check GitHub CLI first: `gh --version`.
- If `gh` is unavailable, abort.
- Check current branch: `git branch --show-current`.
- Abort on detached HEAD.
- Resolve repository default branch: `gh repo view --json defaultBranchRef`.
- If current branch equals default branch, abort immediately. Do not stage files, do not commit, do not create or edit a PR.
- Also abort if current branch is `main` or `master`.
- When aborting, provide: `git checkout -b <feature-branch-name>`
- If there are no changed files (`git status --short` is empty), abort with a clear message.
- Do not create the branch automatically. Create it only if the user explicitly asks.
- Do not use `git commit --amend` unless the user explicitly asks.

3. Resolve existing PR (no creation)

- Resolve PR for current branch:
  - `gh pr view --json number,url,state,baseRefName,headRefName`
- If no PR exists for the current branch, abort and tell the user to create the PR first.
- Do not create PRs in this skill.

4. Stage and commit

- Inspect changes first (`git status --short` & `git diff`)
- Plan commit boundaries:
  - Prefer one focused commit when changes are a single concern.
  - Split into multiple commits only for clearly separate concerns.
- Stage explicit files only from `git status` output and only for in-scope task files:
  - `git add <file1> <file2> ...`
  - Never use `git add .` for this workflow.
- Do not stage sensitive files by default: `.env*`, `*.pem`, `*.key`, `id_rsa*`, secrets/config credential files.
- Review staged diff: `git diff --staged`.
- Create commit message from staged diff:
  - Subject in imperative mood, <= 72 chars.
  - Optional scope when obvious (example: `api:`, `ui:`, `docs:`).
  - Explain why and impact; avoid only "what changed" language.
  - Body includes: why, key changes, risk/migration notes if needed.
  - Do not include AI attribution or `Co-Authored-By` trailers.
- Commit: `git commit -m "<subject>" -m "<body>"`.

5. Push policy before PR update

- Check branch sync state:
  - `git fetch origin`
  - `git status -sb`
- If branch has unpushed commits, push before updating PR body:
  - `git push`
- If push is not desired, abort and report that PR description may not match remote code.

6. Read or initialize description

- Determine description output path:
  - `./.pi/pr_descriptions/{pr_number}_description.md`
- If an existing description file is present, read and update it instead of rewriting blindly.
- If missing, initialize from `references/pr_description_template.md`.

7. Gather PR context

- Collect:
  - PR diff: `gh pr diff {pr_number}`
  - Commits: `gh pr view {pr_number} --json commits`
  - Base branch: `gh pr view {pr_number} --json baseRefName`
  - Fetch base branch ref first: `git fetch origin {base_branch}`
  - Changed files: `git diff --name-status origin/{base_branch}...HEAD`
- For context, read referenced files that are not fully shown in the diff.
- Analyze for:
  - Problem being solved
  - User-facing impact
  - Implementation details
  - Breaking changes or migration requirements
  - Risks, rollback strategy, and reviewer focus areas

8. Fill verification section

- For each checklist item under "How to verify it":
  - Auto-run only safe, read-only commands.
  - For mutating/destructive commands, require explicit user confirmation first.
  - Mark `- [x]` only when passing.
  - Leave `- [ ]` on failure/manual-only checks and add a short note.
- Include manual test notes when automation is not possible.

9. Generate description

- Fill every section from the template.
- Keep it specific, concise, and scannable.
- Focus on why + user impact, not only code mechanics.
- Include concrete reviewer guidance:
  - areas needing extra scrutiny
  - known limitations
  - follow-up work (if any)

10. Save and update PR body

- Write description file to the selected output path.
- Update existing PR body:
  - `gh pr edit {pr_number} --body-file <description_path>`
- Do not create PRs in this skill.
- Confirm success and call out any unchecked verification steps.

## Quality Bar

- Include breaking-change notes prominently when applicable.
- If multiple components were changed, organize by component.
- Avoid vague claims like "minor fixes"; describe concrete behavior changes.
- Changelog summary must be one concise, user-readable entry.
- Keep commits and PR narrative aligned: each commit should map to a described change.
- Ensure reviewer can answer quickly (if applicable):
  - What changed?
  - How was it verified?
  - What can still go wrong?
