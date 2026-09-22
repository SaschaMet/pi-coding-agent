import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    checkExtensionCompat,
    compareExtensionTrees,
    type CompatViolation,
} from "../scripts/check-extension-compat.ts";

const SDK_VERSION = "0.87.0";

function makePkg(dir: string, peerRange?: string): string {
    fs.mkdirSync(dir, { recursive: true });
    const pkg: Record<string, unknown> = { name: path.basename(dir) };
    if (peerRange !== undefined) {
        pkg.peerDependencies = { "@earendil-works/pi-coding-agent": peerRange };
    }
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    return dir;
}

function makeRoot(prefix: string, builders: Array<(root: string) => unknown>): string {
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", prefix));
    builders.forEach((build) => build(root));
    return root;
}

describe("checkExtensionCompat", () => {
    it("passes when a package's host range satisfies the installed SDK", () => {
        const root = makeRoot("compat-ok-", [
            (r) => makePkg(path.join(r, "pi-spark"), ">=0.87.0"),
        ]);
        expect(checkExtensionCompat({ dirs: [root], installedVersion: SDK_VERSION })).toEqual([]);
    });

    it("flags a package whose host range does not satisfy the installed SDK", () => {
        const root = makeRoot("compat-bad-", [
            (r) => makePkg(path.join(r, "pi-stale"), "^0.84.1"),
        ]);
        const violations = checkExtensionCompat({ dirs: [root], installedVersion: "0.82.1" });
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            name: "pi-stale",
            range: "^0.84.1",
            installedVersion: "0.82.1",
        });
    });

    it("reports a non-semver host range as a named violation (semver.satisfies returns false, no throw)", () => {
        const root = makeRoot("compat-invalid-range-", [
            (r) => makePkg(path.join(r, "pi-workspace-linked"), "workspace:*"),
        ]);
        let violations: CompatViolation[] = [];
        expect(() => {
            violations = checkExtensionCompat({ dirs: [root], installedVersion: SDK_VERSION });
        }).not.toThrow();
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            name: "pi-workspace-linked",
            range: "workspace:*",
            installedVersion: SDK_VERSION,
        });
    });

    it("skips directories without package.json and without a host range", () => {
        const root = makeRoot("compat-skip-", [
            (r) => fs.mkdirSync(path.join(r, "bare-ext"), { recursive: true }),
            (r) => makePkg(path.join(r, "no-range")),
        ]);
        expect(checkExtensionCompat({ dirs: [root], installedVersion: SDK_VERSION })).toEqual([]);
    });

    it("scans flat and scoped packages in an npm node_modules layout", () => {
        const nodeModules = makeRoot("compat-nm-", [
            (r) => makePkg(path.join(r, "pi-flat"), ">=0.84.0"),
            (r) => makePkg(path.join(r, "@scope", "pi-scoped"), ">=0.84.0"),
            (r) => makePkg(path.join(r, "pi-ok"), ">=0.82.1"),
        ]);
        const violations = checkExtensionCompat({
            dirs: [nodeModules],
            installedVersion: "0.82.1",
        });
        expect(violations.map((v: CompatViolation) => v.name).sort()).toEqual([
            "pi-flat",
            "pi-scoped",
        ]);
    });

    it("never treats a missing scan directory as an error", () => {
        expect(
            checkExtensionCompat({
                dirs: ["/nonexistent-compat-dir-for-test"],
                installedVersion: SDK_VERSION,
            }),
        ).toEqual([]);
    });
});

describe("compareExtensionTrees", () => {
    const makeTree = (dir: string, files: Record<string, string>): void => {
        for (const [rel, content] of Object.entries(files)) {
            const abs = path.join(dir, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }
    };

    it("reports no drift for identical trees", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-drift-ok-"));
        const project = path.join(root, "project");
        const global = path.join(root, "global");
        makeTree(project, { "foo.ts": "same" });
        makeTree(global, { "foo.ts": "same" });

        expect(compareExtensionTrees(project, global)).toEqual([]);
    });

    it("reports a file whose content differs", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-drift-differ-"));
        const project = path.join(root, "project");
        const global = path.join(root, "global");
        makeTree(project, { "foo.ts": "new" });
        makeTree(global, { "foo.ts": "old" });

        expect(compareExtensionTrees(project, global)).toEqual([
            { path: "foo.ts", status: "differ" },
        ]);
    });

    it("reports a file that exists only in the project", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-drift-only-"));
        const project = path.join(root, "project");
        const global = path.join(root, "global");
        makeTree(project, { "local-only.ts": "x" });
        makeTree(global, { "foo.ts": "same" });

        expect(compareExtensionTrees(project, global)).toEqual([
            { path: "local-only.ts", status: "only-project" },
        ]);
    });

    it("stays silent about files that exist only in the global tree", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-drift-global-"));
        const project = path.join(root, "project");
        const global = path.join(root, "global");
        makeTree(project, { "foo.ts": "same" });
        makeTree(global, { "foo.ts": "same", "global-only.ts": "x" });

        expect(compareExtensionTrees(project, global)).toEqual([]);
    });

    it("ignores .DS_Store and nested content equally", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-drift-ds-"));
        const project = path.join(root, "project");
        const global = path.join(root, "global");
        makeTree(project, { "foo.ts": "same", ".DS_Store": "junk" });
        makeTree(global, { "foo.ts": "same", ".DS_Store": "other-junk" });

        expect(compareExtensionTrees(project, global)).toEqual([]);
    });

    it("skips symlinks in both trees", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-drift-link-"));
        const project = path.join(root, "project");
        const global = path.join(root, "global");
        makeTree(project, { "foo.ts": "same" });
        makeTree(global, { "foo.ts": "same" });
        fs.symlinkSync(path.join(project, "foo.ts"), path.join(global, "link.ts"));

        expect(compareExtensionTrees(project, global)).toEqual([]);
    });

    it("treats a missing directory as an empty tree", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-drift-missing-"));
        const project = path.join(root, "project");
        makeTree(project, { "foo.ts": "x" });

        expect(compareExtensionTrees(project, path.join(root, "no-global"))).toEqual([
            { path: "foo.ts", status: "only-project" },
        ]);
    });
});
