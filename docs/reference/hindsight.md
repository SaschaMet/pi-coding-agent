# Hindsight memory for pi

Hindsight is a memory server. It stores facts from pi sessions and git history and hands the relevant ones back in later sessions. It runs in Docker on this machine, so memory is stored and processed only on hardware we own.

- A **bank** is one isolated memory store in the server.
- Each opted-in repository gets its own bank, written by the official package `@vectorize-io/hindsight-coding-agents`.
- One extra bank, `personal`, holds facts about you that hold in every repository. Our own extension writes it.

The agent-facing procedure is the `hindsight-memory` skill. This page holds the detail.

## Parts

| Part | Where | Does |
| --- | --- | --- |
| Server | `hindsight-compose.yml`, `scripts/hindsight-up.sh` | Container `hindsight`, API on `127.0.0.1:8888`, web UI on `127.0.0.1:9999`, data in volume `hindsight-data`. Every request needs the API token. |
| Config | `~/.hindsight/coding-agent.json` (mode 600) | Server URL, API token, opt-in mode. Reference copy without the token: `docs/reference/hindsight/coding-agent.json`. |
| Runtime | `~/.hindsight/coding-agents/` | The official pi extension, installed by `npx @vectorize-io/hindsight-coding-agents@0.8.8 install pi`. |
| Wrapper | `.pi/extensions/hindsight-repo.ts` | Reads `piSettings.json`, sets the bank id, loads the runtime, limits it to trusted interactive sessions. |
| Personal bank | `.pi/extensions/hindsight-personal.ts` | Tool `personal_remember` and the `user_profile` prompt section. |
| Opt-in file | `piSettings.json` at a repo's top folder | `{ "useMemory": true }` turns repo memory on for that repo. |
| Runtime skill | `.pi/skills/hindsight-coding-agent/` | Written by the installer and tracked here. See "Tracked third-party skill". |

## Setup on a new machine

Write the config before the install; without it, the installer may pick the vendor cloud.

1. **Secrets.**
   - LLM key: the iqRouter key already in `~/.pi/agent/models.json` (provider `iqRouter`, a literal `apiKey`, a `baseUrl` ending in `/v1`). The server uses it to turn text into facts with model `grunt`.
   - API token: generated once with `openssl rand -hex 32`. It lives only in `~/.hindsight/coding-agent.json`.
   - The start script reads both and exports them for compose. It never writes or prints them.
2. **Config.** Write `~/.hindsight/coding-agent.json` from the reference copy with the real token, then `chmod 600` it. It must not set `optInPaths`, `mapPathToBank`, `bankId`, `bankIdTemplate` or `dynamicBankId`: a value in the file overrides the wrapper. Keep `"autoInject": "recall"` and `recallOptions.types` `["world", "experience", "observation"]` from the reference copy: the first prompt then gets stored facts directly instead of waiting for an LLM summary (see "Known limits").
3. **Server.** Run `npm run hindsight:up` and wait for `curl -fsS -m 5 http://127.0.0.1:8888/health` to succeed. `npm run dev` and `npm run agent` also start it, without waiting.
4. **Runtime.**
   - Run `npx @vectorize-io/hindsight-coding-agents@0.8.8 install pi --server self-hosted --api-url http://127.0.0.1:8888`.
   - Remove the entry it adds to `~/.pi/agent/settings.json`, so the wrapper stays the only loader: `jq '.extensions |= map(select(contains("coding-agents") | not))' ~/.pi/agent/settings.json > ~/.pi/agent/settings.json.tmp && mv ~/.pi/agent/settings.json.tmp ~/.pi/agent/settings.json`.
   - Never restore `settings.json.hindsight-backup`. The installer keeps only its first backup, so restoring it rewinds unrelated settings.
5. **Skill copy.** Run `cp -R ~/.pi/agent/skills/hindsight-coding-agent .pi/skills/` before any `npm run pi:sync-global`. A push without the copy deletes the global skill.
6. **Personal profile.** Create the mental model once (see "Personal bank").

