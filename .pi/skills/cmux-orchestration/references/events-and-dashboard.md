# Events and Dashboard

Read when many workers run long (push events instead of polling) or to show status in the cmux sidebar.

**Event-driven (push, not poll):**

```bash
cmux events --name agent.hook --name notification.created --reconnect \
  --cursor-file "$TMPDIR/cmux-fleet.seq" | while read -r evt; do
    SURF=$(printf '%s' "$evt" | jq -r '.surface_id // empty')
    cmux read-screen --surface "$SURF" --scrollback --lines 40    # event = doorbell, read the details
  done
```

Event payloads redact titles/bodies (privacy doorbell: ids + lengths only). Other event names: `surface.created`, `surface.closed`, `workspace.created`.

**Dashboard:** `cmux set-status build "running" --workspace "$WS" --color "#ff9500"` · `cmux set-progress 0.4 --label "Building"` · `cmux log --workspace "$WS" --level info -- "msg"` · `cmux top --format tsv` (per-surface CPU/mem) · `cmux notify --title .. --body ..` for desktop alerts.
