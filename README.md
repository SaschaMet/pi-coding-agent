# PI Coding Agent Parity Stack

Project-local PI runtime that adds:
- Codex-style plan mode
- Subagents with curated specialist roles
- Shared skills (including `~/.codex/skills`)
- Native `web_search` tool (default provider: Brave, configurable)
- Native `fetch_web_page` tool for extracting readable text from a specific URL
- Structured planner Q&A tool: `ask_questions` (alias: `ask`)
- Capability-mode safety guardrails (deny-by-default policy matrix + coverage enforcement)

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Set at least one model provider key (for PI itself), for example:
```bash
export ANTHROPIC_API_KEY=...
```

3. Configure web search key(s) in your shell or a local `.env` file:
```bash
export BRAVE_API_KEY=...
# optional:
# export TAVILY_API_KEY=...
# export SERPER_API_KEY=...
```

The runtime no longer hydrates `.env` globally into `process.env`.
Secrets are resolved via scoped access where needed (for example in `web_search`).

4. Run smoke checks:
```bash
npm run smoke
```

5. Start the agent:
```bash
npm run agent
```

## Commands

- `npm run dev` - run interactive agent with file watch
- `npm run agent` - run interactive agent
- `npm run smoke` - extension/resource discovery smoke check
- `npm test` - run unit/integration tests
- `npm run pi:pull-global` - merge global PI config/resources into this repo's `.pi/`
- `npm run pi:sync-global` - sync this repo's `.pi/` resources into global `~/.pi/agent` (or `PI_CODING_AGENT_DIR`)

Notes:
- Sync only covers shareable config/resources (`settings.json`, `models.json`, `keybindings.json`, `agent.config.json`, `extensions/`, `skills/`, `prompts/`, `themes/`, `agents/`, `security/`).
- It intentionally does not touch personal runtime data like `auth.json` or `sessions/`.
- Secrets can be centralized via `envService` in `settings.json` (e.g. `"envFile": "${PI_CODER_REPO}/.env"`).

## Sharing Setup with Colleagues

From the cloned repo root:

1. Import any existing global config into the repo copy (one-time, optional):
```bash
npm run pi:pull-global
```
2. Point envService at this repository's `.env` file:
```bash
export PI_CODER_REPO="$(pwd)"
```
3. Push this repo's `.pi/` stack to the colleague's global PI directory:
```bash
npm run pi:sync-global
```

Both commands honor `PI_CODING_AGENT_DIR` if set; otherwise they use `~/.pi/agent`.

## Runtime Layout

- [`src/main.ts`](/Users/saschametzger/Projects/pi-coding-agent/src/main.ts): embedded PI runtime entrypoint (`createAgentSession` + `InteractiveMode`)
- `.pi/settings.json`: project-level PI settings (skills path integration; direct skill commands disabled so skills run via subagents)
- `.pi/agent.config.json`: search/subagent config contract
- `.pi/extensions/`: custom + vendored extensions
- `.pi/security/`: capability policy schema + matrix source (`capabilities.schema.json`, `capabilities.json`)
- `.pi/agents/`: project-local subagent role definitions
- `.pi/prompts/`: workflow prompt templates
- `.pi/skills/`: project-local skills (includes `brave-search` wrapper)
- `docs/security/`: operator runbook and human-readable capability matrix

## Role Catalog

- `explorer`: quick codebase recon
- `planner`: decision-complete planning, can use `ask_questions` and `web_search`
- `worker`: focused implementation
- `reviewer`: review-only quality gate
- `tdd-red`, `tdd-green`, `tdd-refactor`: explicit TDD stages
- `gan-generator`, `gan-critic`: generator/critic workflow

## Skill Routing

- Skill-backed subagent names are not guaranteed to be available in every runtime.
- Use the canonical inline subagent fallback table in [`.pi/agents/AGENTS.md`](.pi/agents/AGENTS.md).
- Direct skill commands are disabled, so skills run only in isolated subagent sessions.
- Project-local skills come from `.pi/skills/`; user/global skills come from configured paths such as `~/.codex/skills`.

## Workflow Prompts

- `/scout-plan <task>` - explorer -> planner
- `/implement <task>` - explorer -> planner -> worker
- `/implement-review <task>` - worker -> reviewer -> worker
- `/tdd-cycle <task>` - red -> green -> refactor
- `/gan-loop <task>` - generator -> critic (+ optional revise pass)

## Implementation Workflow

- See [`docs/reference/implementation-workflow.md`](docs/reference/implementation-workflow.md) for a concise implementation checklist.

## Plan Mode

See [`.pi/extensions/plan-mode/README.md`](.pi/extensions/plan-mode/README.md) for the full plan mode behavior and configuration.

- `/plan` - toggle read-only plan mode
- `/todos` - show the current plan progress
- `/plan-widget` - toggle the plan widget visibility
- `Ctrl+Alt+P` - toggle plan mode
- Widget toggle shortcut defaults to `Ctrl+Alt+W`
- Override the widget shortcut in `.pi/agent.config.json`:
```json
{
  "planMode": {
    "toggleWidgetShortcut": "ctrl+shift+w"
  }
}
```

## Tool Interfaces

### `ask_questions` / `ask`
- Input: `questions[]` where each item has `id`, `label`, `question`, `options[]`, optional `allow_other`
- Output: `details.answers` keyed by `id`
- Non-interactive fallback: deterministic first-option selection

### `web_search`
- Input: `query`, `provider?`, `topK?`, `domains?`, `recency?`, `includeContent?`
- Output: normalized `results[]` with `title`, `url`, `snippet`, optional `content`
- Provider default is configured via `.pi/agent.config.json`

### `fetch_web_page`
- Input: `url`
- Output: readable page text extracted from the fetched page, plus `details` with `finalUrl`, `status`, `contentType`, `title`, and `text`
- Intended for fetching a specific page when you already know the URL
- Returns an error for invalid or unsupported URLs

## Troubleshooting

- Missing model/API key:
  - Ensure a PI model provider key exists (e.g., `ANTHROPIC_API_KEY`).
- `web_search` failing:
  - Verify provider env var (`BRAVE_API_KEY`, `TAVILY_API_KEY`, or `SERPER_API_KEY`).
  - Check provider selection in `.pi/agent.config.json`.
- No Codex skills detected:
  - Ensure `~/.codex/skills` exists and is readable.
  - Confirm `.pi/settings.json` includes the path.
- Subagent not running:
  - Ensure local PI binary exists in `node_modules/.bin/pi` or global `pi` is installed.

## Failure Handling Notes

- `ask_questions` in non-interactive mode returns deterministic fallback answers.
- Capability policy (`.pi/security/capabilities.json`) is deny-by-default and controls per-tool allow/block/confirm behavior.
- Startup coverage checks fail closed when active/exposed tools are missing capability entries.
- `permission-gate` applies capability policy for bash, including non-interactive deny for confirmation-required commands.
- `protected-paths` applies capability path policy, blocking `.env*`, `.git`, and `node_modules`, and requiring confirmation for root-scoped grep/find.
- `bash-sandbox` uses capability env allowlist and strips non-allowlisted env vars from shell execution.
- `web_search` and `fetch_web_page` require explicit user confirmation before use.
- `web_search` returns structured error text and `isError: true` when provider calls fail.

## Token Efficiency Guidance

- Use `explorer` first for large unknown codebases.
- Use `planner` only after context exists; keep planning prompts narrow.
- Prefer direct `worker` for small, obvious edits.
- Use `tdd-cycle` only when behavior changes need explicit regression safety.
- Use `gan-loop` for high-risk slices where a critic gate is beneficial.
