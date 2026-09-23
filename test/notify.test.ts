import { describe, expect, it, vi } from "vitest";
import notifyExtension from "../.pi/extensions/notify.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

const assistantText = (text: string) => ({
    role: "assistant",
    content: [{ type: "text", text }],
});

/** Register the extension on a fresh fake pi, fire agent_end, return raw stdout writes. */
async function runAgentEnd(
    mode: string,
    messages: unknown[],
): Promise<string[]> {
    const pi = createFakePi();
    notifyExtension(asExtensionAPI(pi));
    const handlers = pi.handlers.get("agent_end") ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(
        () => true,
    );
    try {
        await handlers[0]({ type: "agent_end", messages }, { mode, hasUI: false });
        return writeSpy.mock.calls.map((call) => String(call[0]));
    } finally {
        writeSpy.mockRestore();
    }
}

describe("notify extension", () => {
    it("writes an OSC 777 notification with the last assistant text in tui mode", async () => {
        const writes = await runAgentEnd("tui", [
            { role: "user", content: "do the thing" },
            assistantText("All done, tests pass."),
        ]);
        expect(writes).toHaveLength(1);
        const seq = writes[0];
        expect(seq.startsWith("\x1b]777;notify;")).toBe(true);
        expect(seq.endsWith("\x07")).toBe(true);
        expect(seq).toContain(";π;");
        expect(seq).toContain("All done, tests pass.");
    });

    it("stays silent in print mode (subagent sessions)", async () => {
        const writes = await runAgentEnd("print", [
            assistantText("subagent finished"),
        ]);
        expect(writes).toHaveLength(0);
    });

    it("falls back to an empty-body notification when no assistant text exists", async () => {
        const writes = await runAgentEnd("tui", [
            { role: "user", content: "hi" },
        ]);
        expect(writes).toHaveLength(1);
        // no assistant text: fallback title, empty body
        expect(writes[0]).toBe("\x1b]777;notify;Ready for input;\x07");
    });

    it("truncates long bodies to 200 characters", async () => {
        const long = "x".repeat(250);
        const writes = await runAgentEnd("tui", [assistantText(long)]);
        const body = writes[0].slice("\x1b]777;notify;π;".length, -1);
        expect(body.length).toBe(200);
        expect(body.endsWith("…")).toBe(true);
    });

    it("flattens markdown to plain text", async () => {
        const writes = await runAgentEnd("tui", [
            assistantText("**bold** and `code`"),
        ]);
        expect(writes[0]).toContain("bold and code");
        expect(writes[0]).not.toContain("**");
    });

    it("strips embedded terminal escape sequences from the body", async () => {
        const malicious = "safe \x1b]8;;http://evil.example\x07 text";
        const writes = await runAgentEnd("tui", [assistantText(malicious)]);
        const seq = writes[0];
        // exactly one ESC (the OSC 777 opener) and one BEL (the terminator)
        const escCount = seq.split("\x1b").length - 1;
        const belCount = seq.split("\x07").length - 1;
        expect(escCount).toBe(1);
        expect(belCount).toBe(1);
        // body is printable-only: no control character survives into the payload
        const body = seq.slice("\x1b]777;notify;".length, -1);
        expect(body).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
        expect(body).toContain("safe");
        expect(body).toContain("text");
    });

    it("registers the handler only once per pi instance", () => {
        const pi = createFakePi();
        notifyExtension(asExtensionAPI(pi));
        notifyExtension(asExtensionAPI(pi));
        expect(pi.handlers.get("agent_end")?.length).toBe(1);
    });
});
