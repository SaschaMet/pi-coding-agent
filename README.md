# PI Coding Agent Parity Stack

Git-tracked PI config for the global PI runtime (`~/.pi/agent`). It adds:

- Claude Code-style subagents (`@tintinweb/pi-subagents`)
- Shared skills and agent roles
- Quality-gate and boundary-guard extensions
- Reversible PII redaction for every model request (see [step 7](#7-start-headroom-and-the-pii-analyzer))
- A spec-gated coding workflow (see [Workflow and Guards](#workflow-and-guards))
- A local bootstrap (`src/`) for developing the stack itself

Daily use: you run the global `pi` command. This repo is the source of truth for what `pi` loads.

## New Machine Setup

Follow the steps in order. Tested layout: macOS with `zsh`.

### 1. Prerequisites

Required:

- Node `>=22.19.0` (check: `node -v`)
- `npm`
- `git`
- Docker (runs the Headroom proxy and the PII analyzer, see step 7)

Optional, but some skills and the workflow depend on them:

- `graphify` CLI: used by the `graphify` skill. The `graphify query` step in the workflow needs it. `pisync` calls `graphify install --platform pi`.
- `cmux`: used by the `cmux-orchestration` skill and `.cmux/cmux.json`.
- `direnv`, LM Studio CLI (`lms`), oMLX CLI: only for local model providers.

Without the optional tools, the matching skills fail. Everything else works.

### 2. Install the PI CLI

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Check: `pi --version`. Upstream install docs: <https://pi.dev/docs/latest>.

### 3. Clone and install this repo

```bash
mkdir -p ~/Projects && cd ~/Projects
git clone <repo-url> pi-coding-agent
cd pi-coding-agent
npm install
```

`npm install` runs `postinstall` (`scripts/patch-retry.ts`). It patches the LLM retry backoff in the repo copy and in the global `pi` install. The patch is idempotent.

### 4. Push the config into the global runtime

```bash
npm run pi:sync-global
```

This copies `.pi/` (settings, `SYSTEM.md`, skills, agents, extensions, skill library) into `~/.pi/agent`. `pi` only loads this stack after this step.

Sync never copies these files. Create them yourself:

- `auth.json`, `sessions/`, `trust.json`: per-machine state
- `models.json`: your model providers (see step 5)
- `mcp-adapter.json`: MCP servers (see step 8)
- the top-level `.pi/AGENTS.md`

Details: [`scripts/sync-pi-config.md`](scripts/sync-pi-config.md).

### 5. Add your model provider

Add your provider to `~/.pi/agent/models.json`. Use the internal provider details you already have. Schema: [Providers & Models](node_modules/@earendil-works/pi-coding-agent/docs/providers.md).

Shape (placeholders only):

```json
{
  "providers": {
    "<provider-name>": {
      "baseUrl": "https://<host>/v1",
      "api": "openai-responses",
      "apiKey": "<your-key>",
      "models": [{ "id": "<model-id>", "name": "<display name>", "reasoning": true }]
    }
  }
}
```

Rules:

- Never commit `models.json` or any key.
- The synced `settings.json` sets the default to `iqRouter/grunt` with thinking `high`. If your provider name differs, change `defaultProvider` and `defaultModel` in `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "<provider-name>",
  "defaultModel": "<model-id>",
  "defaultThinkingLevel": "high"
}
```

- Boot Claude models with thinking `medium`, not `high`. Example: `pi --model claude-bridge/claude-opus-5-5:medium`. The synced settings already set `medium` for the bridge models.

### 6. Install the PI packages

Sync does not install packages. Install each one:

```bash
pi install npm:@tintinweb/pi-subagents
pi install npm:@raquezha/noheadroom
pi install npm:pi-mcp-adapter
pi install npm:pi-spark
pi install npm:@juicesharp/rpiv-ask-user-question
pi install npm:@juicesharp/rpiv-todo
pi install npm:pi-lens
pi install npm:pi-cache-optimizer
pi install npm:pi-insomnia
pi install npm:pi-claude-bridge
```

What they do:

| Package | Purpose |
| --- | --- |
| `@tintinweb/pi-subagents` | `Agent`, `get_subagent_result`, `steer_subagent` |
| `@raquezha/noheadroom` | Headroom integration |
| `pi-mcp-adapter` | MCP servers (step 8) |
| `pi-spark` | PI helpers |
| `@juicesharp/rpiv-ask-user-question` | Ask-the-user tool |
| `@juicesharp/rpiv-todo` | Todo tool |
| `pi-lens` | Code intelligence |
| `pi-cache-optimizer` | Prompt-cache tuning |
| `pi-insomnia` | Keeps the machine awake during runs |
| `pi-claude-bridge` | Use Claude models through Claude Code (step 9) |

### 7. Start Headroom and the PII analyzer

Headroom is a local compression proxy in Docker on `127.0.0.1:8788`.

```bash
npm run headroom:up
```

Check: `curl -fsS http://127.0.0.1:8788/health`.

- Headroom is an optimization. If Docker is missing, `pi` still starts and prints a warning.
- Stop it: `npm run headroom:down`.
- The container mounts `~/.claude/projects` and `~/.pi/agent/sessions` read-only.

The PII analyzer is a local Presidio container (English + German) on `127.0.0.1:5002`. The `pii-redaction` package (`.pi/local-packages/pii-redaction.ts`) uses it to replace emails, phone numbers, IBANs, card numbers, and names with tags like `<pii:EMAIL_ADDRESS:…>` before any model sees them, Claude through `claude-bridge` included. Local tools (`bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`) get the real values back, so logins still work.

```bash
npm run presidio:up   # first run builds the image (~1.5 GB)
```

Check: `curl -fsS http://127.0.0.1:5002/health`, then `/pii status` in a new PI session.

- Redaction is off by default. Turn it on with `pi --private` or `npm run agent:private` (which also starts the analyzer). A private session stays private when reopened. Docker restarts the container after a reboot.
- With redaction on and the analyzer down, PI withholds new text instead of sending it raw. `/pii off` turns redaction off until you quit PI.
- Stop it: `npm run presidio:down`.
- Behavior, failure modes, and known gaps: [`docs/reference/pii-redaction.md`](docs/reference/pii-redaction.md).

### 8. MCP servers

Set up MCP servers through the `pi-mcp-adapter` extension. No MCP config is stored in this repo.

### 9. Claude models (optional)

Use Claude models inside PI through Claude Code:

1. Install Claude Code and log in: `claude` (follow the login prompt).
2. Install the bridge: `pi install npm:pi-claude-bridge` (already in step 6).
3. Start `pi`, run `/model`, and pick a `claude-bridge/...` model.

Optional config: `~/.pi/agent/claude-bridge.json`. Docs: <https://www.npmjs.com/package/pi-claude-bridge>.

### 10. Shell setup

Add to `~/.zshrc`. Set `PI_CODER_REPO` to where you cloned the repo.

```zsh
export PI_CODER_REPO="$HOME/Projects/pi-coding-agent"
export PI_TELEMETRY=0

# Run the global pi binary. Refuse to start in $HOME.
picoder() {
  if [[ "$PWD" == "$HOME" ]]; then
    echo "Refusing to start from \$HOME. cd into a project directory."
    return 1
  fi
  local pi_bin
  pi_bin="$(whence -p pi)" || return 1
  "$pi_bin" "$@"
}

# Start Headroom (if needed), then PI.
pi() {
  "$PI_CODER_REPO/scripts/headroom-up.sh" --quiet
  picoder "$@"
}
```

Reload: `source ~/.zshrc`.

The `pisync` helper is optional. See [Syncing Skills to Other Agents](#syncing-skills-to-other-agents).

### 11. Verify

```bash
cd ~/Projects/pi-coding-agent
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run smoke       # extension and resource discovery
```

Then start PI in a project directory (not `$HOME`):

```bash
cd ~/Projects/<some-project>
pi
```

Expected:

- PI starts with no extension load errors.
- `/model` lists your provider's models.
- The skills (`create-spec`, `grill-me`, `code-review`, ...) are listed.
- `curl -fsS http://127.0.0.1:8788/health` succeeds.
- `curl -fsS http://127.0.0.1:5002/health` succeeds, and `/pii status` reports `on`.

## Workflow and Guards

PI here enforces a spec-gated workflow. Read `.pi/SYSTEM.md` and `AGENTS.md` for the full rules.

- Every code change needs an approved spec or plan file first (`create-spec` or `create-plan`, then `grill-me`).
- Write tests first (`tdd` skill).
- After each turn, `gates.ts` checks the final message. It names every changed file, and it claims "tests pass" only if a test ran. On a violation it sends one correction. Toggle with `/gates on|off`.
- `read-boundary-guard.ts` asks for approval when a path is outside the current directory. Without a UI, it blocks the path. Trusted directories go in `.pi/trust.json`.
- `write-boundary-guard.ts` arms itself when a spec or plan is written, then limits writes to the spec's `Modify` list. In a new session, run `/scope <path-to-spec>`. `/scope off` disarms.
- Files under `~/.pi` are read-only for the agent.

The guards and gates only act from the global copy in `~/.pi/agent/extensions/`. Run `npm run pi:sync-global` after every change, or they are not active.

PI does not block reading `.env` files. The author's Claude Code setup has a separate hook for that. A PI-only install has no such protection, so keep secrets out of files the agent can read.

These are intended. Do not work around them. Full rules, decision order, and how to unblock: [`docs/reference/gates-and-guards.md`](docs/reference/gates-and-guards.md).

## Commands

- `npm run agent`: run the local bootstrap (`src/main.ts`) from this repo. Starts Headroom first. For developing the stack.
- `npm run dev`: same, with file watch.
- `npm run agent:private`: start headroom and the PII analyzer, then run the bootstrap with `--private`.
- `npm run smoke`: extension and resource discovery check.
- `npm run typecheck`: `tsc --noEmit`.
- `npm test`: unit and integration tests.
- `npm run test:coverage`: tests with coverage.
- `npm run pi:pull-global`: copy global config into this repo's `.pi/`.
- `npm run pi:sync-global`: copy this repo's `.pi/` into `~/.pi/agent`. Overwrites global state.
- `npm run headroom:up` / `npm run headroom:down`: start or stop the Headroom container.
- `npm run presidio:up` / `npm run presidio:down`: start or stop the PII analyzer container.

Both sync commands honor `PI_CODING_AGENT_DIR` if set. Default: `~/.pi/agent`.

## Keeping Config in Sync

The repo `.pi/` is the source of truth. Edit there, then push:

```bash
npm run pi:sync-global
```

If you changed files directly in `~/.pi/agent`, pull first so you do not lose them:

```bash
npm run pi:pull-global
```

Push and pull mirror files: they delete files that exist only on the target side. Read [`scripts/sync-pi-config.md`](scripts/sync-pi-config.md) before you use either.

## Syncing Skills to Other Agents

Optional. PI skills live in `~/.pi/agent/skills/`. `pisync` links them into the skill folders of other agents (Claude Code, Codex, Copilot), so every tool uses one skill set.

`pisync` does this:

1. Runs `npm run pi:sync-global`.
2. Links each PI skill into every target folder.
3. Removes dangling links when a PI skill is deleted.
4. Runs `graphify install --platform pi` (needs `graphify`).

Warning: if a target folder already has a real (non-link) folder with the same skill name, the helper runs `rm -rf` on it before it links. Back up such folders first.

Remove the target lines for agents you do not use.

```zsh
_pisync_link_skills() {
  local pi_skills="$1"
  local dest_skills="$2"

  mkdir -p "$dest_skills"

  for skill_dir in "$pi_skills"/*/; do
    local skill_name="${skill_dir%/}"
    skill_name="${skill_name##*/}"
    local target="$dest_skills/$skill_name"

    if [[ -L "$target" && "$(readlink "$target")" == "$pi_skills/$skill_name" ]]; then
      continue
    fi

    if [[ -d "$target" && ! -L "$target" ]]; then
      rm -rf "$target"
    fi

    ln -sfn "$pi_skills/$skill_name" "$target"
    echo "pisync: linked skill '$skill_name' -> $dest_skills"
  done

  while IFS= read -r target; do
    if [[ "$(readlink "$target")" == "$pi_skills/"* && ! -e "$target" ]]; then
      rm "$target"
      echo "pisync: removed stale skill '${target##*/}' from $dest_skills"
    fi
  done < <(find "$dest_skills" -maxdepth 1 -type l)
}

pisync() {
  (cd "$PI_CODER_REPO" && npm run pi:sync-global)

  local pi_skills="$HOME/.pi/agent/skills"

  if [[ ! -d "$pi_skills" ]]; then
    echo "pisync: no skills directory found at $pi_skills, skipping skill links"
    return
  fi

  _pisync_link_skills "$pi_skills" "$HOME/.claude/skills"   # Claude Code
  _pisync_link_skills "$pi_skills" "$HOME/.codex/skills"    # OpenAI Codex
  _pisync_link_skills "$pi_skills" "$HOME/.copilot/skills"  # GitHub Copilot

  graphify install --platform pi
}
```

| Scenario | Result |
| --- | --- |
| Skill added to `~/.pi/agent/skills/` | Link created in all targets |
| Skill already linked | No-op |
| Skill deleted from `~/.pi/agent/skills/` | Dangling link removed from all targets |
| Skill exists only in a target | Untouched, unless it has the same name as a PI skill |

## Runtime Layout

- [`src/main.ts`](src/main.ts): local bootstrap (`createAgentSession` + `InteractiveMode`)
- `.pi/settings.json`: PI settings
- `.pi/SYSTEM.md`: durable agent rules
- `.pi/extensions/`: quality gates, guards, tools
- `.pi/local-packages/`: extensions loaded as `packages` entries, so they run before npm packages (`pii-redaction.ts`)
- `.pi/agents/`: subagent role definitions
- `.pi/skills/`: project-local skills
- `.pi/skill-library/`: on-demand skills, loaded only when named
- `scripts/`: sync, smoke check, Headroom and PII analyzer helpers
- `presidio/`, `presidio-compose.yml`: PII analyzer image (en + de)
- `docs/`: architecture and reference docs

## Role Catalog

- `generic-readonly`: read-only subagent for research, planning, summaries
- `generic-worker`: mutating subagent for implementation and file edits

## Delegation

- Normal inspection and edits stay in the current session.
- Use `Agent` from `@tintinweb/pi-subagents` only when you ask for delegation.
- Get background results with `get_subagent_result`. Redirect a running agent with `steer_subagent`.
- Do not pass `model` to `Agent`. Subagents inherit the orchestrator model.
- Custom agents must live in `.pi/agents/` or `$PI_CODING_AGENT_DIR/agents/`.

## Troubleshooting

- `pi: command not found`: redo step 2. Check that the npm global bin folder is in `PATH`.
- No model or provider error: check `~/.pi/agent/models.json` and that `defaultProvider` matches a provider name in it.
- Skills or extensions missing: run `npm run pi:sync-global`, then `npm run smoke`.
- Subagents not running: check that `@tintinweb/pi-subagents` is installed (`pi install npm:@tintinweb/pi-subagents`).
- No Headroom warning shown but no compression: run `curl -fsS http://127.0.0.1:8788/health`, then `npm run headroom:up`.
- Messages show `[pii-redaction: withheld, analyzer unavailable]`: run `npm run presidio:up`. New text is redacted again within 30 s.
- A tool call is blocked with "Unknown PII tag": the tag came from an earlier session or a restart. Give the value again.
- "Refusing to start from $HOME": `cd` into a project directory.
- Path approval prompts: expected. Reads and writes outside the current directory need approval. In non-interactive mode they are blocked.

## Upstream Docs

- PI: <https://pi.dev/docs/latest> and <https://github.com/earendil-works/pi>
- Package docs (after `npm install`): [Providers & Models](node_modules/@earendil-works/pi-coding-agent/docs/providers.md), [Settings](node_modules/@earendil-works/pi-coding-agent/docs/settings.md), [Skills](node_modules/@earendil-works/pi-coding-agent/docs/skills.md), [Extensions](node_modules/@earendil-works/pi-coding-agent/docs/extensions.md), [Sessions](node_modules/@earendil-works/pi-coding-agent/docs/sessions.md), [Keybindings](node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md), [Terminal Setup](node_modules/@earendil-works/pi-coding-agent/docs/terminal-setup.md)
- Subagents: <https://github.com/tintinweb/pi-subagents>
- Claude bridge: <https://www.npmjs.com/package/pi-claude-bridge>
- Implementation checklist: [`docs/reference/implementation-workflow.md`](docs/reference/implementation-workflow.md)
