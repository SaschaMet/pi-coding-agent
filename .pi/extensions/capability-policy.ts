import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export type CapabilityAction = "allow" | "block" | "confirm";

export interface PathCapabilityPolicy {
    denyProtectedPaths?: boolean;
    denySearchScopeIncludingProtectedRoots?: boolean;
    confirmSearchScopeIncludingProtectedRoots?: boolean;
}

export interface BashRule {
    pattern: string;
    action: CapabilityAction;
    reason?: string;
}

export interface BashCapabilityPolicy {
    defaultAction: CapabilityAction;
    nonInteractiveConfirm: "deny" | "allow";
    rules: BashRule[];
    sensitivePatterns: string[];
    networkDenyCommands: string[];
    networkAllowPatterns: string[];
    envAllowlist: string[];
}

export interface ToolCapability {
    mode: CapabilityAction;
    nonInteractivePolicy?: "deny" | "allow";
    pathPolicy?: PathCapabilityPolicy;
    bashPolicy?: BashCapabilityPolicy;
}

export interface CapabilityConfig {
    version: number;
    defaultAction: "deny";
    protectedPathSegments: string[];
    protectedBasenames: string[];
    protectedBasenamePrefixes: string[];
    tools: Record<string, ToolCapability>;
}

export interface SecurityRuntimeConfig {
    capabilitiesFile: string;
    enforceCoverageAtStartup: boolean;
    strictSubagentLocalRuntime: boolean;
}

const DEFAULT_CAPABILITIES_FILE = ".pi/security/capabilities.json";

const DEFAULT_SECURITY_RUNTIME_CONFIG: SecurityRuntimeConfig = {
    capabilitiesFile: DEFAULT_CAPABILITIES_FILE,
    enforceCoverageAtStartup: true,
    strictSubagentLocalRuntime: true,
};

const BOOLEAN_CHAIN_OPERATOR_PATTERN = /&&|\|\|/;

interface CapabilityConfigCacheEntry {
    mtimeMs: number;
    size: number;
    config: CapabilityConfig;
}

const capabilityConfigCache = new Map<string, CapabilityConfigCacheEntry>();


export interface CapabilityDecision {
    action: CapabilityAction;
    reason?: string;
}

function resolveGlobalConfigDir(): string {
    return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function parseSecurityRuntimeConfig(configPath: string): SecurityRuntimeConfig | undefined {
    if (!fs.existsSync(configPath)) return undefined;

    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
            security?: Partial<SecurityRuntimeConfig>;
        };
        return {
            capabilitiesFile: parsed.security?.capabilitiesFile ?? DEFAULT_SECURITY_RUNTIME_CONFIG.capabilitiesFile,
            enforceCoverageAtStartup:
                typeof parsed.security?.enforceCoverageAtStartup === "boolean"
                    ? parsed.security.enforceCoverageAtStartup
                    : DEFAULT_SECURITY_RUNTIME_CONFIG.enforceCoverageAtStartup,
            strictSubagentLocalRuntime:
                typeof parsed.security?.strictSubagentLocalRuntime === "boolean"
                    ? parsed.security.strictSubagentLocalRuntime
                    : DEFAULT_SECURITY_RUNTIME_CONFIG.strictSubagentLocalRuntime,
        };
    } catch {
        return DEFAULT_SECURITY_RUNTIME_CONFIG;
    }
}

export function loadSecurityRuntimeConfig(cwd: string): SecurityRuntimeConfig {
    const localConfigPath = path.join(cwd, ".pi", "agent.config.json");
    const localConfig = parseSecurityRuntimeConfig(localConfigPath);
    if (localConfig) return localConfig;

    const globalConfigPath = path.join(resolveGlobalConfigDir(), "agent.config.json");
    const globalConfig = parseSecurityRuntimeConfig(globalConfigPath);
    if (globalConfig) return globalConfig;

    return DEFAULT_SECURITY_RUNTIME_CONFIG;
}

