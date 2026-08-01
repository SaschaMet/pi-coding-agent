# Logic Prototype

A tiny interactive terminal app that lets the user drive a state model by hand. Use when the question is about **business logic, state transitions, or data shape** — the kind of thing that looks reasonable on paper but only feels wrong once pushed through real cases.

Wrong branch if the question is "what should this look like" — use [ui.md](ui.md).

## When this is the right shape

- "I'm not sure this state machine handles X then Y."
- "Does this data model actually let me represent the case where..."
- "I want to feel out what the API should look like before writing it."
- Anything where the user wants to **press keys and watch state change**.

## Process

### 1. State the question

Before writing code, write down the state model and the question, one paragraph, at the top of the file. A logic prototype that answers the wrong question is pure waste — make the question checkable later, whether the user is watching now or returning to it AFK.

### 2. Pick the language

Whatever the host project uses. Match its existing tooling — don't add a package manager or runtime just for the prototype. If the project has no obvious runtime, ask.

### 3. Isolate the logic in a portable module

Put the bit that answers the question behind a small, pure interface that could be lifted into the real codebase later. The TUI around it is throwaway; the logic module isn't. Pick the shape that fits the question, not whichever is easiest to wire to a TUI:

- **A pure reducer** — `(state, action) => state`. Discrete events, single state value.
- **A state machine** — explicit states and transitions. Use when "which actions are even legal right now" is part of the question.
- **Pure functions** over a plain data type. No implicit current state, just transformations.
- **A class or module** when the logic genuinely owns ongoing internal state.

Keep it pure: no I/O, no terminal code, no `console.log` for control flow. The TUI imports it and calls in; nothing flows the other direction.

### 4. Build the smallest TUI that exposes the state

A **lightweight TUI**: on every tick, clear the screen (`console.clear()`, `print("\033[2J\033[H")`, equivalent) and re-render the whole frame. One stable view, not growing scrollback. Each frame, in this order:

1. **Current state**, pretty-printed and diff-friendly — one field per line or formatted JSON. Bold for field names, dim for less important context. Native ANSI is fine (`\x1b[1m` bold, `\x1b[2m` dim, `\x1b[0m` reset); no styling library unless the project already has one.
2. **Keyboard shortcuts** at the bottom: `[a] add user  [d] delete user  [t] tick clock  [q] quit`.

Loop: initialise a single in-memory state object and render → read one keystroke → dispatch to a handler that mutates state → re-render the full frame → repeat until quit. The whole frame fits on one screen.

### 5. Make it runnable in one command

Add a script to the project's existing task runner. The user runs `npm run <prototype-name>` or equivalent — never a remembered path. No task runner? Put the command at the top of the file.

### 6. Hand it over

Give the user the run command. The interesting moments are "wait, that shouldn't be possible" and "huh, I assumed X would be different" — those are bugs in the _idea_, which is the whole point. Add actions if they ask. Prototypes evolve.

### 7. Capture the answer and the prototype

Capture the answer, then the prototype as `SKILL.md` describes. The logic-specific mapping: the validated reducer / machine / function set lifts into the real module; the TUI shell rides along to the throwaway branch.

## Anti-patterns

- **Blurring the logic and the TUI together.** If the reducer references prompts, `console.log`, or escape codes, it is no longer portable.
- **Shipping the TUI shell into production.** The shell is for driving by hand. The logic module behind it is the part worth keeping.
- **Wiring it to the real database.** In-memory store, unless the question is specifically about persistence.
