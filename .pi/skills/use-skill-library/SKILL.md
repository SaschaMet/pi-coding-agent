---
name: use-skill-library
description: 'Router for the on-demand skill library at ~/.pi/agent/skill-library/ — skills stored on disk but deliberately not auto-discovered, so they cost no context until named. Use when the user names a skill from that library, says "use the skill library", "check my skill library", "load the <name> skill", or asks which library skills exist. Reads the library AGENTS.md index, picks the matching skill, and runs it from its own SKILL.md. Do not use for skills already in the auto-loaded skill list.'
license: MIT
metadata:
  author: saschametzger
  version: "1.0.0"
---

# Use Skill Library

Load and run a skill from the manual library at `~/.pi/agent/skill-library/`.

## Why this exists

The library holds skills that are valuable but rarely needed. They are not auto-discovered, so none of their descriptions enter session context. This router is the one small description that stays loaded; it turns a skill name into a loaded skill on demand.

## Procedure

1. **Read the index.** Read `~/.pi/agent/skill-library/AGENTS.md` in full. Its index table is the only authoritative list of what the library contains. Never assume a skill exists without seeing it there.
2. **Match the request** to exactly one skill (see Matching rules).
3. **Announce the choice** in one line before doing anything: which skill, and the phrase in the request that selected it. A silent pick is a defect — the user cannot correct a decision they never saw.
4. **Load the skill.** Read `~/.pi/agent/skill-library/<skill-name>/SKILL.md` in full.
5. **Follow it.** That file is now the method. Do not paraphrase its framework from memory, do not substitute a similar approach, do not skip steps it marks as gates.
6. **Read references on demand only.** `SKILL.md` names which `references/*.md` to read for a given task. Read those, and only those. Relative links resolve against the skill's own folder.

## Matching rules

| Situation | Action |
|---|---|
| The user named a skill, and it is in the index | Use it. No question needed. |
| The user described a need, and one skill clearly fits | Name it, state why, proceed. |
| Several skills plausibly fit | List them with one line each, recommend one, ask. Do not silently pick. |
| Nothing in the index fits | Say so plainly. Answer from general knowledge if you can, and label it as such. Never present improvised advice as a library skill. |
| The user named something absent from the index | Say it is not installed. Show the closest index entries. Do not substitute one skill for another without saying so. |

## Metaskills

Some library skills orchestrate others — `improve-website` runs twelve of them as phases. When loading one:

- Check the orchestration map in `AGENTS.md` and confirm each named skill exists in the library.
- Run each phase with the **real** skill, loaded the same way as step 4. Metaskills carry a condensed "Brief" fallback for missing skills — use it only when the skill is genuinely absent, and say which mode you are in.
- Metaskills are resumable. Read their tracker file in the current project's `docs/` before starting, and resume rather than restart.

## Hard rules

1. **Never dump a whole `references/` folder into context.** Some skills carry over 3,000 lines of reference material. Loading it all defeats the purpose of the library.
2. **Never invent a skill.** If it is not in the index, it does not exist.
3. **Write artifacts to the current project**, into its `docs/` folder as the skill directs. Never write into `~/.pi/agent/skill-library/` — it is read-only in use.
4. **The library skill's method wins** over your default approach for the task it covers. That is why it was invoked.

## Failure modes

| Condition | Response |
|---|---|
| `~/.pi/agent/skill-library/` missing | Report the exact path as missing. Stop. Do not recreate it. |
| `AGENTS.md` missing but skill folders present | List the folder names as a provisional index, say the index file is missing, and suggest rebuilding it. |
| Named skill's `SKILL.md` missing or unreadable | Report the exact path. Stop. Do not run the skill from its name alone. |
| A reference file named by `SKILL.md` does not exist | Report the dangling link, continue with the rest of the skill, and note what was unavailable. |

## Managing the library

`AGENTS.md` documents how to add a skill, run the link check, update a skill from upstream, promote one to auto-loaded, and remove one. Follow that file rather than improvising; it is the maintenance contract for this directory.