function resolveCapabilitiesPath(cwd: string): string {
    const localConfigPath = path.join(cwd, ".pi", "agent.config.json");
    if (fs.existsSync(localConfigPath)) {
        const localConfig = loadSecurityRuntimeConfig(cwd);
        return path.isAbsolute(localConfig.capabilitiesFile)
            ? localConfig.capabilitiesFile
            : path.join(cwd, localConfig.capabilitiesFile);
    }

    const globalConfigDir = resolveGlobalConfigDir();
    const globalCapabilitiesPath = path.join(globalConfigDir, "security", "capabilities.json");
    if (fs.existsSync(globalCapabilitiesPath)) return globalCapabilitiesPath;

    const fallbackConfig = loadSecurityRuntimeConfig(cwd);
    return path.isAbsolute(fallbackConfig.capabilitiesFile)
        ? fallbackConfig.capabilitiesFile
        : path.join(cwd, fallbackConfig.capabilitiesFile);
}

export function loadCapabilityConfig(cwd: string): CapabilityConfig {
    const capabilitiesPath = resolveCapabilitiesPath(cwd);

    return loadCapabilityConfigFromPath(capabilitiesPath);
}

function loadCapabilityConfigFromPath(capabilitiesPath: string): CapabilityConfig {

    if (!fs.existsSync(capabilitiesPath)) {
        throw new Error(
            `Capability policy file is missing: ${capabilitiesPath}. Restore it or set security.capabilitiesFile in .pi/agent.config.json.`,
        );
    }

    let parsed: CapabilityConfig;
    try {
        parsed = JSON.parse(fs.readFileSync(capabilitiesPath, "utf-8")) as CapabilityConfig;
    } catch {
        throw new Error(
            `Capability policy file contains invalid JSON: ${capabilitiesPath}. Fix JSON syntax before starting the runtime.`,
        );
    }

    const validationErrors = validateCapabilityConfig(parsed);
    if (validationErrors.length > 0) {
        throw new Error(`Capability policy config is invalid (${capabilitiesPath}): ${validationErrors.join("; ")}`);
    }

    return parsed;
}

export function loadCapabilityConfigCached(cwd: string): CapabilityConfig {
    const capabilitiesPath = resolveCapabilitiesPath(cwd);

    if (!fs.existsSync(capabilitiesPath)) {
        throw new Error(
            `Capability policy file is missing: ${capabilitiesPath}. Restore it or set security.capabilitiesFile in .pi/agent.config.json.`,
        );
    }

    const stat = fs.statSync(capabilitiesPath);
    const cached = capabilityConfigCache.get(capabilitiesPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.config;
    }

    const parsed = loadCapabilityConfigFromPath(capabilitiesPath);
    capabilityConfigCache.set(capabilitiesPath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        config: parsed,
    });
    return parsed;
}

export function clearCapabilityConfigCache(): void {
    capabilityConfigCache.clear();
}

export function validateCapabilityConfig(config: CapabilityConfig): string[] {
    const errors: string[] = [];
    if (config.defaultAction !== "deny") {
        errors.push("defaultAction must be 'deny'");
    }
    if (!Number.isFinite(config.version) || config.version < 1) {
        errors.push("version must be a positive number");
    }
    if (!Array.isArray(config.protectedPathSegments)) {
        errors.push("protectedPathSegments must be an array");
    }
    if (!Array.isArray(config.protectedBasenames)) {
        errors.push("protectedBasenames must be an array");
    }
    if (!Array.isArray(config.protectedBasenamePrefixes)) {
        errors.push("protectedBasenamePrefixes must be an array");
    }
    if (!config.tools || typeof config.tools !== "object") {
        errors.push("tools map is required");
    }
    for (const [toolName, cap] of Object.entries(config.tools ?? {})) {
        if (!cap || !cap.mode) {
            errors.push(`tool '${toolName}' must declare a mode`);
        }
        if (toolName === "bash" && !cap.bashPolicy) {
            errors.push("bash tool must declare bashPolicy");
        }
    }
    return errors;
}

