import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	syncManagedPiDirectory,
	copySystemMdToClaudeMd,
	isProjectOnlyExtensionPath,
} from "../scripts/sync-pi-config.ts";
import { fakeSecrets } from "./fixtures/security/cases.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TSX = path.join(REPO_ROOT, "node_modules/.bin/tsx");
const SYNC_SCRIPT = path.join(REPO_ROOT, "scripts/sync-pi-config.ts");

function runSyncScript(
	cwd: string,
	home: string,
	agentDir: string,
	args: string[] = ["push"],
) {
	return spawnSync(TSX, [SYNC_SCRIPT, ...args], {
		cwd,
		env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir },
		encoding: "utf8",
		timeout: 120_000,
	});
}

function listFiles(root: string): string[] {
	return fs
		.readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
}

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

	it("keeps target-only settings keys on pull and push", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-target-only-");
		const localFile = path.join(localPiDir, "settings.json");
		const globalFile = path.join(globalAgentDir, "settings.json");
		const read = (file: string) =>
			JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;

		writeJson(localFile, { defaultProvider: "local-provider" });
		writeJson(globalFile, {
			defaultProvider: "global-provider",
			extensions: ["-builtin:mcp"],
		});

		syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		const globalAfterPush = read(globalFile);
		expect(globalAfterPush.defaultProvider).toBe("local-provider");
		expect(globalAfterPush.extensions).toEqual(["-builtin:mcp"]);

		writeJson(localFile, { defaultProvider: "local", localOnly: true });
		writeJson(globalFile, { defaultProvider: "global", globalOnly: true });

		syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		const localAfterPull = read(localFile);
		expect(localAfterPull.defaultProvider).toBe("global");
		expect(localAfterPull.globalOnly).toBe(true);
		expect(localAfterPull.localOnly).toBe(true);
	});

	it("never copies lastChangelogVersion", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-changelog-key-");
		const localFile = path.join(localPiDir, "settings.json");
		const globalFile = path.join(globalAgentDir, "settings.json");
		const read = (file: string) =>
			JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;

		writeJson(localFile, { lastChangelogVersion: "0.99.2", theme: "light" });
		writeJson(globalFile, { lastChangelogVersion: "1.0.4", theme: "dark" });
		syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(read(globalFile).lastChangelogVersion).toBe("1.0.4");
		expect(read(globalFile).theme).toBe("light");

		writeJson(globalFile, { theme: "dark" });
		syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(read(globalFile)).not.toHaveProperty("lastChangelogVersion");

		writeJson(globalFile, { lastChangelogVersion: "1.0.4" });
		syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(read(localFile).lastChangelogVersion).toBe("0.99.2");
	});

	it("does not report merged JSON files as changed when only their layout differs", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-json-layout-");
		// Pi or an editor may save these files with 4-space indentation and no final newline.
		const settings = { defaultProvider: "p", packages: ["npm:pi-lens"], theme: "dark" };
		const mcp = { mcpServers: { docs: { command: "docs-mcp" } } };
		fs.writeFileSync(path.join(localPiDir, "settings.json"), JSON.stringify(settings, null, 4));
		fs.writeFileSync(path.join(localPiDir, "mcp.json"), JSON.stringify(mcp, null, 4));

		const first = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(first.updated).toEqual(expect.arrayContaining(["settings.json", "mcp.json"]));
		const second = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(second.updated).toEqual([]);
	});

	it("falls back to byte-copy semantics when settings JSON is invalid", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-invalid-json-");

		const sourceRaw =
			'{\n  "defaultProvider": "source",\n  "packages": ["npm:pi-mcp-adapter@1.0.0"]\n}\n';
		fs.writeFileSync(path.join(localPiDir, "settings.json"), sourceRaw, "utf-8");
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
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-mcp-target-only-");

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
			JSON.parse(fs.readFileSync(path.join(globalAgentDir, "mcp.json"), "utf-8")),
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

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.updated.length).toBe(0);
		expect(pullResult.deleted.length).toBe(0);
		expect(
			JSON.parse(fs.readFileSync(path.join(localPiDir, "models.json"), "utf-8")),
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

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.updated.length).toBe(0);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			JSON.parse(fs.readFileSync(path.join(localPiDir, "models.json"), "utf-8")),
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
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-trust-skip-");

		writeJson(path.join(localPiDir, "trust.json"), {
			trustedDirectories: ["/local/only/path"],
		});
		writeJson(path.join(globalAgentDir, "trust.json"), {
			trustedDirectories: ["/global/only/path"],
		});

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.updated.length).toBe(0);
		expect(pullResult.deleted.length).toBe(0);
		expect(
			JSON.parse(fs.readFileSync(path.join(localPiDir, "trust.json"), "utf-8")),
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

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.updated.length).toBe(0);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			JSON.parse(fs.readFileSync(path.join(localPiDir, "trust.json"), "utf-8")),
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

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.deleted.length).toBe(0);
		expect(fs.existsSync(path.join(localPiDir, "trust.json"))).toBe(true);
		expect(fs.existsSync(path.join(globalAgentDir, "trust.json"))).toBe(false);

		writeJson(path.join(globalAgentDir, "trust.json"), {
			trustedDirectories: ["/global/only/path"],
		});

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(globalAgentDir, "trust.json"), "utf-8"),
			),
		).toEqual({
			trustedDirectories: ["/global/only/path"],
		});
	});

	it("skips syncing mcp-project-approvals.json for both pull and push", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-mcp-approvals-skip-",
		);

		const localApprovals = {
			version: 1,
			approvals: [
				{
					projectRoot: "/local/only/root",
					serverName: "MCP_LOCAL",
					definitionHash: "local-hash",
					approvedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		const globalApprovals = {
			version: 1,
			approvals: [
				{
					projectRoot: "/global/only/root",
					serverName: "MCP_GLOBAL",
					definitionHash: "global-hash",
					approvedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};

		writeJson(path.join(localPiDir, "mcp-project-approvals.json"), localApprovals);
		writeJson(
			path.join(globalAgentDir, "mcp-project-approvals.json"),
			globalApprovals,
		);

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.updated.length).toBe(0);
		expect(pullResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(localPiDir, "mcp-project-approvals.json"),
					"utf-8",
				),
			),
		).toEqual(localApprovals);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(globalAgentDir, "mcp-project-approvals.json"),
					"utf-8",
				),
			),
		).toEqual(globalApprovals);

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.updated.length).toBe(0);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(localPiDir, "mcp-project-approvals.json"),
					"utf-8",
				),
			),
		).toEqual(localApprovals);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(globalAgentDir, "mcp-project-approvals.json"),
					"utf-8",
				),
			),
		).toEqual(globalApprovals);
	});

	it("does not delete target-only mcp-project-approvals.json during pull and push sync", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-mcp-approvals-target-only-",
		);

		const globalApprovals = {
			version: 1,
			approvals: [
				{
					projectRoot: "/global/only/root",
					serverName: "MCP_GLOBAL",
					definitionHash: "global-hash",
					approvedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		writeJson(
			path.join(globalAgentDir, "mcp-project-approvals.json"),
			globalApprovals,
		);

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.deleted.length).toBe(0);
		expect(
			fs.existsSync(path.join(localPiDir, "mcp-project-approvals.json")),
		).toBe(false);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(globalAgentDir, "mcp-project-approvals.json"),
					"utf-8",
				),
			),
		).toEqual(globalApprovals);

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.deleted.length).toBe(0);
		expect(
			fs.existsSync(path.join(localPiDir, "mcp-project-approvals.json")),
		).toBe(false);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(globalAgentDir, "mcp-project-approvals.json"),
					"utf-8",
				),
			),
		).toEqual(globalApprovals);
	});

	it("skips syncing top-level AGENTS.md for both pull and push", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-agents-md-skip-");

		fs.writeFileSync(
			path.join(localPiDir, "AGENTS.md"),
			"# local contract\n",
			"utf-8",
		);
		fs.writeFileSync(
			path.join(globalAgentDir, "AGENTS.md"),
			"# global contract\n",
			"utf-8",
		);
		fs.mkdirSync(path.join(localPiDir, "extensions"), { recursive: true });
		fs.writeFileSync(
			path.join(localPiDir, "extensions", "AGENTS.md"),
			"# nested local contract\n",
			"utf-8",
		);

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.deleted.length).toBe(0);
		expect(fs.readFileSync(path.join(localPiDir, "AGENTS.md"), "utf-8")).toBe(
			"# local contract\n",
		);
		expect(fs.readFileSync(path.join(globalAgentDir, "AGENTS.md"), "utf-8")).toBe(
			"# global contract\n",
		);

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.deleted.length).toBe(0);
		expect(pushResult.updated).toEqual(["extensions/AGENTS.md"]);
		expect(fs.readFileSync(path.join(localPiDir, "AGENTS.md"), "utf-8")).toBe(
			"# local contract\n",
		);
		expect(fs.readFileSync(path.join(globalAgentDir, "AGENTS.md"), "utf-8")).toBe(
			"# global contract\n",
		);
		expect(
			fs.readFileSync(
				path.join(globalAgentDir, "extensions", "AGENTS.md"),
				"utf-8",
			),
		).toBe("# nested local contract\n");
	});

	it("does not delete target-only AGENTS.md during pull and push sync", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-agents-md-target-only-",
		);

		fs.writeFileSync(
			path.join(localPiDir, "AGENTS.md"),
			"# local contract\n",
			"utf-8",
		);

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.deleted.length).toBe(0);
		expect(fs.existsSync(path.join(localPiDir, "AGENTS.md"))).toBe(true);
		expect(fs.existsSync(path.join(globalAgentDir, "AGENTS.md"))).toBe(false);

		fs.writeFileSync(
			path.join(globalAgentDir, "AGENTS.md"),
			"# global contract\n",
			"utf-8",
		);

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.deleted.length).toBe(0);
		expect(fs.readFileSync(path.join(globalAgentDir, "AGENTS.md"), "utf-8")).toBe(
			"# global contract\n",
		);
	});

	it("syncs skill-library files during pull, including nested AGENTS.md", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-skill-library-pull-",
		);

		const skillDir = path.join(globalAgentDir, "skill-library", "refactoring-ui");
		fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
		fs.writeFileSync(
			path.join(globalAgentDir, "skill-library", "AGENTS.md"),
			"# library index\n",
			"utf-8",
		);
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			"---\nname: refactoring-ui\n---\n",
			"utf-8",
		);
		fs.writeFileSync(
			path.join(skillDir, "references", "spacing.md"),
			"# spacing\n",
			"utf-8",
		);

		const result = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		expect(result.updated).toEqual([
			"skill-library/AGENTS.md",
			"skill-library/refactoring-ui/SKILL.md",
			"skill-library/refactoring-ui/references/spacing.md",
		]);
		expect(
			fs.readFileSync(
				path.join(localPiDir, "skill-library", "AGENTS.md"),
				"utf-8",
			),
		).toBe("# library index\n");
		expect(
			fs.readFileSync(
				path.join(localPiDir, "skill-library", "refactoring-ui", "SKILL.md"),
				"utf-8",
			),
		).toBe("---\nname: refactoring-ui\n---\n");
		expect(
			fs.readFileSync(
				path.join(
					localPiDir,
					"skill-library",
					"refactoring-ui",
					"references",
					"spacing.md",
				),
				"utf-8",
			),
		).toBe("# spacing\n");
	});

	it("syncs skill-library files during push", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-skill-library-push-",
		);

		const skillDir = path.join(localPiDir, "skill-library", "mom-test");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(localPiDir, "skill-library", "AGENTS.md"),
			"# local library index\n",
			"utf-8",
		);
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			"---\nname: mom-test\n---\n",
			"utf-8",
		);

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.updated).toEqual([
			"skill-library/AGENTS.md",
			"skill-library/mom-test/SKILL.md",
		]);
		expect(
			fs.readFileSync(
				path.join(globalAgentDir, "skill-library", "AGENTS.md"),
				"utf-8",
			),
		).toBe("# local library index\n");
		expect(
			fs.readFileSync(
				path.join(globalAgentDir, "skill-library", "mom-test", "SKILL.md"),
				"utf-8",
			),
		).toBe("---\nname: mom-test\n---\n");
	});

	it("mirrors skill-library deletions in both pull and push", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-skill-library-mirror-",
		);

		const localSkill = path.join(localPiDir, "skill-library", "local-only-skill");
		fs.mkdirSync(localSkill, { recursive: true });
		fs.writeFileSync(path.join(localSkill, "SKILL.md"), "local only\n", "utf-8");

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.deleted).toEqual([
			"skill-library/local-only-skill/SKILL.md",
		]);
		expect(fs.existsSync(path.join(localSkill, "SKILL.md"))).toBe(false);

		const globalSkill = path.join(
			globalAgentDir,
			"skill-library",
			"global-only-skill",
		);
		fs.mkdirSync(globalSkill, { recursive: true });
		fs.writeFileSync(
			path.join(globalSkill, "SKILL.md"),
			"global only\n",
			"utf-8",
		);

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.deleted).toEqual([
			"skill-library/global-only-skill/SKILL.md",
		]);
		expect(fs.existsSync(path.join(globalSkill, "SKILL.md"))).toBe(false);
	});

	it("skips syncing global runtime cache files for both pull and push", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-cache-skip-");

		const cachePaths = [
			"mcp-cache.json",
			"models-store.json",
			"pi-cache-optimizer-stats.d/stats.json",
		];

		for (const relativePath of cachePaths) {
			fs.mkdirSync(path.dirname(path.join(localPiDir, relativePath)), {
				recursive: true,
			});
			fs.mkdirSync(path.dirname(path.join(globalAgentDir, relativePath)), {
				recursive: true,
			});
			fs.writeFileSync(
				path.join(localPiDir, relativePath),
				"local cache\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(globalAgentDir, relativePath),
				"global cache\n",
				"utf-8",
			);
		}

		const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
		expect(pullResult.updated.length).toBe(0);
		expect(pullResult.deleted.length).toBe(0);

		const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		expect(pushResult.updated.length).toBe(0);
		expect(pushResult.deleted.length).toBe(0);

		for (const relativePath of cachePaths) {
			expect(fs.readFileSync(path.join(localPiDir, relativePath), "utf-8")).toBe(
				"local cache\n",
			);
			expect(
				fs.readFileSync(path.join(globalAgentDir, relativePath), "utf-8"),
			).toBe("global cache\n");
		}
	});

	it("does not delete target-only global runtime cache files during push", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-cache-target-only-",
		);

		fs.writeFileSync(
			path.join(globalAgentDir, "mcp-cache.json"),
			"{}\n",
			"utf-8",
		);
		fs.writeFileSync(
			path.join(globalAgentDir, "models-store.json"),
			"{}\n",
			"utf-8",
		);
		fs.mkdirSync(path.join(globalAgentDir, "pi-cache-optimizer-stats.d"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(globalAgentDir, "pi-cache-optimizer-stats.d", "stats.json"),
			"{}\n",
			"utf-8",
		);
		fs.writeFileSync(path.join(localPiDir, "settings.json"), "{}\n", "utf-8");

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.deleted).toEqual([]);
		expect(fs.existsSync(path.join(globalAgentDir, "mcp-cache.json"))).toBe(true);
		expect(fs.existsSync(path.join(globalAgentDir, "models-store.json"))).toBe(
			true,
		);
		expect(
			fs.existsSync(
				path.join(globalAgentDir, "pi-cache-optimizer-stats.d", "stats.json"),
			),
		).toBe(true);
	});

	it("does not delete target-only claude-bridge state during push", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-claude-bridge-target-only-",
		);

		for (const name of ["claude-bridge.json", "claude-bridge-diag.log"]) {
			fs.writeFileSync(path.join(globalAgentDir, name), "{}\n", "utf-8");
		}
		fs.writeFileSync(path.join(localPiDir, "settings.json"), "{}\n", "utf-8");

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.deleted).toEqual([]);
		expect(fs.existsSync(path.join(globalAgentDir, "claude-bridge.json"))).toBe(
			true,
		);
		expect(
			fs.existsSync(path.join(globalAgentDir, "claude-bridge-diag.log")),
		).toBe(true);
	});

	it("does not delete target-only claude-bridge sessions and the MCP upgrade marker during push", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-runtime-state-");
		fs.mkdirSync(path.join(globalAgentDir, "claude-bridge", "sessions"), { recursive: true });
		fs.writeFileSync(path.join(globalAgentDir, "claude-bridge", "sessions", "s-1.json"), "{}\n", "utf-8");
		fs.writeFileSync(path.join(globalAgentDir, "mcp-last-seen-version.json"), "{}\n", "utf-8");
		fs.writeFileSync(path.join(localPiDir, "settings.json"), "{}\n", "utf-8");

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.deleted).toEqual([]);
		expect(fs.existsSync(path.join(globalAgentDir, "claude-bridge", "sessions", "s-1.json"))).toBe(true);
		expect(fs.existsSync(path.join(globalAgentDir, "mcp-last-seen-version.json"))).toBe(true);
	});

	it("does not delete target-only zentui config and custom themes during push", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-ui-config-");
		fs.mkdirSync(path.join(globalAgentDir, "themes"), { recursive: true });
		fs.writeFileSync(path.join(globalAgentDir, "themes", "my-dark.json"), "{}\n", "utf-8");
		fs.writeFileSync(path.join(globalAgentDir, "zentui.json"), "{}\n", "utf-8");
		fs.writeFileSync(path.join(localPiDir, "settings.json"), "{}\n", "utf-8");

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.deleted).toEqual([]);
		expect(fs.existsSync(path.join(globalAgentDir, "themes", "my-dark.json"))).toBe(true);
		expect(fs.existsSync(path.join(globalAgentDir, "zentui.json"))).toBe(true);
	});

	it("does not delete target-only compact-tools notice markers during push", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-notices-");
		fs.mkdirSync(path.join(globalAgentDir, "compact-tools-notices"), { recursive: true });
		fs.writeFileSync(path.join(globalAgentDir, "compact-tools-notices", "0.14.2"), "", "utf-8");
		fs.writeFileSync(path.join(localPiDir, "settings.json"), "{}\n", "utf-8");

		const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

		expect(result.deleted).toEqual([]);
		expect(fs.existsSync(path.join(globalAgentDir, "compact-tools-notices", "0.14.2"))).toBe(true);
	});

	it("does not pull managed global extension directories into local project config", () => {
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
		fs.writeFileSync(
			path.join(globalAgentDir, "extensions", "plan-mode", ".pi-managed"),
			"",
			"utf-8",
		);

		const result = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		expect(result.updated.length).toBe(0);
		expect(result.directoriesRemoved.length).toBe(1);
		expect(fs.existsSync(localPlanMode)).toBe(false);
		expect(fs.existsSync(path.dirname(localPlanMode))).toBe(false);
		expect(fs.existsSync(localCustomExtension)).toBe(true);
	});

	it("does not push local extension directories that duplicate managed global plugin extensions", () => {
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
		fs.writeFileSync(
			path.join(globalAgentDir, "extensions", "plan-mode", ".pi-managed"),
			"",
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

	it("preserves local extension directories whose global counterpart lacks the .pi-managed marker", () => {
		const { localPiDir, globalAgentDir } = setupRoots(
			"pi-sync-unmanaged-extension-keep-",
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

		const result = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		expect(result.directoriesRemoved.length).toBe(0);
		expect(fs.existsSync(localPlanMode)).toBe(true);
	});

	it("never deletes or copies sandbox runtime state on push or pull", () => {
		const { localPiDir, globalAgentDir } = setupRoots("pi-sync-sandbox-state-");
		const liveSettings = path.join(globalAgentDir, "sandbox-run", "123-abc.json");
		const policy = path.join(globalAgentDir, "sandbox.json");
		writeJson(liveSettings, { network: {} });
		writeJson(policy, { allowedDomains: ["example.com"] });

		const pushed = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
		const pulled = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

		expect(pushed.deleted).toEqual([]);
		expect(fs.existsSync(liveSettings)).toBe(true);
		expect(fs.existsSync(policy)).toBe(true);
		expect(pulled.updated).toEqual([]);
		expect(fs.existsSync(path.join(localPiDir, "sandbox-run"))).toBe(false);
		expect(fs.existsSync(path.join(localPiDir, "sandbox.json"))).toBe(false);
	});

	describe("project-only extension files", () => {
		function writeFile(filePath: string, content: string): void {
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, content, "utf-8");
		}

		it("matches only the exact listed paths", () => {
			expect(isProjectOnlyExtensionPath("sandbox-bash.ts")).toBe(true);
			expect(isProjectOnlyExtensionPath("lib/sandbox-bash.ts")).toBe(true);
			expect(isProjectOnlyExtensionPath("sandbox-bash-extra.ts")).toBe(false);
			expect(isProjectOnlyExtensionPath("other/sandbox-bash.ts")).toBe(false);
			expect(isProjectOnlyExtensionPath("lib/sandbox-bash.ts.bak")).toBe(false);
		});

		it("push copies every extension file except the project-only ones", () => {
			const { localPiDir, globalAgentDir } = setupRoots("pi-sync-project-only-push-");
			writeFile(path.join(localPiDir, "extensions", "sandbox-bash.ts"), "sandbox\n");
			writeFile(path.join(localPiDir, "extensions", "lib", "sandbox-bash.ts"), "core\n");
			writeFile(path.join(localPiDir, "extensions", "lib", "helpers.ts"), "helpers\n");
			writeFile(path.join(localPiDir, "extensions", "gates.ts"), "gates\n");

			const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

			expect(result.updated.sort()).toEqual(["extensions/gates.ts", "extensions/lib/helpers.ts"]);
			expect(fs.existsSync(path.join(globalAgentDir, "extensions", "sandbox-bash.ts"))).toBe(false);
			expect(fs.existsSync(path.join(globalAgentDir, "extensions", "lib", "sandbox-bash.ts"))).toBe(false);
		});

		it("pull keeps the project copies unchanged, even when a global copy differs", () => {
			const { localPiDir, globalAgentDir } = setupRoots("pi-sync-project-only-pull-");
			const local = path.join(localPiDir, "extensions", "sandbox-bash.ts");
			const localLib = path.join(localPiDir, "extensions", "lib", "sandbox-bash.ts");
			writeFile(local, "project\n");
			writeFile(localLib, "project core\n");
			writeFile(path.join(globalAgentDir, "extensions", "sandbox-bash.ts"), "stale global\n");

			const result = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

			expect(result.updated).toEqual([]);
			expect(fs.readFileSync(local, "utf-8")).toBe("project\n");
			expect(fs.readFileSync(localLib, "utf-8")).toBe("project core\n");
		});

		it.each(["sandbox-bash.ts", "lib/sandbox-bash.ts"])("push neither updates nor deletes a manual global copy of %s", (file) => {
			const { localPiDir, globalAgentDir } = setupRoots("pi-sync-project-only-twin-");
			const globalCopy = path.join(globalAgentDir, "extensions", file);
			writeFile(path.join(localPiDir, "extensions", file), "project core\n");
			writeFile(globalCopy, "manual global\n");

			const result = syncManagedPiDirectory("push", localPiDir, globalAgentDir);

			expect(result.updated).toEqual([]);
			expect(result.deleted).toEqual([]);
			expect(fs.readFileSync(globalCopy, "utf-8")).toBe("manual global\n");
		});

		it.each(["push", "pull"] as const)(
			"%s keeps a local folder that holds a project-only file, even when the global folder is managed",
			(mode) => {
				const { localPiDir, globalAgentDir } = setupRoots(`pi-sync-project-only-prune-${mode}-`);
				const localLib = path.join(localPiDir, "extensions", "lib", "sandbox-bash.ts");
				writeFile(localLib, "project core\n");
				writeFile(path.join(globalAgentDir, "extensions", "lib", "helpers.ts"), "global helpers\n");
				writeFile(path.join(globalAgentDir, "extensions", "lib", ".pi-managed"), "");

				const result = syncManagedPiDirectory(mode, localPiDir, globalAgentDir);

				expect(result.directoriesRemoved).toEqual([]);
				expect(fs.readFileSync(localLib, "utf-8")).toBe("project core\n");
			},
		);
	});

	describe("file modes on push", () => {
		it("keeps the shipped binaries executable, since push copies their mode", () => {
			const bin = path.join(REPO_ROOT, ".pi/bin");
			const files = fs.readdirSync(bin).filter((name) => fs.statSync(path.join(bin, name)).isFile());
			expect(files.length).toBeGreaterThan(0);
			for (const file of files) expect(fs.statSync(path.join(bin, file)).mode & 0o111, file).toBe(0o111);
		});

		it("keeps the source mode and repairs a mode-only drift", () => {
			const { localPiDir, globalAgentDir } = setupRoots("pi-sync-mode-");
			const hook = path.join(localPiDir, "security/git-hooks/pre-commit");
			fs.mkdirSync(path.dirname(hook), { recursive: true });
			fs.writeFileSync(hook, "#!/bin/sh\n");
			fs.chmodSync(hook, 0o755);
			const target = path.join(globalAgentDir, "security/git-hooks/pre-commit");

			syncManagedPiDirectory("push", localPiDir, globalAgentDir);
			expect(fs.statSync(target).mode & 0o777).toBe(0o755);

			fs.chmodSync(target, 0o644);
			const drift = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
			expect(drift.updated).toEqual(["security/git-hooks/pre-commit"]);
			expect(fs.statSync(target).mode & 0o777).toBe(0o755);

			expect(syncManagedPiDirectory("push", localPiDir, globalAgentDir).updated).toEqual([]);
		});

		it("ships the security hooks so a commit through the synced copy is blocked", () => {
			const { localPiDir, globalAgentDir } = setupRoots("pi-sync-security-");
			fs.cpSync(path.join(REPO_ROOT, ".pi/security"), path.join(localPiDir, "security"), { recursive: true });
			syncManagedPiDirectory("push", localPiDir, globalAgentDir);

			const hooks = path.join(globalAgentDir, "security/git-hooks");
			for (const file of fs.readdirSync(hooks)) expect(fs.statSync(path.join(hooks, file)).mode & 0o777).toBe(0o755);

			const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-commit-"));
			tmpRoots.push(repo);
			const env = {
				...process.env,
				PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
				GIT_CONFIG_GLOBAL: path.join(repo, ".gitconfig-test"),
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_AUTHOR_NAME: "Test",
				GIT_AUTHOR_EMAIL: "test@example.invalid",
				GIT_COMMITTER_NAME: "Test",
				GIT_COMMITTER_EMAIL: "test@example.invalid",
			};
			const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
			fs.writeFileSync(env.GIT_CONFIG_GLOBAL, `[core]\n\thooksPath = ${hooks}\n`);
			git("init", "-q");
			fs.writeFileSync(path.join(repo, "a.ts"), `const k = "${fakeSecrets.aws}";\n`);
			git("add", "a.ts");
			const commit = git("commit", "-q", "-m", "x");
			expect(commit.status).not.toBe(0);
			expect(commit.stderr).toContain("AWS access key ID");
		});

		it("pushes the real tree twice: only CLAUDE.md lands in HOME and the second run has no changes", () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-real-"));
			tmpRoots.push(root);
			const home = path.join(root, "home");
			const agentDir = path.join(root, "agent");
			fs.mkdirSync(home);

			expect(runSyncScript(REPO_ROOT, home, agentDir).status).toBe(0);
			const second = runSyncScript(REPO_ROOT, home, agentDir);
			expect(second.status).toBe(0);
			expect(second.stdout).toContain("No changes.");
			expect(listFiles(home)).toEqual([path.join(".claude", "CLAUDE.md")]);
		}, 240_000);
	});

	describe("security policy check before push", () => {
		function setupProject(policySource: string) {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-policy-check-"));
			tmpRoots.push(root);
			const security = path.join(root, "project/.pi/security");
			fs.mkdirSync(security, { recursive: true });
			fs.copyFileSync(path.join(REPO_ROOT, ".pi/security/guard-core.ts"), path.join(security, "guard-core.ts"));
			fs.writeFileSync(path.join(security, "policy.ts"), policySource);
			const agentDir = path.join(root, "agent");
			const existing = path.join(agentDir, "security/policy.ts");
			fs.mkdirSync(path.dirname(existing), { recursive: true });
			fs.writeFileSync(existing, "// last good policy\n");
			const home = path.join(root, "home");
			fs.mkdirSync(home);
			return { cwd: path.join(root, "project"), agentDir, existing, home };
		}

		const realPolicy = () => fs.readFileSync(path.join(REPO_ROOT, ".pi/security/policy.ts"), "utf8");

		it.each([
			["throws on import", 'throw new Error("broken policy");\n', /broken policy/],
			[
				"has a regex that does not compile",
				realPolicy().replace('maxScanChars: 1_000_000', 'maxScanChars: 1_000_000, rmFlag: "("'),
				/regular expression|Invalid/i,
			],
		])("refuses a policy that %s and leaves the global copy untouched", (_label, source, error) => {
			const project = setupProject(source);
			const result = runSyncScript(project.cwd, project.home, project.agentDir);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(error);
			expect(fs.readFileSync(project.existing, "utf8")).toBe("// last good policy\n");
			expect(fs.existsSync(path.join(project.agentDir, "security/guard-core.ts"))).toBe(false);
		});
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
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-copy-update-"));
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
	describe("dry run", () => {
		function treeSnapshot(root: string): string[] {
			if (!fs.existsSync(root)) return [];
			return listFiles(root)
				.map((rel) => {
					const hash = crypto
						.createHash("sha256")
						.update(fs.readFileSync(path.join(root, rel)))
						.digest("hex");
					return `${rel}:${hash}`;
				})
				.sort();
		}

		function dirSnapshot(root: string): string[] {
			if (!fs.existsSync(root)) return [];
			const dirs: string[] = [];
			const walk = (dir: string) => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					if (!entry.isDirectory()) continue;
					const abs = path.join(dir, entry.name);
					dirs.push(path.relative(root, abs));
					walk(abs);
				}
			};
			walk(root);
			return dirs.sort();
		}

		// A fixture where push would: update SYSTEM.md, delete a global-only skill,
		// merge settings.json, and prune a managed local extension directory.
		function setupFixture(prefix: string) {
			const { localPiDir, globalAgentDir } = setupRoots(prefix);
			fs.writeFileSync(path.join(localPiDir, "SYSTEM.md"), "local\n");
			fs.writeFileSync(path.join(globalAgentDir, "SYSTEM.md"), "global\n");
			fs.mkdirSync(path.join(globalAgentDir, "skills", "only-global"), { recursive: true });
			fs.writeFileSync(path.join(globalAgentDir, "skills", "only-global", "SKILL.md"), "global only\n");
			writeJson(path.join(localPiDir, "settings.json"), { packages: ["npm:a@1.0.0"] });
			writeJson(path.join(globalAgentDir, "settings.json"), { packages: ["npm:b@1.0.0"] });
			fs.mkdirSync(path.join(localPiDir, "extensions", "old-ext"), { recursive: true });
			fs.writeFileSync(path.join(localPiDir, "extensions", "old-ext", "index.ts"), "local ext\n");
			fs.mkdirSync(path.join(globalAgentDir, "extensions", "old-ext"), { recursive: true });
			fs.writeFileSync(path.join(globalAgentDir, "extensions", "old-ext", ".pi-managed"), "");
			fs.writeFileSync(path.join(globalAgentDir, "extensions", "old-ext", "index.ts"), "global ext\n");
			fs.writeFileSync(path.join(localPiDir, "local-only.md"), "local only\n");
			return { localPiDir, globalAgentDir };
		}

		function setupCliFixture(prefix: string) {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
			tmpRoots.push(root);
			const cwd = path.join(root, "project");
			const piDir = path.join(cwd, ".pi");
			fs.mkdirSync(piDir, { recursive: true });
			fs.writeFileSync(path.join(piDir, "SYSTEM.md"), "local\n");
			const home = path.join(root, "home");
			const agentDir = path.join(root, "agent");
			fs.mkdirSync(home);
			fs.mkdirSync(agentDir);
			fs.writeFileSync(path.join(agentDir, "SYSTEM.md"), "global\n");
			fs.mkdirSync(path.join(agentDir, "skills", "only-global"), { recursive: true });
			fs.writeFileSync(path.join(agentDir, "skills", "only-global", "SKILL.md"), "x\n");
			return { cwd, home, agentDir };
		}

		it("writes nothing: file hashes and folders are unchanged after a dry push", () => {
			const { localPiDir, globalAgentDir } = setupFixture("pi-sync-dry-nowrite-");
			const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-dry-nowrite-home-"));
			tmpRoots.push(home);
			const beforeLocal = treeSnapshot(localPiDir);
			const beforeGlobal = treeSnapshot(globalAgentDir);
			const beforeHome = treeSnapshot(home);
			const beforeLocalDirs = dirSnapshot(localPiDir);
			const beforeGlobalDirs = dirSnapshot(globalAgentDir);

			const originalHomeDir = os.homedir;
			os.homedir = () => home;
			let result;
			try {
				result = syncManagedPiDirectory("push", localPiDir, globalAgentDir, {
					dryRun: true,
				});
			} finally {
				os.homedir = originalHomeDir;
			}

			expect(treeSnapshot(localPiDir)).toEqual(beforeLocal);
			expect(treeSnapshot(globalAgentDir)).toEqual(beforeGlobal);
			expect(treeSnapshot(home)).toEqual(beforeHome);
			expect(dirSnapshot(localPiDir)).toEqual(beforeLocalDirs);
			expect(dirSnapshot(globalAgentDir)).toEqual(beforeGlobalDirs);
			// and it still reports what a real run would do
			expect(result.deleted).toEqual(["skills/only-global/SKILL.md"]);
			expect(result.directoriesRemoved).toEqual(["extensions/old-ext"]);
			expect(result.updated).toContain("SYSTEM.md");
			expect(result.updated).toContain("settings.json");
		});

		it("reports the same lists as a real run, for push and pull", () => {
			const pushA = setupFixture("pi-sync-dry-push-");
			const pushB = setupFixture("pi-sync-dry-push-real-");
			const pushDry = syncManagedPiDirectory("push", pushA.localPiDir, pushA.globalAgentDir, {
				dryRun: true,
			});
			const pushReal = syncManagedPiDirectory("push", pushB.localPiDir, pushB.globalAgentDir);
			expect({
				updated: pushDry.updated,
				deleted: pushDry.deleted,
				directoriesRemoved: pushDry.directoriesRemoved,
			}).toEqual({
				updated: pushReal.updated,
				deleted: pushReal.deleted,
				directoriesRemoved: pushReal.directoriesRemoved,
			});

			const pullA = setupFixture("pi-sync-dry-pull-");
			const pullB = setupFixture("pi-sync-dry-pull-real-");
			const pullDry = syncManagedPiDirectory("pull", pullA.localPiDir, pullA.globalAgentDir, {
				dryRun: true,
			});
			const pullReal = syncManagedPiDirectory("pull", pullB.localPiDir, pullB.globalAgentDir);
			expect({
				updated: pullDry.updated,
				deleted: pullDry.deleted,
				directoriesRemoved: pullDry.directoriesRemoved,
			}).toEqual({
				updated: pullReal.updated,
				deleted: pullReal.deleted,
				directoriesRemoved: pullReal.directoriesRemoved,
			});
			// the pruned local extension files are reported as a directory removal, not per-file deletes
			expect(pullDry.deleted).toContain("local-only.md");
			expect(pullDry.deleted).not.toContain("extensions/old-ext/index.ts");
			expect(pullDry.directoriesRemoved).toEqual(["extensions/old-ext"]);
		});

		it("copySystemMdToClaudeMd dry run reports a copy without writing", () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-dry-claude-"));
			tmpRoots.push(root);
			fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
			fs.writeFileSync(path.join(root, ".pi", "SYSTEM.md"), "# Test\n");

			const originalHomeDir = os.homedir;
			os.homedir = () => root;
			try {
				expect(copySystemMdToClaudeMd(root, { dryRun: true })).toBe(true);
				expect(fs.existsSync(path.join(root, ".claude"))).toBe(false);
				expect(copySystemMdToClaudeMd(root)).toBe(true);
				expect(fs.readFileSync(path.join(root, ".claude", "CLAUDE.md"), "utf-8")).toBe("# Test\n");
				expect(copySystemMdToClaudeMd(root, { dryRun: true })).toBe(false);
			} finally {
				os.homedir = originalHomeDir;
			}
		});

		it("push --dry-run exits 0, prints the banner and lists, and writes nothing", () => {
			const { cwd, home, agentDir } = setupCliFixture("pi-sync-dry-cli-");
			const beforeAgent = treeSnapshot(agentDir);
			const beforeHome = treeSnapshot(home);

			const result = runSyncScript(cwd, home, agentDir, ["push", "--dry-run"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("DRY RUN: nothing written");
			expect(result.stdout).toContain("Would update files");
			expect(result.stdout).toContain("Would delete files");
			expect(result.stdout).toContain("skills/only-global/SKILL.md");
			expect(result.stdout).toContain("Would copy SYSTEM.md");
			expect(treeSnapshot(agentDir)).toEqual(beforeAgent);
			expect(treeSnapshot(home)).toEqual(beforeHome);
			expect(fs.existsSync(path.join(home, ".claude"))).toBe(false);
		});

		it("push with pending global deletes exits 1 and writes nothing until --allow-delete", () => {
			const { cwd, home, agentDir } = setupCliFixture("pi-sync-dry-delete-");
			const beforeAgent = treeSnapshot(agentDir);
			const beforeHome = treeSnapshot(home);

			const blocked = runSyncScript(cwd, home, agentDir, ["push"]);

			expect(blocked.status).toBe(1);
			expect(blocked.stdout).toContain("skills/only-global/SKILL.md");
			expect(blocked.stderr).toContain("--allow-delete");
			expect(blocked.stderr).toContain("--dry-run");
			expect(treeSnapshot(agentDir)).toEqual(beforeAgent);
			expect(treeSnapshot(home)).toEqual(beforeHome);

			const allowed = runSyncScript(cwd, home, agentDir, ["push", "--allow-delete"]);
			expect(allowed.status).toBe(0);
			expect(fs.existsSync(path.join(agentDir, "skills", "only-global", "SKILL.md"))).toBe(false);
			expect(fs.readFileSync(path.join(agentDir, "SYSTEM.md"), "utf-8")).toBe("local\n");

			const usage = runSyncScript(cwd, home, agentDir, ["pull", "--allow-delete"]);
			expect(usage.status).toBe(1);
			expect(usage.stderr).toContain("Usage:");
		});

		it("rejects unknown flags and --allow-delete on pull with the usage text", () => {
			const { cwd, home, agentDir } = setupCliFixture("pi-sync-dry-usage-");

			const result = runSyncScript(cwd, home, agentDir, ["push", "--force"]);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Usage: tsx scripts/sync-pi-config.ts <pull|push> [--dry-run] [--allow-delete]");
		});
	});
});
