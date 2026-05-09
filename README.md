# PI Coding Agent Parity Stack

Git-tracked PI config/runtime parity stack for a global PI runtime (`~/.pi/agent`) that adds:

- Codex-style plan mode
- Claude Code-style subagents via `@tintinweb/pi-subagents`
- Shared skills (including `~/.codex/skills`)
- Structured planner Q&A tool: `ask_questions` (alias: `ask`)

## Quick Start

1. Install dependencies:

```bash
npm install
```

1. Set at least one model provider key (for PI itself), for example:

```bash
export ANTHROPIC_API_KEY=...
```

1. Run smoke checks:

```bash
npm run smoke
```

1. Start PI from the global runtime:

```bash
pi
```

## Commands

- `npm run dev` - run local interactive agent with file watch
- `npm run agent` - run local interactive agent
- `npm run smoke` - extension/resource discovery smoke check
- `npm test` - run unit/integration tests
- `npm run pi:pull-global` - mirror global PI config/resources into this repo's `.pi/` (preferred)
- `npm run pi:sync-global` - legacy push from repo `.pi/` into global `~/.pi/agent` (`PI_CODING_AGENT_DIR`), use only when intentionally overwriting global state

## Runtime Defaults

The default repo runtime is local-first. `npm run agent` and `npm run dev` run against the current project filesystem so repository inspection and file edits work directly.

### Runtime Launching

Default: run PI from the global runtime (plain `pi`) or the local repo runtime (`npm run agent`) for direct project access.

### Repo Runtime Launcher (Optional)

If you start PI via shell alias/function, point it to this runtime script, not plain `pi`.
Plain `pi` will not use this repository's extension stack automatically.

For `zsh`:

```zsh
export PI_CODER_REPO="${PI_CODER_REPO:-$HOME/Projects/pi-coding-agent}"

picoder() {
  if [[ "$PWD" == "$HOME" ]]; then
    echo "Refusing to start from \$HOME. cd into a project directory."
    return 1
  fi
  node "$PI_CODER_REPO/node_modules/tsx/dist/cli.mjs" \
    "$PI_CODER_REPO/src/main.ts" \
    "$@"
}
```

Notes:

- Sync mirrors managed files under `.pi/` (including `.pi/SYSTEM.md`) and removes stale managed files in the target.
- `settings.json` is mirrored, except `settings.packages` which is merged (union) to preserve target-only installed `npm:` packages during sync.
- It intentionally excludes personal/runtime data like `auth.json`, `sessions/`, `npm/`, `models.json`, and `.DS_Store`.
- Secrets can be centralized via `envService` in `settings.json` (e.g. `"envFile": "${PI_CODER_REPO}/.env"`).
- This launcher is optional and mainly useful for local parity-stack development.

## Sync and Sharing Workflow

From the cloned repo root:

1. Import existing global config into the repo copy (preferred direction):

```bash
npm run pi:pull-global
```

1. Point envService at this repository's `.env` file:

```bash
export PI_CODER_REPO="$(pwd)"
```

1. Optional legacy step: push this repo's `.pi/` stack to global PI only if you explicitly want to overwrite global state:

```bash
npm run pi:sync-global
```

Both commands honor `PI_CODING_AGENT_DIR` if set; otherwise they use `~/.pi/agent`.

## Runtime Layout

- [`src/main.ts`](src/main.ts): embedded PI runtime entrypoint (`createAgentSession` + `InteractiveMode`)
- `.pi/settings.json`: project-level PI settings and skills path integration
- `.pi/agent.config.json`: local bridge config contract
- `.pi/extensions/`: custom extensions
- `.pi/agents/`: project-local `@tintinweb/pi-subagents` role definitions
- `.pi/prompts/`: workflow prompt templates
- `.pi/skills/`: project-local skills

## Role Catalog

- `generic-readonly`: read-only delegated subagent for research/planning/summarization
- `generic-worker`: mutating delegated subagent for implementation/file updates
- `gan-generator`: generator role for explicit generator/evaluator workflows
- `gan-evaluator`: evaluator role for explicit generator/evaluator workflows

## Delegation Orchestration

- Normal repository inspection and file edits stay in-session.
- Use `Agent` from `@tintinweb/pi-subagents` only when the user explicitly asks for delegation.
- Retrieve background results with `get_subagent_result`.
- Redirect running agents with `steer_subagent`.
- Full reference: [`.pi/skills/subagent-orchestrator/references/pi-subagents.md`](.pi/skills/subagent-orchestrator/references/pi-subagents.md).

## Skill Routing

- Direct skill commands are enabled and run in the current session unless the user explicitly asks for delegation.
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

## Troubleshooting

- Missing model/API key:
  - Ensure a PI model provider key exists (e.g., `ANTHROPIC_API_KEY`).
- No Codex skills detected:
  - Ensure `~/.codex/skills` exists and is readable.
  - Confirm `.pi/settings.json` includes the path.
- Subagent not running:
  - Confirm `.pi/settings.json` includes `npm:@tintinweb/pi-subagents`.
  - Run `pi install npm:@tintinweb/pi-subagents` if the package is not installed in the target runtime.
  - Use `Agent({ subagent_type, prompt, description })`.
  - Custom agents must be under `.pi/agents/` or `$PI_CODING_AGENT_DIR/agents/`.
- Read/search/list outside current directory:
  - `read`, `write`, `edit`, `grep`, `find`, and `ls` require approval when the requested path resolves outside the current working directory.
  - Exception: paths under global PI (`~/.pi`, or `PI_CODING_AGENT_DIR` when set) are read-only; `read`/`grep`/`find`/`ls` are allowed there, `write`/`edit` are always blocked.
  - In non-interactive mode, those outside-cwd requests are blocked.

## Failure Handling Notes

- `ask_questions` in non-interactive mode returns deterministic fallback answers.
- Outside-cwd `read`/`write`/`edit`/`grep`/`find`/`ls` requests require explicit approval and are denied without UI.
- Global PI directory is read-only: outside-cwd reads/list/search are allowed under `~/.pi` (or `PI_CODING_AGENT_DIR`), while writes/edits are denied.

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

Subagent extension docs:

- [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents)
- Local reference: [`.pi/skills/subagent-orchestrator/references/pi-subagents.md`](.pi/skills/subagent-orchestrator/references/pi-subagents.md)

## Token Efficiency Guidance

- Prefer in-session work for normal repository inspection and edits.
- Use background `Agent` calls only when the user explicitly requests independent subagents and tasks are low-overlap.
