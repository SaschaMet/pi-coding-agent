import { loadProjectAgentConfig } from "./agent-config.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface LocalhostBridgeConfig {
    enabled: boolean;
    hostAlias: string;
    allowedPorts: number[];
}

const DEFAULT_LOCALHOST_BRIDGE_CONFIG: LocalhostBridgeConfig = {
    enabled: false,
    hostAlias: "host.docker.internal",
    allowedPorts: [],
};

function isContainerRuntime(argv: string[] = process.argv.slice(2)): boolean {
    let containerEnabled = false;
    for (const token of argv) {
        if (token === "--container") containerEnabled = true;
        if (token === "--no-container" || token === "--noc") containerEnabled = false;
    }
    return containerEnabled;
}

function normalizePortList(rawPorts: unknown): number[] {
    if (!Array.isArray(rawPorts)) return [];
    const ports = rawPorts
        .map((port) => (typeof port === "number" ? port : Number.parseInt(String(port), 10)))
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
    return Array.from(new Set(ports)).sort((a, b) => a - b);
}

export function loadLocalhostBridgeConfig(cwd: string): LocalhostBridgeConfig {
    const parsed = loadProjectAgentConfig<{
        localhostBridge?: {
            enabled?: boolean;
            hostAlias?: string;
            allowedPorts?: unknown;
        };
    }>(cwd);

    const enabled =
        typeof parsed?.localhostBridge?.enabled === "boolean"
            ? parsed.localhostBridge.enabled
            : DEFAULT_LOCALHOST_BRIDGE_CONFIG.enabled;
    const hostAlias =
        typeof parsed?.localhostBridge?.hostAlias === "string" && parsed.localhostBridge.hostAlias.trim().length > 0
            ? parsed.localhostBridge.hostAlias.trim()
            : DEFAULT_LOCALHOST_BRIDGE_CONFIG.hostAlias;
    const allowedPorts = normalizePortList(parsed?.localhostBridge?.allowedPorts);

    return {
        enabled,
        hostAlias,
        allowedPorts,
    };
}

export function rewriteLoopbackUrlForSandbox(rawUrl: string, cwd: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid URL: ${rawUrl}`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
    }

    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
        return parsed;
    }

    if (!isContainerRuntime()) {
        return parsed;
    }

    const config = loadLocalhostBridgeConfig(cwd);
    if (!config.enabled) {
        throw new Error(
            `Loopback URL blocked in sandboxed HTTP fetches: ${parsed.hostname}. Enable localhostBridge in .pi/agent.config.json.`,
        );
    }

    const effectivePort = parsed.port.length > 0 ? Number.parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
    if (!config.allowedPorts.includes(effectivePort)) {
        throw new Error(
            `Loopback port ${effectivePort} is not allowlisted for sandbox access. Allowed ports: ${config.allowedPorts.join(", ") || "(none)"}.`,
        );
    }

    parsed.hostname = config.hostAlias;
    return parsed;
}
