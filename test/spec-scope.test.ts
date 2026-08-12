import { describe, expect, it } from "vitest";
import { matchesAny, matchesPattern, parseScopeSection } from "../.pi/extensions/lib/spec-scope.ts";

describe("parseScopeSection", () => {
    it("reads the Modify and Forbid lists from the spec template shape", () => {
        const parsed = parseScopeSection(
            "# Spec\n\n## 2. Scope\n\n**Modify:**\n- `src/**`\n- `package.json`\n\n**Forbid:**\n- `src/secrets.ts`\n\n## 3. Next\n",
        );

        expect(parsed).toEqual({ lists: { modify: ["src/**", "package.json"], forbid: ["src/secrets.ts"] } });
    });

    it("reports a missing Scope section", () => {
        expect(parseScopeSection("# Spec\n\n## 1. Intent\nNothing.\n")).toHaveProperty("error");
    });

    it("reports a Modify list holding only template placeholders", () => {
        expect(
            parseScopeSection("# Spec\n\n## 2. Scope\n\n**Modify:**\n- `path/to/file`\n- ...\n"),
        ).toHaveProperty("error");
    });

    it("returns an empty Forbid list when the spec omits it", () => {
        const parsed = parseScopeSection("# Spec\n\n## 2. Scope\n\n**Modify:**\n- `src/**`\n");
        expect(parsed).toEqual({ lists: { modify: ["src/**"], forbid: [] } });
    });
});

describe("matchesPattern", () => {
    it("matches an exact path", () => {
        expect(matchesPattern("package.json", "package.json")).toBe(true);
        expect(matchesPattern("package-lock.json", "package.json")).toBe(false);
    });

    it("treats a wildcard-free pattern as a directory prefix", () => {
        expect(matchesPattern("src/env.ts", "src")).toBe(true);
        expect(matchesPattern("src/env.ts", "src/")).toBe(true);
        expect(matchesPattern("srcx/env.ts", "src")).toBe(false);
    });

    it("keeps a single star inside one segment", () => {
        expect(matchesPattern("src/env.ts", "src/*.ts")).toBe(true);
        expect(matchesPattern("src/deep/env.ts", "src/*.ts")).toBe(false);
    });

    it("spans zero or more segments with a double star", () => {
        expect(matchesPattern("src/index.ts", "src/**/*.ts")).toBe(true);
        expect(matchesPattern("src/a/b.ts", "src/**/*.ts")).toBe(true);
        expect(matchesPattern("smoke.test.ts", "**/*.test.ts")).toBe(true);
        expect(matchesPattern("test/a.test.ts", "**/*.test.ts")).toBe(true);
    });

    it("matches everything under a trailing double star", () => {
        expect(matchesPattern("src/a.ts", "src/**")).toBe(true);
        expect(matchesPattern("src/a/b/c.ts", "src/**")).toBe(true);
        expect(matchesPattern("other/a.ts", "src/**")).toBe(false);
    });

    it("treats a question mark as one literal character, not a quantifier", () => {
        expect(matchesPattern("src/secret1.ts", "src/secret?.ts")).toBe(true);
        expect(matchesPattern("src/secret.ts", "src/secret?.ts")).toBe(false);
        expect(matchesPattern("src/secret12.ts", "src/secret?.ts")).toBe(false);
    });

    // `..` is an ordinary segment to a glob, so a `../` path can match `**`. Containment is
    // the guard's job, not the matcher's — see the outside-cwd case in write-boundary-guard.
    it("has no opinion about paths that escaped the working directory", () => {
        expect(matchesPattern("../other/config.ts", "**/*.ts")).toBe(true);
    });

    it("returns false for an empty pattern instead of matching everything", () => {
        expect(matchesPattern("src/env.ts", "   ")).toBe(false);
        expect(matchesAny("src/env.ts", [])).toBe(false);
    });

    it("stays fast on a pathological pattern", () => {
        const started = process.hrtime.bigint();
        expect(matchesPattern("src/a/b/c/d/e/f/g/h/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ts", "a**a**a**a**a**a**a**a**b")).toBe(false);
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        expect(elapsedMs).toBeLessThan(100);
    });
});
