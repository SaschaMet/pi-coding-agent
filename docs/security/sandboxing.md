# Sandboxing Runbook

## Enforced Today

- Capability-mode policy via `.pi/security/capabilities.json`
- Deny-by-default for missing tool entries
- Startup coverage enforcement for active + subagent-exposed tools
- Protected path blocking (`.env*`, `.git`)
- Bash env sanitization with strict allowlist
- Bash network command deny-by-default
- Bash operator enforcement (`;`, backticks, `$()` blocked; `|`, `&&`, `||` allowed with per-segment policy checks)
- `confirm` actions auto-denied when `hasUI=false`
- Subagent strict local runtime (`node_modules/.bin/pi`) with fail-closed behavior, resolved in order from:
  - delegated task `cwd`
  - nearest project root for that `cwd` (directory containing `.pi`)
  - PI runtime anchor repo

## Quick Verification

1. `npm test`
2. `npm run smoke`
3. Manual checks:
   - `grep` with `path: "."` is blocked
   - `read` on `.env` is blocked
   - `bash` `printenv` is blocked
   - `bash` `curl https://example.com` is blocked
   - dangerous git command prompts in UI and denies in non-UI
   - `bash` `npm run smoke && printenv` is blocked as chained payload

## Emergency Override (Temporary)

Use only for local debugging and revert immediately:

- Additive env allowlist for bash:
  - `PI_BASH_ENV_ALLOWLIST=VAR1,VAR2`
- Disable startup coverage enforcement (not recommended):
  - set `security.enforceCoverageAtStartup` to `false` in `.pi/agent.config.json`

## Troubleshooting

- **Startup fails with missing capability entries**
  - Add missing tools to `.pi/security/capabilities.json`
  - Re-run `npm run smoke`

- **Command unexpectedly blocked**
  - Check bash rule order and regex in capability file
  - Confirm whether command is treated as networked or sensitive

## Roadmap (Not Yet Enforced)

- Containerized runtime isolation profile
- Host-level execution controls (MAC policies)
- Unified network allowlist for all outbound tools (including web tools)
- Persistent audit log export pipeline
