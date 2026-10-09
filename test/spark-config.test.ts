import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SPARK = path.resolve(import.meta.dirname, "../.pi/spark.json");

// claude-bridge rejects system prompts it did not capture, so pi-spark's
// background calls must never fall back to a bridge session model.
describe("spark.json", () => {
	for (const feature of ["recap", "title"]) {
		it(`pins ${feature} to a model outside claude-bridge`, () => {
			const entry = JSON.parse(fs.readFileSync(SPARK, "utf8"))[feature];
			expect(entry.provider).toEqual(expect.any(String));
			expect(entry.provider).not.toBe("");
			expect(entry.model).toEqual(expect.any(String));
			expect(entry.model).not.toBe("");
			expect(entry.provider).not.toBe("claude-bridge");
		});
	}
});
