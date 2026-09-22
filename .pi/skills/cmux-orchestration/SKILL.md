---
name: cmux-orchestration
description: Use this skill when driving the cmux terminal app via its CLI — booting agent fleets, dynamically composing panes (workers, Logs, Browser, Research) for a task, broadcasting tasks to agent surfaces, reading their screens, reacting to cmux events, or tearing workspaces down. Covers the multi-agent orchestration loop on top of this repo's roster in `.cmux/cmux.json`. Do not use for plain shell work inside the current terminal, or for editing global cmux/Ghostty config. Invoke the skill when the user says `run in cmux` or `run cmux` or `spawn an agent team` (also the common typo `spwan and agent team`).
---

# cmux Orchestration

Drive cmux (native macOS terminal, Ghostty-based) from the CLI: one agent session (you) spawns, prompts, reads, and tears down other agent terminals. No SDK — every agent is a real, addressable terminal surface.

## Topology

```
Window (macOS window) → Workspace (sidebar tab) → Pane (split region)
  → Surface (tab in a pane: terminal or browser) → Panel (content)
```

Refs are short handles: `workspace:9`, `pane:2`, `surface:3`. UUIDs accepted via `--id-format both` when persistence needs them.

## The 4-Verb Loop

```bash
cmux send --surface surface:3 "claude"      # type text (does NOT press Enter)
cmux send-key --surface surface:3 enter     # submit
cmux read-screen --surface surface:3 --scrollback --lines 200   # read output
cmux close-surface --surface surface:3      # stop / tear down one agent
```

`send` with a trailing `\n` acts as Enter. There are no modifier chords (`Ctrl-C` impossible) — to stop a running agent, `close-surface` it. To stop a whole workspace: `cmux workspace close --workspace <ref>`.

### Boot verification (run once per worker)

After a worker reports ready, read its model line once and report it to the user. Silent model fallback (e.g. `iqRouter/grunt:high` → `openrouter/z-ai/glm-5.3-flash:medium`) is otherwise visible only in the pane footer — verified: a full review ran on a fallback model unnoticed:

```bash
cmux read-screen --surface "$W" --scrollback --lines 60 | grep -oE '[A-Za-z0-9._-]+/[A-Za-z0-9._-]+:[a-z]+' | tail -1
```

Compare against the requested model. On mismatch: report it, do not silently accept — the user decides whether to respawn on the requested model (see the respawn rule under Dynamic workers).

## Boot the Team (this repo's roster)

**Default: spawn in the caller workspace — no new window, no tab switch.** Fill a 2-column grid by anchored splits, alternating direction per worker (staircase: `right`, `down`, `right`, `down`, …), each anchored at the previous worker's surface — verified geometry: never more than 2 panes side by side; the 3rd pane lands on a new row.

```bash
WS="${CMUX_WORKSPACE_ID:-$(cmux identify --json | jq -r .caller.workspace_ref)}"
LAST="${CMUX_SURFACE_ID:-$(cmux identify --json | jq -r .caller.surface_ref)}"   # anchor = caller surface
W1=$(cmux new-split --workspace "$WS" right --surface "$LAST" --json | jq -r .surface_ref)
W2=$(cmux new-split --workspace "$WS" down  --surface "$W1"  --json | jq -r .surface_ref)
# worker N: alternate right/down, anchored at W_(N-1)
cmux send --workspace "$WS" --surface "$W1" "npm run agent -- --new-session --model iqRouter/grunt:high"
cmux send-key --workspace "$WS" --surface "$W1" enter   # boot first: split surfaces are bare shells
```

Helper panes (Logs/Browser) join the same grid with `new-pane --workspace "$WS" …` when the task calls for them. Cleanup (user-approved, never automatic) closes worker/helper surfaces with explicit `--workspace "$WS"` — the caller's own pane and unrelated surfaces stay untouched.

**Alternative: dedicated workspace** (when the user asks for a separate tab or the fleet is large): `.cmux/cmux.json` is the single roster source (`commands[]` → named workspace layout, currently `pi Team`: 2 panes each running `npm run agent`). After editing it: `cmux config doctor` (validate, no socket needed) then `cmux reload-config`.

