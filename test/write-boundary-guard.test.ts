import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import writeBoundaryGuard from "../.pi/extensions/write-boundary-guard.ts";
import { createFakePi, createFakeUi } from "./helpers/fake-pi.ts";

let tmpDir: string;

const SPEC_BODY = `# Spec: Demo

## 2. Scope

**Modify:**
- \`src/**\`
- \`package.json\`

**Call:**
- \`none\`

**Forbid:**
- \`src/secrets.ts\`

**Out of Scope:**
- everything else

## 3. Acceptance Criteria
- [ ] AC1
`;

const PLAN_BODY = `# Plan: Demo

## 2. Scope

**Modify:**
- \`src/**\`

**Forbid:**
- \`src/secrets.ts\`

## 3. Next
`;

const PLAN_WITH_GRILL_TABLE = `# Plan: Demo

## Grill Status

| # | Status |
|---|--------|
| 1 | Not run |

## 2. Scope

**Modify:**
- \`src/**\`

**Forbid:**
- \`src/secrets.ts\`

## 3. Next
`;

function writeFixture(relativePath: string, contents: string): string {
    const absolute = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
    return absolute;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
    return {
        cwd: tmpDir,
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ...overrides,
    };
}

async function toolCall(
    pi: ReturnType<typeof createFakePi>,
    toolName: string,
    input: Record<string, unknown>,
    ctx: Record<string, unknown> = makeCtx(),
) {
    const handlers = pi.handlers.get("tool_call") ?? [];
    for (const handler of handlers) {
        const result = await handler({ toolName, input }, ctx);
        if (result) return result;
    }
    return undefined;
}

async function toolResult(
    pi: ReturnType<typeof createFakePi>,
    input: Record<string, unknown>,
    options: { toolName?: string; isError?: boolean } = {},
) {
    for (const handler of pi.handlers.get("tool_result") ?? []) {
        await handler(
            {
                toolName: options.toolName ?? "write",
                input,
                isError: options.isError ?? false,
            },
            makeCtx(),
        );
    }
}

async function arm(
    pi: ReturnType<typeof createFakePi>,
    specRelativePath: string,
) {
    await pi.commands.get("scope")!.handler(specRelativePath, makeCtx());
}

function messages(pi: ReturnType<typeof createFakePi>): string {
    return pi.sentMessages
        .map((sent: any) => String(sent.message?.content ?? ""))
        .join("\n");
}

