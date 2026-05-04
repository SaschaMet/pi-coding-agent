# PI Coding Agent Parity Stack

Project-local PI runtime that adds:

- Codex-style plan mode
- Subagents with two generic delegation profiles (`generic-readonly`, `generic-worker`)
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

1. Set at least one model provider key (for PI itself), for example:

```bash
export ANTHROPIC_API_KEY=...
```

1. Configure web search key(s) in your shell or a local `.env` file:

```bash
export BRAVE_API_KEY=...
# optional:
# export TAVILY_API_KEY=...
# export SERPER_API_KEY=...
```

The runtime no longer hydrates `.env` globally into `process.env`.
Secrets are resolved via scoped access where needed (for example in `web_search`).

1. Run smoke checks:

```bash
npm run smoke
```

1. Start the agent:

```bash
npm run agent
```

## Commands

- `npm run dev` - run interactive agent with file watch
- `npm run agent` - run interactive agent
- `npm run smoke` - extension/resource discovery smoke check
- `npm test` - run unit/integration tests
- `npm run pi:pull-global` - mirror global PI config/resources into this repo's `.pi/`
- `npm run pi:sync-global` - sync this repo's `.pi/` resources into global `~/.pi/agent` (or `PI_CODING_AGENT_DIR`)

## Sandbox Defaults

`npm run agent` and `npm run dev` now enforce these sandbox hardening defaults:

- `--container`
- `--no-container-net`
- `--no-container-mount-skills`
- `--container-image thegreataxios/pi-sandbox@sha256:be6d992940f63e435ba5cdd840a9b26003f0694fb36b749a4ddf121555d79d9e`

If you explicitly need outbound network or skill mounts for a task, run `tsx src/main.ts` directly and pass only the minimum extra flags required.

### Shell Launcher (Recommended)

If you start PI via shell alias/function, point it to this runtime script, not plain `pi`.
Plain `pi` will not use this repository's hardened defaults automatically.

For `zsh`:

```zsh
export PI_CODER_REPO="${PI_CODER_REPO:-$HOME/Projects/pi-coding-agent}"

picoder() {
  node "$PI_CODER_REPO/node_modules/tsx/dist/cli.mjs" \
    "$PI_CODER_REPO/src/main.ts" \
    --container --no-container-net --no-container-mount-skills \
    --container-image thegreataxios/pi-sandbox@sha256:be6d992940f63e435ba5cdd840a9b26003f0694fb36b749a4ddf121555d79d9e \
    "$@"
}
```

Notes:

- Sync mirrors managed files under `.pi/` (including `.pi/SYSTEM.md`) and removes stale managed files in the target.
- It intentionally excludes personal runtime data like `auth.json`, `sessions/`, and `.DS_Store`.
- Secrets can be centralized via `envService` in `settings.json` (e.g. `"envFile": "${PI_CODER_REPO}/.env"`).

## Sharing Setup with Colleagues

From the cloned repo root:

1. Import any existing global config into the repo copy (one-time, optional):

```bash
npm run pi:pull-global
```

1. Point envService at this repository's `.env` file:

```bash
export PI_CODER_REPO="$(pwd)"
```

1. Push this repo's `.pi/` stack to the colleague's global PI directory:

```bash
npm run pi:sync-global
```

Both commands honor `PI_CODING_AGENT_DIR` if set; otherwise they use `~/.pi/agent`.

## Runtime Layout

- [`src/main.ts`](src/main.ts): embedded PI runtime entrypoint (`createAgentSession` + `InteractiveMode`)
- `.pi/settings.json`: project-level PI settings (skills path integration; direct skill commands disabled so skills run via subagents)
- `.pi/agent.config.json`: search/subagent config contract
- `.pi/extensions/`: custom extensions
- `.pi/security/`: capability policy schema + matrix source (`capabilities.schema.json`, `capabilities.json`)
- `.pi/agent/`: project-local subagent role definitions
- `.pi/prompts/`: workflow prompt templates
- `.pi/skills/`: project-local skills (includes `brave-search` wrapper)
- `docs/security/`: operator runbook and human-readable capability matrix

## Role Catalog

