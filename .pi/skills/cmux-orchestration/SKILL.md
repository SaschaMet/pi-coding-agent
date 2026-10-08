---
name: cmux-orchestration
description: Drives the cmux terminal app from its CLI. Boots agent panes, sends them tasks, reads their screens, reacts to events, and tears workspaces down. Use when running inside cmux and the user asks to run in cmux, use an agent team, use agents or sub-agents, open a new pane, or watch workers. Not for plain shell work in the current terminal or for editing global cmux/Ghostty config.
---

# cmux Orchestration

Orchestrator only. A session whose task starts with `You are a cmux worker` stops reading here; workers never spawn cmux panes.

Drive cmux (native macOS terminal, Ghostty-based) from the CLI: one agent session (you) spawns, prompts, reads, and tears down other agent terminals. No SDK — every agent is a real, addressable terminal surface.

## Topology

```
Window (macOS window) → Workspace (sidebar tab) → Pane (split region)
  → Surface (tab in a pane: terminal or browser) → Panel (content)
```

Refs are short handles: `workspace:9`, `pane:2`, `surface:3`. UUIDs accepted via `--id-format both` when persistence needs them.

## The 4-Verb Loop

```bash
cmux send --surface surface:3 "pi"        # type text (does NOT press Enter)
cmux send-key --surface surface:3 enter     # submit
cmux read-screen --surface surface:3 --scrollback --lines 200   # read output
cmux close-surface --surface surface:3      # stop / tear down one agent
```

`send` with a trailing `\n` acts as Enter. Interrupt a running agent with `cmux send-key --workspace "$WS" --surface <ref> ctrl+c`. Use `close-surface` only as **Fail-Safe Teardown** allows. To stop a whole workspace: `cmux workspace close --workspace <ref>`.

### Boot verification (run once per worker)

After a worker reports ready, read its model line once and report it to the user. Silent model fallback (e.g. `iqRouter/grunt:high` → `openrouter/z-ai/glm-5.3-flash:medium`) is otherwise visible only in the pane footer:

```bash
cmux read-screen --surface "$W" --scrollback --lines 60 | grep -oE '[A-Za-z0-9._-]+/[A-Za-z0-9._-]+:[a-z]+' | tail -1
```

Compare against the requested model. On mismatch: report it, do not silently accept — the user decides whether to respawn on the requested model (see the respawn rule under Dynamic workers).

## Boot the Team

**Worker boot command: `pi --no-session --model iqRouter/grunt:high`.** It works in any repo. `--no-session` keeps the worker's session unsaved, so it cannot resume the orchestrator's session. `npm run agent` and `--new-session` exist only in the pi-coding-agent repo: elsewhere npm fails with `ENOENT` and `pi` rejects `--new-session`.

**Model default: every new pane/agent boots on `iqRouter/grunt:high` unless the user names another model.**

**Private sessions:** when this session runs with `--private` (or the user says the work is private), append `--private` to every worker boot command: `pi --no-session --model iqRouter/grunt:high --private`. Workers are separate processes and start with redaction off. Start the analyzer first with `npm run presidio:up`. In the pi-coding-agent repo, `npm run agent:private -- --new-session` is the equivalent.

**Default: spawn in the caller workspace — no new window, no tab switch.** Fill a 2-column grid by anchored splits, alternating direction per worker (staircase: `right`, `down`, `right`, `down`, …), each anchored at the previous worker's surface. Never more than 2 panes side by side; the 3rd pane lands on a new row.

```bash
WS="${CMUX_WORKSPACE_ID:-$(cmux identify --json | jq -r .caller.workspace_ref)}"
LAST="${CMUX_SURFACE_ID:-$(cmux identify --json | jq -r .caller.surface_ref)}"   # anchor = caller surface
W1=$(cmux new-split --workspace "$WS" right --surface "$LAST" --json | jq -r .surface_ref)
W2=$(cmux new-split --workspace "$WS" down  --surface "$W1"  --json | jq -r .surface_ref)
# worker N: alternate right/down, anchored at W_(N-1)
cmux send --workspace "$WS" --surface "$W1" "pi --no-session --model iqRouter/grunt:high"
cmux send-key --workspace "$WS" --surface "$W1" enter   # boot first: split surfaces are bare shells
```

