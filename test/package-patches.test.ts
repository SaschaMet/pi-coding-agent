import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import packagePatches from "../.pi/extensions/package-patches.ts";
import {
    applyPatch,
    checkPatch,
    listPatches,
    runCheck,
} from "../.pi/extensions/lib/package-patches.ts";
import { asExtensionAPI, createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

const PATCH = (reviewed = "1.0.0") => `Purpose: fixture
Reviewed-Version: ${reviewed}
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
`;

let agentDir: string;
let target: string;
let patchFile: string;
const prevEnv = process.env.PI_CODING_AGENT_DIR;

const writePkg = (content: string, version = "1.0.0") => {
    const dir = path.join(agentDir, "npm", "node_modules", "pkg");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
    target = path.join(dir, "a.ts");
    fs.writeFileSync(target, content);
};

beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "package-patches-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const dir = path.join(agentDir, "patches", "pkg");
    fs.mkdirSync(dir, { recursive: true });
    patchFile = path.join(dir, "fix.patch");
    fs.writeFileSync(patchFile, PATCH());
});

afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
    if (prevEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevEnv;
});

describe("checkPatch", () => {
    it("reports needed on an unpatched file", () => {
        writePkg("one\ntwo\nthree\n");
        expect(checkPatch(agentDir, patchFile).state).toBe("needed");
    });

    it("reports applied on a patched file", () => {
        writePkg("one\nTWO\nthree\n");
        expect(checkPatch(agentDir, patchFile).state).toBe("applied");
    });

    it("reports conflict when upstream changed the patched lines", () => {
        writePkg("one\nsomething else\nthree\n");
        expect(checkPatch(agentDir, patchFile).state).toBe("conflict");
    });

    it("reports absent when the package is not installed", () => {
        expect(checkPatch(agentDir, patchFile).state).toBe("absent");
    });

    it("flags a review when the installed version differs from Reviewed-Version", () => {
        writePkg("one\nTWO\nthree\n", "1.1.0");
        const status = checkPatch(agentDir, patchFile);
        expect(status.reviewDue).toBe(true);
        expect(status.installed).toBe("1.1.0");
        expect(status.reviewed).toBe("1.0.0");
    });

    it("flags no review when versions match", () => {
        writePkg("one\nTWO\nthree\n");
        expect(checkPatch(agentDir, patchFile).reviewDue).toBe(false);
    });
});

describe("applyPatch", () => {
    it("applies a needed patch and is idempotent", () => {
        writePkg("one\ntwo\nthree\n");
        expect(applyPatch(agentDir, patchFile)).toBe("applied");
        expect(fs.readFileSync(target, "utf8")).toBe("one\nTWO\nthree\n");
        expect(applyPatch(agentDir, patchFile)).toBe("applied");
        expect(fs.readFileSync(target, "utf8")).toBe("one\nTWO\nthree\n");
    });

    it("never writes on conflict", () => {
        writePkg("one\nsomething else\nthree\n");
        expect(applyPatch(agentDir, patchFile)).toBe("conflict");
        expect(fs.readFileSync(target, "utf8")).toBe("one\nsomething else\nthree\n");
    });

    it("does not write when the package is absent", () => {
        expect(applyPatch(agentDir, patchFile)).toBe("absent");
    });
});

describe("repo config around the package", () => {
    let marker: string;

    const plantFilter = () => {
        marker = path.join(agentDir, "..", path.basename(agentDir) + "-marker");
        execFileSync("git", ["init", "-q", agentDir]);
        execFileSync("git", ["-C", agentDir, "config", "filter.x.clean", `sh -c 'touch ${marker}; cat'`]);
        fs.writeFileSync(path.join(agentDir, ".gitattributes"), "* filter=x\n");
    };

    afterEach(() => fs.rmSync(marker, { force: true }));

    it("does not run a planted repo filter while checking", () => {
        plantFilter();
        writePkg("one\ntwo\nthree\n");
        expect(checkPatch(agentDir, patchFile).state).toBe("needed");
        expect(fs.existsSync(marker)).toBe(false);
        writePkg("one\nTWO\nthree\n");
        expect(checkPatch(agentDir, patchFile).state).toBe("applied");
        expect(fs.existsSync(marker)).toBe(false);
    });

    it("does not run a planted repo filter while applying", () => {
        plantFilter();
        writePkg("one\ntwo\nthree\n");
        expect(applyPatch(agentDir, patchFile)).toBe("applied");
        expect(fs.readFileSync(target, "utf8")).toBe("one\nTWO\nthree\n");
        expect(fs.existsSync(marker)).toBe(false);
    });
});