```bash
# 1. extract the layout from the roster and boot it (workspace create has NO --json flag)
LAYOUT=$(node -e "const c=require('./.cmux/cmux.json'); \
  console.log(JSON.stringify(c.commands.find(k=>k.name==='pi Team').workspace.layout))")
cmux workspace create --name "pi-team" --cwd "$PWD" --layout "$LAYOUT"

# 2. capture refs AFTER creation — never guess them
cmux tree --all --json    # ground truth: every workspace/pane/surface with refs (→ WS, S1, S2)
# note: `list-pane-surfaces --workspace` only lists ONE pane's surfaces — use tree --all

# 3. label the workspace (color is runtime-only, not part of the layout JSON)
cmux workspace-action --action set-color --workspace "$WS" --color Blue
```

Each roster surface auto-runs its `command` on open — the layout is the boot script. To boot agents other than the roster (e.g. `claude`, `codex`, `gemini`, `pi`): create a workspace, then `cmux new-split right --surface <ref>` (returns the new surface ref) and `cmux send` the agent CLI name into each surface.

## Orchestration Recipes

**Broadcast (fan-out):**

```bash
for S in $S1 $S2; do cmux send --surface "$S" "$TASK"; cmux send-key --surface "$S" enter; done
```

**Read to decide:** make agents print a machine-greppable sentinel instead of parsing prose.

```bash
OUT=$(cmux read-screen --surface "$S" --scrollback --lines 200)
VERDICT=$(printf '%s\n' "$OUT" | grep -oE 'VERDICT=(GREEN|RED)' | tail -1 | cut -d= -f2)
# branch on $VERDICT; if empty, poll again
```

**Wait for a marker (the one honest poll):** loop `read-screen --lines 30` + `grep -qE "$MARKER"` once per second, bounded (e.g. 60–120 polls), else time out.

**Event-driven (push, not poll):**

```bash
cmux events --name agent.hook --name notification.created --reconnect \
  --cursor-file /tmp/cmux-fleet.seq | while read -r evt; do
    SURF=$(printf '%s' "$evt" | jq -r '.surface_id // empty')
    cmux read-screen --surface "$SURF" --scrollback --lines 40    # event = doorbell, read the details
  done
```

Event payloads redact titles/bodies (privacy doorbell: ids + lengths only). Other event names: `surface.created`, `surface.closed`, `workspace.created`.

**Rendezvous (block until a worker signals) — the preferred completion mechanism, not read-screen polling:** orchestrator `cmux wait-for <token> --timeout 600` ⇄ worker `cmux wait-for -S <token>`. For long-output tasks (reports, reviews), put three requirements in the task prompt: the worker (1) writes its full report to `$TMPDIR/pi-reports/<task>.md`, (2) prints a one-line sentinel as its last chat line, (3) runs `cmux wait-for -S <token>` when done. The orchestrator waits on the token, then reads the report file. Never parse a long report from screen scrollback: the TUI wraps lines at pane width and truncates scrollback (verified: a 400-line read-screen captured a wrapped, incomplete report). Bounded `read-screen` marker polling stays the fallback only when the worker cannot signal `wait-for`. **Never wait blind — watch for approval prompts.** A worker blocked on an approval prompt can never signal, so a bare `wait-for` hangs until its timeout (verified: a pi review sat on "Allow write outside current directory?" for its report file while the orchestrator waited). Wait in 60-second slices and read the worker's screen between slices:

```bash
wait_or_prompt() {   # $1 = token, $2 = worker surface; exit 0 = signalled, 2 = prompt, 1 = timed out
  for _ in $(seq 1 60); do
    cmux wait-for "$1" --timeout 60 && return 0          # exits 1 on timeout
    SCR=$(cmux read-screen --workspace "$WS" --surface "$2" --lines 40)
    if printf '%s\n' "$SCR" | grep -qE 'Allow .*\?|Do you want to proceed|Trust project folder|→ Yes'; then
      echo "PROMPT on $2"; printf '%s\n' "$SCR" | tail -15; return 2
    fi
  done
  return 1
}
```

