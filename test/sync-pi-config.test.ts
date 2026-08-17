import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	syncManagedPiDirectory,
	copySystemMdToClaudeMd,
} from "../scripts/sync-pi-config.ts";

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("sync-pi-config", () => {
	const tmpRoots: string[] = [];

	afterEach(() => {
		for (const root of tmpRoots) {
			fs.rmSync(root, { recursive: true, force: true });
		}
		tmpRoots.length = 0;
	});

	function setupRoots(prefix: string): {
		localPiDir: string;
		globalAgentDir: string;
	} {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		tmpRoots.push(root);
		const localPiDir = path.join(root, "local", ".pi");
		const globalAgentDir = path.join(root, "global", "agent");
		fs.mkdirSync(localPiDir, { recursive: true });
		fs.mkdirSync(globalAgentDir, { recursive: true });
		return { localPiDir, globalAgentDir };
	}

	it("preserves target-only npm packages during pull and push sync", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-packages-keep-");

		writeJson(path.join(localPiDir, "settings.json"), {
			defaultProvider: "local-provider",
			packages: ["npm:pi-mcp-adapter@1.0.0"],
		});
		writeJson(path.join(globalAgentDir, "settings.json"), {
			defaultProvider: "global-provider",
			packages: ["npm:pi-mcp-adapter@2.0.0", "npm:pi-task-runner@1.0.0"],
		});

		syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		const localAfterPull = JSON.parse(
			fs.readFileSync(path.join(localPiDir, "settings.json"), "utf-8"),
		) as {
			packages: string[];
		};
		expect(localAfterPull.packages).toContain("npm:pi-mcp-adapter@1.0.0");

		writeJson(path.join(globalAgentDir, "settings.json"), {
			defaultProvider: "global-provider-2",
			packages: ["npm:pi-task-runner@1.0.0"],
		});

		syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		const globalAfterPush = JSON.parse(
			fs.readFileSync(path.join(globalAgentDir, "settings.json"), "utf-8"),
		) as {
			packages: string[];
		};
		expect(globalAfterPush.packages).toContain("npm:pi-mcp-adapter@1.0.0");
	});

	it("keeps target version when npm package spec conflicts", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-packages-conflict-",
		);

		writeJson(path.join(localPiDir, "settings.json"), {
			packages: ["npm:pi-mcp-adapter@1.0.0"],
		});
		writeJson(path.join(globalAgentDir, "settings.json"), {
			packages: ["npm:pi-mcp-adapter@2.0.0"],
		});

		syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		const localSettings = JSON.parse(
			fs.readFileSync(path.join(localPiDir, "settings.json"), "utf-8"),
		) as {
			packages: string[];
		};
		expect(localSettings.packages).toEqual(["npm:pi-mcp-adapter@1.0.0"]);
	});

	it("still mirrors non-package settings from source", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-non-packages-");

		writeJson(path.join(localPiDir, "settings.json"), {
			defaultProvider: "local-provider",
			theme: "light",
			packages: ["npm:pi-mcp-adapter@1.0.0"],
		});
		writeJson(path.join(globalAgentDir, "settings.json"), {
			defaultProvider: "global-provider",
			theme: "dark",
			packages: ["npm:pi-task-runner@1.0.0"],
		});

		syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		const globalSettings = JSON.parse(
			fs.readFileSync(path.join(globalAgentDir, "settings.json"), "utf-8"),
		) as {
			defaultProvider: string;
			theme: string;
			packages: string[];
		};

		expect(globalSettings.defaultProvider).toBe("local-provider");
		expect(globalSettings.theme).toBe("light");
		expect(globalSettings.packages).toEqual([
			"npm:pi-mcp-adapter@1.0.0",
			"npm:pi-task-runner@1.0.0",
		]);
	});

	it("falls back to byte-copy semantics when settings JSON is invalid", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-invalid-json-");

		const sourceRaw =
			'{\n  "defaultProvider": "source",\n  "packages": ["npm:pi-mcp-adapter@1.0.0"]\n}\n';
		fs.writeFileSync(
			path.join(localPiDir, "settings.json"),
			sourceRaw,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(globalAgentDir, "settings.json"),
			"{ invalid json",
			"utf-8",
		);

		syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		const targetRaw = fs.readFileSync(
			path.join(globalAgentDir, "settings.json"),
			"utf-8",
		);
		expect(targetRaw).toBe(sourceRaw);
	});

	it("merges mcp.json servers without overwriting target-only entries", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-mcp-merge-");

		writeJson(path.join(localPiDir, "mcp.json"), {
			mcpServers: {
				localOnly: { command: "local-server" },
			},
		});
		writeJson(path.join(globalAgentDir, "mcp.json"), {
			mcpServers: {
				globalOnly: { command: "global-server" },
			},
		});

		syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		const localMcp = JSON.parse(
			fs.readFileSync(path.join(localPiDir, "mcp.json"), "utf-8"),
		) as {
			mcpServers: Record<string, unknown>;
		};
		expect(localMcp.mcpServers).toEqual({
			globalOnly: { command: "global-server" },
			localOnly: { command: "local-server" },
		});
	});

	it("keeps target mcp.json server definition when names conflict", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-mcp-conflict-");

		writeJson(path.join(localPiDir, "mcp.json"), {
			mcpServers: {
				shared: { command: "local-server" },
			},
		});
		writeJson(path.join(globalAgentDir, "mcp.json"), {
			mcpServers: {
				shared: { command: "global-server" },
			},
		});

		syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		const localMcp = JSON.parse(
			fs.readFileSync(path.join(localPiDir, "mcp.json"), "utf-8"),
		) as {
			mcpServers: Record<string, unknown>;
		};
		expect(localMcp.mcpServers).toEqual({
			shared: { command: "local-server" },
		});
	});

	it("does not delete target-only mcp.json during push sync", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-mcp-target-only-",
		);

		writeJson(path.join(localPiDir, "settings.json"), {
			packages: [],
		});
		writeJson(path.join(globalAgentDir, "mcp.json"), {
			mcpServers: {
				globalOnly: { command: "global-server" },
			},
		});

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(globalAgentDir, "mcp.json"), "utf-8"),
			),
		).toEqual({
			mcpServers: {
				globalOnly: { command: "global-server" },
			},
		});
	});

	it("skips syncing models.json for both pull and push", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-models-skip-");

		writeJson(path.join(localPiDir, "models.json"), {
			localOnly: "keep-local",
		});
		writeJson(path.join(globalAgentDir, "models.json"), {
			globalOnly: "keep-global",
		});

		const pullResult = syncManagedPiDirectory(
			"pull",
			localPiDir,
			globalAgentDir,
		);
		expect(pullResult.updated.length).toBe(0);
		expect(pullResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(localPiDir, "models.json"), "utf-8"),
			),
		).toEqual({
			localOnly: "keep-local",
		});
		expect(
			JSON.parse(
				fs.readFileSync(path.join(globalAgentDir, "models.json"), "utf-8"),
			),
		).toEqual({
			globalOnly: "keep-global",
		});

		const pushResult = syncManagedPiDirectory(
			"push",
			localPiDir,
			globalAgentDir,
		);
		expect(pushResult.updated.length).toBe(0);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(localPiDir, "models.json"), "utf-8"),
			),
		).toEqual({
			localOnly: "keep-local",
		});
		expect(
			JSON.parse(
				fs.readFileSync(path.join(globalAgentDir, "models.json"), "utf-8"),
			),
		).toEqual({
			globalOnly: "keep-global",
		});
	});

	it("skips syncing trust.json for both pull and push", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-trust-skip-",
		);

		writeJson(path.join(localPiDir, "trust.json"), {
			trustedDirectories: ["/local/only/path"],
		});
		writeJson(path.join(globalAgentDir, "trust.json"), {
			trustedDirectories: ["/global/only/path"],
		});

		const pullResult = syncManagedPiDirectory(
			"pull",
			localPiDir,
			globalAgentDir,
		);
		expect(pullResult.updated.length).toBe(0);
		expect(pullResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(localPiDir, "trust.json"), "utf-8"),
			),
		).toEqual({
			trustedDirectories: ["/local/only/path"],
		});
		expect(
			JSON.parse(
				fs.readFileSync(path.join(globalAgentDir, "trust.json"), "utf-8"),
			),
		).toEqual({
			trustedDirectories: ["/global/only/path"],
		});

		const pushResult = syncManagedPiDirectory(
			"push",
			localPiDir,
			globalAgentDir,
		);
		expect(pushResult.updated.length).toBe(0);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(localPiDir, "trust.json"), "utf-8"),
			),
		).toEqual({
			trustedDirectories: ["/local/only/path"],
		});
		expect(
			JSON.parse(
				fs.readFileSync(path.join(globalAgentDir, "trust.json"), "utf-8"),
			),
		).toEqual({
			trustedDirectories: ["/global/only/path"],
		});
	});

	it("does not delete target-only trust.json during pull and push sync", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-trust-target-only-",
		);

		writeJson(path.join(localPiDir, "trust.json"), {
			trustedDirectories: ["/local/only/path"],
		});

		const pullResult = syncManagedPiDirectory(
			"pull",
			localPiDir,
			globalAgentDir,
		);
		expect(pullResult.deleted.length).toBe(0);
		expect(fs.existsSync(path.join(localPiDir, "trust.json"))).toBe(true);
		expect(
			fs.existsSync(path.join(globalAgentDir, "trust.json")),
		).toBe(false);

		writeJson(path.join(globalAgentDir, "trust.json"), {
			trustedDirectories: ["/global/only/path"],
		});

		const pushResult = syncManagedPiDirectory(
			"push",
			localPiDir,
			globalAgentDir,
		);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(globalAgentDir, "trust.json"),
					"utf-8",
				),
			),
		).toEqual({
			trustedDirectories: ["/global/only/path"],
		});
	});

	it("does not pull global extension directories into local project config", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-global-extension-dirs-",
		);
		const localPlanMode = path.join(
			localPiDir,
			"extensions",
			"plan-mode",
			"index.ts",
		);
		const globalPlanMode = path.join(
			globalAgentDir,
			"extensions",
			"plan-mode",
			"index.ts",
		);
		const localCustomExtension = path.join(
			localPiDir,
			"extensions",
			"read-boundary-guard.ts",
		);

		fs.mkdirSync(path.dirname(localPlanMode), { recursive: true });
		fs.writeFileSync(
			localPlanMode,
			"export default function localPlanMode() {}\n",
			"utf-8",
		);
		fs.mkdirSync(path.dirname(globalPlanMode), { recursive: true });
		fs.writeFileSync(
			globalPlanMode,
			"export default function globalPlanMode() {}\n",
			"utf-8",
		);
		fs.writeFileSync(
			localCustomExtension,
			"export default function readBoundaryGuard() {}\n",
			"utf-8",
		);

		const result = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		expect(result.updated.length).toBe(0);
		expect(result.directoriesRemoved.length).toBe(1);
		expect(fs.existsSync(localPlanMode)).toBe(false);
		expect(fs.existsSync(path.dirname(localPlanMode))).toBe(false);
		expect(fs.existsSync(localCustomExtension)).toBe(true);
	});

	it("does not push local extension directories that duplicate global plugin extensions", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-global-extension-dir-push-",
		);
		const localPlanMode = path.join(
			localPiDir,
			"extensions",
			"plan-mode",
			"index.ts",
		);
		const globalPlanMode = path.join(
			globalAgentDir,
			"extensions",
			"plan-mode",
			"index.ts",
		);
		const localCustomExtension = path.join(
			localPiDir,
			"extensions",
			"read-boundary-guard.ts",
		);

		fs.mkdirSync(path.dirname(localPlanMode), { recursive: true });
		fs.writeFileSync(
			localPlanMode,
			"export default function localPlanMode() {}\n",
			"utf-8",
		);
		fs.mkdirSync(path.dirname(globalPlanMode), { recursive: true });
		fs.writeFileSync(
			globalPlanMode,
			"export default function globalPlanMode() {}\n",
			"utf-8",
		);
		fs.writeFileSync(
			localCustomExtension,
			"export default function readBoundaryGuard() {}\n",
			"utf-8",
		);

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.updated.length).toBe(1);
		expect(result.directoriesRemoved.length).toBe(1);
		expect(fs.existsSync(localPlanMode)).toBe(false);
		expect(fs.readFileSync(globalPlanMode, "utf-8")).toBe(
			"export default function globalPlanMode() {}\n",
		);
		expect(
			fs.existsSync(
				path.join(globalAgentDir, "extensions", "read-boundary-guard.ts"),
			),
		).toBe(true);
	});

	describe("copySystemMdToClaudeMd", () => {
		it("returns false when SYSTEM.md does not exist", () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-no-system-"));
			tmpRoots.push(root);
			const piDir = path.join(root, ".pi");
			fs.mkdirSync(piDir, { recursive: true });

			const result = copySystemMdToClaudeMd(root);
			expect(result).toBe(false);
		});

		it("copies SYSTEM.md to CLAUDE.md when target does not exist", () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-copy-new-"));
			tmpRoots.push(root);
			const piDir = path.join(root, ".pi");
			fs.mkdirSync(piDir, { recursive: true });
			const systemMdPath = path.join(piDir, "SYSTEM.md");
			const systemMdContent = "# Test System\nContent here\n";
			fs.writeFileSync(systemMdPath, systemMdContent, "utf-8");

			// Use a fake home directory by creating a .claude dir in our temp root
			// We need to patch os.homedir for this test
			const originalHomeDir = os.homedir;
			os.homedir = () => root;

			try {
				const result = copySystemMdToClaudeMd(root);
				expect(result).toBe(true);

				const claudeMdPath = path.join(root, ".claude", "CLAUDE.md");
				expect(fs.existsSync(claudeMdPath)).toBe(true);
				expect(fs.readFileSync(claudeMdPath, "utf-8")).toBe(systemMdContent);
			} finally {
				os.homedir = originalHomeDir;
			}
		});

		it("updates CLAUDE.md when SYSTEM.md content changes", () => {
			const root = fs.mkdtempSync(
				path.join(os.tmpdir(), "pi-sync-copy-update-"),
			);
			tmpRoots.push(root);
			const piDir = path.join(root, ".pi");
			const claudeDir = path.join(root, ".claude");
			fs.mkdirSync(piDir, { recursive: true });
			fs.mkdirSync(claudeDir, { recursive: true });

			const systemMdPath = path.join(piDir, "SYSTEM.md");
			const claudeMdPath = path.join(claudeDir, "CLAUDE.md");

			fs.writeFileSync(systemMdPath, "# Old Content\n", "utf-8");
			fs.writeFileSync(claudeMdPath, "# Old Content\n", "utf-8");

			const originalHomeDir = os.homedir;
			os.homedir = () => root;

			try {
				// First call should report no change
				let result = copySystemMdToClaudeMd(root);
				expect(result).toBe(false);

				// Update SYSTEM.md
				const newContent = "# New Content\nUpdated\n";
				fs.writeFileSync(systemMdPath, newContent, "utf-8");

				// Second call should update
				result = copySystemMdToClaudeMd(root);
				expect(result).toBe(true);
				expect(fs.readFileSync(claudeMdPath, "utf-8")).toBe(newContent);
			} finally {
				os.homedir = originalHomeDir;
			}
		});

		it("returns false when SYSTEM.md content is unchanged", () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-copy-same-"));
			tmpRoots.push(root);
			const piDir = path.join(root, ".pi");
			const claudeDir = path.join(root, ".claude");
			fs.mkdirSync(piDir, { recursive: true });
			fs.mkdirSync(claudeDir, { recursive: true });

			const systemMdPath = path.join(piDir, "SYSTEM.md");
			const claudeMdPath = path.join(claudeDir, "CLAUDE.md");
			const content = "# Same Content\n";

			fs.writeFileSync(systemMdPath, content, "utf-8");
			fs.writeFileSync(claudeMdPath, content, "utf-8");

			const originalHomeDir = os.homedir;
			os.homedir = () => root;

			try {
				const result = copySystemMdToClaudeMd(root);
				expect(result).toBe(false);
			} finally {
				os.homedir = originalHomeDir;
			}
		});
	});
});
