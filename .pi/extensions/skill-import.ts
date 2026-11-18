import fs from "node:fs";
import path from "node:path";
import {
    getAgentDir,
    type ExtensionAPI,
    type ExtensionCommandContext,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expandHomePath, isShadowedProjectCopy } from "./lib/extension-helpers.ts";
import {
    AUDIT_TOOLS,
    buildAuditPrompt,
    findCollision,
    installStaged,
    isError,
    libraryDirOf,
    parseArgs,
    parseVerdict,
    readConfig,
    readGitProvenance,
    sanitizeSource,
    removeStaging,
    stageSkill,
    stagingRoot,
    USAGE,
    type StagedSkill,
    type Target,
} from "./lib/skill-import.ts";

const SKILL_IMPORT_REGISTERED = Symbol.for("pi.extensions.skill-import.registered");

type PendingImport = {
    staged: StagedSkill;
    libraryRepo: string;
    target: Target;
    source: string;
    commit: string | null;
    /** Tool list to put back; set only while the audit turn runs with the narrowed set. */
    savedTools: string[] | undefined;
    auditing: boolean;
    auditPrompt: string;
    /** True once the runtime reports the run that carries `auditPrompt`. */
    auditStarted: boolean;
    assistantText: string;
};

function messageText(message: unknown): string {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .map((block) =>
            block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
                ? (block as { text: string }).text
                : "",
        )
        .join("\n");
}

export default function skillImport(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[SKILL_IMPORT_REGISTERED]) return;
    guardPi[SKILL_IMPORT_REGISTERED] = true;

    // Per session: a second session in the same process must not see this import.
    let pending: PendingImport | undefined;

    const restoreTools = (): void => {
        if (pending?.savedTools) {
            const saved = pending.savedTools;
            pending.savedTools = undefined;
            pi.setActiveTools(saved);
        }
    };

    const discardPending = (): void => {
        restoreTools();
        if (pending) removeStaging(pending.staged.stagingDir);
        pending = undefined;
    };

    const refuse = (ctx: { ui: { notify: (m: string, l?: "info" | "warning" | "error") => void } }, reason: string): void => {
        ctx.ui.notify(`skill-import refused: ${reason}`, "error");
    };

    pi.on("session_start", async () => {
        discardPending();
    });

    // pi swallows sendUserMessage failures, so the only proof the audit run began is
    // this event carrying our exact prompt; any other run first means it never will.
    pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
        if (!pending?.auditing) return;
        if (event.messageType === "user" && event.prompt === pending.auditPrompt) {
            pending.auditStarted = true;
            return;
        }
        if (!pending.auditStarted) {
            discardPending();
            ctx.ui.notify("skill-import cancelled: the audit run never started", "warning");
        }
    });

    pi.on("message_end", async (event) => {
        if (!pending?.auditing || event.message.role !== "assistant") return;
        pending.assistantText += `${messageText(event.message)}\n`;
    });

    const reject = (ctx: ExtensionContext, reason: string): void => {
        if (pending) removeStaging(pending.staged.stagingDir);
        pending = undefined;
        ctx.ui.notify(`skill-import rejected: ${reason}`, "warning");
    };

    pi.on("agent_settled", async (event, ctx: ExtensionContext) => {
        if (!pending?.auditing) return;
        // Tools come back before any dialog or reject, so no path leaves the session read-only.
        restoreTools();
        const current = pending;
        if (!current.auditStarted) return reject(ctx, "audit never started");
        const verdict = event.aborted ? undefined : parseVerdict(current.assistantText);
        if (verdict !== "PASS" && verdict !== "REVIEW") {
            return reject(ctx, event.aborted ? "aborted" : (verdict ?? "no verdict"));
        }
        if (!ctx.hasUI) return reject(ctx, "no interactive session for approval");

        let approved = false;
        try {
            approved = await ctx.ui.confirm(`Install skill ${current.staged.name}?`, summary(current, verdict));
        } catch {
            approved = false;
        }
        if (!approved) return reject(ctx, "declined");

        const result = installStaged({
            staged: current.staged,
            libraryRepo: current.libraryRepo,
            target: current.target,
            source: current.source,
            commit: current.commit,
            verdict,
        });
        removeStaging(current.staged.stagingDir);
        pending = undefined;
        if (isError(result)) {
            ctx.ui.notify(`skill-import failed: ${result.error}`, "error");
            return;
        }
        ctx.ui.notify(nextSteps(current, result.installedDir), "info");
    });

    pi.registerCommand("skill-import", {
        description: "Stage, audit, and install a new skill into the skill library",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            if (!ctx.hasUI) return refuse(ctx, "needs an interactive session for approval");
            if (!ctx.isIdle()) return refuse(ctx, "agent is busy");
            if (pending) return refuse(ctx, `import of ${pending.staged.name} is still pending`);

            const config = readConfig(getAgentDir());
            if (isError(config)) return refuse(ctx, config.error);
            const { libraryRepo } = config;
            if (!isDirectory(path.join(libraryRepo, ".pi", "skill-library"))) {
                return refuse(ctx, `${path.join(libraryRepo, ".pi", "skill-library")} does not exist`);
            }

            const parsed = parseArgs(args);
            if (isError(parsed)) return refuse(ctx, parsed.error);
            const sourceDir = path.resolve(ctx.cwd, expandHomePath(parsed.sourcePath));
            if (!isDirectory(sourceDir)) return refuse(ctx, `not a directory: ${sourceDir}\n${USAGE}`);

            // Plain-text read of .git; asked before staging so a cancel leaves nothing behind.
            const provenance = readGitProvenance(sourceDir);
            let source = provenance.source;
            let isLocal = false;
            if (source === null) {
                const answer = await ctx.ui.input(
                    "Source URL of this skill (type local for a skill you wrote yourself)",
                    "https://example.com/owner/repo.git or local",
                );
                const typed = answer === undefined ? "" : sanitizeSource(answer);
                if (typed === "") return refuse(ctx, "cancelled: no source given");
                isLocal = typed === "local";
                source = typed;
            }
            if (parsed.target === "skills" && !isLocal) {
                return refuse(ctx, "third-party skills go to the library only");
            }

            const catalogue = new Set(pi.getAllTools().map((tool) => tool.name));
            const auditTools = AUDIT_TOOLS.filter((name) => catalogue.has(name));
            if (auditTools.length === 0) return refuse(ctx, "no read-only tools available for the audit");

            const staged = stageSkill(sourceDir, stagingRoot());
            if (isError(staged)) return refuse(ctx, staged.error);
            const collision = findCollision(libraryRepo, staged.name);
            if (collision) {
                removeStaging(staged.stagingDir);
                return refuse(ctx, `name taken: ${collision}`);
            }

            const flagged = staged.files.filter((file) => file.flags.length > 0);
            ctx.ui.notify(
                [
                    `skill-import: staged ${staged.name} (${staged.files.length} files)`,
                    `Tree hash: ${staged.treeSha256}`,
                    ...(flagged.length > 0
                        ? ["Flagged:", ...flagged.map((file) => `  ${file.relPath} [${file.flags.join(", ")}]`)]
                        : []),
                ].join("\n"),
                "info",
            );

            const auditPrompt = buildAuditPrompt(staged.stagingDir, staged.name, staged.treeSha256);
            pending = {
                staged,
                libraryRepo,
                target: parsed.target,
                source,
                commit: provenance.commit,
                savedTools: [...pi.getActiveTools()],
                auditing: false,
                auditPrompt,
                auditStarted: false,
                assistantText: "",
            };
            pi.setActiveTools([...auditTools]);
            pending.auditing = true;
            pi.sendUserMessage(auditPrompt);
        },
    });
}

