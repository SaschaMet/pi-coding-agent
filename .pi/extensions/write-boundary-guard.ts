import fs from "node:fs";
import path from "node:path";
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
    ToolCallEvent,
    ToolCallEventResult,
    ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
    getToolPath,
    isOutsideWorkingDirectory,
    isShadowedProjectCopy,
    isWithinTempDir,
    readLastCustomEntry,
    toRepoRelative,
} from "./lib/extension-helpers.ts";
import { matchesAny, parseScopeSection } from "./lib/spec-scope.ts";

const WRITE_BOUNDARY_GUARD_REGISTERED = Symbol.for(
    "pi.extensions.write-boundary-guard.registered",
);
const SCOPE_STATE_TYPE = "write-scope";

const GUARDED_TOOLS = new Set(["write", "edit"]);

/** Planning artifacts (spec or plan files) that arm the guard when written. */
const PLANNING_PATH_PATTERN =
    /(^|\/)(docs\/specs\/spec-|docs\/plans\/plan-)[^/]+\.md$/;

/** Planning artifacts the agent must always be able to maintain while armed. */
const ALWAYS_WRITABLE_PREFIXES = [
    "docs/specs/",
    "docs/research/",
    "docs/plans/",
];

type Scope = {
    specPath: string;
    modify: string[];
    forbid: string[];
};

type ScopeLists = { modify: string[]; forbid: string[] };

type ScopeChange = "widens" | "narrows";

/** Scope edits the user approved, waiting for their write to land. */
type PendingScope = ScopeLists & { change: ScopeChange };

type GuardState = { scope: Scope | null; pending: Map<string, PendingScope> };

const states = new WeakMap<object, GuardState>();

function getState(pi: ExtensionAPI): GuardState {
    let state = states.get(pi as object);
    if (!state) {
        state = { scope: null, pending: new Map() };
        states.set(pi as object, state);
    }
    return state;
}

type ParseResult = { scope: Scope } | { error: string };

function parseSpecScope(specRelativePath: string, cwd: string): ParseResult {
    const absolute = path.isAbsolute(specRelativePath)
        ? specRelativePath
        : path.join(cwd, specRelativePath);

    let specText: string;
    try {
        specText = fs.readFileSync(absolute, "utf8");
    } catch {
        return { error: `could not read spec '${specRelativePath}'` };
    }

    const parsed = parseScopeSection(specText);
    if ("error" in parsed)
        return { error: `${parsed.error} in '${specRelativePath}'` };

    return {
        scope: {
            specPath: toRepoRelative(specRelativePath, cwd),
            modify: parsed.lists.modify,
            forbid: parsed.lists.forbid,
        },
    };
}

function pendingKey(event: unknown, relativePath: string): string {
    const id = (event as { toolCallId?: unknown }).toolCallId;
    return `${typeof id === "string" ? id : ""}|${relativePath}`;
}

const toLF = (text: string) => text.replace(/\r\n/g, "\n");

function toEdits(input: Record<string, unknown>): { oldText: string; newText: string }[] {
    const raw = Array.isArray(input.edits)
        ? input.edits
        : input.edits && typeof input.edits === "object"
          ? [input.edits]
          : [];
    const edits = [...raw, { oldText: input.oldText, newText: input.newText }];
    return edits.filter(
        (e): e is { oldText: string; newText: string } =>
            typeof e?.oldText === "string" && typeof e?.newText === "string",
    );
}

/**
 * The text a write or edit would leave on disk; `null` when the input carries nothing the
 * tool could apply. Edits match exactly, never fuzzily: a prediction that could differ
 * from what the tool writes is reported as an error, so the caller fails closed.
 */