function armedGuard(spec: string = SPEC_BODY) {
    const pi = createFakePi();
    writeBoundaryGuard(pi as any);
    writeFixture("docs/specs/spec-demo.md", spec);
    return pi;
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-write-guard-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("write boundary guard extension", () => {
    it("registers the guard handlers and the /scope command", () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);

        expect(pi.handlers.get("tool_call")?.length).toBeGreaterThan(0);
        expect(pi.handlers.get("tool_result")?.length).toBeGreaterThan(0);
        expect(pi.commands.has("scope")).toBe(true);
    });

    it("allows any write while unarmed", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);

        expect(
            await toolCall(pi, "write", { path: "anywhere/at/all.ts" }),
        ).toBeUndefined();
    });

    it("allows a write inside the spec modify scope", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(
            await toolCall(pi, "write", { path: "src/nested/thing.ts" }),
        ).toBeUndefined();
        expect(
            await toolCall(pi, "edit", { path: "package.json" }),
        ).toBeUndefined();
    });

    it("blocks a write outside the spec modify scope", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "edit", {
            path: "scripts/deploy.sh",
        });
        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("scripts/deploy.sh");
        expect(result?.reason).toContain("spec-demo.md");
    });

    it("resolves the target the same way for path, file_path, and filePath", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        for (const key of ["path", "file_path", "filePath"]) {
            expect(
                await toolCall(pi, "write", { [key]: "src/thing.ts" }),
                key,
            ).toBeUndefined();
            expect(
                (await toolCall(pi, "write", { [key]: "scripts/deploy.sh" }))
                    ?.block,
                key,
            ).toBe(true);
        }
    });

    it("accepts an absolute path inside the working directory", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(
            await toolCall(pi, "write", {
                path: path.join(tmpDir, "src/thing.ts"),
            }),
        ).toBeUndefined();
    });

    it("blocks a target that resolves outside the working directory", async () => {
        const pi = armedGuard(SPEC_BODY.replace("`src/**`", "`**/*.ts`"));
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", {
            path: "../outside/config.ts",
        });
        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("outside the working directory");
    });

    it("blocks a symlink whose real target leaves the modify scope", async () => {
        const pi = armedGuard();
        writeFixture("forbidden/secret.ts", "// real file\n");
        fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
        fs.symlinkSync(
            path.join(tmpDir, "forbidden/secret.ts"),
            path.join(tmpDir, "src/link.ts"),
        );
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", { path: "src/link.ts" });
        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("forbidden/secret.ts");
    });

    it("lets forbid override modify", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", { path: "src/secrets.ts" });
        expect(result?.block).toBe(true);
        expect(result?.reason).toMatch(/forbid/i);
    });

    it("lets forbid override the always-writable planning prefixes", async () => {
        const pi = armedGuard(
            SPEC_BODY.replace("`src/secrets.ts`", "`docs/plans/**`"),
        );
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", {
            path: "docs/plans/plan-other.md",
        });
        expect(result?.block).toBe(true);
        expect(result?.reason).toMatch(/forbid/i);
    });

    it("always allows the armed spec and sibling planning artifacts", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(
            await toolCall(pi, "edit", { path: "docs/specs/spec-demo.md" }),
        ).toBeUndefined();
        expect(
            await toolCall(pi, "write", {
                path: "docs/research/research-demo.md",
            }),
        ).toBeUndefined();
        expect(
            await toolCall(pi, "write", { path: "docs/plans/plan-demo.md" }),
        ).toBeUndefined();
    });

    it("leaves read-only tools alone", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(
            await toolCall(pi, "read", { path: "scripts/deploy.sh" }),
        ).toBeUndefined();
        expect(await toolCall(pi, "grep", { path: "scripts" })).toBeUndefined();
    });

    it("auto-arms from a successful write to a spec file", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/specs/spec-auto.md", SPEC_BODY);

        await toolResult(pi, { path: "docs/specs/spec-auto.md" });

        expect(messages(pi)).toContain("spec-auto.md");
        const result = await toolCall(pi, "write", {
            path: "scripts/deploy.sh",
        });
        expect(result?.block).toBe(true);
    });

    it("does not auto-arm from a failed write", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/specs/spec-auto.md", SPEC_BODY);

        await toolResult(
            pi,
            { path: "docs/specs/spec-auto.md" },
            { isError: true },
        );

        expect(
            await toolCall(pi, "write", { path: "scripts/deploy.sh" }),
        ).toBeUndefined();
    });

    it("does not let a spec written while armed replace the active scope", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");
        writeFixture(
            "docs/specs/spec-wide.md",
            "# Spec\n\n## 2. Scope\n\n**Modify:**\n- `**`\n\n## 3. Next\n",
        );

        await toolResult(pi, { path: "docs/specs/spec-wide.md" });

        expect(messages(pi)).toMatch(/already armed/i);
        expect(
            (await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block,
        ).toBe(true);
    });

    it("auto-arms from a successful write to a plan file", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/plans/plan-auto.md", PLAN_BODY);

        await toolResult(pi, { path: "docs/plans/plan-auto.md" });

        expect(messages(pi)).toContain("plan-auto.md");
        const result = await toolCall(pi, "write", {
            path: "scripts/deploy.sh",
        });
        expect(result?.block).toBe(true);
    });

    it("does not auto-arm from a failed plan write", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/plans/plan-auto.md", PLAN_BODY);

        await toolResult(
            pi,
            { path: "docs/plans/plan-auto.md" },
            { isError: true },
        );

        expect(
            await toolCall(pi, "write", { path: "scripts/deploy.sh" }),
        ).toBeUndefined();
    });

    it("does not let a plan written while armed replace the active scope", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");
        writeFixture(
            "docs/plans/plan-wide.md",
            "# Plan\n\n## 2. Scope\n\n**Modify:**\n- `**`\n\n## 3. Next\n",
        );

        await toolResult(pi, { path: "docs/plans/plan-wide.md" });

        expect(messages(pi)).toMatch(/already armed/i);
        expect(
            (await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block,
        ).toBe(true);
    });

    it("auto-arms from a plan file that carries a Grill Status table above its Scope section", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/plans/plan-grill.md", PLAN_WITH_GRILL_TABLE);

        await toolResult(pi, { path: "docs/plans/plan-grill.md" });

        expect(messages(pi)).toContain("plan-grill.md");
        const result = await toolCall(pi, "write", {
            path: "scripts/deploy.sh",
        });
        expect(result?.block).toBe(true);
    });

    it("refuses to arm when the spec has no Scope section", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture(
            "docs/specs/spec-bad.md",
            "# Spec: Bad\n\n## 1. Intent\nNo scope here.\n",
        );

        await arm(pi, "docs/specs/spec-bad.md");

        expect(messages(pi)).toMatch(/not armed|could not/i);
        expect(
            await toolCall(pi, "write", { path: "scripts/deploy.sh" }),
        ).toBeUndefined();
    });

    it("refuses to arm when the modify list is only placeholders", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture(
            "docs/specs/spec-placeholder.md",
            "# Spec\n\n## 2. Scope\n\n**Modify:**\n- `path/to/file`\n- ...\n\n## 3. Next\n",
        );

        await arm(pi, "docs/specs/spec-placeholder.md");

        expect(messages(pi)).toMatch(/not armed|could not/i);
        expect(
            await toolCall(pi, "write", { path: "scripts/deploy.sh" }),
        ).toBeUndefined();
    });

    it("keeps the active scope armed when a later spec fails to parse", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");
        writeFixture(
            "docs/specs/spec-skeleton.md",
            "# Spec\n\n## 2. Scope\n\n**Modify:**\n- `path/to/file`\n\n## 3. Next\n",
        );

        await pi.commands
            .get("scope")!
            .handler("docs/specs/spec-skeleton.md", makeCtx());

        expect(messages(pi)).toMatch(/stays armed/i);
        expect(
            (await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block,
        ).toBe(true);
    });

    it("keeps the active scope armed when /scope names a nonexistent spec", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        await pi.commands
            .get("scope")!
            .handler("docs/specs/spec-typo.md", makeCtx());

        expect(
            (await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block,
        ).toBe(true);
    });

    it("asks for approval when a UI is available and honours yes", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        const ui = createFakeUi();
        ui.select = vi.fn(async () => "Yes");
        const result = await toolCall(
            pi,
            "write",
            { path: "scripts/deploy.sh" },
            makeCtx({ hasUI: true, ui }),
        );

        expect(ui.select).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it("blocks when the user declines the approval prompt", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        const ui = createFakeUi();
        ui.select = vi.fn(async () => "No");
        const result = await toolCall(
            pi,
            "write",
            { path: "scripts/deploy.sh" },
            makeCtx({ hasUI: true, ui }),
        );

        expect(result?.block).toBe(true);
    });

    it("disarms on /scope off", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");
        expect(
            (await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block,
        ).toBe(true);

        await pi.commands.get("scope")!.handler("off", makeCtx());

        expect(
            await toolCall(pi, "write", { path: "scripts/deploy.sh" }),
        ).toBeUndefined();
    });

    it("restores the persisted scope when the branch carries one", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        for (const handler of pi.handlers.get("session_tree") ?? []) {
            await handler(
                {},
                makeCtx({ sessionManager: { getBranch: () => pi.entries } }),
            );
        }

        expect(
            (await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block,
        ).toBe(true);
    });

    it("disarms when the branch carries no scope entry", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        for (const handler of pi.handlers.get("session_tree") ?? []) {
            await handler(
                {},
                makeCtx({ sessionManager: { getBranch: () => [] } }),
            );
        }

        expect(
            await toolCall(pi, "write", { path: "scripts/deploy.sh" }),
        ).toBeUndefined();
    });

    it("reports the active scope when /scope is called without an argument", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        await pi.commands.get("scope")!.handler("", makeCtx());

        const report = messages(pi);
        expect(report).toContain("src/**");
        expect(report).toContain("src/secrets.ts");
    });

    it("blocks a missing path argument on a guarded tool while armed", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", {});
        expect(result?.block).toBe(true);
    });
});

