# PII redaction

Reversible PII redaction for PI model requests, backed by a local Presidio analyzer (English + German).

- Package: `.pi/local-packages/pii-redaction.ts` (PI wiring, analyzer client, key file)
- Pure logic: `.pi/extensions/lib/pii-redaction.ts` (tags, span merging, restore, message walks)
- Analyzer: `presidio-compose.yml`, `presidio/Dockerfile`, `presidio/analyzer-conf.yml`
- Tests: `test/pii-redaction.test.ts`

## Turning it on

- **Off by default.** A plain `pi` sends text raw and makes no analyzer calls. This is a deliberate exception to Fail-Safe Defaults, chosen because the analyzer caused errors in everyday sessions.
- On: `pi --private`, or `npm run agent:private` (starts headroom and Presidio, then runs `src/main.ts --private`).
- `src/main.ts` forwards only `--private`. Other extension flags are not forwarded by `npm run agent`.
- The choice is made once per process, by the first loaded copy. Later session starts (subagents, `/new`, `/resume`, `/reload`) never switch it off.
- Sticky: a session that ran with redaction on gets a hidden `pii-private` entry. Reopening it, even without the flag, switches redaction on. The entry only ever switches on.
- Put `--private` last, or give no prompt: `pi --private "fix the bug"` takes the prompt as the flag's value. `--private=false` still turns it on.
- cmux workers are separate `pi` processes and start raw. Add `--private` to their boot command by hand.
- This replaces the earlier rule that a new session turns redaction back on.

## What it does

| PI event | Behavior |
|---|---|
| `context` (every model request) | Replaces PII in prompts, tool results, `bashExecution`, summaries, assistant text, and tool-call arguments with tags |
| `session_before_compact`, `session_before_tree` | Same for the compaction and branch-summary calls, which skip `context`. Analyzer down → the summary is cancelled |
| `tool_call` | Swaps tags back to real values, only for `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`. An unknown tag blocks the call |
| `message_end` | Swaps tags back in assistant text, so you read real values |

- Tag format: `<pii:TYPE:…>`, where `…` is 12 hex characters of an HMAC-SHA256 of the value. The same value always gets the same tag, also across sessions and restarts.
- Entities: `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IBAN_CODE`, `CREDIT_CARD`, `PERSON`. Score threshold 0.4 (phone hits score 0.4 without an English context word).
- Both languages run on every text; overlapping hits are joined, so no flagged character stays raw.
- A value tagged once stays tagged for the life of the PI process, even when the analyzer misses it later.
- Other tools (MCP, web search, `AskClaude`, `Agent`) only ever see tags.
- Raw values stay local: in the PI session file and in memory. Nothing is logged.

## Order and providers

- It is a `packages` entry (`./local-packages/pii-redaction.ts`) placed before `npm:@raquezha/noheadroom@latest` in `.pi/settings.json`. Packages load before `.pi/extensions/`, so Headroom and its message log only see tags.
- It works for every provider, including `claude-bridge`: the bridge builds Claude Code's prompt from the redacted messages.
- In this repo both the project and the global copy load. They share one state, so tags restore across both. The command shows up as `/pii:1` and `/pii:2`; either switches both.

## Commands

- `/pii status` — on/off, analyzer state, number of known tags
- `/pii off` — send raw text until you quit PI or reopen a private session (explicit opt-out)
- `/pii on` — switch on and mark the session private

## Running the analyzer

- Starts with `npm run agent:private` (`scripts/presidio-up.sh`, never blocks), and after Docker restarts (`restart: unless-stopped`). `npm run agent` and `npm run dev` do not start it.
- Manual: `npm run presidio:up`, `npm run presidio:down`.
- Listens on `127.0.0.1:5002` only.

## Failure behavior (fail closed)

| Failure | Result |
|---|---|
| Analyzer unreachable or times out (15 s) | Uncached text becomes `[pii-redaction: withheld, analyzer unavailable]`; one warning; the analyzer is skipped for 30 s |
| Analyzer rejects one text | Only that text is withheld |
| Key file unreadable or not 32 bytes | Everything uncached is withheld |
| Tag collision or any internal error | Withheld, never passed through |
| Tool call with an unknown tag | Blocked; the model is told to ask you for the value |

- Key file: `~/.local/state/pi-pii-redaction/hmac.key` (dir `0700`, file `0600`). Deleting it changes all tags; start a new session after that.

## Known gaps

- Best effort: names the NER model misses reach the provider. Regex entities (email, IBAN, card, phone) are reliable.
- Not covered: the system prompt, `thinking` blocks, files that `AskClaude`'s Claude Code reads itself, extensions that call models on their own, images.
- Claude Code adds its own context (for example your account email) inside `claude-bridge`; PI cannot see or redact it.
- Sessions that ran before redaction was enabled keep raw history in Claude Code's session file. Start a new session.
- After a PI restart plus compaction, tags in old summaries are unknown; a tool call using one is blocked. Give the value again.
- NER can tag long spans (a whole phrase as `PERSON`) and long digit runs as phones. Edits stay correct because tool calls get real values.
- The smoke drift check covers `.pi/extensions/`, not `.pi/local-packages/`; run `npm run pi:sync-global` after changing the package.

## Writing docs and tests

- Never write a tag with 12 real hex characters in docs, specs, or fixtures. Under live redaction a `write`/`edit` with an unknown tag is blocked. Use `<pii:TYPE:…>`; tests build tags with `makeTag`.