function predictContent(
    toolName: string,
    input: Record<string, unknown>,
    absolutePath: string,
): { content: string } | { error: string } | null {
    if (toolName === "write") {
        return typeof input.content === "string" ? { content: input.content } : null;
    }
    const edits = toEdits(input);
    if (edits.length === 0) return null;

    let content: string;
    try {
        content = toLF(fs.readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
    } catch {
        return { error: "the file could not be read" };
    }
    const ranges: { start: number; end: number; text: string }[] = [];
    for (const edit of edits) {
        const oldText = toLF(edit.oldText);
        const start = oldText ? content.indexOf(oldText) : -1;
        if (start < 0 || content.indexOf(oldText, start + 1) >= 0) {
            return { error: "an edit does not match the file exactly once" };
        }
        ranges.push({ start, end: start + oldText.length, text: toLF(edit.newText) });
    }
    ranges.sort((a, b) => a.start - b.start);
    if (ranges.some((r, i) => i > 0 && r.start < ranges[i - 1].end)) {
        return { error: "edits overlap" };
    }
    for (const r of ranges.reverse()) {
        content = content.slice(0, r.start) + r.text + content.slice(r.end);
    }
    return { content };
}

/**
 * Order-insensitive. Any new Modify entry or dropped Forbid entry widens, even a
 * stricter-looking glob.
 */
function compareScope(armed: ScopeLists, next: ScopeLists): ScopeChange | "same" {
    const sameSet = (a: string[], b: string[]) =>
        new Set(a).size === new Set(b).size && a.every((p) => b.includes(p));
    if (sameSet(armed.modify, next.modify) && sameSet(armed.forbid, next.forbid)) return "same";
    const widens =
        next.modify.some((p) => !armed.modify.includes(p)) ||
        armed.forbid.some((p) => !next.forbid.includes(p));
    return widens ? "widens" : "narrows";
}

const listLine = (label: string, before: string[], after: string[]) =>
    `${label}: ${before.join(", ") || "(none)"} → ${after.join(", ") || "(none)"}`;

export default function writeBoundaryGuardExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[WRITE_BOUNDARY_GUARD_REGISTERED]) return;
    guardPi[WRITE_BOUNDARY_GUARD_REGISTERED] = true;

    const report = (content: string) => {
        pi.sendMessage(
            { customType: SCOPE_STATE_TYPE, display: true, content },
            { deliverAs: "nextTurn" },
        );
    };

    /**
     * State lives on the `pi` object and outlives a branch switch, so a branch carrying no
     * scope entry must disarm rather than inherit the previous branch's boundary.
     */
    const applyPersistedScope = (ctx: ExtensionContext) => {
        const entry = readLastCustomEntry<{ scope?: Scope | null }>(
            ctx,
            SCOPE_STATE_TYPE,
        );
        getState(pi).scope = entry?.data?.scope ?? null;
    };

    const armFromSpec = (
        specPath: string,
        cwd: string,
        origin: "command" | "auto",
    ): void => {
        const state = getState(pi);
        const parsed = parseSpecScope(specPath, cwd);

        if ("error" in parsed) {
            // Never trade an enforcing boundary for none. Failing to parse a new spec is a
            // reason to keep the current scope, not to unlock the whole repository.
            if (state.scope) {
                report(
                    `[SCOPE] Could not arm from '${specPath}': ${parsed.error}. The scope from \`${state.scope.specPath}\` stays armed.`,
                );
                return;
            }
            report(
                `[SCOPE] Write scope not armed: ${parsed.error}. Writes stay unrestricted — fix the spec's Scope section, then run /scope ${specPath}.`,
            );
            return;
        }

        state.scope = parsed.scope;
        pi.appendEntry(SCOPE_STATE_TYPE, { scope: parsed.scope });
        report(
            [
                `[SCOPE] Write scope armed from \`${parsed.scope.specPath}\`${origin === "auto" ? " (auto)" : ""}.`,
                `Modify: ${parsed.scope.modify.join(", ")}`,
                parsed.scope.forbid.length > 0
                    ? `Forbid: ${parsed.scope.forbid.join(", ")}`
                    : "Forbid: (none)",
                "Writes outside this scope are blocked. /scope off to disarm.",
            ].join("\n"),
        );
    };

    pi.on("session_start", async (_event, ctx) => {
        applyPersistedScope(ctx);
    });
    pi.on("session_tree", async (_event, ctx) => {
        applyPersistedScope(ctx);
    });

    /** Re-arms only when the file on disk holds exactly the lists the user approved. */
    const rearmFromApproved = (scope: Scope, approved: PendingScope, cwd: string) => {
        const state = getState(pi);
        const parsed = parseSpecScope(scope.specPath, cwd);
        if ("error" in parsed || compareScope(approved, parsed.scope) !== "same") {
            report(
                `[SCOPE] The Scope in \`${scope.specPath}\` on disk does not match the approved lists. The previous scope stays armed.`,
            );
            return;
        }
        state.scope = parsed.scope;
        pi.appendEntry(SCOPE_STATE_TYPE, { scope: parsed.scope });
        report(
            [
                approved.change === "widens"
                    ? `[SCOPE] Scope in \`${scope.specPath}\` widens; re-armed from the new lists. Stop and re-grill before continuing.`
                    : `[SCOPE] Scope in \`${scope.specPath}\` narrows; re-armed from the new lists. Add an Amendment.`,
                `Modify: ${parsed.scope.modify.join(", ")}`,
                `Forbid: ${parsed.scope.forbid.join(", ") || "(none)"}`,
            ].join("\n"),
        );
    };

    // Auto-arm once a spec or plan write actually lands, because a skill cannot type `/scope`.
    pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
        if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

        const targetPath = getToolPath(event.input);
        if (!targetPath) return undefined;
        const relativePath = toRepoRelative(targetPath, ctx.cwd);
        const state = getState(pi);
        const key = pendingKey(event, relativePath);
        const approved = state.pending.get(key);
        state.pending.delete(key);

        if (event.isError) return undefined;
        if (!PLANNING_PATH_PATTERN.test(relativePath)) return undefined;

        // Markers and notes land here on every step; only an approved Scope change speaks.
        if (state.scope && relativePath === state.scope.specPath) {
            if (approved) rearmFromApproved(state.scope, approved, ctx.cwd);
            return undefined;
        }

        // Re-arming from a planning artifact the agent just authored would let the work
        // in flight rewrite its own boundary. Replacing an armed scope stays a human
        // action.
        if (state.scope) {
            report(
                `[SCOPE] '${targetPath}' looks like a spec or plan, but the scope from \`${state.scope.specPath}\` is already armed and was left in place. Run /scope off first to switch.`,
            );
            return undefined;
        }

        armFromSpec(targetPath, ctx.cwd, "auto");
        return undefined;
    });

    pi.on(
        "tool_call",
        async (
            event: ToolCallEvent,
            ctx,
        ): Promise<ToolCallEventResult | undefined> => {
            if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

            const state = getState(pi);
            const scope = state.scope;
            if (!scope) return undefined;

            const targetPath = getToolPath(
                event.input as Record<string, unknown>,
            );
            if (!targetPath) {
                return {
                    block: true,
                    reason: `Blocked ${event.toolName}: missing path argument, cannot check it against the armed scope in '${scope.specPath}'.`,
                };
            }

            const relativePath = toRepoRelative(targetPath, ctx.cwd);

            const reason = describeViolation(
                scope,
                targetPath,
                relativePath,
                ctx.cwd,
            );
            if (reason) {
                if (!ctx.hasUI) {
                    return {
                        block: true,
                        reason: `${reason} (no UI for approval)`,
                    };
                }

                const choice = await ctx.ui.select(
                    `Allow ${event.toolName} outside the armed spec scope?\n\n${reason}`,
                    ["Yes", "No"],
                );
                if (choice !== "Yes") {
                    return { block: true, reason: `${reason} Blocked by user.` };
                }
            }

            if (relativePath !== scope.specPath) return undefined;
            return checkScopeChange(
                event,
                ctx,
                scope,
                path.resolve(ctx.cwd, targetPath),
            );
        },
    );

    /**
     * A write to the armed spec could rewrite the boundary it is checked against, so a
     * change to its Scope lists needs a human Yes before it lands.
     */
    const checkScopeChange = async (
        event: ToolCallEvent,
        ctx: ExtensionContext,
        scope: Scope,
        absolutePath: string,
    ): Promise<ToolCallEventResult | undefined> => {
        const predicted = predictContent(
            event.toolName,
            event.input as Record<string, unknown>,
            absolutePath,
        );
        if (!predicted) return undefined;
        const parsed =
            "error" in predicted ? predicted : parseScopeSection(predicted.content);

        const ask = async (reason: string, question: string, onYes?: () => void) => {
            if (!ctx.hasUI) {
                return { block: true, reason: `${reason} (no UI for approval)` };
            }
            const choice = await ctx.ui.select(`${question}\n\n${reason}`, ["Yes", "No"]);
            if (choice !== "Yes") {
                return { block: true, reason: `${reason} Blocked by user.` };
            }
            onYes?.();
            return undefined;
        };

        if ("error" in parsed) {
            return ask(
                `Cannot tell what this ${event.toolName} does to the Scope of the armed spec '${scope.specPath}': ${parsed.error}. The current scope stays armed.`,
                `Allow ${event.toolName} to the armed spec?`,
            );
        }

        const change = compareScope(scope, parsed.lists);
        if (change === "same") return undefined;
        return ask(
            [
                `This ${event.toolName} changes the Scope of the armed spec '${scope.specPath}'; it ${change} the scope.`,
                listLine("Modify", scope.modify, parsed.lists.modify),
                listLine("Forbid", scope.forbid, parsed.lists.forbid),
                change === "widens"
                    ? "Yes re-arms from the new lists; a widening change needs a re-grill before work continues."
                    : "Yes re-arms from the new lists; record the change as an Amendment.",
            ].join("\n"),
            `Allow ${event.toolName} to change the armed Scope?`,
            () => {
                getState(pi).pending.set(
                    pendingKey(event, scope.specPath),
                    { ...parsed.lists, change },
                );
            },
        );
    };

    pi.registerCommand("scope", {
        description:
            "Arm write boundaries from a spec's Scope section (<spec-path>|off; no argument reports status)",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const state = getState(pi);
            const requested = args.trim();

            if (requested.toLowerCase() === "off") {
                state.scope = null;
                pi.appendEntry(SCOPE_STATE_TYPE, { scope: null });
                report(
                    "[SCOPE] Write scope disarmed. Writes are unrestricted.",
                );
                return;
            }

            if (requested.length > 0) {
                armFromSpec(requested, ctx.cwd, "command");
                return;
            }

            if (!state.scope) {
                report(
                    "[SCOPE] No write scope armed. Usage: /scope <spec-path> | /scope off",
                );
                return;
            }

            report(
                [
                    `[SCOPE] Armed from \`${state.scope.specPath}\`.`,
                    `Modify: ${state.scope.modify.join(", ")}`,
                    state.scope.forbid.length > 0
                        ? `Forbid: ${state.scope.forbid.join(", ")}`
                        : "Forbid: (none)",
                ].join("\n"),
            );
        },
    });
}

