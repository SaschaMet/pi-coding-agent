# graphify reference: commit hook and native CLAUDE.md integration

Load this when the user asked to install the post-commit hook or wire graphify into a project's CLAUDE.md.

## For git commit hook

Install a post-commit hook that auto-rebuilds the graph after every commit. No background process needed - triggers once per commit, works with any editor.

```bash
GIT_CONFIG_GLOBAL=/dev/null graphify hook install    # install
GIT_CONFIG_GLOBAL=/dev/null graphify hook uninstall  # remove
GIT_CONFIG_GLOBAL=/dev/null graphify hook status     # check
```

The prefix hides the global `core.hooksPath`, so graphify uses this repo's `.git/hooks/` instead of the shared global folder. Without it, the install lands in the global folder and never runs, and `status` checks the wrong folder. The security guard blocks agents from this prefix: a human runs these commands.

After every `git commit`, the hook detects which code files changed (via `git diff HEAD~1`), re-runs AST extraction on those files, and rebuilds `graph.json` and `GRAPH_REPORT.md`. Doc/image changes are ignored by the hook - run `/graphify --update` manually for those.

If a post-commit hook already exists, graphify appends to it rather than replacing it.

---

## For native CLAUDE.md integration

Run once per project to make graphify always-on in Claude Code sessions:

```bash
graphify claude install
```

This writes a `## graphify` section to the local `CLAUDE.md` that instructs Claude to check the graph before answering codebase questions and rebuild it after code changes. No manual `/graphify` needed in future sessions.

```bash
graphify claude uninstall  # remove the section
```
