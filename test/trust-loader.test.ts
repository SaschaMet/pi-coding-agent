import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	isWithinTrustedDirectory,
	loadTrustedDirectories,
} from "../.pi/extensions/lib/trust-loader.ts";

describe("trust loader", () => {
	describe("loadTrustedDirectories", () => {
		it("returns empty array when trust.json does not exist", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-missing-"));
			const result = loadTrustedDirectories(tmp);
			expect(result).toEqual([]);
		});

		it("finds trust.json in parent directory", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-parent-"));
			const trustedDir = path.join(tmp, "trusted");
			fs.mkdirSync(trustedDir, { recursive: true });
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.mkdirSync(path.join(tmp, "subdir"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify({ trustedDirectories: [trustedDir] }),
			);
			const result = loadTrustedDirectories(path.join(tmp, "subdir"));
			expect(result).toHaveLength(1);
			// Resolve both paths to handle macOS /private/var symlink
			expect(fs.realpathSync(result[0])).toBe(fs.realpathSync(trustedDir));
		});

		it("returns empty array when trust.json is malformed JSON", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-malformed-"));
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(path.join(tmp, ".pi", "trust.json"), "{ not valid json");
			const result = loadTrustedDirectories(tmp);
			expect(result).toEqual([]);
		});

		it("returns empty array when trust.json is an array instead of object", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-array-"));
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify(["/tmp"]),
			);
			const result = loadTrustedDirectories(tmp);
			expect(result).toEqual([]);
		});

		it("returns empty array when trustedDirectories is not an array", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-not-array-"));
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify({ trustedDirectories: "/tmp" }),
			);
			const result = loadTrustedDirectories(tmp);
			expect(result).toEqual([]);
		});

		it("returns empty array when trustedDirectories is missing", () => {
			const tmp = fs.mkdtempSync(
				path.join(os.tmpdir(), "pi-trust-missing-key-"),
			);
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify({ otherKey: [] }),
			);
			const result = loadTrustedDirectories(tmp);
			expect(result).toEqual([]);
		});

		it("returns resolved absolute paths from trustedDirectories", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-valid-"));
			const trustedDir = path.join(tmp, "trusted");
			fs.mkdirSync(trustedDir, { recursive: true });
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify({ trustedDirectories: [trustedDir] }),
			);
			const result = loadTrustedDirectories(tmp);
			expect(result).toHaveLength(1);
			// resolvePathWithRealAncestor may resolve /var to /private/var on macOS
			expect(fs.existsSync(result[0])).toBe(true);
		});

		it("expands ~ in trustedDirectories", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-home-"));
			const homeDir = os.homedir();
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify({ trustedDirectories: ["~/Documents"] }),
			);
			const result = loadTrustedDirectories(tmp);
			expect(result).toHaveLength(1);
			expect(result[0]).toBe(path.join(homeDir, "Documents"));
		});

		it("skips relative paths", () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-relative-"));
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify({ trustedDirectories: ["relative/path"] }),
			);
			const result = loadTrustedDirectories(tmp);
			expect(result).toEqual([]);
		});

		it("skips empty strings and non-string entries", () => {
			const tmp = fs.mkdtempSync(
				path.join(os.tmpdir(), "pi-trust-invalid-entries-"),
			);
			fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmp, ".pi", "trust.json"),
				JSON.stringify({ trustedDirectories: ["", 123, null, "/valid/path"] }),
			);
			const result = loadTrustedDirectories(tmp);
			expect(result).toHaveLength(1);
			expect(result[0]).toBe("/valid/path");
		});
	});

	describe("isWithinTrustedDirectory", () => {
		it("returns true when path is directly under trusted directory", () => {
			const trusted = "/home/user/projects";
			expect(
				isWithinTrustedDirectory("/home/user/projects/file.txt", [trusted]),
			).toBe(true);
		});

		it("returns true when path is deeply nested under trusted directory", () => {
			const trusted = "/home/user/projects";
			expect(
				isWithinTrustedDirectory("/home/user/projects/src/lib/file.ts", [
					trusted,
				]),
			).toBe(true);
		});

		it("returns true when path equals trusted directory", () => {
			const trusted = "/home/user/projects";
			expect(isWithinTrustedDirectory("/home/user/projects", [trusted])).toBe(
				true,
			);
		});

		it("returns false when path is outside trusted directory", () => {
			const trusted = "/home/user/projects";
			expect(
				isWithinTrustedDirectory("/home/user/secrets/passwords.txt", [trusted]),
			).toBe(false);
		});

		it("returns false when trusted directories array is empty", () => {
			expect(isWithinTrustedDirectory("/any/path", [])).toBe(false);
		});

		it("checks multiple trusted directories", () => {
			const trusted = ["/home/user/projects", "/home/user/docs"];
			expect(
				isWithinTrustedDirectory("/home/user/docs/notes.md", trusted),
			).toBe(true);
			expect(
				isWithinTrustedDirectory("/home/user/projects/src/index.ts", trusted),
			).toBe(true);
			expect(
				isWithinTrustedDirectory("/home/user/secrets/key.pem", trusted),
			).toBe(false);
		});

		it("prevents directory traversal escape", () => {
			const trusted = "/home/user/projects";
			expect(
				isWithinTrustedDirectory("/home/user/projects/../secrets/file.txt", [
					trusted,
				]),
			).toBe(false);
		});
	});
});
