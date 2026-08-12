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
    readLastCustomEntry,
    toRepoRelative,
} from "./lib/extension-helpers.ts";
import { matchesAny, parseScopeSection } from "./lib/spec-scope.ts";

const WRITE_BOUNDARY_GUARD_REGISTERED = Symbol.for("pi.extensions.write-boundary-guard.registered");
const SCOPE_STATE_TYPE = "write-scope";

const GUARDED_TOOLS = new Set(["write", "edit"]);

/** Spec files that arm the guard when written. */
const SPEC_PATH_PATTERN = /(^|\/)docs\/specs\/spec-[^/]+\.md$/;

/** Planning artifacts the agent must always be able to maintain while armed. */
const ALWAYS_WRITABLE_PREFIXES = ["docs/specs/", "docs/research/", "docs/plans/"];

type Scope = {
    specPath: string;
    modify: string[];
    forbid: string[];
};

type GuardState = { scope: Scope | null };

const states = new WeakMap<object, GuardState>();

function getState(pi: ExtensionAPI): GuardState {
    let state = states.get(pi as object);
    if (!state) {
        state = { scope: null };
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
    if ("error" in parsed) return { error: `${parsed.error} in '${specRelativePath}'` };

    return {
        scope: {
            specPath: toRepoRelative(specRelativePath, cwd),
            modify: parsed.lists.modify,
            forbid: parsed.lists.forbid,
        },
    };
}

export default function writeBoundaryGuardExtension(pi: ExtensionAPI): void {
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
        const entry = readLastCustomEntry<{ scope?: Scope | null }>(ctx, SCOPE_STATE_TYPE);
        getState(pi).scope = entry?.data?.scope ?? null;
    };

    const armFromSpec = (specPath: string, cwd: string, origin: "command" | "auto"): void => {
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
                parsed.scope.forbid.length > 0 ? `Forbid: ${parsed.scope.forbid.join(", ")}` : "Forbid: (none)",
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

    // Auto-arm once a spec write actually lands, because a skill cannot type `/scope`.
    pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
        if (!GUARDED_TOOLS.has(event.toolName) || event.isError) return undefined;

        const targetPath = getToolPath(event.input);
        if (!targetPath) return undefined;
        if (!SPEC_PATH_PATTERN.test(toRepoRelative(targetPath, ctx.cwd))) return undefined;

        // Re-arming from a spec the agent just authored would let the work in flight
        // rewrite its own boundary. Replacing an armed scope stays a human action.
        const state = getState(pi);
        if (state.scope) {
            report(
                `[SCOPE] '${targetPath}' looks like a spec, but the scope from \`${state.scope.specPath}\` is already armed and was left in place. Run /scope off first to switch.`,
            );
            return undefined;
        }

        armFromSpec(targetPath, ctx.cwd, "auto");
        return undefined;
    });

    pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | undefined> => {
        if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

        const state = getState(pi);
        const scope = state.scope;
        if (!scope) return undefined;

        const targetPath = getToolPath(event.input as Record<string, unknown>);
        if (!targetPath) {
            return {
                block: true,
                reason: `Blocked ${event.toolName}: missing path argument, cannot check it against the armed scope in '${scope.specPath}'.`,
            };
        }

        const relativePath = toRepoRelative(targetPath, ctx.cwd);

        const reason = describeViolation(scope, targetPath, relativePath, ctx.cwd);
        if (!reason) return undefined;

        if (!ctx.hasUI) {
            return { block: true, reason: `${reason} (no UI for approval)` };
        }

        const choice = await ctx.ui.select(
            `Allow ${event.toolName} outside the armed spec scope?\n\n${reason}`,
            ["Yes", "No"],
        );
        if (choice !== "Yes") {
            return { block: true, reason: `${reason} Blocked by user.` };
        }

        return undefined;
    });

    pi.registerCommand("scope", {
        description: "Arm write boundaries from a spec's Scope section (<spec-path>|off; no argument reports status)",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const state = getState(pi);
            const requested = args.trim();

            if (requested.toLowerCase() === "off") {
                state.scope = null;
                pi.appendEntry(SCOPE_STATE_TYPE, { scope: null });
                report("[SCOPE] Write scope disarmed. Writes are unrestricted.");
                return;
            }

            if (requested.length > 0) {
                armFromSpec(requested, ctx.cwd, "command");
                return;
            }

            if (!state.scope) {
                report("[SCOPE] No write scope armed. Usage: /scope <spec-path> | /scope off");
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
 * Why this write is not allowed, or `undefined` when it is. Order matters: containment and
 * `Forbid` are decided before any allowance, so no allowlist can override a denial.
 */
function describeViolation(
    scope: Scope,
    targetPath: string,
    relativePath: string,
    cwd: string,
): string | undefined {
    if (isOutsideWorkingDirectory(targetPath, cwd)) {
        return `Path '${targetPath}' resolves outside the working directory, so the scope of spec '${scope.specPath}' cannot cover it.`;
    }

    if (matchesAny(relativePath, scope.forbid)) {
        return `Path '${relativePath}' is in the forbid list of spec '${scope.specPath}'.`;
    }

    if (relativePath === scope.specPath) return undefined;
    if (ALWAYS_WRITABLE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return undefined;
    if (matchesAny(relativePath, scope.modify)) return undefined;

    return `Path '${relativePath}' is outside the modify scope of spec '${scope.specPath}' (${scope.modify.join(", ")}).`;
}
