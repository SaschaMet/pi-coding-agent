# Sync Pi Config

Syncs the `.pi` directory between the project-local copy and the global `~/.pi/agent/` directory.

## Usage

```bash
npx tsx scripts/sync-pi-config.ts pull   # Global → Local
npx tsx scripts/sync-pi-config.ts push   # Local → Global
```

## What Gets Synced

All files under `.pi/` except:

| Path | Reason |
|------|--------|
| `auth.json` | Credentials |
| `sessions/` | Ephemeral state |
| `npm/` | Cached packages |
| `models.json` | Local model overrides |

## Extension Directory Pruning

When syncing, extension directories under `extensions/` that exist in both global and local are pruned from the local copy — **but only if the global extension is marked as managed**.

### Managed Extension Marker

A global extension is considered "managed" (and therefore eligible for pruning) only if it contains a `.pi-managed` marker file:

```
~/.pi/agent/extensions/plan-mode/.pi-managed  ← managed, local copy gets pruned
~/.pi/agent/extensions/lib/                   ← no marker, local copy is preserved
```

### Why Marker-Based?

The marker approach replaces a hardcoded exclusion list. It:

- **Auto-works** for new directories — no config change needed
- **Self-documents** — the marker signals intent
- **Is reversible** — remove the marker to stop pruning
- **Fails safe** — unmarked directories are never deleted

### Creating a Managed Extension

To make a new extension directory managed:

```bash
touch ~/.pi/agent/extensions/<name>/.pi-managed
```

### Protecting a Local Extension

To prevent a local extension from being pruned, ensure the global copy does **not** have a `.pi-managed` file. Internal helper directories like `lib/` should never have this marker.
