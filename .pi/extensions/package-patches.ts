/**
 * Package patch extension.
 *
 * Re-applies local patches to installed packages that an update may have
 * wiped. A patch that still fits is applied at session start. A conflict,
 * or a package version newer than the one the patch was reviewed against,
 * goes to the agent as a next-turn message so it can run the
 * package-patches skill. Never throws: a failed check must not block startup.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";
import {
    applyPatch,
    checkPatch,
    formatStatus,
    getAgentDir,
    listPatches,
} from "./lib/package-patches.ts";

const PACKAGE_PATCHES_REGISTERED = Symbol.for("pi.extensions.package-patches.registered");
const MESSAGE_TYPE = "package-patches";

function run(pi: ExtensionAPI, ctx: ExtensionContext): void {
    const agentDir = getAgentDir();
    let patched = 0;
    const attention: string[] = [];

    for (const file of listPatches(agentDir)) {
        const before = checkPatch(agentDir, file, ctx.cwd);
        let status = before;
        if (before.state === "needed" && applyPatch(agentDir, file, ctx.cwd) === "applied") {
            patched += 1;
            status = checkPatch(agentDir, file, ctx.cwd);
        }
        if (status.state === "conflict" || status.reviewDue) attention.push(formatStatus(status));
    }

    if (patched > 0) {
        ctx.ui.notify(`package-patches: patched ${patched} file(s), restart Pi`, "info");
    }
    if (attention.length > 0) {
        const content = `Package patch needs review. Run the package-patches skill.\n${attention.join("\n")}`;
        pi.sendMessage({ customType: MESSAGE_TYPE, display: true, content }, { deliverAs: "nextTurn" });
        ctx.ui.notify(content, "warning");
    }
}

export default function packagePatches(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[PACKAGE_PATCHES_REGISTERED]) return;
    guardPi[PACKAGE_PATCHES_REGISTERED] = true;

    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        setImmediate(() => {
            try {
                run(pi, ctx);
            } catch (error) {
                ctx.ui.notify(`package-patches failed: ${String(error)}`, "warning");
            }
        });
    });
}