describe("project copy", () => {
    let projectDir: string;
    const writeProjectPkg = (content: string) => {
        const dir = path.join(projectDir, ".pi", "npm", "node_modules", "pkg");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
        fs.writeFileSync(path.join(dir, "a.ts"), content);
        return path.join(dir, "a.ts");
    };

    beforeEach(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "package-patches-proj-"));
    });
    afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

    it("applies to the global and the project copy", () => {
        writePkg("one\ntwo\nthree\n");
        const projectTarget = writeProjectPkg("one\ntwo\nthree\n");
        expect(applyPatch(agentDir, patchFile, projectDir)).toBe("applied");
        expect(fs.readFileSync(target, "utf8")).toBe("one\nTWO\nthree\n");
        expect(fs.readFileSync(projectTarget, "utf8")).toBe("one\nTWO\nthree\n");
    });

    it("is needed while any copy is unpatched", () => {
        writePkg("one\nTWO\nthree\n");
        writeProjectPkg("one\ntwo\nthree\n");
        expect(checkPatch(agentDir, patchFile, projectDir).state).toBe("needed");
    });

    it("is conflict when any copy conflicts, and writes nothing there", () => {
        writePkg("one\ntwo\nthree\n");
        const projectTarget = writeProjectPkg("one\nsomething else\nthree\n");
        expect(checkPatch(agentDir, patchFile, projectDir).state).toBe("conflict");
        expect(fs.readFileSync(projectTarget, "utf8")).toBe("one\nsomething else\nthree\n");
    });

    it("ignores a missing project copy", () => {
        writePkg("one\nTWO\nthree\n");
        expect(checkPatch(agentDir, patchFile, projectDir).state).toBe("applied");
    });
});

describe("listPatches / runCheck", () => {
    it("lists patch files across package folders", () => {
        expect(listPatches(agentDir)).toEqual([patchFile]);
    });

    it("returns exit code 0, 1, 2 for applied, needed, conflict", () => {
        writePkg("one\nTWO\nthree\n");
        expect(runCheck(agentDir).exitCode).toBe(0);
        writePkg("one\ntwo\nthree\n");
        expect(runCheck(agentDir).exitCode).toBe(1);
        writePkg("one\nsomething else\nthree\n");
        expect(runCheck(agentDir).exitCode).toBe(2);
    });

    it("treats an agent dir without patches as clean", () => {
        fs.rmSync(path.join(agentDir, "patches"), { recursive: true });
        expect(runCheck(agentDir).exitCode).toBe(0);
    });
});

