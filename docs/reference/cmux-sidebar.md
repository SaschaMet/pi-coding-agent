# cmux sidebar: settings and pi pills

Settings for `~/.config/cmux/cmux.json` that make each workspace row in the cmux sidebar show only the agent state, the tab names, and the git branch. Written for cmux 0.65.2.

## Sidebar block

Merge these keys into the `sidebar` object of `~/.config/cmux/cmux.json`:

```json
{
  "sidebar": {
    "showNotificationMessage": false,
    "showBranchDirectory": true,
    "pathLastSegmentOnly": true
  }
}
```

What each key does (schema descriptions, quoted verbatim):

| Key | Value | Schema description | Why |
| --- | --- | --- | --- |
| `showNotificationMessage` | `false` | "Show the latest notification text in the sidebar." | Hides the message preview under the workspace title. |
| `showBranchDirectory` | `true` | "Show the workspace working directory." | Keeps the branch and directory line (this is the default). |
| `pathLastSegmentOnly` | `true` | "Truncate sidebar paths from the start, showing as much of the trailing path as fits with a leading …/. When false, full paths are abbreviated with ~/." | Shortens the path. |

`pathLastSegmentOnly` is the closest setting cmux offers, but it does not show strictly the last segment. It keeps as much of the end of the path as fits, after a leading `…/`.

## Settings left alone

- `showAgentActivity` stays at its default. Its description reads: "Show the loading spinner on workspaces with running coding agents or active loaders." It controls the spinner only. It does **not** remove the built-in pi pill (see below).
- `compactAgentStatus` is rejected. Its description says one icon "replaces the agent status rows (for example Running or Needs input), the branch and directory line, and the pull request rows". That would drop the branch line, which this setup keeps.
- `hideAllDetails` is rejected: "Hide all per-workspace detail rows." also hides the branch.

## Pills this repo's extension sets

The pi extension `cmux-status` runs `cmux set-status` only inside a live cmux terminal (surface id set and cmux socket file present), and only in the interactive session.

| Key | Text | Icon | Color | When |
| --- | --- | --- | --- | --- |
| `pi-<surface id>` | `idle` | `moon.zzz` | `#8e8e93` | Session start, agent end |
| `pi-<surface id>` | `working` | `sparkle` | `#ff9500` | Agent start, after a UI prompt closes during a run |
| `pi-<surface id>` | `needs input` | `bell.fill` | `#ff3b30` | A UI prompt opens during a run (also flashes the pane and sends a notification) |
| `pi-tabs` (per workspace) | tab titles joined with ` · ` | `rectangle.stack` | — | Session start and after `set_pane_title` when the text changed; every agent end, even unchanged |

On session shutdown the extension runs `cmux clear-status pi-<surface id>` and `cmux clear-status pi-tabs --workspace <id>`. Another pi session in the same workspace restores `pi-tabs` on its next agent end.

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
4. Check: the workspace row shows no message preview, still shows the branch line, and the path starts with `…/` when it is long.

Rollback: copy the `.bak` file back and run `cmux reload-config`.

## Sources

- cmux version: `cmux 0.65.2 (113) [12023d89f]`.
- Config schema, section `sidebar`: <https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux.schema.json>
- `cmux hooks --help` (pi hook injection).
- `cmux sidebar-state` (status entries of the current workspace).