export function getMissingCapabilityTools(toolNames: string[], config: CapabilityConfig): string[] {
    const unique = [...new Set(toolNames)];
    return unique.filter((toolName) => !config.tools[toolName]);
}

export function getToolCapability(toolName: string, config: CapabilityConfig): ToolCapability | undefined {
    return config.tools[toolName];
}

function resolvePathFromCwd(rawPath: string, cwd: string): string {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) return path.resolve(cwd);
    return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(cwd, trimmed);
}

function isProtectedLeafPath(targetPath: string, config: CapabilityConfig): boolean {
    const normalized = path.normalize(targetPath);
    const segments = normalized.split(path.sep).filter(Boolean);
    if (segments.some((segment) => config.protectedPathSegments.includes(segment))) {
        return true;
    }

    const base = path.basename(normalized);
    if (config.protectedBasenames.includes(base)) return true;
    return config.protectedBasenamePrefixes.some((prefix) => base.startsWith(prefix));
}

function isSameOrParent(parentPath: string, childPath: string): boolean {
    const rel = path.relative(parentPath, childPath);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isSearchScopeIncludingProtectedRoots(targetPath: string, cwd: string, config: CapabilityConfig): boolean {
    const normalizedCwd = path.normalize(path.resolve(cwd));
    const normalizedTarget = path.normalize(targetPath);

    // Allow repo-root searches (`.`) without an extra confirmation step.
    // Protected leaf paths remain blocked by denyProtectedPaths checks.
    if (normalizedTarget === normalizedCwd) {
        return false;
    }

    const protectedRoots = [
        ...config.protectedBasenames.map((entry) => path.resolve(cwd, entry)),
        ...config.protectedPathSegments.map((entry) => path.resolve(cwd, entry)),
    ];
    return protectedRoots.some((protectedRoot) => isSameOrParent(targetPath, protectedRoot));
}

export function evaluatePathToolAccess(
    toolName: string,
    inputPath: string,
    cwd: string,
    config: CapabilityConfig,
): CapabilityDecision {
    const capability = config.tools[toolName];
    if (!capability) {
        return { action: "block", reason: `Tool '${toolName}' has no capability entry` };
    }
    if (capability.mode === "block") {
        return { action: "block", reason: `Tool '${toolName}' is blocked by capability policy` };
    }
    if (!capability.pathPolicy) {
        return { action: capability.mode };
    }

    const targetPath = resolvePathFromCwd(inputPath, cwd);
    if (capability.pathPolicy.denyProtectedPaths && isProtectedLeafPath(targetPath, config)) {
        if (toolName === "read") {
            return { action: "confirm", reason: `Path '${inputPath}' requires confirmation` };
        }
        return { action: "block", reason: `Path '${inputPath}' is protected` };
    }

    if (toolName === "grep" || toolName === "find") {
        const includesProtectedRoots = isSearchScopeIncludingProtectedRoots(targetPath, cwd, config);
        if (capability.pathPolicy.confirmSearchScopeIncludingProtectedRoots && includesProtectedRoots) {
            return { action: "confirm", reason: `Search path '${inputPath}' includes protected roots` };
        }
        if (capability.pathPolicy.denySearchScopeIncludingProtectedRoots && includesProtectedRoots) {
            return { action: "block", reason: `Search path '${inputPath}' includes protected roots` };
        }
    }

    return { action: capability.mode };
}

function includesNetworkCommand(command: string, deniedCommands: string[]): string | undefined {
    for (const commandName of deniedCommands) {
        const pattern = new RegExp(`(^|[\\s;&|])${commandName}([\\s;&|]|$)`, "i");
        if (pattern.test(command)) return commandName;
    }
    return undefined;
}

function splitBooleanChainedCommands(command: string): string[] {
    const segments = command
        .split(BOOLEAN_CHAIN_OPERATOR_PATTERN)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
    return segments.length > 0 ? segments : [command.trim()];
}

function evaluateBashCommandRules(
    command: string,
    hasUI: boolean,
    capability: ToolCapability & { bashPolicy: BashCapabilityPolicy },
): CapabilityDecision {
    for (const rule of capability.bashPolicy.rules) {
        if (new RegExp(rule.pattern, "i").test(command)) {
            if (rule.action === "confirm") {
                if (!hasUI && capability.bashPolicy.nonInteractiveConfirm === "deny") {
                    return {
                        action: "block",
                        reason: (rule.reason ?? "Command requires confirmation") + " (no UI for confirmation)",
                    };
                }
                return { action: "confirm", reason: rule.reason ?? "Command requires confirmation" };
            }
            return { action: rule.action, reason: rule.reason };
        }
    }

    if (capability.bashPolicy.defaultAction === "confirm") {
        if (!hasUI && capability.bashPolicy.nonInteractiveConfirm === "deny") {
            return { action: "block", reason: "Command requires confirmation (no UI for confirmation)" };
        }
        return { action: "confirm", reason: "Command requires confirmation" };
    }
    if (capability.bashPolicy.defaultAction === "block") {
        return { action: "block", reason: "Command not allowed by capability policy" };
    }
    return { action: "allow" };
}

export function evaluateBashCommand(
    command: string,
    hasUI: boolean,
    config: CapabilityConfig,
): CapabilityDecision {
    const capability = config.tools.bash;
    if (!capability || !capability.bashPolicy) {
        return { action: "block", reason: "bash tool has no capability policy" };
    }
    if (capability.mode === "block") {
        return { action: "block", reason: "bash is blocked by capability policy" };
    }

    for (const sensitivePattern of capability.bashPolicy.sensitivePatterns) {
        if (new RegExp(sensitivePattern, "i").test(command)) {
            return { action: "block", reason: "Sensitive data access command blocked by policy" };
        }
    }

    const networkCommand = includesNetworkCommand(command, capability.bashPolicy.networkDenyCommands);
    if (networkCommand) {
        const allowedByPattern = capability.bashPolicy.networkAllowPatterns.some((pattern) =>
            new RegExp(pattern, "i").test(command),
        );
        if (!allowedByPattern) {
            return { action: "block", reason: `Network command '${networkCommand}' blocked by capability policy` };
        }
    }

    let confirmDecision: CapabilityDecision | undefined;
    for (const segment of splitBooleanChainedCommands(command)) {
        const decision = evaluateBashCommandRules(segment, hasUI, capability);
        if (decision.action === "block") return decision;
        if (decision.action === "confirm" && !confirmDecision) {
            confirmDecision = decision;
        }
    }

    return confirmDecision ?? { action: "allow" };
}

export function getDefaultBashEnvAllowlist(config: CapabilityConfig): string[] {
    return config.tools.bash?.bashPolicy?.envAllowlist ?? [];
}

export function sanitizeEnvWithAllowlist(
    env: NodeJS.ProcessEnv,
    baseAllowlist: string[],
    additionalAllowed?: Set<string>,
): NodeJS.ProcessEnv {
    const allowed = new Set<string>(baseAllowlist);
    for (const key of additionalAllowed ?? []) {
        allowed.add(key);
    }

    const sanitized: NodeJS.ProcessEnv = {};
    for (const key of allowed) {
        const value = env[key];
        if (value !== undefined) sanitized[key] = value;
    }
    if (!sanitized.PWD && env.PWD) sanitized.PWD = env.PWD;
    return sanitized;
}

export function shouldEnforceCoverageAtStartup(cwd: string): boolean {
    return loadSecurityRuntimeConfig(cwd).enforceCoverageAtStartup;
}

export default function capabilityPolicyExtension(): void {
    // Intentionally empty.
    // This file primarily exposes shared capability-policy helpers that are imported by
    // other extensions and startup code. A no-op default export prevents extension-load
    // errors when PI auto-discovers all files in `.pi/extensions`.
}
