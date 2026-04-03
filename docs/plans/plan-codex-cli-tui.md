# Plan: Codex-like TUI Restyle

> Generated on 2026-04-03
> Status: Draft
> Size: Medium

## Summary
Restyle this repo’s project-local pi TUI so the default experience feels closer to the Codex CLI screenshot: a minimal dark interface, a roomy dark input box with a leading chevron prompt, a compact single-line footer, and less visual noise overall. Keep the change project-local by composing pi’s supported customization surfaces (theme JSON + TUI extension + compact renderers) instead of forking `@mariozechner/pi-coding-agent` internals.

## Scope

**Included:**
- A new project-local theme under `.pi/themes/`
- A new project-local UI extension under `.pi/extensions/`
- Setting the Codex-like theme as the repo default in `.pi/settings.json`
- Header/footer/editor restyling using supported pi TUI APIs
- Compact built-in tool rendering where it improves the Codex-like feel
- Subtle cursor/input polish only if it is clearly supported and low-risk
- Vitest coverage for extension registration, formatting, and fallbacks

**Excluded:**
- Forking or patching upstream pi packages
- Rewriting the core `InteractiveMode` boot flow in `src/main.ts`
- Heavy fake character-by-character assistant streaming
- Large refactors to unrelated extensions or plan-mode behavior
- Changing provider/model logic, auth flow, or tool semantics

## References
- User resources:
  - Screenshot: `/var/folders/6n/qtdj22mj0fz1rt7z646041ym0000gn/T/TemporaryItems/NSIRD_screencaptureui_YksPIf/Screenshot 2026-04-03 at 15.16.48.png`
  - User preferences captured via structured Q&A:
    - make the new UI the project default
    - keep typing polish subtle
    - use the screenshot as the main reference
- Related code:
  - `src/main.ts:51-71` — creates the agent session and launches `InteractiveMode`
  - `.pi/settings.json:2-6` — project-level pi settings already active in this repo
  - `.pi/extensions/plan-mode/index.ts:78-100` — existing footer-status/widget usage that the new footer/header must coexist with
  - `test/helpers/fake-pi.ts:33-99` — current extension-test helper patterns
  - `package.json:8-10,19-20,28` — runtime/test scripts and TUI dependencies
- External pi docs/examples:
  - Themes: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/themes.md`
  - TUI components: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/tui.md`
  - Extensions: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md`
  - Custom editor example: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/examples/extensions/rainbow-editor.ts`
  - Custom footer example: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/examples/extensions/custom-footer.ts`
  - Custom header example: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/examples/extensions/custom-header.ts`
  - Modal editor example: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/examples/extensions/modal-editor.ts`
  - Built-in tool renderer example: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/examples/extensions/built-in-tool-renderer.ts`
  - Minimal tool display example: `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/examples/extensions/minimal-mode.ts`
- Prior plans/specs:
  - None found under `docs/plans/`, `*.plan.md`, `*.spec.md`, or `PRD.md`

## Detected Project Context
- Language/Framework: TypeScript, Node.js, project-local pi runtime
- TUI Stack: `@mariozechner/pi-coding-agent` + `@mariozechner/pi-tui`
- Test Framework: Vitest with tests in `test/*.test.ts`
- Build/Run Commands:
  - Run agent: `npm run agent`
  - Run tests: `npm test`
- CI/CD: none detected in the repo snapshot reviewed
- Deployment Target: local CLI/runtime project, not a deployed service
- Relevant AI Instructions:
  - Use project-local extensions and settings rather than modifying upstream packages
  - Read-only planning only for this task

## Risks & Dependencies

| # | Risk | Severity | Mitigation | One-Way Door? |
| --- | --- | --- | --- | --- |
| 1 | Exact blinking behavior may be terminal-controlled, not fully extension-controlled | Medium | Prefer the hardware cursor / existing editor cursor path and document terminal-dependent behavior | No |
| 2 | A custom editor can regress multiline editing, cursor placement, or IME behavior | High | Subclass/wrap existing editor behavior instead of reimplementing text editing from scratch | No |
| 3 | Overly compact tool rendering could hide important errors or confirmations | Medium | Keep failures explicit and preserve expandable detail paths | No |
| 4 | Custom footer/header may conflict visually with existing status/widget extensions like plan mode | Medium | Test coexistence with `.pi/extensions/plan-mode/index.ts` behavior and keep footer composition simple | No |
| 5 | Project theme selection may still interact with user-global pi settings/preferences | Medium | Verify precedence manually; keep extension-driven layout useful even if the theme is overridden | No |
| 6 | “Flow-like typing” can feel worse than native streaming if over-animated | Medium | Limit polish to subtle cursor/input affordances and skip aggressive fake typing | No |

**Blockers** (must be resolved before implementation):
- None currently identified.

---

## Phase 1: Default Codex-like Shell Chrome

### Goal
Create the project-default visual shell: theme, minimal header, compact footer, and a Codex-like input box without changing core pi internals.

### Tasks

#### Task 1.1: Add a project-local Codex-like theme
**Files to modify**: `.pi/settings.json`
**Files to create**: `.pi/themes/codex-dark.json`

