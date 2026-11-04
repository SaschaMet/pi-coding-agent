# cmux sidebar: settings and pi pills

Settings for `~/.config/cmux/cmux.json` that make each workspace row in the cmux sidebar show only the agent state and the tab names. Written for cmux 0.65.2.

## Sidebar block

Merge these keys into the `sidebar` object of `~/.config/cmux/cmux.json`:

```json
{
  "sidebar": {
    "showNotificationMessage": false,
    "showBranchDirectory": false,
    "pathLastSegmentOnly": true
  }
}
```

What each key does (schema descriptions, quoted verbatim):

| Key | Value | Schema description | Why |
| --- | --- | --- | --- |
| `showNotificationMessage` | `false` | "Show the latest notification text in the sidebar." | Hides the message preview under the workspace title. |
| `showBranchDirectory` | `false` | "Show the workspace working directory." | Hides the path. cmux has no key that hides only the path, so the git branch goes too. |
| `pathLastSegmentOnly` | `true` | "Truncate sidebar paths from the start, showing as much of the trailing path as fits with a leading …/. When false, full paths are abbreviated with ~/." | Shortens the path where cmux still shows one. |

`pathLastSegmentOnly` does not show strictly the last segment. It keeps as much of the end of the path as fits, after a leading `…/`. With the branch + directory line on, the sidebar still showed full `/Users/…` paths, so the line is off.

## Settings left alone

- `showAgentActivity` stays at its default. Its description reads: "Show the loading spinner on workspaces with running coding agents or active loaders." It controls the spinner only. It does **not** remove the built-in pi pill (see below).
- `compactAgentStatus` is rejected. Its description says one icon "replaces the agent status rows (for example Running or Needs input), the branch and directory line, and the pull request rows". That would also replace the state rows.
- `hideAllDetails` is rejected: "Hide all per-workspace detail rows." also hides the pills.

## Pills this repo's extension sets

The pi extension `cmux-status` runs `cmux set-status` only inside a live cmux terminal (surface id set and cmux socket file present), and only in the interactive session.

| Key | Text | Icon | Color | When |
| --- | --- | --- | --- | --- |
| `pi-<surface id>` | `idle` | `moon.zzz` | `#8e8e93` | Session start, agent end |
| `pi-<surface id>` | `working` | `sparkle` | `#ff9500` | Agent start, after a UI prompt closes during a run |
| `pi-<surface id>` | `needs input` | `bell.fill` | `#ff3b30` | A UI prompt opens during a run (also flashes the pane and sends a notification) |
| `pi-tabs` (per workspace) | tab titles joined with ` · ` | `rectangle.stack` | — | Session start and after `set_pane_title` when the text changed; every agent end, even unchanged |

On session shutdown the extension runs `cmux clear-status pi-<surface id>` and `cmux clear-status pi-tabs --workspace <id>`. Another pi session in the same workspace restores `pi-tabs` on its next agent end.

A pi that is killed skips that shutdown and leaves its `pi-<surface id>` pill behind. On session start the extension lists the workspace's pills (`cmux list-status`) and its live tabs (`cmux --id-format uuids tree --json`), then clears each `pi-<surface id>` pill whose tab is gone. It clears nothing unless the tree lists its own tab, so a failed tree call never removes live pills.

cmux workers started by the `cmux-orchestration` skill run with `CMUX_PI_HOOKS_DISABLED=1`. That turns off cmux's own pi hook (the `pi=Running` pill below) for them: the hook treats a final message ending in `?` as "needs input", so a worker asking its orchestrator a question flagged the shared workspace. Their `cmux-status` pill still works.

## Tab and workspace names

pi sets the terminal title to `π - <session name> - <folder>`, and cmux shows it as the tab name. The `pi-spark` package writes a 3–8 word session name, so the title gets long. `cmux-status` renames the tab with `cmux rename-tab` whenever the session name changes. The name is cut to at most 4 words and stops before the first filler word (`for`, `in`, `to`, `and`, …): "Investigate manual read approval for subagent orchestrator" becomes "Investigate manual read approval". The workspace gets the same name when the pane is alone in it. A cmux rename overrides later terminal-title writes (checked on cmux 0.65.2: an OSC title write did not replace a `rename-tab` title). Once the agent calls `set_pane_title`, the auto name stops until the next `/new`, `/resume`, or `/fork`; `/reload` keeps the current tab name. After `/new` the tab keeps the previous name until pi-spark names the new session.

## The duplicate built-in pill

`cmux sidebar-state` shows a second pill next to ours:

```text
pi=Running icon=bolt.fill color=#4C8DFF
pi-F6AF4990-CF14-4C1F-8B33-BDE0E6DE94F4=running icon=sparkle color=#ff9500
```

The `pi` key belongs to cmux's own pi integration, not to this repo. `cmux hooks --help`: "Pi hooks are injected automatically by their cmux wrappers"; the generated file is `~/.pi/agent/extensions/cmux-session.ts`. No sidebar setting hides it. Removing it with `cmux hooks pi uninstall` is the operator's call. Unverified: the cmux wrapper may inject the hook again on the next launch.

## How to apply

1. Back up the config: `cp ~/.config/cmux/cmux.json ~/.config/cmux/cmux.json.$(date +%Y%m%d-%H%M%S).bak`
2. Merge the three keys from the block above into the existing `sidebar` object. Keep every other key.
3. Reload: `cmux reload-config`
4. Check: the workspace row shows no message preview and no branch or path line.

Rollback: copy the `.bak` file back and run `cmux reload-config`.

## Sources

- cmux version: `cmux 0.65.2 (113) [12023d89f]`.
- Config schema, section `sidebar`: <https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux.schema.json>
- `cmux hooks --help` (pi hook injection).
- `cmux sidebar-state` (status entries of the current workspace).