- `generic-readonly`: read-only delegated subagent for research/planning/summarization
- `generic-worker`: mutating delegated subagent for implementation/file updates

## Delegation Orchestration

- Use skill `subagent-orchestrator` as the central policy for subagent spawning and coordination.
- Non-trivial tasks should be delegated through `subagent` using this skill's rules.
- Keep trivial localized work in-session unless explicit delegation is requested.

## Skill Routing

- Skill-backed subagent names are not guaranteed to be available in every runtime.
- Use the inline subagent fallback table in [`.pi/extensions/subagent/index.ts`](.pi/extensions/subagent/index.ts).
- Direct skill commands are disabled, so skills run only in isolated subagent sessions.
- Project-local skills come from `.pi/skills/`; user/global skills come from configured paths such as `~/.codex/skills`

## Workflow Prompts

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
  - With strict local runtime enabled, ensure `node_modules/.bin/pi` exists in either:
    - the delegated task `cwd`,
    - the nearest project root for that `cwd` (directory containing `.pi`),
    - or the PI runtime anchor repo (this repository).
  - If strict local runtime is disabled, non-local fallback (`process.execPath`/`pi` from `PATH`) is used.
  - For subagent payloads, provide exactly one mode:
    - single: `{ agent, task }`
    - parallel: `{ tasks: [{ agent, task }, ...] }`
    - chain: `{ chain: [{ agent, task }, ...] }`
  - Do not mix `agent/task` with `tasks` or `chain` in the same call.
- Subagent tool conflict errors:
  - Subagent subprocesses now use scoped project extension loading (`--no-extensions` + project `.pi/extensions/*`) to avoid duplicate tool registration from overlapping user/project extension sets.
- `grep`/`find` on `.`:
  - Repository-root search is supported; explicit protected paths such as `.git` and `.env*` remain blocked by capability policy.

## Failure Handling Notes

- `ask_questions` in non-interactive mode returns deterministic fallback answers.
- Capability policy (`.pi/security/capabilities.json`) is deny-by-default and controls per-tool allow/block/confirm behavior.
- Startup coverage checks fail closed when active/exposed tools are missing capability entries.
- `permission-gate` applies capability policy for bash, including non-interactive deny for confirmation-required commands.
- `protected-paths` applies capability path policy, blocking `.env*`, `.git`, and `node_modules`, and requiring confirmation for root-scoped grep/find.
- `bash-sandbox` uses capability env allowlist and strips non-allowlisted env vars from shell execution.
- `web_search` and `fetch_web_page` require explicit user confirmation before use.
- `web_search` returns structured error text and `isError: true` when provider calls fail.

## Upstream Docs

The underlying [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) package ships comprehensive docs:

- [README](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) — overview, quick start, CLI reference
- [Providers & Models](node_modules/@mariozechner/pi-coding-agent/docs/providers.md)
- [Settings](node_modules/@mariozechner/pi-coding-agent/docs/settings.md)
- [Skills](node_modules/@mariozechner/pi-coding-agent/docs/skills.md)
- [Extensions](node_modules/@mariozechner/pi-coding-agent/docs/extensions.md)
- [Prompt Templates](node_modules/@mariozechner/pi-coding-agent/docs/prompt-templates.md)
- [Sessions & Compaction](node_modules/@mariozechner/pi-coding-agent/docs/session.md)
- [Keybindings](node_modules/@mariozechner/pi-coding-agent/docs/keybindings.md)
- [Themes](node_modules/@mariozechner/pi-coding-agent/docs/themes.md)
- [SDK](node_modules/@mariozechner/pi-coding-agent/docs/sdk.md)
- [RPC](node_modules/@mariozechner/pi-coding-agent/docs/rpc.md)
- [Terminal Setup](node_modules/@mariozechner/pi-coding-agent/docs/terminal-setup.md)
- [Windows](node_modules/@mariozechner/pi-coding-agent/docs/windows.md)
- [Development](node_modules/@mariozechner/pi-coding-agent/docs/development.md)

## Token Efficiency Guidance

- Prefer one focused delegated subtask using either `generic-readonly` or `generic-worker`.
- Use `chain` mode when step output feeds the next step.
- Use `parallel` mode only for truly independent subtasks.