**Spec**:
- Behavior:
  - Define a subdued dark theme with muted text, low-noise borders, and restrained accent usage.
  - Make it the repo default via project settings.
  - Keep warning/success/error states readable and accessible.
- Edge cases:
  - If user-global theme precedence wins, the extension-driven layout should still look acceptable.
  - Theme tokens must cover all required pi theme colors.

**Definition of Done**:
- [ ] `.pi/themes/codex-dark.json` exists and validates against pi’s required token set
- [ ] `.pi/settings.json` selects the new theme as the repo default
- [ ] The theme visually supports muted chrome, compact footer text, and the custom editor state

#### Task 1.2: Add a dedicated Codex-like UI extension
**Files to create**: `.pi/extensions/codex-ui.ts`

**Spec**:
- Behavior:
  - On session startup, replace or minimize the header using `ctx.ui.setHeader()`.
  - Install a custom footer using `ctx.ui.setFooter()` that condenses model + context-left (if available) + cwd into one line.
  - Install a custom editor component using `ctx.ui.setEditorComponent()` to render a dark, roomy input box with a leading chevron prompt and muted placeholder.
- Edge cases:
  - If model or context-left data is unavailable, the footer should omit or gracefully degrade rather than show broken placeholders.
  - If UI hooks are unavailable, the extension should no-op safely.
  - The editor must preserve focus/cursor placement behavior rather than invent a separate cursor model.

**Definition of Done**:
- [ ] Header is reduced to a minimal Codex-like presentation or intentionally hidden
- [ ] Footer renders as a single concise line and degrades gracefully with partial metadata
- [ ] Editor visually matches the target style closely while retaining normal editing behavior
- [ ] No changes are required in `src/main.ts`

### Testing

#### Automated Tests
- [ ] Add Vitest coverage for theme-selection wiring and extension startup registration
- [ ] Add tests for footer formatting with full and partial metadata
- [ ] Add tests that the extension safely no-ops when UI facilities are absent

**Run with**: `npm test`

#### Manual Verification
1. Run `npm run agent`.
2. Confirm the startup UI uses the new dark/minimal visual style by default.
3. Verify the header is minimal or hidden rather than the standard busy header.
4. Verify the editor area is a dark block with a chevron-style prompt and muted placeholder.
5. Verify the footer shows a compact line similar to `model · context left · cwd`.
6. Type a single-line prompt and a multiline prompt to confirm editing still works.

**Expected result**: The app launches with a Codex-like default shell style, while typing/editing still behaves normally.

**Regression check**: `npm test`

### Context for Implementation
- **Read first**: `src/main.ts`, `.pi/settings.json`, `.pi/extensions/plan-mode/index.ts`, `test/helpers/fake-pi.ts`
- **Can skip**: `docs/security/*`, `src/env.ts`, `src/secrets.ts` unless implementation unexpectedly touches startup config or env behavior
- **Patterns to follow**:
  - Startup extension registration in `.pi/extensions/plan-mode/index.ts:349-356`
  - Existing status/widget composition in `.pi/extensions/plan-mode/index.ts:78-100`
  - Custom editor approach from pi example `rainbow-editor.ts`
  - Header/footer replacement from pi examples `custom-header.ts` and `custom-footer.ts`
- **Reuse**: existing Vitest + fake-pi test style from `test/plan-mode.test.ts` and `test/helpers/fake-pi.ts`

### Review Checkpoint
Stop after the theme + shell chrome work. Verify the static look and editing behavior before compacting tool output or adding any animation polish.

---

## Phase 2: Compact Renderers, Cursor Polish, and Test Hardening

### Goal
Reduce visual noise in tool output and add only low-risk motion/cursor polish that supports the Codex-like feel.

### Tasks

#### Task 2.1: Compact built-in tool rendering
**Files to modify**: `.pi/extensions/codex-ui.ts`

**Spec**:
- Behavior:
  - Override the built-in renderers for the most visible tools (`read`, `bash`, `edit`, `write`, and optionally `find`/`grep`/`ls`) to show compact, scan-friendly summaries.
  - Keep errors explicit and preserve expanded output when needed.
- Edge cases:
  - Partial/running states should still communicate progress.
  - Long paths/commands should truncate cleanly.
  - Compact mode must not hide destructive/error outcomes.

**Definition of Done**:
- [ ] Common tool calls render in a more minimal Codex-like style
- [ ] Error states remain obvious
- [ ] Expanded detail remains available where appropriate

#### Task 2.2: Add subtle cursor or typing polish only if safe
**Files to modify**: `.pi/extensions/codex-ui.ts`

**Spec**:
- Behavior:
  - Prefer preserving the terminal’s hardware cursor behavior for the “blinking cursor” request.
  - If animation is used, keep it subtle and limited to the editor/input affordance or a lightweight streaming indicator.
- Edge cases:
  - Do not introduce render flicker, broken selection, or degraded typing responsiveness.
  - Skip aggressive assistant-output typing simulations if the API support is weak.