describe("writes to the armed spec", () => {
    const SPEC = "docs/specs/spec-demo.md";
    const NOTE =
        "\n## AI-Notes\n\n### 2026-09-25T08:00:00Z · pi · s-1 · worker · gotcha\n**Modify:**\n- `scripts/**`\n";
    const WIDER = SPEC_BODY.replace("- `package.json`\n", "- `package.json`\n- `scripts/**`\n");
    const NARROWER = SPEC_BODY.replace("- `src/secrets.ts`\n", "- `src/secrets.ts`\n- `src/env.ts`\n");
    const SCOPE_SECTION = SPEC_BODY.slice(SPEC_BODY.indexOf("## 2. Scope"), SPEC_BODY.indexOf("## 3."));

    async function armed() {
        const pi = armedGuard();
        await arm(pi, SPEC);
        return pi;
    }

    function yesUi(answer = "Yes") {
        const select = vi.fn(async (_prompt: string, _options: string[]) => answer);
        return { ...createFakeUi(), select };
    }

    /** Lands a write the guard allowed, the way the tool would. */
    async function land(pi: ReturnType<typeof createFakePi>, content: string) {
        writeFixture(SPEC, content);
        await toolResult(pi, { path: SPEC, content });
    }

    async function deployBlocked(pi: ReturnType<typeof createFakePi>) {
        return (await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block === true;
    }

    it("lets a note append through silently, even when the note holds Scope-like text", async () => {
        const pi = await armed();
        const sent = pi.sentMessages.length;

        expect(await toolCall(pi, "write", { path: SPEC, content: SPEC_BODY + NOTE })).toBeUndefined();
        await land(pi, SPEC_BODY + NOTE);

        expect(pi.sentMessages.length).toBe(sent);
        expect(await deployBlocked(pi)).toBe(true);
    });

    it("lets an edit that keeps the lists through silently, in any order", async () => {
        const pi = await armed();
        const sent = pi.sentMessages.length;
        const edits = [
            { oldText: "- `src/**`\n- `package.json`\n", newText: "- `package.json`\n- `src/**`\n" },
            { oldText: "- [ ] AC1\n", newText: "- [x] AC1\n" },
        ];

        expect(await toolCall(pi, "edit", { path: SPEC, edits })).toBeUndefined();
        await toolResult(pi, { path: SPEC, edits }, { toolName: "edit" });

        expect(pi.sentMessages.length).toBe(sent);
    });

    it("blocks a widening write without a UI and keeps the scope", async () => {
        const pi = await armed();

        const result = await toolCall(pi, "write", { path: SPEC, content: WIDER });

        expect(result?.block).toBe(true);
        expect(result?.reason).toMatch(/widens/);
        expect(await deployBlocked(pi)).toBe(true);
    });

    it("asks before a widening edit, and re-arms from the new lists on Yes", async () => {
        const pi = await armed();
        const ui = yesUi();
        const edits = [{ oldText: "- `package.json`\n", newText: "- `package.json`\n- `scripts/**`\n" }];

        const result = await toolCall(pi, "edit", { path: SPEC, edits }, makeCtx({ hasUI: true, ui }));
        expect(result).toBeUndefined();
        const prompt = String(ui.select.mock.calls[0][0]);
        expect(prompt).toMatch(/widens/);
        expect(prompt).toContain("src/**, package.json");
        expect(prompt).toContain("src/**, package.json, scripts/**");

        writeFixture(SPEC, WIDER);
        await toolResult(pi, { path: SPEC, edits }, { toolName: "edit" });

        expect(messages(pi)).toMatch(/widens[\s\S]*re-grill/i);
        expect(await deployBlocked(pi)).toBe(false);
        expect(pi.entries.at(-1)?.data?.scope?.modify).toEqual(["src/**", "package.json", "scripts/**"]);
    });

    it("labels removing a Forbid entry as widening", async () => {
        const pi = await armed();
        const ui = yesUi("No");
        const content = SPEC_BODY.replace("**Forbid:**\n- `src/secrets.ts`\n", "**Forbid:**\n");

        const result = await toolCall(pi, "write", { path: SPEC, content }, makeCtx({ hasUI: true, ui }));

        expect(String(ui.select.mock.calls[0][0])).toMatch(/widens/);
        expect(result?.block).toBe(true);
    });

    it("re-arms a narrowing change on Yes and asks for an Amendment", async () => {
        const pi = await armed();

        const result = await toolCall(pi, "write", { path: SPEC, content: NARROWER }, makeCtx({ hasUI: true, ui: yesUi() }));
        expect(result).toBeUndefined();
        await land(pi, NARROWER);

        expect(messages(pi)).toMatch(/narrows[\s\S]*Amendment/);
        expect((await toolCall(pi, "write", { path: "src/env.ts" }))?.block).toBe(true);
    });

    it("keeps the scope when the user answers No", async () => {
        const pi = await armed();

        const result = await toolCall(pi, "write", { path: SPEC, content: WIDER }, makeCtx({ hasUI: true, ui: yesUi("No") }));

        expect(result?.block).toBe(true);
        expect(await deployBlocked(pi)).toBe(true);
    });

    it("keeps the scope when an approved write fails", async () => {
        const pi = await armed();
        await toolCall(pi, "write", { path: SPEC, content: WIDER }, makeCtx({ hasUI: true, ui: yesUi() }));

        await toolResult(pi, { path: SPEC, content: WIDER }, { isError: true });

        expect(await deployBlocked(pi)).toBe(true);
    });

    it("keeps the scope when the file on disk does not match the approved lists", async () => {
        const pi = await armed();
        await toolCall(pi, "write", { path: SPEC, content: NARROWER }, makeCtx({ hasUI: true, ui: yesUi() }));

        await land(pi, WIDER);

        expect(await deployBlocked(pi)).toBe(true);
        expect(messages(pi)).toMatch(/stays armed/);
    });

    it("asks before an edit that deletes the Scope section, and keeps the old scope on Yes", async () => {
        const pi = await armed();
        const edits = [{ oldText: SCOPE_SECTION, newText: "" }];

        expect((await toolCall(pi, "edit", { path: SPEC, edits }))?.block).toBe(true);

        const ui = yesUi();
        expect(await toolCall(pi, "edit", { path: SPEC, edits }, makeCtx({ hasUI: true, ui }))).toBeUndefined();
        expect(String(ui.select.mock.calls[0][0])).toMatch(/stays armed/);
        await land(pi, SPEC_BODY.replace(SCOPE_SECTION, ""));

        expect(await deployBlocked(pi)).toBe(true);
    });

    it("fails closed when an edit does not match the file exactly", async () => {
        const pi = await armed();

        for (const edits of [
            [{ oldText: "not in the file", newText: "x" }],
            [{ oldText: "`", newText: "'" }],
        ]) {
            expect((await toolCall(pi, "edit", { path: SPEC, edits }))?.block).toBe(true);
        }
    });

    it("reads the legacy single-edit input shape", async () => {
        const pi = await armed();

        const result = await toolCall(pi, "edit", {
            path: SPEC,
            oldText: "- `package.json`\n",
            newText: "- `package.json`\n- `scripts/**`\n",
        });

        expect(result?.block).toBe(true);
    });

    it("still reports an already-armed scope for other planning files", async () => {
        const pi = await armed();
        writeFixture("docs/plans/plan-other.md", PLAN_BODY);

        await toolResult(pi, { path: "docs/plans/plan-other.md" });

        expect(messages(pi)).toMatch(/already armed/i);
    });
});

describe("tmp directory exemption", () => {
    // The exemption only makes sense for a working directory outside the system tmp
    // directory, so this block uses a fixture cwd under the repo (not os.tmpdir()).
    let fixturesBase: string;
    let repoCwd: string;

    const repoCtx = () => makeCtx({ cwd: repoCwd });

    const armedGuardInRepo = () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        return pi;
    };

    const armInRepo = async (pi: ReturnType<typeof createFakePi>) => {
        await pi.commands
            .get("scope")!
            .handler("docs/specs/spec-demo.md", repoCtx());
    };

    beforeEach(() => {
        const fixturesDir = path.join(process.cwd(), "test", ".fixtures");
        fs.mkdirSync(fixturesDir, { recursive: true });
        fixturesBase = fs.mkdtempSync(
            path.join(fixturesDir, "pi-write-guard-"),
        );
        repoCwd = path.join(fixturesBase, "repo");
        fs.mkdirSync(path.join(repoCwd, "docs/specs"), { recursive: true });
        fs.writeFileSync(
            path.join(repoCwd, "docs/specs/spec-demo.md"),
            SPEC_BODY,
        );
    });

    afterEach(() => {
        fs.rmSync(fixturesBase, { recursive: true, force: true });
    });

    it("allows a write to the tmp directory without approval while armed", async () => {
        const pi = armedGuardInRepo();
        await armInRepo(pi);

        const result = await toolCall(
            pi,
            "write",
            { path: path.join(os.tmpdir(), "pi-scratch", "scratch.ts") },
            repoCtx(),
        );

        expect(result).toBeUndefined();
    });

    it("does not prompt the user for a tmp write when a UI is available", async () => {
        const pi = armedGuardInRepo();
        await armInRepo(pi);

        const ui = createFakeUi();
        ui.select = vi.fn(async () => "Yes");
        const result = await toolCall(
            pi,
            "write",
            { path: path.join(os.tmpdir(), "scratch.ts") },
            makeCtx({ cwd: repoCwd, hasUI: true, ui }),
        );

        expect(result).toBeUndefined();
        expect(ui.select).not.toHaveBeenCalled();
    });

    it("allows an edit to a tmp file while armed", async () => {
        const pi = armedGuardInRepo();
        await armInRepo(pi);

        const result = await toolCall(
            pi,
            "edit",
            { path: path.join(os.tmpdir(), "pi-scratch", "scratch.ts") },
            repoCtx(),
        );

        expect(result).toBeUndefined();
    });

    it("blocks a path that escapes the tmp directory via ..", async () => {
        const pi = armedGuardInRepo();
        await armInRepo(pi);

        const result = await toolCall(
            pi,
            "write",
            { path: path.join(os.tmpdir(), "..", "outside-tmp.ts") },
            repoCtx(),
        );

        expect(result?.block).toBe(true);
    });

    it("blocks a symlink inside the tmp directory whose real target leaves it", async () => {
        const pi = armedGuardInRepo();
        await armInRepo(pi);

        const realTarget = path.join(fixturesBase, "real-target.ts");
        fs.writeFileSync(realTarget, "// real file\n");
        const link = path.join(
            os.tmpdir(),
            `pi-write-guard-scratch-link-${process.pid}.ts`,
        );
        fs.symlinkSync(realTarget, link);

        try {
            const result = await toolCall(
                pi,
                "write",
                { path: link },
                repoCtx(),
            );
            expect(result?.block).toBe(true);
        } finally {
            fs.rmSync(link, { force: true });
        }
    });

    it("keeps blocking sibling tmp writes when the working directory is inside the tmp directory", async () => {
        // The default fixture cwd (tmpDir) is inside os.tmpdir(): the exemption must stay
        // inactive there, so a sibling of the cwd is still outside the working directory.
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", {
            path: path.join(os.tmpdir(), "pi-sibling-scratch.ts"),
        });

        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("outside the working directory");
    });
});
