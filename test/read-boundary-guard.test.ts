import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

describe("read boundary guard", () => {
    it("registers guard only once", () => {
        const pi = createFakePi();
        readBoundaryGuardExtension(pi as any);
        readBoundaryGuardExtension(pi as any);

        const handlers = pi.handlers.get("tool_call") ?? [];
        expect(handlers).toHaveLength(1);
    });

    it("allows read inside current directory", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-inside-"));
        const pi = createFakePi();
        readBoundaryGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const result = await handlers[0](
            { toolName: "read", input: { path: "README.md" } },
            { hasUI: false, cwd: tmp },
        );

        expect(result).toBeUndefined();
    });

    it("blocks read outside current directory in non-interactive mode", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-outside-"));
        const pi = createFakePi();
        readBoundaryGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const result = await handlers[0](
            { toolName: "read", input: { path: "../secrets.txt" } },
            { hasUI: false, cwd: tmp },
        );

        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("requires approval");
    });

    it("blocks write and edit outside current directory in non-interactive mode", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-outside-mutate-"));
        const pi = createFakePi();
        readBoundaryGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const writeResult = await handlers[0](
            { toolName: "write", input: { path: "../unsafe.txt", content: "x" } },
            { hasUI: false, cwd: tmp },
        );
        expect(writeResult?.block).toBe(true);

        const editResult = await handlers[0](
            { toolName: "edit", input: { file_path: "../unsafe.txt" } },
            { hasUI: false, cwd: tmp },
        );
        expect(editResult?.block).toBe(true);
    });

    it("blocks non-existent write targets that traverse symlinked outside directories", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-symlink-"));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-outside-link-"));
        fs.symlinkSync(outside, path.join(tmp, "linked-outside"));

        const pi = createFakePi();
        readBoundaryGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const result = await handlers[0](
            { toolName: "write", input: { path: "linked-outside/new-file.txt", content: "x" } },
            { hasUI: false, cwd: tmp },
        );

        expect(result?.block).toBe(true);
        expect(result?.reason).toContain("requires approval");
    });

    it("asks for approval for outside reads in interactive mode", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-ui-"));
        const pi = createFakePi();
        readBoundaryGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const denied = await handlers[0](
            { toolName: "read", input: { path: "../secrets.txt" } },
            {
                hasUI: true,
                cwd: tmp,
                ui: {
                    select: async () => "No",
                },
            },
        );
        expect(denied?.block).toBe(true);

        const allowed = await handlers[0](
            { toolName: "read", input: { path: "../secrets.txt" } },
            {
                hasUI: true,
                cwd: tmp,
                ui: {
                    select: async () => "Yes",
                },
            },
        );
        expect(allowed).toBeUndefined();
    });

    it("asks for approval for outside writes in interactive mode", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-boundary-ui-write-"));
        const pi = createFakePi();
        readBoundaryGuardExtension(pi as any);
        const handlers = pi.handlers.get("tool_call") ?? [];

        const denied = await handlers[0](
            { toolName: "write", input: { path: "../unsafe.txt", content: "x" } },
            {
                hasUI: true,
                cwd: tmp,
                ui: {
                    select: async () => "No",
                },
            },
        );
        expect(denied?.block).toBe(true);

        const allowed = await handlers[0](
            { toolName: "write", input: { path: "../unsafe.txt", content: "x" } },
            {
                hasUI: true,
                cwd: tmp,
                ui: {
                    select: async () => "Yes",
                },
            },
        );
        expect(allowed).toBeUndefined();
    });
});