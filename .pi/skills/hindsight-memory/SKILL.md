---
name: hindsight-memory
description: Sets up, uses, checks, switches off, and debugs pi's Hindsight memory (the local memory server, per-repo banks opted in with piSettings.json, and the personal bank with personal_remember). Use when the user asks to set up or upgrade memory, opt a repo in or out, remember something about them, check why memory is missing, or delete memories. Not for editing the Hindsight extensions' code, for Claude Code memory, or for the agent's own notes in docs/.
---

# Hindsight memory

Hindsight stores facts from pi sessions on a local server and returns them in later sessions. Detail, commands, and rationale live in `docs/reference/hindsight.md`; read the matching section before acting.

- **Repo bank:** one per opted-in repository, filled by the official runtime through `.pi/extensions/hindsight-repo.ts`.
- **Personal bank:** bank `personal`, written only by `personal_remember` after the user confirms. Its profile reaches every interactive, trusted, non-private session as the prompt section `user_profile`.

On bank routing (bank names, which repos get memory), this skill wins over the vendor skill `hindsight-coding-agent`: the wrapper owns the bank id and the opt-in.

Sandboxed bash cannot run Docker or reach `127.0.0.1`. Every `docker`, `curl`, `npx … install`, and sync command below is a human step: hand it over with the `wizard` skill, name the expected output, and record what the user pastes. Never print, ask for, or write the API token or the iqRouter key; commands read them from their files.

## Setup order

| # | Step | Who |
| --- | --- | --- |
| 1 | Write `~/.hindsight/coding-agent.json` from `docs/reference/hindsight/coding-agent.json`, with a token from `openssl rand -hex 32`, mode 600 | Human |
| 2 | `npm run hindsight:up`, then the health and token checks | Human |
| 3 | `npx @vectorize-io/hindsight-coding-agents@0.8.8 install pi --server self-hosted --api-url http://127.0.0.1:8888`, then remove its settings entry with the `jq` command from the reference doc | Human |
| 4 | `cp -R ~/.pi/agent/skills/hindsight-coding-agent .pi/skills/`, before any sync | Human |
| 5 | Create the `user-profile` mental model with `curl` | Human |
| 6 | Commit, then `npm run pi:sync-global` once | Agent commits on request; human syncs |

The config must exist before step 3, or the installer may pick the vendor cloud. The upgrade path repeats steps 3, 4 and 6 with the new pinned version.

## Opt a repo in or out

- In: `piSettings.json` at the repo's top folder with `{ "useMemory": true }`. Only the boolean `true` counts.
- Out: `"useMemory": false`, or delete the file.
- Either way, the user restarts pi inside the repo: the opt-in is read once at launch.
- Before opting a cloned repo in, tell the user that the file, once committed, opts in everyone who clones it.

## Personal bank

- Call `personal_remember` only when the user states a lasting preference or asks you to remember something about them.
- Never store secrets, client data, or project facts. Store each fact as one self-contained sentence.
- If the user declines the dialog, the tool stores nothing. Do not retry.

## Which sessions get memory

Repo memory and the personal bank reach interactive, trusted sessions only, cmux pane workers included. In-process subagents and `pi -p` runs get neither. A project the user refused to trust gets no per-turn repo memory, no personal profile, and no `personal_remember`. A `--private` session gets no personal profile and no `personal_remember`.

## Check status

1. In pi: `hindsight_diagnose` gives the bank, config location and API endpoint. `hindsight_sync_status` shows whether the bank is seeded.
2. Human: `curl -fsS -m 5 http://127.0.0.1:8888/health` exits 0. Logs: `docker logs -f hindsight`. Start and stop only with `npm run hindsight:up` / `hindsight:down`; a bare `docker compose -f hindsight-compose.yml …` fails without the secret variables.
3. Human: the web UI at `http://127.0.0.1:9999` lists banks and memories.

## Switch off

- All repo memory: `"disabled": true` in `~/.hindsight/coding-agent.json`, then restart pi.
- One repo: `"useMemory": false`.
- Server: `npm run hindsight:down`. pi keeps working without memory.

## Delete memory

The user deletes a single memory or a whole bank in the web UI, or with the `curl … -X DELETE` command in the reference doc. Never delete a bank or the `hindsight-data` volume yourself; offer the command and let the user run it.

## Troubleshooting

| Symptom | Cause | Do this |
| --- | --- | --- |
| No memory, no `hindsight_*` tools | Server down, repo not opted in, pi started outside the repo, or a non-interactive session | Check `piSettings.json`, have the user restart pi in the repo, run the status checks |
| Memory gone after moving or renaming the repo folder | The bank name includes a hash of the folder path, so the moved repo has a new, empty bank | Expected. Offer deletion of the old bank in the web UI |
| `hindsight_diagnose` names `api.hindsight.vectorize.io` | Config missing or wrong, or a stray environment variable | Stop. Have the user fix `apiUrl` in the config, then restart pi |
| `Failed to connect to 127.0.0.1` from bash | The sandbox blocks local ports | Hand the command to the human (`sandboxed-bash` skill) |
| Profile never changes | Automatic refresh paused after a failure | Human: `paused_mental_models` on `GET /v1/default/banks/personal/stats`, then `POST /v1/default/banks/personal/mental-models/user-profile/refresh` with the token |
| Interactive `grunt` use stalls | Background extraction load on iqRouter | Lower the load knobs listed in the reference doc |
