import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractBashMutations } from "../.pi/extensions/lib/bash-mutations.ts";

describe("extractBashMutations", () => {
    it("extracts both sides of a plain mv", () => {
        expect(extractBashMutations("mv a.ts b.ts").map((m) => m.path)).toEqual(["a.ts", "b.ts"]);
        expect(extractBashMutations("mv a.ts b.ts")).toEqual([{ path: "a.ts" }, { path: "b.ts" }]);
    });

    it("extracts both sides of git mv", () => {
        expect(extractBashMutations("git mv old.ts new.ts").map((m) => m.path)).toEqual([
            "old.ts",
            "new.ts",
        ]);
    });

    it("extracts a redirection target as a mutation", () => {
        expect(extractBashMutations("echo hi > out.txt")).toEqual([{ path: "out.txt" }]);
        expect(extractBashMutations("echo hi >> out.txt")).toEqual([{ path: "out.txt" }]);
    });

    it("drops /dev/null and descriptor redirections", () => {
        expect(extractBashMutations("npm test > /dev/null 2>&1").map((m) => m.path)).toEqual([]);
    });

    it("drops targets inside the system temp root (os.tmpdir())", () => {
        const target = path.join(os.tmpdir(), "err.log");
        expect(extractBashMutations(`npm test 2> ${target}`).map((m) => m.path)).toEqual([]);
    });

    it("does not exempt the shared /tmp or /var/tmp", () => {
        expect(extractBashMutations("npm test 2> /tmp/err.log").map((m) => m.path)).toEqual([
            "/tmp/err.log",
        ]);
        expect(extractBashMutations("npm test 2> /var/tmp/err.log").map((m) => m.path)).toEqual([
            "/var/tmp/err.log",
        ]);
    });

    it("returns nothing for non-mutating commands", () => {
        for (const command of ["git status", "npm test", "grep -rn x .", "ls -la", "cat file.txt"]) {
            expect(extractBashMutations(command).map((m) => m.path), command).toEqual([]);
        }
    });

    it("takes only the file operand of sed -i, not the script", () => {
        expect(extractBashMutations("sed -i 's/a/b/' file.ts").map((m) => m.path)).toEqual([
            "file.ts",
        ]);
        expect(extractBashMutations("sed -i 's/a/b/' file.ts")).toEqual([{ path: "file.ts" }]);
    });

    it("extracts touch, tee, and mkdir targets", () => {
        expect(extractBashMutations("touch a b")).toEqual([{ path: "a" }, { path: "b" }]);
        expect(extractBashMutations("tee out.txt")).toEqual([{ path: "out.txt" }]);
        expect(extractBashMutations("mkdir -p deep/dir").map((m) => m.path)).toEqual(["deep/dir"]);
    });

    it("extracts both the cp source and destination", () => {
        expect(extractBashMutations("cp -R src dst")).toEqual([{ path: "src" }, { path: "dst" }]);
    });

    it("extracts across command chains", () => {
        expect(extractBashMutations("echo ok && rm x | cp y z; touch w").map((m) => m.path)).toEqual(
            ["x", "y", "z", "w"],
        );
    });

    it("drops garbage tokens from command substitution", () => {
        expect(extractBashMutations("rm $(ls tmp)").map((m) => m.path)).toEqual([]);
    });

    it("drops flag tokens and quoted strings never reach the path filter", () => {
        expect(extractBashMutations("rm --force file.txt").map((m) => m.path)).toEqual(["file.txt"]);
        expect(extractBashMutations("mv 'a b.ts' c.ts").map((m) => m.path)).toEqual([
            "a b.ts",
            "c.ts",
        ]);
    });
});

describe("extractBashMutations quote-aware tokenizing", () => {
    it("does not treat a quoted redirect character as an operator", () => {
        expect(extractBashMutations('grep -n ">" src/app.ts')).toEqual([]);
    });

    it("does not split on a quoted semicolon or dispatch on a quoted command name", () => {
        expect(extractBashMutations('git commit -m "fix; rm old.ts"')).toEqual([]);
    });

    it("bails out entirely on a command with an unquoted heredoc", () => {
        expect(extractBashMutations("cat > notes.md <<'EOF'\na > b\nrm old\nEOF")).toEqual([]);
    });

    it("splits segments on unquoted newlines", () => {
        expect(extractBashMutations("mkdir a\ntouch b").map((m) => m.path)).toEqual(["a", "b"]);
    });
});
