// CLI for the package patches in `.pi/patches/` (synced to `<agentDir>/patches/`).
// Usage: tsx scripts/pi-package-patches.ts check|apply
// Exit codes: 0 all applied or absent, 1 a patch is needed, 2 a patch conflicts.
import {
    applyPatch,
    formatStatus,
    getAgentDir,
    listPatches,
    runCheck,
} from "../.pi/extensions/lib/package-patches.ts";

const command = process.argv[2];
if (command !== "check" && command !== "apply") {
    console.error("usage: pi-package-patches.ts check|apply");
    process.exit(64);
}

const agentDir = getAgentDir();
if (command === "apply") {
    for (const file of listPatches(agentDir)) applyPatch(agentDir, file, process.cwd());
}

const { statuses, exitCode } = runCheck(agentDir, process.cwd());
if (statuses.length === 0) console.log(`no patches in ${agentDir}/patches`);
for (const status of statuses) console.log(formatStatus(status));
process.exit(exitCode);
