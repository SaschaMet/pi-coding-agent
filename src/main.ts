import process from "node:process";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  InteractiveMode,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../.pi/extensions/subagent/agents.ts";
import {
  getMissingCapabilityTools,
  loadCapabilityConfig,
  shouldEnforceCoverageAtStartup,
  validateCapabilityConfig,
} from "../.pi/extensions/capability-policy.ts";

function getSubagentExposedTools(cwd: string): string[] {
  const { agents } = discoverAgents(cwd, "both");
  return agents.flatMap((agent) => agent.tools ?? []);
}

function assertCapabilityCoverage(cwd: string, toolNames: string[]): void {
  if (!shouldEnforceCoverageAtStartup(cwd)) return;

  const capabilityConfig = loadCapabilityConfig(cwd);
  const capabilityErrors = validateCapabilityConfig(capabilityConfig);
  if (capabilityErrors.length > 0) {
    throw new Error(`Capability policy config is invalid: ${capabilityErrors.join("; ")}`);
  }

  const missing = getMissingCapabilityTools(toolNames, capabilityConfig);
  if (missing.length > 0) {
    throw new Error(`Capability coverage check failed. Missing entries for: ${missing.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const settingsManager = SettingsManager.create(cwd);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    settingsManager,
  });
  await resourceLoader.reload();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({
    cwd,
    resourceLoader,
    settingsManager,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.continueRecent(cwd),
  });

  const runtimeTools = session.getAllTools().map((tool) => tool.name);
  const subagentTools = getSubagentExposedTools(cwd);
  assertCapabilityCoverage(cwd, [...runtimeTools, ...subagentTools]);

  if (extensionsResult.errors.length > 0) {
    for (const extErr of extensionsResult.errors) {
      console.error(`[extension-load-error] ${extErr.path}: ${extErr.error}`);
    }
  }

  const mode = new InteractiveMode(session, { modelFallbackMessage });
  await mode.run();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