Docker, the installer and the sync are human steps. Sandboxed bash reaches neither Docker nor `127.0.0.1`.

## Opting a repository in or out

- **In:** put `piSettings.json` with `{ "useMemory": true }` at the repo's top folder (the folder that holds `.git`).
- **Out:** set `"useMemory": false` or delete the file. Every other state is off: a missing file, invalid JSON, the string `"true"`, a symlink, a file over 4 KB, a path with a comma, or no git repo.
- **A cloned repo can carry the file** and so switch memory on for itself. That repo's text then goes to its own bank on this machine. Check `piSettings.json` in repos you clone.
- **Memory is decided when pi starts.** Start pi inside the repo. A pi started elsewhere has no repo memory for its whole run.
- **Linked worktrees** read their own top folder's `piSettings.json` and share the main checkout's bank.
- **Bank name:** `coding-agent::<main checkout folder>-<first 8 hex of the SHA-256 of its absolute path>`. Two repos with the same folder name never share a bank.
- **A moved repo starts a new, empty bank.** Delete the old one in the web UI.

## Which sessions get memory

| Session | Repo memory | Personal profile and `personal_remember` |
| --- | --- | --- |
| Interactive pi in a trusted project, including cmux pane workers | Yes | Yes |
| In-process subagents, `pi -p` print runs | No | No |
| A project you refused to trust | No per-turn memory and no tools. The runtime's start-up call still runs: it may seed commit messages into the bank and shows its banner | No |
| `--private` sessions (PII redaction) | Yes; the official package stores the transcript unredacted | No |

The wrapper sets `HINDSIGHT_OPT_IN_ONLY`, `HINDSIGHT_OPT_IN_PATHS` and `HINDSIGHT_BANK_ID`. When they are unset it also sets `HINDSIGHT_API_URL` and `HINDSIGHT_SERVER_MODE`. Programs pi starts, such as the bash tool, inherit these variables.

## Personal bank

- The personal extension runs only in interactive, trusted sessions that are not private. A host without a trust check counts as untrusted.
- `personal_remember` stores one fact in bank `personal` after you confirm the exact text in a dialog. The agent should call it only for a lasting preference or when you ask, never for secrets, client data, or project facts.
- The profile is the mental model `user-profile`: an answer the server rewrites as the bank learns. The extension reads it once per session and adds it as the prompt section `user_profile`, labeled "Untrusted memory". The fetch gives up after 2 s; a down server means no section.
- Create the model once, with the token in `$TOKEN`:

  ```sh
  curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -X POST http://127.0.0.1:8888/v1/default/banks/personal/mental-models \
    -d '{"id":"user-profile","name":"User profile","source_query":"How does this person like to work, which tools do they use, and what do they forbid?","trigger":{"refresh_after_consolidation":true,"min_refresh_interval_seconds":3600}}'
  ```

- It refreshes after consolidation, at most once an hour. A failed refresh pauses automatic ones. **Stale-profile check:** `GET /v1/default/banks/personal/stats` lists them under `paused_mental_models`. Refresh by hand with `curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8888/v1/default/banks/personal/mental-models/user-profile/refresh`.

## Checking status

- Server: `curl -fsS -m 5 http://127.0.0.1:8888/health`, `docker ps --filter name=hindsight`, `docker logs -f hindsight`.
- Start and stop only with `npm run hindsight:up` and `npm run hindsight:down`, never a bare `docker compose -f hindsight-compose.yml …`: compose refuses to read the file without the three secret variables, which only the npm scripts supply.
- Auth: `/v1/default/banks` answers 401 without the token and 200 with it.
- In pi: `hindsight_diagnose` reports the resolved bank, config location, API endpoint and non-secret overrides. `hindsight_sync_status` reports whether the repo's bank is seeded and which extractions are still running.
- Web UI: `http://127.0.0.1:9999` lists banks and memories.

