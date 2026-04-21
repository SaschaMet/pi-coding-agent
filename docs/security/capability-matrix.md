# Capability Matrix

Versioned source of truth for runtime permissions: `.pi/security/capabilities.json`.

## Policy Baseline

- Model: **Capability-mode**
- Missing entry: **deny**
- Confirmation in non-interactive mode (`hasUI=false`): **deny**
- Shell network commands: **allow**
- Protected paths requiring confirmation: `.env*` reads only

## Tool Capabilities

| Tool | Mode | Notes |
| --- | --- | --- |
| `bash` | allow (rule-based) | Confirm only for delete/remove and `.env` file reads; otherwise allow |
| `read` | allow | Confirm when target is `.env*` |
| `write` | allow | unrestricted |
| `edit` | allow | unrestricted |
| `ls` | allow | unrestricted |
| `grep` | allow | unrestricted |
| `find` | allow | unrestricted |
| `ask_questions` | allow | unrestricted |
| `ask` | allow | unrestricted |
| `web_search` | allow | unrestricted |
| `fetch_web_page` | allow | unrestricted |
| `subagent` | allow | strict local runtime enforced separately |

## Bash Rule Summary

- Confirm:
  - delete/remove operations (`rm`, `rmdir`, `unlink`, `del`, `erase`, `git rm`, `git branch -d/-D`)
  - `.env` file reads (`cat .env`, `grep .env`, etc.)
- Allow:
  - all other bash commands

## Change Process

1. Update `.pi/security/capabilities.json`.
2. Update this document.
3. Run `npm test` and `npm run smoke`.
4. Ensure coverage check passes (no missing tool entries).
