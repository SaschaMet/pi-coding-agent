# Gates and Write Scope — Internals

Load this when changing the extensions, diagnosing a gate that fired wrongly, or authoring a spec `Scope` section. Day-to-day rules live in `gates-and-scope-guide.md`.

## Files

| Path | Holds |
|------|-------|
| `.pi/extensions/gates.ts` | Post-run gate wiring on `agent_end` |
| `.pi/extensions/write-boundary-guard.ts` | Write blocking and scope arming |
| `.pi/extensions/lib/gate-checks.ts` | The three gate predicates |
| `.pi/extensions/lib/spec-scope.ts` | `Scope` parser and pattern matcher |
| `.pi/extensions/lib/extension-helpers.ts` | Path resolution shared with `read-boundary-guard.ts` |

## Gate mechanics

Gates run on `agent_end`. Violations are returned through `sendUserMessage`, so the session stays alive — no cold restart, no lost context.

**`changes_disclosed`** — the changed set is `git status --porcelain -uall` at `agent_end` minus a baseline snapshotted at `agent_start`, so files that were already dirty are ignored. `-uall` is required: plain `--porcelain` collapses untracked directories into one `?? dir/` entry, which would name a directory instead of the new file. `core.quotePath=false` keeps non-ASCII paths comparable to what the message actually wrote. Both sides of a rename count. A full path always counts as disclosure; a bare basename counts only when unique among the run's changes, since naming one `index.ts` cannot vouch for three.

**`artifacts_exist` / `files_non_empty`** — targets are recorded on `tool_result`, not `tool_call`, so calls another guard blocked never produce a violation for a file they were prevented from writing.

**`verification_actually_ran`** — the claim is matched per sentence, and a negated sentence ("typecheck is not clean", "tests do not pass") is a failure report rather than a claim. Without that, honest reporting would trip the gate.

Paths from `git status` are untrusted text: they are stripped of control characters, length-capped, and wrapped in a `<changed-paths>` block before reaching the model.

### Loop safety

At most one correction per violating streak. A correction starts a new run, which would otherwise re-trigger the gates forever. The counter resets after a clean run, so a later violation is reported normally.

### Fail-open cases

Gates skip silently when the working directory is not a git work tree, when `git` errors or is missing, and when gates are off. This is a deliberate departure from Fail-Safe Defaults: a wedged gate blocks all work, while a missed gate costs one review. Blocking belongs in the write guard, not here.

### Known limits

- Changes to gitignored files are invisible.
- Disclosure is substring matching, not comprehension: it catches silent changes, not misleading descriptions.

## Write scope

Checks run in this order, and the first decision wins:

1. A path resolving outside the working directory is blocked. Symlinks and `~` are expanded first, so the check sees the real target rather than the literal string.
2. A path matching `Forbid` is blocked. Deciding forbid first means no allowance below can override it.
3. The armed spec file itself is writable.
4. `docs/specs/`, `docs/research/`, `docs/plans/` are writable, so the agent can maintain its own planning artifacts.
5. A path matching `Modify` is allowed.
6. Anything else is blocked.

With a UI, a block becomes a one-time Yes/No prompt, matching `read-boundary-guard.ts`. Without a UI it is a hard block.

### Pattern syntax

| Pattern | Matches |
|---------|---------|
| `src/**/*.ts` | `src/index.ts` and `src/a/b.ts` — `**` is zero or more segments |
| `src/*.ts` | one segment only |
| `src/thing?.ts` | exactly one character |
| `src` | directory prefix, so `src/env.ts` |
| `package.json` | that exact path |

### Arming

Automatic arming happens when a `write`/`edit` to `docs/specs/spec-*.md` succeeds **while nothing is armed**. Arming has to be code because a skill cannot type `/scope`.

Automatic arming never replaces an active scope. A spec written mid-session — the next one being drafted, or one the agent authored itself — would otherwise let work in flight rewrite its own boundary.

The guard refuses to arm when it cannot parse the scope confidently: no `Scope` heading, or a `Modify` list holding only template placeholders (`path/to/file`, `...`). Arming a mis-parsed allowlist would block everything.

A failed parse never disarms. With nothing armed, writes stay unrestricted and the guard says so; with a scope already armed, it stays enforcing. Trading a working boundary for none because a *different* spec failed to parse would unlock the repository at exactly the wrong moment.

Expected shape (see `.pi/skills/create-spec/references/spec-template.md`):

```md
## 2. Scope

**Modify:**
- `src/**`
- `package.json`

**Forbid:**
- `src/secrets.ts`
```

### Known limits

- Mutating `bash` commands are not covered. A determined agent can still write through the shell.
- Unarmed means unrestricted: the guard only constrains work that has a spec.
- State lives on the session, not on disk. A branch carrying no scope entry disarms rather than inheriting the previous branch's boundary.
