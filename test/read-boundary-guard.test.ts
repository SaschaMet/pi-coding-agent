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
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-inside-"),
		);
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
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-outside-"),
		);
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
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-outside-mutate-"),
		);
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

	it("fails closed when read/write/edit path arguments are missing", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-missing-path-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const readResult = await handlers[0](
			{ toolName: "read", input: {} },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);
		expect(readResult?.reason).toContain("missing or invalid path");

		const writeResult = await handlers[0](
			{ toolName: "write", input: { content: "x" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);

		const editResult = await handlers[0](
			{ toolName: "edit", input: { path: "   " } },
			{ hasUI: false, cwd: tmp },
		);
		expect(editResult?.block).toBe(true);
	});

	it("blocks tilde paths outside current directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-tilde-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { path: "~/.claude/settings.json", content: "x" },
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);

		const readResult = await handlers[0](
			{ toolName: "read", input: { path: "~/.zshrc" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);
	});

	it("blocks $HOME paths outside current directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-home-env-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { path: "$HOME/.claude/settings.json", content: "x" },
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);

		const readResult = await handlers[0](
			{ toolName: "read", input: { path: "${HOME}/.zshrc" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);
	});

	it("allows reads from global ~/.pi directory in non-interactive mode", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-global-pi-read-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{
				toolName: "read",
				input: {
					path: path.join(os.homedir(), ".pi", "agent", "skills", "SKILL.md"),
				},
			},
			{ hasUI: false, cwd: tmp },
		);

		expect(result).toBeUndefined();
	});

	it("blocks writes and edits under global ~/.pi directory as read-only", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-global-pi-write-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: {
					path: path.join(os.homedir(), ".pi", "agent", "settings.json"),
					content: "x",
				},
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);
		expect(writeResult?.reason).toContain("read-only global PI directory");

		const editResult = await handlers[0](
			{
				toolName: "edit",
				input: {
					path: path.join(os.homedir(), ".pi", "agent", "settings.json"),
				},
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(editResult?.block).toBe(true);
		expect(editResult?.reason).toContain("read-only global PI directory");
	});

	it("supports filePath aliases when guarding outside current directory", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-filepath-"),
		);
		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const readResult = await handlers[0](
			{ toolName: "read", input: { filePath: "../outside.txt" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(readResult?.block).toBe(true);

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { filePath: "../outside.txt", content: "x" },
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(writeResult?.block).toBe(true);
	});

	it("blocks non-existent write targets that traverse symlinked outside directories", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-symlink-"),
		);
		const outside = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-outside-link-"),
		);
		fs.symlinkSync(outside, path.join(tmp, "linked-outside"));

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{
				toolName: "write",
				input: { path: "linked-outside/new-file.txt", content: "x" },
			},
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
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-ui-write-"),
		);
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

	it("allows access to paths under trusted directories from trust.json", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-"),
		);
		const trustedDir = path.join(tmp, "trusted");
		fs.mkdirSync(trustedDir, { recursive: true });
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [trustedDir] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const readResult = await handlers[0](
			{ toolName: "read", input: { path: "../trusted/file.txt" } },
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(readResult).toBeUndefined();

		const writeResult = await handlers[0](
			{
				toolName: "write",
				input: { path: "../trusted/new-file.txt", content: "x" },
			},
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(writeResult).toBeUndefined();
	});

	it("allows access to paths deeply nested under trusted directories", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-nested-"),
		);
		const trustedDir = path.join(tmp, "trusted");
		fs.mkdirSync(path.join(trustedDir, "deep", "nested"), { recursive: true });
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [trustedDir] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "../trusted/deep/nested/file.txt" } },
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(result).toBeUndefined();
	});

	it("blocks access when path is outside trusted directory", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-outside-"),
		);
		const trustedDir = path.join(tmp, "trusted");
		fs.mkdirSync(trustedDir, { recursive: true });
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [trustedDir] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "../secrets/passwords.txt" } },
			{ hasUI: false, cwd: path.join(tmp, "other") },
		);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("requires approval");
	});

	it("blocks access when trust.json is missing", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-no-trust-"),
		);
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{ toolName: "read", input: { path: "../outside.txt" } },
			{ hasUI: false, cwd: tmp },
		);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("requires approval");
	});

	it("still blocks global PI directory writes even with trust.json", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-read-boundary-trust-pi-"),
		);
		const homeDir = os.homedir();
		fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "trust.json"),
			JSON.stringify({ trustedDirectories: [homeDir] }),
		);

		const pi = createFakePi();
		readBoundaryGuardExtension(pi as any);
		const handlers = pi.handlers.get("tool_call") ?? [];

		const result = await handlers[0](
			{
				toolName: "write",
				input: {
					path: path.join(homeDir, ".pi", "agent", "settings.json"),
					content: "x",
				},
			},
			{ hasUI: false, cwd: tmp },
		);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("read-only global PI directory");
	});
});