function isDirectory(dir: string): boolean {
    try {
        return fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

function summary(pending: PendingImport, verdict: "PASS" | "REVIEW"): string {
    const { staged } = pending;
    const flagged = staged.files.filter((file) => file.flags.length > 0);
    return [
        `Verdict: ${verdict}`,
        `Skill: ${staged.name}`,
        `Tree hash: ${staged.treeSha256}`,
        `Source: ${pending.source}`,
        `Commit: ${pending.commit ?? "unknown"}`,
        `Files: ${staged.files.length} files`,
        `Flagged: ${flagged.length > 0 ? flagged.map((file) => `${file.relPath} [${file.flags.join(", ")}]`).join("; ") : "none"}`,
        `Installs to: ${targetPath(pending.libraryRepo, pending.target, staged.name)}`,
    ].join("\n");
}

function nextSteps(pending: PendingImport, installedDir: string): string {
    const { name } = pending.staged;
    return [
        `skill-import: installed ${name} at ${installedDir}`,
        "Next steps (you):",
        ...(pending.target === "library"
            ? [`  1. Add an index row to .pi/skill-library/AGENTS.md, for example: | <topic> | \`${name}\` |`]
            : []),
        "  2. Check the relative links inside the skill resolve against its own folder.",
        `  3. Review the files, then commit them in ${pending.libraryRepo}.`,
        "  4. Run `npm run pi:sync-global` in a normal terminal, then restart pi.",
    ].join("\n");
}

function targetPath(libraryRepo: string, target: Target, name: string): string {
    return path.join(libraryDirOf(libraryRepo, target), name);
}
