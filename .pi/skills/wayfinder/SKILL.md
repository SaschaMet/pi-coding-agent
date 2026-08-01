---
name: wayfinder
description: Use this skill when the user asks to plan an effort too big for one agent session — a greenfield build, a large migration, or a foggy idea where the way to the destination is not visible yet. Chart a shared map of decision tickets on the tracker and resolve them one at a time, producing decisions rather than deliverables. Do not use for a well-scoped feature that fits one session, for turning an already-settled plan into a spec, or for implementation.
disable-model-invocation: true
---

# Wayfinder

A loose idea has arrived — too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the tracker, then works its **decision tickets** — questions whose resolution is a decision, not slices of a build to execute — one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting — it shapes every ticket. It might be a spec to hand off, a decision to lock before planning starts, or a change made in place like a data-structure migration.

## Two standing rules

**Plan, don't do.** Each ticket resolves a decision; the map is done when nothing is left to decide. The pull to just do the work is the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its `## Notes` — carrying execution into the map itself — but absent that, produce decisions, not deliverables.

**Refer by name.** In everything the human reads — narration, Decisions-so-far — refer to a map or ticket by its title, never a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. A name wraps its link; the id rides inside it, never stands in for it.

## Invocation

Two modes. Either way, **never resolve more than one non-research ticket per session.** Research tickets are exempt because they cost no session context: dispatch every unblocked one in parallel subagents.

Before either mode, read [references/tracker.md](references/tracker.md) — you need it before the first tracker write.

### Chart the map

User invokes with a loose idea.

1. **Check for an existing map.** Scan for open `wayfinder` maps (see the tracker reference). If one matches this idea, switch to *Work through the map* — do not chart a second.
2. **Name the destination.** Run a grilling session per `../grill-me/SKILL.md` to pin down what this map is finding its way to. The destination fixes the scope, so it is settled first. Done when the destination fits in two lines and the user has agreed to it.
3. **Map the frontier.** Grill again, **breadth-first**: fan out across the whole space rather than deep on one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** — the way is already clear, the journey small enough for one session — stop and tell the user they don't need a map.
4. **Create the map** with Destination and Notes filled in, Decisions-so-far empty, the fog sketched into Not yet specified. Record the tracker choice on one line in `## Notes` (`Tracker: local` or `Tracker: github`).
5. **Create the tickets you can specify now**, then wire blocking edges in a **second pass** — tickets need ids before they can reference each other. Done when every created ticket is either on the frontier or has at least one blocking edge, and nothing you can specify is still sitting in Not yet specified.
6. **Fire the research subagents** for every `research` ticket just created.
7. Stop. Charting is one session's work; it hand-resolves nothing.

### Work through the map

User invokes with a map. A ticket is optional — without one, you pick the next decision, not the user.

1. Load the **map** — the low-res view, not every ticket body.
2. **Is the map done?** If the frontier is empty *and* Not yet specified is empty, the way is clear. Stop and hand off to `../create-spec/SKILL.md`, which collapses Decisions-so-far into a buildable plan. **Never implement from the map** — going straight to code skips that collapse and throws the linked detail away.
3. Choose the ticket. If the user named one, use it. Otherwise take the first frontier ticket in order. **Claim it before any other work**, so concurrent sessions skip it.
4. Resolve it — **zoom as needed**: fetch the full body of any related or closed ticket on demand; invoke the skills `## Notes` names. If in doubt, grill (`../grill-me/SKILL.md`).
5. Record the resolution: post the answer, close the ticket, append a one-line context pointer to Decisions-so-far.
6. Add newly-surfaced tickets (create-then-wire); graduate any fog the answer made specifiable, **clearing each graduated patch from Not yet specified** so it lives only as its new ticket. If the answer reveals a ticket sits beyond the destination, rule it out of scope rather than resolving it. If the decision invalidates other tickets, update or delete them.

The user may run unblocked tickets in parallel, so expect other sessions editing the tracker concurrently.

## The Map

The map is a single tracker item labelled `wayfinder:map` — the canonical artifact. Its tickets are its children.

The map is an **index**, not a store. It lists the decisions made and points at the tickets holding their detail; a decision lives in exactly one place — its ticket — so the map never restates it, only gists it and links.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed — they are found by query.

```markdown
## Destination

<what reaching the end of this map looks like — the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<Tracker: local|github; domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail -->

- [<closed ticket title>](link) — <one-line gist of the answer>

## Not yet specified

<!-- in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a **child** of the map. Its body is the question, sized to one agent session:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Each ticket carries a `wayfinder:<type>` label — see [Ticket Types](#ticket-types).

A ticket is **unblocked** when every ticket blocking it is closed. The **frontier** is the open, unblocked, unclaimed children — the edge of the known.

The answer is not part of the body; it is recorded on resolution. Assets created while resolving are linked, not pasted in.

## Ticket Types

Every ticket is either **HITL** — human in the loop, worked *with* a human who speaks for themselves — or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it. A grilling agent that answers its own questions has broken this.

| Type | Mode | Resolve with | Use when |
| --- | --- | --- | --- |
| `research` | AFK | A read-only subagent per `../subagent-orchestrator/SKILL.md`, using the `generic-readonly` agent. Write findings to `.pi/wayfinder/<effort>/research/<slug>.md` and link them from the ticket. | Knowledge outside the working directory is needed — docs, third-party APIs, prior art. |
| `prototype` | HITL | `../prototype/SKILL.md`. Link the prototype as an asset. | "How should it look" or "how should it behave" is the question, and running something beats arguing on paper. |
| `grilling` | HITL | `../grill-me/SKILL.md`. **Two overrides apply**: its 0–7 question budget and its summary exit do not — a grilling ticket runs until the decision is settled. Keep its Language Discipline and `CONTEXT.md` maintenance on; that is the domain-modeling half of the work. | The default case. |
| `task` | either | Do the work, or hand the human a precise checklist. Record what was done plus any facts later tickets depend on (credential locations, new URLs, row counts). | Manual work gates a *decision* — signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. |

`task` is the one type that *does* rather than decides, and it earns its place by unblocking a decision, not by delivering the destination.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war** — decisions you can tell are coming but can't pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets, one at a time, until the way is clear and no tickets remain.

`## Not yet specified` is where that dim view is written down: the suspected question, the area to revisit. Everything there is in scope, just not sharp enough to ticket. It doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now — _not_ whether you can answer it now.

- **Ticket** when the question is already sharp, even if blocked and unactionable.
- **Not yet specified** when you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: one patch may graduate into several tickets, or none.

Not yet specified excludes what's already decided, what's already a live ticket, and what's out of scope.

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope** — it isn't fog and doesn't belong in Not yet specified. Scope, not sharpness, lands it there. Out-of-scope work never graduates; it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

When a ticket turns out to sit past the destination — mis-scoped while charting, or exposed by a resolution — **close it** (a closed ticket is unambiguously off the frontier) and leave one line in `## Out of scope`: the gist plus why, linking the closed ticket. It stays out of Decisions-so-far, which records the route actually walked; a scope boundary isn't a step on it.
