import { existsSync } from "node:fs";
import process from "node:process";
import {
    createAgentSessionFromServices,
    createAgentSessionRuntime,
    createAgentSessionServices,
    getAgentDir,
    InteractiveMode,
    resolveCliModel,
    type SessionContext,
    SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionEstablishedEvent } from "./session-established-event.ts";
import { parseSessionMode, parseSessionModel, toSessionModelOptions } from "./session-mode.ts";

async function main(): Promise<void> {
    const cwd = process.cwd();
    const sessionMode = parseSessionMode(process.argv);
    const cliModel = parseSessionModel(process.argv);
    const sessionManager =
        sessionMode === "in-memory"
            ? SessionManager.inMemory(cwd)
            : SessionManager.continueRecent(cwd);
    const sessionFile = sessionManager.getSessionFile();
    const didLoadExistingSessionFile = sessionFile !== undefined && existsSync(sessionFile);

    let sessionEstablishedEmitted = false;
    const runtime = await createAgentSessionRuntime(
        async ({ cwd: runtimeCwd, agentDir, sessionManager: runtimeSessionManager, sessionStartEvent }) => {
            const services = await createAgentSessionServices({
                cwd: runtimeCwd,
                agentDir,
            });

            // Per-worker model passthrough (--model <ref>[:<level>] [--provider]),
            // thinking level included. Unknown refs fall back to the default model
            // with a warning (Fail-Safe).
            let modelOptions: Pick<
                Parameters<typeof createAgentSessionFromServices>[0],
                "model" | "thinkingLevel"
            > = {};
            if (cliModel !== undefined) {
                const resolved = resolveCliModel({
                    cliProvider: cliModel.provider,
                    cliModel: cliModel.model,
                    modelRuntime: services.modelRuntime,
                });
                modelOptions = toSessionModelOptions(resolved);
                if (resolved.error !== undefined) {
                    console.error(`[model-flag] ${resolved.error} — falling back to the default model.`);
                } else if (resolved.warning !== undefined) {
                    console.error(`[model-flag] ${resolved.warning}`);
                }
            }

            const created = await createAgentSessionFromServices({
                services,
                sessionManager: runtimeSessionManager,
                sessionStartEvent,
                ...modelOptions,
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