## Switching memory off

- **Kill switch:** set `"disabled": true` in `~/.hindsight/coding-agent.json` and restart pi. Repo memory is then off everywhere. The personal extension still runs.
- **One repo:** `"useMemory": false` in its `piSettings.json`, then restart pi.
- **Server off:** `npm run hindsight:down`. pi keeps working without memory.

## Deleting memory

- One memory: in the web UI.
- One bank: in the web UI, or `curl -X DELETE -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:8888/v1/default/banks/<bank id>'`. Write `::` in a bank id as `%3A%3A`.
- Everything: delete the `hindsight-data` volume. Nothing expires on its own, and nothing backs the volume up.

## Housekeeping

The server has no retention or expiry setting; only deletes remove data. No pruning schedule is needed, but check a few times a year and after moving or deleting a repo.

- **What grows:** one bank per opted-in repo plus `personal`. Each bank holds session transcripts (`retainSessions: true`), the facts extracted from them, commit messages and survey findings.
- **Expected size:** a transcript is roughly 0.1–1 MB of text, so about 1,000 sessions make about 1 GB. This is an estimate, not a measurement. Junk hurts recall quality long before it hurts disk space.
- **What already limits junk:**
  - Consolidation merges overlapping facts into observations.
  - Storing a document under an existing `document_id` replaces the old version.
  - A `Correction: <topic>` document outranks the stale fact in recall.
  - One wrong fact can be retired without deleting it: `PATCH /v1/default/banks/<bank id>/memories/<memory id>` with `{"state":"invalidated"}`. It leaves recall, stays in the bank, and can be restored.

| Junk | Cause | Fix |
| --- | --- | --- |
| Orphan bank | Repo moved or deleted | Delete the bank (see "Deleting memory") |
| Throwaway bank | A short-lived repo was opted in | Don't opt in short-lived repos; delete the bank when done |
| Noisy transcripts | Every session is stored | `"retainSessions": false` in `~/.hindsight/coding-agent.json` |
| Leftover files from failed stores | Failed retains leave attachments behind | `hindsight-admin repair-bank --all --attachments --dry-run`, then again without `--dry-run` |

Routine, about 5 minutes:

1. **Size:** `docker system df -v | grep hindsight-data`. Hundreds of MB to a few GB is normal. Act only if it keeps climbing.
2. **Banks:** open the web UI, or run `curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8888/v1/default/banks`. Bank names are `<folder>-<hash>`; delete each bank whose repo no longer exists at its old path.
3. **Export before you delete** anything you might want back: `curl --fail-with-body -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8888/v1/default/banks/<bank id>/transfer/export`. It runs in the background and returns an operation id.

These are human steps: sandboxed bash reaches neither Docker nor `127.0.0.1`.

## Load knobs

Extraction and profile refreshes call `grunt` on iqRouter, the same link pi already uses for prompts. If interactive use stalls, lower the load in `~/.hindsight/coding-agent.json` and restart pi:

