/**
 * Pure prompt-cache clock logic: TTL per provider, footer text, and the
 * auto-compact decision. No pi imports and no timers, so it is testable alone.
 */

export const MINUTE_MS = 60_000;
/** Two minutes of slack before a 60-minute cache goes cold. */
export const AUTO_COMPACT_AFTER_MS = 58 * MINUTE_MS;

const LONG_TTL_MS = 60 * MINUTE_MS;
const SHORT_TTL_MS = 5 * MINUTE_MS;

export interface CacheTtl {
    ttlMs: number;
    autoCompact: boolean;
}

export interface ClockState {
    lastResponseAt?: number;
    compacted: boolean;
}

export interface AutoCompactInput {
    lastResponseAt?: number;
    attemptedFor?: number;
    compacting: boolean;
    running: boolean;
    autoCompact: boolean;
    now: number;
}

type Env = Record<string, string | undefined>;

export function cacheTtl(model: { provider?: string; api?: string } | undefined, env: Env): CacheTtl {
    if (model?.provider === "claude-bridge") return { ttlMs: LONG_TTL_MS, autoCompact: true };
    const anthropic = model?.provider === "anthropic" || model?.api === "anthropic-messages";
    if (anthropic && env.PI_CACHE_RETENTION === "long") return { ttlMs: LONG_TTL_MS, autoCompact: true };
    // Unknown clock: count the shortest common TTL and never compact (fail-safe).
    return { ttlMs: SHORT_TTL_MS, autoCompact: false };
}

export function formatCacheStatus(state: ClockState, ttlMs: number, now: number): string {
    if (state.compacted) return "cache compacted";
    if (state.lastResponseAt === undefined) return "cache none";
    const elapsed = now - state.lastResponseAt;
    if (elapsed >= ttlMs) return "cache cold";
    return `cache ${Math.floor((ttlMs - elapsed) / MINUTE_MS)}m`;
}

export function shouldAutoCompact(input: AutoCompactInput): boolean {
    const { lastResponseAt, attemptedFor, compacting, running, autoCompact, now } = input;
    if (!autoCompact || compacting || running || lastResponseAt === undefined) return false;
    // One attempt per response: a failed compaction is not retried.
    if (attemptedFor === lastResponseAt) return false;
    const elapsed = now - lastResponseAt;
    // Past the TTL the cache is already cold, so compacting saves nothing and
    // only delays the next prompt (e.g. the first tick after the machine wakes).
    return elapsed >= AUTO_COMPACT_AFTER_MS && elapsed < LONG_TTL_MS;
}

/** Per-pane sidebar key; shared key when the surface id is unknown. */
export function cmuxStatusKey(env: Env): string {
    return env.CMUX_SURFACE_ID ? `cache-clock-${env.CMUX_SURFACE_ID}` : "cache-clock";
}