Helper panes (Logs/Browser) join the same grid with `new-pane --workspace "$WS" …` when the task calls for them. Cleanup follows **Fail-Safe Teardown**.

**Alternative: dedicated workspace** (the user asks for a separate tab or the fleet is large): read `references/roster-workspace.md` when `.cmux/cmux.json` exists in the current directory; otherwise use the split recipe above.

To boot agents other than the roster (e.g. `claude`, `codex`, `gemini`, `pi`): create a workspace, then `cmux new-split right --surface <ref>` (returns the new surface ref) and `cmux send` the agent CLI name into each surface. Boot Claude Code workers as `claude --permission-mode auto`: a bare `claude` starts in manual mode and asks before every shell command, so the worker stalls on its first command and never signals. Never use `bypassPermissions`: auto mode still stops risky actions, so keep the prompt watcher running.
Note: When spwaning claude agents, use thinking level `medium`.

## Orchestration Recipes

**Worker messages:** every task message starts with `You are a cmux worker.` Workers are full pi sessions without an `<active_agent>` tag. That opening line makes them read the subagent rules — `.pi/SUBAGENT.md` if it exists, otherwise `~/.pi/agent/SUBAGENT.md` (approval comes from the task, no further delegation, when to stop). Follow the opening with this bootstrap: "Your system prompt already contains the durable rules (SYSTEM.md) and, if present, this repo's AGENTS.md — follow them. Read the subagent rules: `.pi/SUBAGENT.md` if it exists, otherwise `~/.pi/agent/SUBAGENT.md`." Then add: "Use `general-purpose` subagents for any subagent work." Non-pi workers (e.g. `claude`) are not covered: they rely on their own context files, and their subagents may not load them.

**Time signal:** workers pace their work to an elapsed-time budget. At fleet boot, set the start time and a budget of about 1.5× your estimate in seconds. Leave `BUDGET` unset when you cannot estimate. Append `$(ts)` to the end of every task, Green-dispatch, and steer message. Keep it on the same line: a newline in `cmux send` acts as Enter. The brackets keep workers from reading the tag as part of a trailing command such as `cmux wait-for -S <token>`.

```bash
T0=$(date +%s); BUDGET=1200   # BUDGET is advisory; workers stop on correctness, not the clock
ts() { local e=$(( $(date +%s) - T0 )); if [ -n "${BUDGET:-}" ]; then echo "[time: ${e}s elapsed of ${BUDGET}s budget]"; else echo "[time: ${e}s elapsed]"; fi; }
```

**Broadcast (fan-out):**

```bash
for S in $S1 $S2; do cmux send --surface "$S" "You are a cmux worker. $TASK $(ts)"; cmux send-key --surface "$S" enter; done
```

**Completion: pick one.** Default: rendezvous.

| Situation                         | Use                                           |
| --------------------------------- | --------------------------------------------- |
| Worker can run `cmux wait-for -S` | Rendezvous (below)                            |
| Worker cannot signal              | Wait for a marker (below)                     |
| Many workers, long run            | Events (`references/events-and-dashboard.md`) |

**Check interval:** the orchestrator never goes more than 30 seconds without checking a worker.

**Read to decide:** make agents print a machine-greppable sentinel instead of parsing prose.

```bash
OUT=$(cmux read-screen --surface "$S" --scrollback --lines 200)
VERDICT=$(printf '%s\n' "$OUT" | grep -oE 'VERDICT=(GREEN|RED)' | tail -1 | cut -d= -f2)
# branch on $VERDICT; if empty, poll again
```

**Wait for a marker (the one honest poll):** loop `read-screen --lines 30` + `grep -qE "$MARKER"` once per second, bounded (e.g. 60–120 polls), else time out.