/**
 * Why this write is not allowed, or `undefined` when it is. The system temp directory is
 * exempt: scratch space is outside the spec's jurisdiction, and the check runs on the
 * resolved path, so a tmp path that symlinks out of the temp directory still resolves
 * outside it and stays blocked. Order otherwise matters: containment and `Forbid` are
 * decided before any allowance, so no allowlist can override a denial.
 */
function describeViolation(
    scope: Scope,
    targetPath: string,
    relativePath: string,
    cwd: string,
): string | undefined {
    if (isWithinTempDir(targetPath, cwd)) return undefined;

    if (isOutsideWorkingDirectory(targetPath, cwd)) {
        return `Path '${targetPath}' resolves outside the working directory, so the scope of spec '${scope.specPath}' cannot cover it.`;
    }

    if (matchesAny(relativePath, scope.forbid)) {
        return `Path '${relativePath}' is in the forbid list of spec '${scope.specPath}'.`;
    }

    if (relativePath === scope.specPath) return undefined;
    if (
        ALWAYS_WRITABLE_PREFIXES.some((prefix) =>
            relativePath.startsWith(prefix),
        )
    )
        return undefined;
    if (matchesAny(relativePath, scope.modify)) return undefined;

    return `Path '${relativePath}' is outside the modify scope of spec '${scope.specPath}' (${scope.modify.join(", ")}).`;
}