**Definition of Done**:
- [ ] Cursor behavior is as close as safely possible to the requested blink/flow feel
- [ ] Any animation is subtle, low-frequency, and easy to remove
- [ ] No editing regressions are introduced

#### Task 2.3: Harden tests and helper support
**Files to create**: `test/codex-ui.test.ts`
**Files to modify**: `test/helpers/fake-pi.ts` (only if needed)

**Spec**:
- Behavior:
  - Add focused tests for extension registration, footer formatting, renderer fallback behavior, and any startup hooks.
  - Extend fake UI support only if the new extension requires header/footer/editor mocks not already present.
- Edge cases:
  - Missing UI methods should not crash tests.
  - Compact renderer logic should work for empty output and error output.

**Definition of Done**:
- [ ] New tests cover startup wiring and formatting/fallback paths
- [ ] Fake helpers are extended only if necessary
- [ ] `npm test` passes with the new suite

### Testing

#### Automated Tests
- [ ] Add renderer tests for compact success/error/partial states
- [ ] Add footer/path-format tests
- [ ] Add startup-registration tests for header/footer/editor setup

**Run with**: `npm test`

#### Manual Verification
1. Run `npm run agent`.
2. Enter `Summarize the files in src/` and confirm assistant/tool output looks more compact than the current default.
3. Trigger at least one file-read or bash-heavy task and verify errors/output remain understandable.
4. Observe the cursor while typing in the editor and confirm the experience feels subtly more “flow-like” without visible flicker.
5. Resize the terminal and verify header, editor, tool output, and footer still wrap correctly.
6. Toggle `/plan` and confirm plan-mode status/widget output still coexists with the custom footer/header choices.

**Expected result**: The UI feels more Codex-like and less visually noisy, while tool/error feedback and plan-mode behavior remain understandable.

**Regression check**: `npm test`

### Context for Implementation
- **Read first**: `.pi/extensions/codex-ui.ts`, `.pi/extensions/plan-mode/index.ts`, `test/codex-ui.test.ts`, `test/helpers/fake-pi.ts`
- **Can skip**: unrelated security extensions and subagent internals
- **Patterns to follow**:
  - Built-in renderer overrides from pi examples `built-in-tool-renderer.ts` and `minimal-mode.ts`
  - Custom editor subclassing from pi examples `modal-editor.ts` and `rainbow-editor.ts`
- **Reuse**: existing project test conventions and theme APIs already used by other extensions

### Review Checkpoint
Stop after compact renderers and cursor polish. Re-check the screenshot goal, terminal behavior, and coexistence with existing repo extensions before considering any further cosmetic tweaks.

---

## Summary of All Changes

| File | Change type | Phase |
| ---- | ----------- | ----- |
| `docs/plans/plan-codex-cli-tui.md` | Create | 1 |
| `.pi/themes/codex-dark.json` | Create | 1 |
| `.pi/settings.json` | Modify | 1 |
| `.pi/extensions/codex-ui.ts` | Create | 1-2 |
| `test/codex-ui.test.ts` | Create | 2 |
| `test/helpers/fake-pi.ts` | Modify (if needed) | 2 |

## Manual Test Checklist
- [ ] Run `npm run agent` and confirm the repo starts with the new Codex-like dark UI by default.
- [ ] Verify the header is minimal or hidden and no longer dominates the screen.
- [ ] Verify the editor shows a dark prompt box with a leading chevron and muted placeholder text.
- [ ] Verify the footer shows a concise single-line summary with model, context-left when available, and abbreviated cwd.
- [ ] Type a normal one-line prompt and confirm cursor placement and editing behavior remain correct.
- [ ] Enter a multiline prompt and confirm multiline editing still works as before.
- [ ] Submit `Summarize the files in src/` and confirm tool/result rendering is more compact than before.
- [ ] Trigger a tool-heavy request and confirm errors remain obvious and readable.
- [ ] Observe the cursor/input behavior and confirm any blink/typing polish is subtle, not distracting.
- [ ] Resize the terminal and confirm the custom header/footer/editor layout still wraps correctly.
- [ ] Run `/plan`, then inspect the footer/widget behavior and confirm plan mode still works alongside the new UI.
- [ ] Run `npm test` and confirm the full Vitest suite passes.

## Open Questions / Deferred Decisions

| # | Question | Owner | Blocking? |
| --- | --- | --- | --- |
| 1 | Can project `.pi/settings.json` reliably force the theme as default when a user has global pi theme preferences? | Implementer | No |
| 2 | Is “100% left” style context data directly available to the footer API, or does the footer need a fallback wording/omission path? | Implementer | No |
| 3 | Which built-in tools should be compacted first: only `read/bash/edit/write`, or the full common set including `find/grep/ls`? | Implementer | No |
| 4 | Is any animation beyond hardware-cursor preservation worth keeping after real-terminal testing? | Implementer | No |

## Handoff
- **Implementation**: Use `$tdd-coding` to implement each phase in TDD order.
- **Review**: Use `$grill-me` to stress-test this plan before implementing if you want to pressure-test the UI tradeoffs.
- **Integration tests**: During implementation, the TDD skill will ask about integration test input/output pairs.