**Event-driven and dashboard:** read `references/events-and-dashboard.md` when many workers run long, or to show status and progress in the sidebar.

**Rendezvous (block until a worker signals) — the preferred completion mechanism, not read-screen polling:**

- orchestrator `wait_or_prompt <token> <surface>` (below) ⇄ worker `cmux wait-for -S <token>`.
- **Report contract:** For long-output tasks (reports, reviews), put three requirements in the task prompt: the worker (1) writes its full report to `$TMPDIR/pi-reports/<task>.md`, (2) prints a one-line sentinel as its last chat line, (3) runs `cmux wait-for -S <token>` when done. The orchestrator waits on the token, then reads the report file. When the task serves a spec or plan, the task prompt names that document, and the orchestrator copies the report to `docs/specs/<name>/reports/<task>.md` or `docs/plans/<name>/reports/<task>.md` (see **Artifact folder** in [../create-spec/SKILL.md](../create-spec/SKILL.md)). Workers never write into a document folder. Never parse a long report from screen scrollback: the TUI wraps lines at pane width and truncates scrollback (verified: a 400-line read-screen captured a wrapped, incomplete report). Bounded `read-screen` marker polling stays the fallback only when the worker cannot signal `wait-for`.
- **Never wait blind — watch for approval prompts.** A worker blocked on an approval prompt can never signal, so a bare `wait-for` hangs until its timeout (verified: a pi review sat on "Allow write outside current directory?" for its report file while the orchestrator waited). Wait in 15-second slices and read the worker's screen between slices:

```bash
wait_or_prompt() {   # $1 = token, $2 = worker surface; exit 0 = signalled, 2 = prompt, 1 = timed out
  for _ in $(seq 1 240); do
    cmux wait-for "$1" --timeout 15 && return 0          # exits 1 on timeout
    SCR=$(cmux read-screen --workspace "$WS" --surface "$2" --lines 40)
    if printf '%s\n' "$SCR" | grep -qE 'Allow .*\?|Do you want to proceed|Trust project folder|→ Yes'; then
      echo "PROMPT on $2"; printf '%s\n' "$SCR" | tail -15; return 2
    fi
  done
  return 1
}
```

Run it in the background. On exit 2, show the prompt to the user at once and let them decide. Do not answer a permission prompt for them unless they have said to. Standing exception: a grill worker's start prompt (see below). Keep the task file and the report file on different paths (`<task>.task.md` vs `<task>.md`) — verified: a shared path made workers overwrite their own task file with the report.

**TDD gate (every code task) — the orchestrator enforces Red, not the worker:** a rule in `.pi/SYSTEM.md` alone does not hold (verified: a worker with the TDD rule loaded wrote source before tests). Split each code task into two dispatches:

1. **Red dispatch:** the worker writes or changes tests only — no source edits — runs them, writes the exact test command and its failing output to `$TMPDIR/pi-reports/<task>.red.md`, prints `RED_READY`, and signals `cmux wait-for -S <task>-red`.
2. **Orchestrator check:** wait on `<task>-red`, then rerun the command from the red report yourself. Proceed only when it fails for the reason the task names (missing behavior, not a syntax or import error). Otherwise send the worker back to step 1.
3. **Green dispatch:** send "implement until `<command>` is green, then refactor; do not weaken the tests", with the normal report, rendezvous, and `$(ts)` suffix.

Check the order afterwards in the worker's transcript: its first `Edit`/`Write` of the slice must hit a test file. Report any violation to the user.

**Fan-in:** read every surface with `read-screen --scrollback`, compare/aggregate, then report. `cmux tree --all` is the ground truth of what is running.

## Grill Workers

Standing user approval, only for a worker running `$grill-me`: approve its start prompt at once (trust-folder or first-run `Allow …?`) with `cmux send-key --workspace "$WS" --surface <ref> enter`, no human step. Any later prompt, and any prompt on another worker, still goes to the user. When the grill report is read, close that worker's pane automatically; this is the only automatic close.

## Fail-Safe Teardown

