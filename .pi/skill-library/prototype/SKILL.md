---
name: prototype
description: Use this skill when the user wants to sanity-check a state model, business logic, or what a UI should look like by building throwaway code — a design question that is faster to settle by running something than by arguing on paper. Also use when another skill needs a prototype to raise the fidelity of a discussion. Do not use for production code, for spikes intended to be kept, or when reading the codebase already answers the question.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → read [references/logic.md](references/logic.md). A tiny interactive terminal app that pushes the state machine through cases that are hard to reason about on paper.
- **"What should this look like?"** → read [references/ui.md](references/ui.md). Several radically different UI variations on one route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default by surrounding code — a backend module means logic, a page or component means UI — and state the assumption at the top of the prototype.

## Rules for both branches

1. **Throwaway from day one, and marked as such.** Put the prototype next to the module or page it prototypes for, so context is obvious, but name it so a casual reader sees it is a prototype. Follow the project's existing routing and file conventions; don't invent a new top-level structure.
2. **One command to run.** Whatever the project's task runner already supports. The user must be able to start it without thinking.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it depends on. If the question is specifically about a database, use a scratch one named `PROTOTYPE — wipe me`.
4. **Skip the polish.** No tests, no error handling beyond what makes it runnable, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or variant switch (UI), print or render the full relevant state so the user sees what changed.
6. **Capture it when done.** Fold the validated decision into the real code. Keep the prototype itself as a primary source on a throwaway branch, out of main, with a pointer to that branch from wherever the decision is recorded. Capture the verdict and the question it settled alongside it. Main keeps only the validated decision.

## Anti-patterns

- **Adding tests.** A prototype that needs tests is no longer a prototype.
- **Wiring it to real data or real mutations.** Point at a stub unless the question is specifically about persistence.
- **Generalising.** No "what if we wanted X later." The prototype answers one question.
- **Promoting prototype code straight to production.** It was written under prototype constraints. Rewrite it properly when folding it in.
