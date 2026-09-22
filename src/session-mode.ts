export type SessionMode = "continue-recent" | "in-memory";

export interface SessionModelSelection {
    provider?: string;
    model: string;
}

/**
 * Maps CLI argv to a session mode. `--new-session` opts into an in-memory
 * session (never written to disk, absent from the resume list) — used by
 * fleet workers so they cannot resume the orchestrator's live session.
 * Default stays "continue-recent" (unchanged behavior, Fail-Safe).
 */
export function parseSessionMode(argv: readonly string[]): SessionMode {
    return argv.includes("--new-session") ? "in-memory" : "continue-recent";
}

/**
 * Parses `--model <value>` / `--model=<value>` plus the optional `--provider`
 * companion from CLI argv, for per-worker model selection. Returns undefined
 * when no `--model` flag is present, or when the value is missing, empty, or
 * flag-like (starts with `--`) — such a value selects nothing and the default
 * model stays (provider alone selects nothing).
 * Resolution against available models happens in main via the SDK's
 * `resolveCliModel`; unknown refs fall back to the default model (Fail-Safe).
 */
export function parseSessionModel(argv: readonly string[]): SessionModelSelection | undefined {
    const value = readFlagValue(argv, "--model");
    if (value === undefined) return undefined;
    const provider = readFlagValue(argv, "--provider");
    return provider === undefined ? { model: value } : { provider, model: value };
}

/**
 * Maps a `resolveCliModel` result to the model options of
 * `createAgentSessionFromServices`, including the thinking level from a
 * `--model <ref>:<level>` suffix. No suffix → no `thinkingLevel` key, so the
 * default level stays. A resolver error → no options, so the default model and
 * level stay (Fail-Safe).
 */
export function toSessionModelOptions<M, L>(resolved: {
    model: M | undefined;
    thinkingLevel?: L;
    warning?: string | undefined;
    error: string | undefined;
}): { model?: M; thinkingLevel?: L } {
    if (resolved.error !== undefined || resolved.model === undefined) return {};
    return resolved.thinkingLevel === undefined
        ? { model: resolved.model }
        : { model: resolved.model, thinkingLevel: resolved.thinkingLevel };
}

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        let value: string | undefined;
        if (arg === flag) value = argv[i + 1];
        else if (arg?.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1);
        else continue;
        // Missing, empty, or flag-like values select nothing: swallowing a
        // following flag as the value would silently pick a wrong model (Fail-Safe).
        if (value === undefined || value === "" || value.startsWith("--")) continue;
        return value;
    }
    return undefined;
}
