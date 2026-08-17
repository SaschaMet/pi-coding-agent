# RTK — Rust Token Killer

`rtk` wraps bash commands and compresses their output to save tokens.
It **drops tokens** (words, even code keywords), can **insert phantom tokens** (stray `**` seen in `od` dumps), and can **corrupt the command string** itself (probe patterns lose words in transit).
Compressed output is structure, **not bytes**. rtk never alters files on disk.

## Lossless signals (safe for decisions)

- Exit codes (always real).
- Integer counts: `grep -c`, `wc -l` / `wc -c`, `grep -o pat | wc -l`.
- Single-token `grep -qF` / `grep -cF` probes (presence/absence, 0/1).
- Numeric `awk` probes, e.g. `awk 'NR==n{print RSTART}' file`.

## Lossy displays (review only — never byte-exact evidence)

- `rtk read <file>`: the cleanest display, but still drops function words even on small files. 50 KB cap — larger files lose the head; full output goes to the log path printed in the notice.
- `cat`, `sed -n`, `node -e`, `git diff`, `git show` (code bodies get compressed).
- `grep -n` output lines (identifiers intact, prose dropped).
- `od -c` dumps (byte order survives; phantom tokens may be inserted).

## What can go wrong

- `rtk rewrite` rewrites the **command string** too. Phrase-length patterns (grep strings, paths with many words) can lose words in transit. Keep probe patterns to short single tokens. Sanity-check the probe harness with a nonsense pattern that must miss.
- Edit-tool results are unreliable: **error and success messages have both been wrong**. Never retry on a reported failure — probe the actual file state first (retries can double-apply).
- Anomalous output (line-number prefixes, missing keywords, phantom `**`) is a pipeline artifact, not disk state.
- `RTK_DISABLED=1` on a bash tool call does **not** disable the hook (the extension runs in its own process with its own environment).

## Rules

- Any fact used as *evidence* (review findings, root causes, doc claims) must come from a lossless signal.
- Compose edit `oldText` from your own verbatim writes (the write path is byte-exact) — or confirm the target line exists via single-token probes first.
- After any write/edit: probe 2–3 distinctive single tokens of the new content **and** one token of the old content (must be gone).
- Bounded region of a big file: `sed -n 'a,bp' file > /tmp/r && rtk read /tmp/r` (display only).
- Exit codes: never `cmd | tail; echo $?` (that is `tail`'s status). Use `cmd > /tmp/log 2>&1; rc=$?; tail /tmp/log; echo rc=$rc`.
- Verify environment premises empirically (`ls`, `test -d`) before building plans or briefs on doc claims — docs go stale.
- Brief subagents with this ladder; verify shared premises before dispatch so agents do not inherit one bad assumption.


---

- There is a `rtk` hook running. RTK (Rust Token Killer) wraps shell commands and compresses their output. It drops tokens, inserts phantom tokens, and can corrupt the command string itself. Output is structure, not bytes.
  - Lossless: exit codes, integer counts (`grep -c`, `wc`), single-token `grep -qF` probes, numeric `awk` probes.
  - Lossy display (review only): `rtk read`, `cat`, `sed -n`, `node -e`, `git diff` bodies, `grep -n` lines, even `od -c`.
  - Any fact used as evidence must come from a lossless signal. Keep probe patterns to single tokens — phrases can lose words in transit.
  - Edit results (error or success) can be wrong. Probe actual file state before retrying.
  - Full guide: @`~/.pi/agent/docs/RTK.md`