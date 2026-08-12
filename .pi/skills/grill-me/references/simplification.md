# Simplification

Grilling has a built-in bias: every risk you find wants a mechanism attached to it. Left uncorrected, a
session closes ten risks and hands back a plan twice the size. This file is the counterweight — run it
against every element the plan introduces **before** proposing anything that adds to it.

## The ladder

For each element the plan introduces — module, service, endpoint, abstraction, config knob, table, queue,
layer, dependency, flag — ask in order and stop at the first hit:

1. **Does this need to exist?** → no: cut it. YAGNI.
2. **Already in this codebase?** → reuse it, don't rewrite it.
3. **Does the stdlib do it?** → use that.
4. **Native platform feature?** → use that.
5. **Already-installed dependency?** → use that.
6. **Is it one line?** → make it one line.
7. Only then: the minimum that works.

An element that survives all seven is justified. One that fails at step 1 is a **finding**, not a taste
preference — record it as a simplification.

## What to look for

- **Speculative generality** — an abstraction, interface, or plugin point with exactly one implementation
  and no named second caller. The requirement it serves is usually hypothetical.
- **Config for a decision nobody is making** — a knob whose value will be set once and never changed.
  Hard-code it and delete the knob.
- **A layer that only forwards** — a service, wrapper, or mapper that passes calls through without owning a
  decision. Delete it and let the caller talk to the callee.
- **Premature distribution** — a queue, cache, or separate service introduced before there is a measured
  load or isolation requirement. Each one buys a new failure mode.
- **Unstated requirements** — features present in the plan that trace back to no user need, ticket, or
  constraint the user has actually named. Ask whose requirement it is.
- **Parallel mechanisms** — two ways to do the same thing, kept because neither was removed. Pick one.
- **Rollout machinery on a reversible change** — a feature flag around something trivially revertible costs
  more than it protects.

## Recording a simplification

Same shape as a default change, opposite direction:

> [High] `NotificationStrategy` interface has one implementation and no named second channel.
> Simplification: delete the interface, call `EmailNotifier` directly.
> Reinstate it when a second channel is actually scheduled — not before.

## Subtraction questions

Use these when the plan is already large. They belong in the frontier alongside the risk questions.

- **Deletion probe**: "What breaks if we ship without this entirely?"
- **Half-size probe**: "What does the version with half the moving parts look like, and what does it cost?"
- **Requirement trace**: "Whose requirement is this? Point me at the ticket or the constraint."
- **Second-caller test**: "This abstraction has one implementation. Who is the second one, and when?"
- **Defer probe**: "Does this have to be in v1, or can it wait until someone asks?"
- **Failure-mode accounting**: "This adds a queue. That is a new thing that can be down, backed up, or
  poisoned. What does it buy that covers those three?"

## Net-complexity rule

A grilling that ends with a longer, more complex plan than it started with has failed, however many risks
it closed. Track both directions and report both.