Closing panes is user-approved, never automatic, except a grill worker's pane (see **Grill Workers**). A finished task is not a close signal — the user must be able to verify the outcome in the pane. Close a spawned pane, surface, or workspace only after the user approves it (e.g. says the research step is done, or part 1 of the plan is done). On an error path (failed boot, timeout, unresponsive agent), report and ask — do not close on your own.

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
| Code/feature work                                             | workers (`.cmux/cmux.json` roster when present, else split workers)                                                                    |
| Backend with a stream worth watching (dev server, long build) | workers + Logs pane (judgment: only if output is worth watching live)                                                                  |
| Frontend change                                               | workers; Browser pane **only on user request** (`new-pane --type browser --url`, then `browser reload` / `browser snapshot` to verify) |
| Research the user should watch                                | Research worker in a pane (fleet worker — live output by construction)                                                                 |
| Research for your own context                                 | in-process subagent; report the result in this conversation (conversation counts as visible)                                           |
| Mixed                                                         | minimal set that covers verification                                                                                                   |

**Dynamic workers:** to exceed the roster's 2, join the existing workspace: `cmux new-split --workspace "$WS" right --surface <ref>`. A split surface is a **bare shell** (layout `command` does not auto-run) — first send the worker boot command (see **Boot the Team**), wait for it to come up, then send the task. If a worker's model backend errors (e.g. 503 busy), report it and ask the user which model to respawn on — do not pick a fallback yourself.

**Creation recipes (additive only, never steal focus):**

```bash
cmux new-pane --workspace "$WS" --type terminal --direction right --focus false                      # generic helper
cmux new-pane --workspace "$WS" --type terminal --direction right --command "touch <logfile> && tail -F <logfile>"   # Logs pane (-F retries; pre-create the file)
cmux new-pane --workspace "$WS" --type browser --url <url> --focus false                            # Browser pane
```

Reuse the existing right-hand helper pane (add a surface) before creating more panes. Surface-affecting verbs (`close-surface`, `new-split`) resolve refs against the **focused** workspace — always pass `--workspace "$WS"` explicitly (without it, valid refs fail with "Surface not found" when the user is focused elsewhere). Browser snapshots: `cmux browser snapshot --surface <ref>`.

**Ephemeral lifecycle:** every helper pane is opened with a purpose and closes per **Fail-Safe Teardown**: the Logs, Browser, or Research pane stays until the user has seen its result. After an approved cleanup, `cmux tree --all` must show only panes the user wants to keep.

**Transparency default:** every delegated unit of work is either a visible pane or is reported in this conversation.

## Gotchas

- **Refs are captured, not guessed.** Create first, then read refs from `tree --all --json` (complete) or `identify --json` (caller). `list-pane-surfaces --workspace` covers a single pane only.
- **Workers must not resume the orchestrator's session.** A worker whose command boots pi in the same project cwd continues the most recent session — i.e. the live orchestrator conversation (verified: cross-talk + concurrent writes). Boot them with the command in **Boot the Team**.
- **`CMUX_QUIET=1`** silences legacy-alias notices for clean scripting. Prefer modern verb forms anyway: `workspace create`/`workspace list`/`workspace close` over the legacy `new-workspace`/`list-workspaces`/`close-workspace` aliases.
- **Never overwrite a working agent login** with `--env-file` placeholder keys; scope credential injection to agents that actually need it.
- **Socket access:** default `socketControlMode` is `cmuxOnly` — this skill's verbs work when pi runs _inside_ a cmux pane. If `cmux ping` fails, check `cmux capabilities --json`; do not raise socket mode without explicit user approval.
- **`reload-config` reloads global AND Ghostty config** and refreshes terminals live — no app restart.
- **Focus verbs are user-affecting** (`select-workspace`, `focus-pane`, `focus-panel`): call only on explicit user request; pass `--focus false` on creation/move verbs that support it.
- Layout `split` ratios are 0.1–0.9, exactly two `children` per split node; `pane` nodes hold `surfaces` with auto-run `command`.
- Synonym for pane is tab.
