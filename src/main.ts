import { existsSync } from "node:fs";
import process from "node:process";
import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  InteractiveMode,
  type SessionContext,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { SessionEstablishedEvent } from "./session-established-event.ts";
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

  const missing = getMissingCapabilityTools(toolNames, capabilityConfig, cwd);
  if (missing.length > 0) {
    throw new Error(`Capability coverage check failed. Missing entries for: ${missing.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const authStorage = AuthStorage.create();
  const sessionManager = SessionManager.continueRecent(cwd);
  const sessionFile = sessionManager.getSessionFile();
  const didLoadExistingSessionFile = sessionFile !== undefined && existsSync(sessionFile);

  let sessionEstablishedEmitted = false;
  const runtime = await createAgentSessionRuntime(
    async ({ cwd: runtimeCwd, agentDir, sessionManager: runtimeSessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd: runtimeCwd,
        agentDir,
        authStorage,
      });

      const created = await createAgentSessionFromServices({
        services,
        sessionManager: runtimeSessionManager,
        sessionStartEvent,
      });

      const session = created.session;
      const originalBindExtensions = session.bindExtensions.bind(session);
      session.bindExtensions = async (bindings: Parameters<typeof originalBindExtensions>[0]) => {
        await originalBindExtensions(bindings);

        if (sessionEstablishedEmitted || bindings.uiContext === undefined) return;

        const ctx: SessionContext = session.sessionManager.buildSessionContext();
        const reason: "new" | "resume" = didLoadExistingSessionFile ? "resume" : "new";
        const event: SessionEstablishedEvent = {
          type: "session_established",
          reason,
          ctx,
        };
        sessionEstablishedEmitted = true;
        await session.extensionRunner?.emit(event);
      };

      return {
        ...created,
        services,
        diagnostics: services.diagnostics,
      };
    },
    {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    },
  );

  const runtimeTools = runtime.session.getAllTools().map((tool) => tool.name);
  const subagentTools = getSubagentExposedTools(cwd);
  assertCapabilityCoverage(cwd, [...runtimeTools, ...subagentTools]);

  const extensionErrors = runtime.services.resourceLoader.getExtensions().errors;
  if (extensionErrors.length > 0) {
    for (const extErr of extensionErrors) {
      console.error(`[extension-load-error] ${extErr.path}: ${extErr.error}`);
    }
  }

  const mode = new InteractiveMode(runtime, { modelFallbackMessage: runtime.modelFallbackMessage });
  await mode.run();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