| Key | Default | Lower load |
| --- | --- | --- |
| `gitIngest` | `"message"` (commit messages seed a new bank) | `"none"` |
| `seedLimit` | `300` commits | a smaller number |
| `retainExtractionMode` | `"concise"` | keep `"concise"` |
| `autoInject` | runtime default `"reflect"` (an LLM summary on the first prompt, up to 20 s); this setup uses `"recall"` (stored facts, no LLM call) | `"recall"`, `"pages"` or `"none"` |
| `recallOptions.types` | runtime default `["observation"]`; this setup uses `["world", "experience", "observation"]` | fewer types |
| `reflectTimeoutMs` | `20000` (the `reflect` lookup gives up after this; unused with `"recall"`) | a smaller number |
| `retainSessions` | `true` (each session's transcript is stored) | `false` |
| mental model `min_refresh_interval_seconds` | `3600` | larger |

## Upgrades

- **Server:** check the newest release, change the `image:` tag in `hindsight-compose.yml` (never `:latest`), then `npm run hindsight:down && npm run hindsight:up`. Re-run the health and auth checks. The image tag is `1.2.3` for GitHub release `v1.2.3`.
- **Runtime:**
  1. Install the new pinned version with the `install pi` command above.
  2. Remove the settings entry with the `jq` command.
  3. Copy the skill with the `cp -R` command.
  4. Commit.
  5. Run `npm run pi:sync-global` once.
- The runtime rewrites its global skill on every load, so the tracked copy must match the installed version.

## Rollback

- Fast: the kill switch.
- Full, in this order:
  1. `npx @vectorize-io/hindsight-coding-agents@0.8.8 uninstall pi`.
  2. `git revert` the commits.
  3. `npm run pi:sync-global`. A push before the revert re-adds the files.
  4. `npm run hindsight:down`.
  5. Remove `~/.hindsight/` and `~/.pi/agent/settings.json.hindsight-backup`.
  6. `docker image rm ghcr.io/vectorize-io/hindsight:1.2.3`.
- Deleting the `hindsight-data` volume erases all memory. Do it only on purpose.

## Known effects

- **Smoke loads the runtime.** `npm run smoke` runs every extension in this repo, and this repo opts in. After the install, smoke loads the official runtime. Its start-up call seeds this repo's bank, the same call a pi start here makes. `"disabled": true` switches it off.
- **Smoke before the first push:** smoke fails with "Extension copy drift" for `hindsight-repo.ts` and `hindsight-personal.ts` until `npm run pi:sync-global` creates their global copies.
- **First prompt:** with `"autoInject": "recall"` the lookup took about 2 s on 2026-11-23. With the runtime default `"reflect"` it can add up to 20 s.
- **Recalled memory reaches the session's model**, which may be a cloud model. That model already sees the session text.
- **Model downloads on re-create:** a re-created container fetches its local models again. On 2026-11-23 the logs showed `Fetching 12 files` and `Fetching 10 files`, each done in under 2 seconds.

## Known limits found on 2026-11-23

- **The first-prompt `reflect` timed out under `grunt` load; `recall` avoids it.** With the default `"autoInject": "reflect"` the runtime gave up at 20 s five times and fell back to the page list, which was still empty. The user switched to `"autoInject": "recall"` with `recallOptions.types` `["world", "experience", "observation"]`. A fresh session then answered the test codename from the injected memory with no tool call, in a 2 s turn. The cost: recall injects raw stored facts with no summary. The model sees more, less ordered text, and no LLM sorts out duplicates or contradictions. `hindsight_reflect` still gives a summary on demand.
- **The git seed is pending.** `hindsight_sync_status` reported `synced: false` and `gitlogPresent: false`. The server log showed LLM connection timeouts and one fact-extraction task scheduled for retry. Knobs: `seedLimit` and `gitIngest`.
- **The installer's config backup holds the token.** `install pi` also writes `~/.hindsight/coding-agent.json.hindsight-backup`. Keep it at mode 600 or delete it; rollback removes it with `~/.hindsight/`.
- **The confirm dialog defaults to Yes.** `personal_remember`'s "Remember about you?" dialog waits for input, but a stray Enter stores the fact. Read it before you press Enter; delete a wrong fact in the web UI.

## Tracked third-party skill

Root `AGENTS.md` sends third-party skills to `.pi/skill-library/`. The installer's `hindsight-coding-agent` skill is tracked in `.pi/skills/` instead: the runtime syncs it into the global skills folder on every load. A copy in the library would leave the global copy untracked, so the next push would delete it.

## Follow-ups

- Claude Code is not wired (`install claude-code`).
- A second Hindsight server exists. It can join later through a `paths.<prefix>.apiUrl` entry in `~/.hindsight/coding-agent.json`. Matching its bank names needs a rename or a `mapPathToBank` entry.
