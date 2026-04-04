# Capability Matrix

Versioned source of truth for runtime permissions: `.pi/security/capabilities.json`.

## Policy Baseline

- Model: **Capability-mode**
- Missing entry: **deny**
- Confirmation in non-interactive mode (`hasUI=false`): **deny**
- Shell network commands: **deny by default**
- Protected paths: `.env*`, `.git`

## Tool Capabilities

| Tool | Mode | Notes |
| --- | --- | --- |
| `bash` | allow (rule-based) | Allowlist + confirm rules + sensitive-pattern block + network deny-default |
| `read` | allow | Protected path deny |
| `write` | allow | Protected path deny |
| `edit` | allow | Protected path deny |
| `ls` | allow | Protected path deny |
| `grep` | allow | Protected path deny + confirm when search scope includes protected roots |
| `find` | allow | Protected path deny + confirm when search scope includes protected roots |
| `ask_questions` | allow | unrestricted |
| `ask` | allow | unrestricted |
| `web_search` | confirm | requires explicit user confirmation (`nonInteractivePolicy=deny`) |
| `fetch_web_page` | confirm | requires explicit user confirmation (`nonInteractivePolicy=deny`) |
| `subagent` | allow | strict local runtime enforced separately |

## Bash Rule Summary

- Default block:
  - secret exfiltration patterns (`env`, `printenv`, `.env`, `process.env`, etc.)
  - network commands by default (`curl`, `wget`, `ssh`, `scp`, ...)
  - Note: with UI available, blocked `bash` commands can now be user-overridden via explicit confirmation prompt.
- Confirm:
  - dangerous git operations (`push`, `pull`, `rebase`, `revert`, ...)
  - destructive shell operations (`rm -rf`, `sudo`, `chmod/chown ...777`)
- Allow:
  - read-only and diagnostics command allowlist
  - repo-standard verification scripts: `npm run smoke`, `npm run typecheck`, `npm run test:coverage`, `npm run docs:sync-pi`
  - JS/package-manager execution commands: `npm`, `pnpm`, `yarn`, `npx`, `bun`, `bunx`
  - Python execution commands (`python`, `python3`, module/script entrypoints)
  - PHP/composer execution commands: `php`, `composer`
  - `uv run` execution commands (including `uv run --python 3.12 ...`)
- Structural guardrail:
  - bash input blocks dangerous shell operators (`;`, backticks, `$()`); pipelines (`|`) and boolean chaining (`&&`, `||`) are allowed when each segment independently matches policy

## Change Process

1. Update `.pi/security/capabilities.json`.
2. Update this document.
3. Run `npm test` and `npm run smoke`.
4. Ensure coverage check passes (no missing tool entries).