Run it in the background. On exit 2, show the prompt to the user at once and let them decide. Do not answer a permission prompt for them unless they have said to. Keep the task file and the report file on different paths (`<task>.task.md` vs `<task>.report.md`) — verified: a shared path made workers overwrite their own task file with the report.

**TDD gate (every code task) — the orchestrator enforces Red, not the worker:** a rule in `.pi/SYSTEM.md` alone does not hold (verified: a worker with the TDD rule loaded wrote source before tests). Split each code task into two dispatches:

1. **Red dispatch:** the worker writes or changes tests only — no source edits — runs them, writes the exact test command and its failing output to `$TMPDIR/pi-reports/<task>.red.md`, prints `RED_READY`, and signals `cmux wait-for -S <task>-red`.
2. **Orchestrator check:** wait on `<task>-red`, then rerun the command from the red report yourself. Proceed only when it fails for the reason the task names (missing behavior, not a syntax or import error). Otherwise send the worker back to step 1.
3. **Green dispatch:** send "implement until `<command>` is green, then refactor; do not weaken the tests", with the normal report and rendezvous.

Check the order afterwards in the worker's transcript: its first `Edit`/`Write` of the slice must hit a test file. Report any violation to the user.

**Rules reach every agent:** Claude Code workers load `~/.claude/CLAUDE.md` (the synced copy of `.pi/SYSTEM.md`) on their own. Their subagents may not: `Explore` subagents do not load CLAUDE.md (verified: 0 rule hits in their transcripts), while `general-purpose` subagents do. Put this in every worker task prompt: "Use `general-purpose` subagents for any subagent work. If you use `Explore` or another type, paste the TDD, `$TMPDIR`, and command-timeout rules from `.pi/SYSTEM.md` into its prompt." Pi workers load `.pi/SYSTEM.md` through the repo; start their task prompt with "Read `.pi/SYSTEM.md` and follow it" anyway, so the rules are fresh in context.

**Dashboard:** `cmux set-status build "running" --workspace "$WS" --color "#ff9500"` · `cmux set-progress 0.4 --label "Building"` · `cmux log --workspace "$WS" --level info -- "msg"` · `cmux top --format tsv` (per-surface CPU/mem) · `cmux notify --title .. --body ..` for desktop alerts.

**Fan-in:** read every surface with `read-screen --scrollback`, compare/aggregate, then report. `cmux tree --all` is the ground truth of what is running.

## Fail-Safe Teardown

Closing panes is user-approved, never automatic. A finished task is not a close signal — the user must be able to verify the outcome in the pane. Close a spawned pane, surface, or workspace only after the user approves it (e.g. says the research step is done, or part 1 of the plan is done). On an error path (failed boot, timeout, unresponsive agent), report and ask — do not close on your own.

```bash
cmux workspace close --workspace "$WS"
cmux tree --all        # verify: no leftover surfaces from this session
```

Exception: a surface that failed to boot (blank shell, dead PTY) may be closed immediately — there is no outcome to verify. Never close workspaces/surfaces you did not spawn or the user did not name.

## Dynamic Composition

Composition is a per-task decision. State it at boot and at every dynamic spawn ("booted 2 workers + 1 logs pane").

**Decision table:**

| Task                                                          | Panes                                                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Code/feature work                                             | roster workers (`.cmux/cmux.json` pool)                                                                                                |
| Backend with a stream worth watching (dev server, long build) | workers + Logs pane (judgment: only if output is worth watching live)                                                                  |
| Frontend change                                               | workers; Browser pane **only on user request** (`new-pane --type browser --url`, then `browser reload` / `browser snapshot` to verify) |
| Research the user should watch                                | Research worker in a pane (fleet worker — live output by construction)                                                                 |
| Research for your own context                                 | in-process subagent; report the result in this conversation (conversation counts as visible)                                           |
| Mixed                                                         | minimal set that covers verification                                                                                                   |