describe("scoped packages", () => {
    let projectDir: string;
    let scopedPatch: string;
    // node_modules keeps a scoped package one folder deeper, under its scope.
    const writeScoped = (root: string, version = "1.0.0") => {
        const dir = path.join(root, "@scope", "name");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
        fs.writeFileSync(path.join(dir, "a.ts"), "one\ntwo\nthree\n");
        return path.join(dir, "a.ts");
    };

    beforeEach(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "package-patches-proj-"));
        const dir = path.join(agentDir, "patches", "@scope", "name");
        fs.mkdirSync(dir, { recursive: true });
        scopedPatch = path.join(dir, "fix.patch");
        fs.writeFileSync(scopedPatch, PATCH());
    });
    afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

    it("lists patches of scoped and plain packages", () => {
        expect(listPatches(agentDir).sort()).toEqual([patchFile, scopedPatch].sort());
    });

    it("names the scoped package in full", () => {
        writeScoped(path.join(agentDir, "npm", "node_modules"));
        expect(checkPatch(agentDir, scopedPatch)).toMatchObject({ pkg: "@scope/name", name: "fix", state: "needed" });
    });

    it("applies to the global and the project copy of a scoped package", () => {
        const globalTarget = writeScoped(path.join(agentDir, "npm", "node_modules"));
        const projectTarget = writeScoped(path.join(projectDir, ".pi", "npm", "node_modules"));
        expect(applyPatch(agentDir, scopedPatch, projectDir)).toBe("applied");
        expect(fs.readFileSync(globalTarget, "utf8")).toBe("one\nTWO\nthree\n");
        expect(fs.readFileSync(projectTarget, "utf8")).toBe("one\nTWO\nthree\n");
    });

    it("flags a review when only the project copy is on a new version", () => {
        writeScoped(path.join(agentDir, "npm", "node_modules"));
        writeScoped(path.join(projectDir, ".pi", "npm", "node_modules"), "1.1.0");
        expect(checkPatch(agentDir, scopedPatch, projectDir)).toMatchObject({ reviewDue: true, installed: "1.1.0" });
    });

    it("keeps the plain package name for unscoped patches", () => {
        writePkg("one\nTWO\nthree\n");
        expect(checkPatch(agentDir, patchFile)).toMatchObject({ pkg: "pkg", state: "applied" });
    });
});

describe("package-patches extension", () => {
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    async function start(mode = "tui") {
        const pi = createFakePi();
        packagePatches(asExtensionAPI(pi));
        const ui = createFakeUi();
        const handlers = pi.handlers.get("session_start") ?? [];
        expect(handlers.length).toBe(1);
        await handlers[0]({ type: "session_start" }, { mode, hasUI: true, ui });
        await settle();
        return { pi, ui };
    }

    it("is silent outside the TUI", async () => {
        writePkg("one\ntwo\nthree\n");
        const { pi, ui } = await start("print");
        expect(fs.readFileSync(target, "utf8")).toBe("one\ntwo\nthree\n");
        expect(ui.notify).not.toHaveBeenCalled();
        expect(pi.sentMessages).toHaveLength(0);
    });

    it("is silent when everything is applied and reviewed", async () => {
        writePkg("one\nTWO\nthree\n");
        const { pi, ui } = await start();
        expect(ui.notify).not.toHaveBeenCalled();
        expect(pi.sentMessages).toHaveLength(0);
    });

    it("applies a needed patch and tells the user to restart", async () => {
        writePkg("one\ntwo\nthree\n");
        const { pi, ui } = await start();
        expect(fs.readFileSync(target, "utf8")).toBe("one\nTWO\nthree\n");
        expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("restart Pi"), "info");
        expect(pi.sentMessages).toHaveLength(0);
    });

    it("sends the agent a nextTurn message on conflict", async () => {
        writePkg("one\nsomething else\nthree\n");
        const { pi, ui } = await start();
        expect(pi.sentMessages).toHaveLength(1);
        expect(pi.sentMessages[0].options).toEqual({ deliverAs: "nextTurn" });
        expect(pi.sentMessages[0].message.content).toContain("package-patches skill");
        expect(ui.notify).toHaveBeenCalled();
    });

    it("sends a review message when the package version changed", async () => {
        writePkg("one\nTWO\nthree\n", "1.1.0");
        const { pi } = await start();
        expect(pi.sentMessages).toHaveLength(1);
        expect(pi.sentMessages[0].message.content).toContain("1.0.0");
        expect(pi.sentMessages[0].message.content).toContain("1.1.0");
    });

    it("turns an internal error into a warning instead of throwing", async () => {
        fs.writeFileSync(path.join(agentDir, "patches", "pkg", "bad.patch"), "x");
        fs.chmodSync(path.join(agentDir, "patches", "pkg", "bad.patch"), 0o000);
        writePkg("one\ntwo\nthree\n");
        const { ui } = await start();
        expect(ui.notify).toHaveBeenCalled();
    });
});
