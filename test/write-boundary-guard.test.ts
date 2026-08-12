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
            { toolName: options.toolName ?? "write", input, isError: options.isError ?? false },
            makeCtx(),
        );
    }
}

async function arm(pi: ReturnType<typeof createFakePi>, specRelativePath: string) {
    await pi.commands.get("scope")!.handler(specRelativePath, makeCtx());
}

function messages(pi: ReturnType<typeof createFakePi>): string {
    return pi.sentMessages.map((sent: any) => String(sent.message?.content ?? "")).join("\n");
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

        expect(await toolCall(pi, "write", { path: "anywhere/at/all.ts" })).toBeUndefined();
    });

    it("allows a write inside the spec modify scope", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(await toolCall(pi, "write", { path: "src/nested/thing.ts" })).toBeUndefined();
        expect(await toolCall(pi, "edit", { path: "package.json" })).toBeUndefined();
    });

    it("blocks a write outside the spec modify scope", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "edit", { path: "scripts/deploy.sh" });
        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("scripts/deploy.sh");
        expect(result?.reason).toContain("spec-demo.md");
    });

    it("resolves the target the same way for path, file_path, and filePath", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        for (const key of ["path", "file_path", "filePath"]) {
            expect(await toolCall(pi, "write", { [key]: "src/thing.ts" }), key).toBeUndefined();
            expect((await toolCall(pi, "write", { [key]: "scripts/deploy.sh" }))?.block, key).toBe(true);
        }
    });

    it("accepts an absolute path inside the working directory", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(await toolCall(pi, "write", { path: path.join(tmpDir, "src/thing.ts") })).toBeUndefined();
    });

    it("blocks a target that resolves outside the working directory", async () => {
        const pi = armedGuard(SPEC_BODY.replace("`src/**`", "`**/*.ts`"));
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", { path: "../outside/config.ts" });
        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("outside the working directory");
    });

    it("blocks a symlink whose real target leaves the modify scope", async () => {
        const pi = armedGuard();
        writeFixture("forbidden/secret.ts", "// real file\n");
        fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
        fs.symlinkSync(path.join(tmpDir, "forbidden/secret.ts"), path.join(tmpDir, "src/link.ts"));
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
        const pi = armedGuard(SPEC_BODY.replace("`src/secrets.ts`", "`docs/plans/**`"));
        await arm(pi, "docs/specs/spec-demo.md");

        const result = await toolCall(pi, "write", { path: "docs/plans/plan-other.md" });
        expect(result?.block).toBe(true);
        expect(result?.reason).toMatch(/forbid/i);
    });

    it("always allows the armed spec and sibling planning artifacts", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(await toolCall(pi, "edit", { path: "docs/specs/spec-demo.md" })).toBeUndefined();
        expect(await toolCall(pi, "write", { path: "docs/research/research-demo.md" })).toBeUndefined();
        expect(await toolCall(pi, "write", { path: "docs/plans/plan-demo.md" })).toBeUndefined();
    });

    it("leaves read-only tools alone", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        expect(await toolCall(pi, "read", { path: "scripts/deploy.sh" })).toBeUndefined();
        expect(await toolCall(pi, "grep", { path: "scripts" })).toBeUndefined();
    });

    it("auto-arms from a successful write to a spec file", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/specs/spec-auto.md", SPEC_BODY);

        await toolResult(pi, { path: "docs/specs/spec-auto.md" });

        expect(messages(pi)).toContain("spec-auto.md");
        const result = await toolCall(pi, "write", { path: "scripts/deploy.sh" });
        expect(result?.block).toBe(true);
    });

    it("does not auto-arm from a failed write", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/specs/spec-auto.md", SPEC_BODY);

        await toolResult(pi, { path: "docs/specs/spec-auto.md" }, { isError: true });

        expect(await toolCall(pi, "write", { path: "scripts/deploy.sh" })).toBeUndefined();
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
        expect((await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block).toBe(true);
    });

    it("refuses to arm when the spec has no Scope section", async () => {
        const pi = createFakePi();
        writeBoundaryGuard(pi as any);
        writeFixture("docs/specs/spec-bad.md", "# Spec: Bad\n\n## 1. Intent\nNo scope here.\n");

        await arm(pi, "docs/specs/spec-bad.md");

        expect(messages(pi)).toMatch(/not armed|could not/i);
        expect(await toolCall(pi, "write", { path: "scripts/deploy.sh" })).toBeUndefined();
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
        expect(await toolCall(pi, "write", { path: "scripts/deploy.sh" })).toBeUndefined();
    });

    it("keeps the active scope armed when a later spec fails to parse", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");
        writeFixture(
            "docs/specs/spec-skeleton.md",
            "# Spec\n\n## 2. Scope\n\n**Modify:**\n- `path/to/file`\n\n## 3. Next\n",
        );

        await pi.commands.get("scope")!.handler("docs/specs/spec-skeleton.md", makeCtx());

        expect(messages(pi)).toMatch(/stays armed/i);
        expect((await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block).toBe(true);
    });

    it("keeps the active scope armed when /scope names a nonexistent spec", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        await pi.commands.get("scope")!.handler("docs/specs/spec-typo.md", makeCtx());

        expect((await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block).toBe(true);
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
        expect((await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block).toBe(true);

        await pi.commands.get("scope")!.handler("off", makeCtx());

        expect(await toolCall(pi, "write", { path: "scripts/deploy.sh" })).toBeUndefined();
    });

    it("restores the persisted scope when the branch carries one", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        for (const handler of pi.handlers.get("session_tree") ?? []) {
            await handler({}, makeCtx({ sessionManager: { getBranch: () => pi.entries } }));
        }

        expect((await toolCall(pi, "write", { path: "scripts/deploy.sh" }))?.block).toBe(true);
    });

    it("disarms when the branch carries no scope entry", async () => {
        const pi = armedGuard();
        await arm(pi, "docs/specs/spec-demo.md");

        for (const handler of pi.handlers.get("session_tree") ?? []) {
            await handler({}, makeCtx({ sessionManager: { getBranch: () => [] } }));
        }

        expect(await toolCall(pi, "write", { path: "scripts/deploy.sh" })).toBeUndefined();
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