**Dynamic workers:** to exceed the roster's 2, join the existing workspace: `cmux new-split --workspace "$WS" right --surface <ref>`. A split surface is a **bare shell** (layout `command` does not auto-run) — first send the worker boot command (`npm run agent -- --new-session --model <model>`), wait for it to come up, then send the task. Workers always run with `--new-session` (prevents resuming your session) and default to `iqRouter/grunt:high` unless the task names another model. If a worker's model backend errors (e.g. 503 busy), respawn it on a known-working model (e.g. `claude/sonnet`) and tell the user. Every Claude Code worker boots with `--permission-mode auto`. Never boot one in a mode that prompts per command (`default`, `manual`, `acceptEdits`): the user would have to approve each prompt by hand in the worker pane. Every Claude Code worker also boots with the env var `CLAUDE_CODE_SUBAGENT_MODEL=haiku`: a subagent spawned without an explicit `model` otherwise inherits the worker's model (verified: a Sonnet worker ran all its research subagents on Sonnet despite the Haiku rule in CLAUDE.md).

**Host model defaults:** pi → workers/researchers on `iqRouter/grunt` (per `.pi/SYSTEM.md`). Claude Code → workers `CLAUDE_CODE_SUBAGENT_MODEL=haiku claude --model sonnet --permission-mode auto`, researchers `claude --model haiku --permission-mode auto`.

**Creation recipes (additive only, never steal focus):**

```bash
cmux new-pane --workspace "$WS" --type terminal --direction right --focus false                      # generic helper
cmux new-pane --workspace "$WS" --type terminal --direction right --command "touch <logfile> && tail -F <logfile>"   # Logs pane (-F retries; pre-create the file)
cmux new-pane --workspace "$WS" --type browser --url <url> --focus false                            # Browser pane
```

Reuse the existing right-hand helper pane (add a surface) before creating more panes. Surface-affecting verbs (`close-surface`, `new-split`) resolve refs against the **focused** workspace — always pass `--workspace "$WS"` explicitly (verified: without it, valid refs fail with "Surface not found" when the user is focused elsewhere). Browser snapshots: `cmux browser snapshot --surface <ref>`.

**Ephemeral lifecycle:** every helper pane is opened with a purpose, and closes only when the user approves (e.g. confirms the step it served is done) — never automatically on completion: the Logs pane stays until the user has seen the monitored result, the Browser pane until the user has seen the verification, the Research pane until the user has read the result (keep it open only if the user asks). Dynamic workers close with the user-approved workspace teardown. After an approved cleanup, `cmux tree --all` must show only panes the user wants to keep.

**Transparency default:** every delegated unit of work is either a visible pane or is reported in this conversation.

## Gotchas

- **Refs are captured, not guessed.** Create first, then read refs from `tree --all --json` (complete) or `identify --json` (caller). `list-pane-surfaces --workspace` covers a single pane only (verified).
- **Workers must not resume the orchestrator's session.** A worker whose command boots pi in the same project cwd continues the most recent session — i.e. the live orchestrator conversation (verified: cross-talk + concurrent writes). Launch workers with an isolated session (fresh cwd or an explicit new-session flag) before broadcasting.
- **`CMUX_QUIET=1`** silences legacy-alias notices for clean scripting (verified: output unchanged, exit 0). Prefer modern verb forms anyway: `workspace create`/`workspace list`/`workspace close` over the legacy `new-workspace`/`list-workspaces`/`close-workspace` aliases.
- **Never overwrite a working agent login** with `--env-file` placeholder keys; scope credential injection to agents that actually need it.
- **Socket access:** default `socketControlMode` is `cmuxOnly` — this skill's verbs work when pi runs _inside_ a cmux pane. If `cmux ping` fails, check `cmux capabilities --json`; do not raise socket mode without explicit user approval.
- **`reload-config` reloads global AND Ghostty config** and refreshes terminals live — no app restart.
- **Focus verbs are user-affecting** (`select-workspace`, `focus-pane`, `focus-panel`): call only on explicit user request; pass `--focus false` on creation/move verbs that support it.
- Layout `split` ratios are 0.1–0.9, exactly two `children` per split node; `pane` nodes hold `surfaces` with auto-run `command`.

## CLI help

```
$ cmux --help
```
