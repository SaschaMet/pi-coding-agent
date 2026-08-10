/**
 * Systematic Debugging Extension
 *
 * Provides a `/debug` command that enforces a disciplined debugging process:
 * 1. Find the root cause FIRST - no fixes until you understand WHY
 * 2. Trace backwards through the call chain to find the original trigger
 * 3. Test hypotheses minimally - one change at a time
 * 4. Fix at the source, not the symptom
 *
 * Based on: https://github.com/obra/superpowers/tree/main/skills/systematic-debugging
 * Adapted from: https://gist.github.com/Colelyman/61d156be5c0b1d9c15acf9d18a017109
 *
 * Usage:
 * - `/debug` - Start debugging session (prompts for problem description)
 * - `/debug test failure in auth module` - Start with specific problem
 * - `/end-debug` - Complete debugging session and return
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

// State for tracking debug session
let debugOriginId: string | undefined;
let debugFixAttempts = 0;
const DEBUG_STATE_TYPE = "debug-session";

type DebugSessionState = {
	active: boolean;
	originId?: string;
	fixAttempts: number;
	problem?: string;
};

function setDebugWidget(
	ctx: ExtensionContext,
	active: boolean,
	fixAttempts = 0,
) {
	if (!ctx.hasUI) return;
	if (!active) {
		ctx.ui.setWidget("debug", undefined);
		return;
	}

	ctx.ui.setWidget("debug", (_tui, theme) => {
		const attemptsText =
			fixAttempts > 0
				? ` • ${fixAttempts} fix attempt${fixAttempts > 1 ? "s" : ""}`
				: "";
		const warningText = fixAttempts >= 3 ? " ⚠️ QUESTION ARCHITECTURE" : "";
		const text = new Text(
			theme.fg(
				"warning",
				`Debug session active${attemptsText}${warningText} — use /end-debug to return`,
			),
			0,
			0,
		);
		return {
			render(width: number) {
				return text.render(width);
			},
			invalidate() {
				text.invalidate();
			},
		};
	});
}

function getDebugState(ctx: ExtensionContext): DebugSessionState | undefined {
	let state: DebugSessionState | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === DEBUG_STATE_TYPE) {
			state = entry.data as DebugSessionState | undefined;
		}
	}
	return state;
}

function applyDebugState(ctx: ExtensionContext) {
	const state = getDebugState(ctx);
	if (state?.active && state.originId) {
		debugOriginId = state.originId;
		debugFixAttempts = state.fixAttempts ?? 0;
		setDebugWidget(ctx, true, debugFixAttempts);
		return;
	}
	debugOriginId = undefined;
	debugFixAttempts = 0;
	setDebugWidget(ctx, false);
}

// The systematic debugging prompt
const DEBUG_PROMPT = `# Systematic Debugging Session

You are entering DEBUG MODE. Your goal is to find the ROOT CAUSE before attempting ANY fix.

## The Iron Law
\`\`\`
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
\`\`\`

Symptom fixes are failure. Quick patches mask underlying issues. You MUST complete Phase 1 before proposing any fix.

## The Problem
{problem}

---

## Phase 1: Root Cause Investigation (REQUIRED FIRST)

Complete ALL of these before moving to Phase 2:

### 1.1 Read Error Messages Carefully
- Don't skip past errors or warnings
- Read stack traces COMPLETELY
- Note line numbers, file paths, error codes
- They often contain the exact solution

### 1.2 Reproduce Consistently
- Can you trigger it reliably?
- What are the exact steps?
- If not reproducible → gather more data, don't guess

### 1.3 Check Recent Changes
- What changed that could cause this?
- \`git diff\`, recent commits
- New dependencies, config changes

### 1.4 Gather Evidence (for multi-component systems)
Before proposing fixes, add diagnostic instrumentation:
\`\`\`
For EACH component boundary:
  - Log what data enters component
  - Log what data exits component  
  - Verify environment/config propagation
  - Check state at each layer

Run once to gather evidence showing WHERE it breaks
THEN analyze evidence to identify failing component
\`\`\`

### 1.5 Trace Data Flow Backwards
When error is deep in call stack:
- Where does bad value originate?
- What called this with bad value?
- Keep tracing UP until you find the source
- Fix at source, not at symptom

**Ask yourself:** "What called this? And what called that?"

---

## Phase 2: Pattern Analysis

### 2.1 Find Working Examples
- Locate similar working code in same codebase
- What works that's similar to what's broken?

### 2.2 Compare Against References  
- If implementing a pattern, read reference implementation COMPLETELY
- Don't skim - understand fully

### 2.3 Identify Differences
- What's different between working and broken?
- List every difference, however small

---

## Phase 3: Hypothesis and Testing

### 3.1 Form Single Hypothesis
State clearly: "I think X is the root cause because Y"
Be specific, not vague.

### 3.2 Test Minimally
- Make the SMALLEST possible change to test hypothesis
- ONE variable at a time
- Don't fix multiple things at once

### 3.3 Verify Before Continuing
- Did it work? → Phase 4
- Didn't work? → Form NEW hypothesis, return to Phase 1 with new info
- DON'T add more fixes on top

---

## Phase 4: Implementation

### 4.1 Create Failing Test Case
- Simplest possible reproduction
- Automated test if possible
- MUST have before fixing

### 4.2 Implement Single Fix
- Address the root cause identified
- ONE change at a time
- No "while I'm here" improvements

### 4.3 Verify Fix
- Test passes now?
- No other tests broken?
- Issue actually resolved?

### 4.4 Add Defense-in-Depth
After fixing, add validation at EVERY layer data passes through:
- Layer 1: Entry point validation (API boundary)
- Layer 2: Business logic validation
- Layer 3: Environment guards (prevent dangerous ops in specific contexts)
- Layer 4: Debug instrumentation (for forensics)

---

## ⚠️ The 3-Fix Rule

**If 3+ fixes have failed:** STOP and question the architecture.

Pattern indicating architectural problem:
- Each fix reveals new shared state/coupling in different place
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

This is NOT a failed hypothesis - this is a wrong architecture.
Discuss with your human partner before attempting more fixes.

---

## 🚨 Red Flags - STOP and Return to Phase 1

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "I don't fully understand but this might work"
- "It's probably X, let me fix that"
- Proposing solutions before tracing data flow
- "One more fix attempt" (when already tried 2+)

**ALL of these mean: STOP. Return to Phase 1.**

---

## Your Process

1. **Acknowledge** the problem and what you understand so far
2. **Investigate** - gather evidence, read errors, trace data flow
3. **Ask questions** if you need more information (ONE at a time)
4. **Form hypothesis** - state clearly what you think is wrong and why
5. **Test minimally** - propose the smallest possible verification
6. **Fix at source** - only after root cause is confirmed
7. **Add defenses** - make the bug structurally impossible

Start by reading any error messages or logs, then trace backwards to find the root cause.`;

// Prompt for incrementing fix attempts
const FIX_ATTEMPT_WARNING = `
---

## ⚠️ Fix Attempt #{count}

You are about to attempt fix #{count}. Remember:

{warning}

Before proceeding:
1. Have you confirmed the root cause through investigation?
2. Is this fix addressing the SOURCE, not the symptom?
3. Have you tested the hypothesis minimally first?

If you're not confident, return to Phase 1 and gather more evidence.
`;

function getFixAttemptWarning(count: number): string {
	if (count >= 3) {
		return `**STOP: You have attempted ${count - 1} fixes already.**

This pattern suggests an ARCHITECTURAL problem, not a bug:
- Each fix reveals new issues in different places
- You're playing whack-a-mole with symptoms

Before attempting another fix:
1. Step back and question the fundamental approach
2. Is this pattern/architecture sound?
3. Would refactoring be better than more patches?

Discuss with your human partner before continuing.`;
	} else if (count === 2) {
		return `You've already tried one fix that didn't fully work.

Before trying again:
- What NEW information did the failed fix reveal?
- Did you trace the data flow completely?
- Is there a deeper root cause you missed?`;
	} else {
		return `This is your first fix attempt. Make sure you:
- Have completed Phase 1 (Root Cause Investigation)
- Can state the root cause clearly
- Are fixing at the SOURCE, not the symptom`;
	}
}

// Summary prompt for end-debug
const DEBUG_SUMMARY_PROMPT = `Summarize this debugging session for future reference.

Include:
1. **The Problem:** What was being debugged
2. **Investigation:** What evidence was gathered, what was traced
3. **Root Cause:** What was the actual source of the bug (not the symptom)
4. **Fix Applied:** What was changed and why
5. **Defenses Added:** What validation/guards were added to prevent recurrence
6. **Lessons Learned:** What would help debug similar issues faster

If the bug wasn't fully resolved, note:
- Current hypothesis
- What's been ruled out
- Suggested next steps`;

export default function debugExtension(pi: ExtensionAPI) {
	// Restore debug state on session events
	pi.on("session_start", (_event, ctx) => applyDebugState(ctx));
	pi.on("session_tree", (_event, ctx) => applyDebugState(ctx));

	// Register /debug command
	pi.registerCommand("debug", {
		description:
			"Start a systematic debugging session (find root cause before fixing)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Debug mode requires interactive mode", "error");
				return;
			}

			if (debugOriginId) {
				ctx.ui.notify(
					"Already in a debug session. Use /end-debug first.",
					"warning",
				);
				return;
			}

			// Get problem description
			let problem = args?.trim();
			if (!problem) {
				const editorResult = await ctx.ui.editor(
					"Describe the problem you're debugging:",
					"e.g., Test failure in auth module - login returns 401 even with valid credentials",
				);
				if (!editorResult?.trim()) {
					ctx.ui.notify("Debug session cancelled", "info");
					return;
				}
				problem = editorResult.trim();
			}

			// Check if we should use fresh session
			const entries = ctx.sessionManager.getEntries();
			const messageCount = entries.filter((e) => e.type === "message").length;

			let useFreshSession = false;
			if (messageCount > 0) {
				const choice = await ctx.ui.select("Start debug session in:", [
					"Empty branch (recommended)",
					"Current session",
				]);
				if (choice === undefined) {
					ctx.ui.notify("Debug session cancelled", "info");
					return;
				}
				useFreshSession = choice === "Empty branch (recommended)";
			}

			if (useFreshSession) {
				const originId = ctx.sessionManager.getLeafId() ?? undefined;
				if (!originId) {
					ctx.ui.notify("Failed to determine origin", "error");
					return;
				}
				debugOriginId = originId;
				const lockedOriginId = originId;

				const firstUserMessage = entries.find(
					(e) => e.type === "message" && e.message.role === "user",
				);
				if (!firstUserMessage) {
					ctx.ui.notify("No user message found in session", "error");
					debugOriginId = undefined;
					return;
				}

				try {
					const result = await ctx.navigateTree(firstUserMessage.id, {
						summarize: false,
						label: "debug-session",
					});
					if (result.cancelled) {
						debugOriginId = undefined;
						return;
					}
				} catch (error) {
					debugOriginId = undefined;
					ctx.ui.notify(
						`Failed to start debug session: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return;
				}

				debugOriginId = lockedOriginId;
				ctx.ui.setEditorText("");
				debugFixAttempts = 0;
				setDebugWidget(ctx, true, 0);
				pi.appendEntry(DEBUG_STATE_TYPE, {
					active: true,
					originId: lockedOriginId,
					fixAttempts: 0,
					problem,
				});
			}

			const fullPrompt = DEBUG_PROMPT.replace("{problem}", problem);
			ctx.ui.notify(
				"Debug session started. Find the root cause before attempting any fix!",
				"info",
			);
			pi.sendUserMessage(fullPrompt);
		},
	});

	// Register /fix-attempt command to track fix attempts
	pi.registerCommand("fix-attempt", {
		description: "Record a fix attempt (tracks count, warns at 3+)",
		handler: async (_args, ctx) => {
			if (!debugOriginId) {
				const state = getDebugState(ctx);
				if (state?.active) {
					debugOriginId = state.originId;
					debugFixAttempts = state.fixAttempts ?? 0;
				}
			}

			debugFixAttempts++;
			setDebugWidget(ctx, true, debugFixAttempts);

			// Update persisted state
			if (debugOriginId) {
				pi.appendEntry(DEBUG_STATE_TYPE, {
					active: true,
					originId: debugOriginId,
					fixAttempts: debugFixAttempts,
				});
			}

			const warning = FIX_ATTEMPT_WARNING.replace(
				/{count}/g,
				String(debugFixAttempts),
			).replace("{warning}", getFixAttemptWarning(debugFixAttempts));

			if (debugFixAttempts >= 3) {
				ctx.ui.notify(
					`⚠️ Fix attempt #${debugFixAttempts} - STOP and question the architecture!`,
					"warning",
				);
			} else {
				ctx.ui.notify(`Fix attempt #${debugFixAttempts} recorded`, "info");
			}

			pi.sendUserMessage(warning);
		},
	});

	// Register /end-debug command
	pi.registerCommand("end-debug", {
		description: "Complete debugging session and return to original position",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Requires interactive mode", "error");
				return;
			}

			if (!debugOriginId) {
				const state = getDebugState(ctx);
				if (state?.active && state.originId) {
					debugOriginId = state.originId;
					debugFixAttempts = state.fixAttempts ?? 0;
				} else if (state?.active) {
					setDebugWidget(ctx, false);
					pi.appendEntry(DEBUG_STATE_TYPE, { active: false, fixAttempts: 0 });
					ctx.ui.notify("Debug state cleared", "warning");
					return;
				} else {
					ctx.ui.notify("Not in a debug session", "info");
					return;
				}
			}

			const choice = await ctx.ui.select("Summarize debugging session?", [
				"Summarize",
				"No summary",
			]);
			if (choice === undefined) {
				ctx.ui.notify("Cancelled. Use /end-debug to try again.", "info");
				return;
			}

			const wantsSummary = choice === "Summarize";
			const originId = debugOriginId;

			if (wantsSummary) {
				const result = await ctx.ui.custom<{
					cancelled: boolean;
					error?: string;
				} | null>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(
						tui,
						theme,
						"Summarizing debug session...",
					);
					loader.onAbort = () => done(null);

					ctx
						.navigateTree(originId!, {
							summarize: true,
							customInstructions: DEBUG_SUMMARY_PROMPT,
							replaceInstructions: true,
						})
						.then(done)
						.catch((err) =>
							done({
								cancelled: false,
								error: err instanceof Error ? err.message : String(err),
							}),
						);

					return loader;
				});

				if (result === null) {
					ctx.ui.notify("Cancelled. Use /end-debug to try again.", "info");
					return;
				}

				if (result.error) {
					ctx.ui.notify(`Failed: ${result.error}`, "error");
					return;
				}

				setDebugWidget(ctx, false);
				debugOriginId = undefined;
				debugFixAttempts = 0;
				pi.appendEntry(DEBUG_STATE_TYPE, { active: false, fixAttempts: 0 });

				if (result.cancelled) {
					ctx.ui.notify("Navigation cancelled", "info");
					return;
				}

				if (!ctx.ui.getEditorText().trim()) {
					ctx.ui.setEditorText("Apply the fix identified in the debug session");
				}

				ctx.ui.notify("Debug session complete!", "info");
			} else {
				try {
					const result = await ctx.navigateTree(originId!, {
						summarize: false,
					});
					if (result.cancelled) {
						ctx.ui.notify("Navigation cancelled", "info");
						return;
					}

					setDebugWidget(ctx, false);
					debugOriginId = undefined;
					debugFixAttempts = 0;
					pi.appendEntry(DEBUG_STATE_TYPE, { active: false, fixAttempts: 0 });
					ctx.ui.notify("Debug session complete!", "info");
				} catch (error) {
					ctx.ui.notify(
						`Failed: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
			}
		},
	});

	// Register /trace command for quick root cause tracing
	pi.registerCommand("trace", {
		description:
			"Trace a value backwards through the call chain to find its origin",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Requires interactive mode", "error");
				return;
			}

			let value = args?.trim();
			if (!value) {
				const inputResult = await ctx.ui.input(
					"What value/error do you want to trace?",
					"e.g., empty string in projectDir, null user object, 401 error",
				);
				if (!inputResult?.trim()) {
					ctx.ui.notify("Cancelled", "info");
					return;
				}
				value = inputResult.trim();
			}

			const tracePrompt = `# Root Cause Tracing

Trace the origin of: **${value}**

## The Process

### 1. Observe the Symptom
Where does this bad value appear? What error does it cause?

### 2. Find Immediate Cause  
What code directly produces or uses this value?

### 3. Trace Backwards
Ask repeatedly: "What called this? What value was passed?"

\`\`\`
[Current location] ← receives bad value
  ↑ called by [caller 1] with value X
    ↑ called by [caller 2] with value Y
      ↑ called by [caller 3] ... ← FIND THE SOURCE
\`\`\`

### 4. Add Stack Traces if Needed
If you can't trace manually, add instrumentation:
\`\`\`typescript
console.error('DEBUG:', {
  value,
  stack: new Error().stack,
  context: relevantContext
});
\`\`\`

### 5. Find the Original Trigger
Keep tracing until you find WHERE the bad value originates.
This is where the fix belongs - not where the error appears.

---

Start by identifying where "${value}" is used, then trace backwards to find where it comes from.`;

			pi.sendUserMessage(tracePrompt);
		},
	});
}
