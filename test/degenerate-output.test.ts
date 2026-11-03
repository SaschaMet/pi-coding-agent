import { describe, expect, it, vi } from "vitest";
import degenerateOutput from "../.pi/extensions/degenerate-output.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

type Part = { type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

// Final replies from a saved iqRouter session: unreadable output, visible text empty or leaking a template marker.
const GARBAGE: Record<string, Part[]> = {"688": [{"type": "thinking", "thinking": "Here is the situation: here, here say its the best herefor:\nconstraining here:\n      the internal test here:\n    here,\n    - into the system: here time: args/{max=16} was misconfigured for the script's end (the other option), and the expected value is being checked for, which is is blank, so the state mentioned there is nothing.<|im_end|>"}], "732": [{"type": "thinking", "thinking": "以\")}─filterreply►本题分析、ęc for the\n"}], "737": [{"type": "thinking", "thinking": "障碍││ance：</══╗ (\nń│││ that了 with\n\n</════agement────────Withń│： with可以.\nthe it─\n。\n\n─\n\n\n│;│�上\n\n\r\n以││\n\n\n\n\nnone\n\n间 with││\n这；/\n以│：\n\n�│?\n────────│══atelyで withoutence.。\n:　。\n│codening it以\n │以─〉： double\n\n─\n│以ąing requests： query1；│命令│[────────\n││\n\n\n││\t；�\n│\n│the supported\n\n│──│….────────\r\n✓\n\n│ance�\n以─\n││ives\n the‚│\n\n│════with\n\n； with── —\n\n?\n│││\n\n││\n�│\n\n\n│\" infoWith│ from\n\n\n"}], "741": [{"type": "thinking", "thinking": " screenshot\n\n\n"}]};

// Healthy final replies from the same session.
const HEALTHY: string[] = ["Recon done — I have what I need to ground the brief. Key facts verified: the 10 in-scope controllers all read `filters` via `$request->query->all('filters')` (ticket 1's step 4 already landed in this tree), the `internal` nelmio area exists but has no doc route (only `/api/doc.json`, area `default`)", "The uncommitted diffs are trivial local work (quote-style in existing OA annotations, docker-compose) — noted, not part of this ticket.\n\n**Status:** Brief approved, all accompanying docs read, three recon agents running in parallel (A: 10 internal controllers + nelmio mechanics, B: api-documentation", "Recon B (api-documentation) is done with a complete change-set sketch. Key findings: the prefix proxy location already routes `/proxy/zam/api/internal/doc.json` with zero changes; only `apps.json` (optional `specs` array) + `generate.sh` (per-spec loops for the swagger-initializer entry and the ngin", "Recon C (backoffice callers) is done: all 12 endpoints have production callers, exact query params per endpoint mapped (`filters[key]=value` wire format, `Y-m-d` dates, comma-joined `partnerSlug`, top-level `page` on list endpoints, no params on long-term-metrics), token injected globally via the ba", "Done. Both artifacts are in place:\n\n- **Research doc:** `docs/specs/internal-openapi/research-internal-openapi.md` — consolidates the three recon passes (zam controllers + nelmio, api-documentation, zam-backoffice) plus inline verification. Every claim carries file:line evidence.\n- **Spec:** `docs/s", "Checked both panes. Here's what I found:\n\n**Worker pane (`surface:1000090041`, the one I created for the grill session)**\n- It is **idle** and finished a task I did not send: *\"Run $grill-me on `docs/plans/EDGWEB-5101/plan.md`, ticket `EDGWEB-5101.md`, parent spec `docs/specs/EDGWEB-4811/`\"* — with ", "All amendments are in place and verified. The grilling session is complete — here's the outcome.\n\n## Grilling session outcome\n\n**Setup:** New cmux pane (`surface:1000090042`, right of yours), worker booted with `pi --no-session --model iqRouter/grunt:high`, ran the `grill-me` skill on `docs/specs/in", "Pane closed. Here's the plan in plain language, step by step, with the diffs.\n\n---\n\n# The plan: document ZAM's internal API\n\n## What's the problem?\n\nZAM middleware has 12 internal endpoints. The backoffice app calls them (for example `GET /internal/statistics`). Nobody has written down how to call t", "There are 4 unrelated pre-existing changes in the working tree (`.gitignore`, `CreateContractController.php`, `GetAllContractsStatusController.php`, `docker-compose.yaml`). Per AGENTS.md, I'll only commit ticket-relevant files.\n\n## Summary\n\nAll 6 steps of the spec are complete:\n\n**Step 1 — Statistic", "All checks pass. Here's the verification summary:\n\n**The report's RED verdict is now stale** — it was written before my AC3 fixes. Current state:\n\n| Check | Result |\n|---|---|\n| AC1: All 10 controllers have OA annotations | ✅ Pass |\n| AC3: `/internal/contracts` — 17 filter keys documented | ✅ Pass |", "Both cmux workers are done. Here's the summary:\n\n## Verification (W1): GREEN\n\nAll 4 checks pass:\n- Internal spec: 24 paths, 7 schemas, `internalToken` security scheme\n- Public spec: 16 paths, zero `/internal/` leaks\n- Test suite: 3595 tests, 6060 assertions — all pass\n- `cmux wait-for` signaled OK\n\n", "## What changed (ELI5)\n\n**The problem:** Your internal API (the stuff the backoffice talks to) had zero documentation. If a new dev wanted to call `/internal/contracts`, they had to read the PHP code to figure out what query params to send.\n\n**The fix, in 5 pieces:**\n\n1. **Annotated 10 controllers**"];

const reply = (content: Part[], stopReason = "stop") => ({ role: "assistant", content, stopReason, api: "openai-responses", provider: "iqRouter", model: "grunt", usage: {}, timestamp: 0 });
const text = (value: string): Part[] => [{ type: "text", text: value }];

function setup(provider = "iqRouter") {
    const pi = createFakePi();
    degenerateOutput(asExtensionAPI(pi));
    const notify = vi.fn();
    const ctx = { cwd: process.cwd(), hasUI: true, ui: { notify }, model: { provider, id: "m" } };

    async function fire(event: string, payload: unknown) {
        for (const handler of pi.handlers.get(event) ?? []) {
            const result = await handler(payload, ctx);
            if (result) return result;
        }
        return undefined;
    }

    const end = (message: unknown) => fire("message_end", { type: "message_end", message });
    const settleCheck = (entries: unknown[] = []) => fire("agent_before_settle", { type: "agent_before_settle", entries });
    return { ctx, fire, end, settleCheck, notify };
}

describe("degenerate-output: detection", () => {
    it.each(Object.entries(GARBAGE))("discards the unreadable reply from session entry %s", async (_entry, content) => {
        const { end } = setup();
        const result = await end(reply(content));

        expect(result?.message.role).toBe("assistant");
        expect(result?.message.content).toEqual([{ type: "text", text: expect.stringMatching(/^\[Reply discarded:/) }]);
    });

    it.each(HEALTHY.map((value) => [value.slice(0, 40), value]))("keeps a healthy reply: %s", async (_label, value) => {
        const { end } = setup();
        expect(await end(reply(text(value)))).toBeUndefined();
    });

    it.each([
        ["a file tree", "Layout:\n\n```\nsrc/\n├── a.ts\n└── lib/\n    └── b.ts\n```\nDone."],
        ["a marker quoted inline", "The server leaked `<|im_end|>`, a chat-template marker."],
        ["a marker in a fenced block", "Leak sample:\n\n```\nfoo<|im_end|>\n```\nThat marker means the template broke."],
        ["arrows and a table", "| Step | Result |\n|---|---|\n| 1 → 2 | ok |"],
    ])("keeps a healthy reply with %s", async (_label, value) => {
        const { end } = setup();
        expect(await end(reply(text(value)))).toBeUndefined();
    });

    it("flags a marker that leaks into plain text", async () => {
        const { end } = setup();
        expect((await end(reply(text("All done.<|im_end|>"))))?.message).toBeDefined();
    });

    it.each([["error"], ["aborted"], ["length"]])("ignores a reply that ended with stopReason %s", async (stopReason) => {
        const { end } = setup();
        expect(await end(reply(GARBAGE["741"], stopReason))).toBeUndefined();
    });

    it("ignores a reply that carries a tool call", async () => {
        const { end } = setup();
        const content: Part[] = [...GARBAGE["688"], { type: "toolCall", id: "t", name: "bash", arguments: { command: "ls" } }];
        expect(await end(reply(content, "stop"))).toBeUndefined();
    });

    it("never touches replies from other providers", async () => {
        const { end } = setup("claude-bridge");
        expect(await end(reply(GARBAGE["688"]))).toBeUndefined();
    });

    it("ignores user and tool messages", async () => {
        const { end } = setup();
        expect(await end({ role: "user", content: "<|im_end|>", timestamp: 0 })).toBeUndefined();
    });
});

describe("degenerate-output: retry", () => {
    it("retries once, keeping the original reply in a hidden entry", async () => {
        const { end, settleCheck, notify } = setup();
        await end(reply(GARBAGE["732"]));

        const result = await settleCheck();

        expect(result?.continue).toBe(true);
        expect(result?.entries).toEqual([
            { type: "custom", customType: "degenerate-output", data: { reason: "empty", content: GARBAGE["732"] } },
            expect.objectContaining({ type: "custom_message", display: false }),
        ]);
        expect(notify).toHaveBeenCalledWith(expect.stringMatching(/retrying once/), "warning");
    });

    it("does not retry a second time in the same run, even across an agent_start", async () => {
        const { fire, end, settleCheck, notify } = setup();
        await end(reply(GARBAGE["732"]));
        await settleCheck();
        await fire("agent_start", { type: "agent_start" });
        await end(reply(GARBAGE["737"]));

        const result = await settleCheck();

        expect(result?.continue).toBeUndefined();
        expect(result?.entries).toEqual([expect.objectContaining({ type: "custom", customType: "degenerate-output" })]);
        expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/unreadable twice/), "error");
    });

    it("allows a retry again once the run settled", async () => {
        const { fire, end, settleCheck } = setup();
        await end(reply(GARBAGE["732"]));
        await settleCheck();
        await fire("agent_settled", { type: "agent_settled", aborted: false });
        await end(reply(GARBAGE["741"]));

        expect((await settleCheck())?.continue).toBe(true);
    });

    it("keeps entries other extensions already added at settle", async () => {
        const { end, settleCheck } = setup();
        const earlier = { type: "custom", customType: "other", data: 1 };
        await end(reply(GARBAGE["741"]));

        const result = await settleCheck([earlier]);

        expect(result?.entries[0]).toEqual(earlier);
        expect(result?.entries).toHaveLength(3);
    });

    it("does nothing at settle when no reply was discarded", async () => {
        const { end, settleCheck } = setup();
        await end(reply(text("Fine.")));
        expect(await settleCheck()).toBeUndefined();
    });
});

describe("degenerate-output: cache skip on the retry", () => {
    const request = (fire: (event: string, payload: unknown) => Promise<any>, payload: unknown = { model: "grunt", input: [] }) =>
        fire("before_provider_request", { type: "before_provider_request", payload });

    it("leaves requests alone when no retry is scheduled", async () => {
        const { fire } = setup();
        expect(await request(fire)).toBeUndefined();
    });

    it("salts every request until the next reply arrives, then stops", async () => {
        const { fire, end, settleCheck } = setup();
        await end(reply(GARBAGE["732"]));
        await settleCheck();

        // A compaction request may come before the retry itself; both must skip the cache.
        const first = await request(fire);
        const second = await request(fire);
        expect(first).toEqual({ model: "grunt", input: [], cache_salt: expect.any(String) });
        expect(second.cache_salt).toEqual(expect.any(String));
        expect(second.cache_salt).not.toBe(first.cache_salt);

        await end(reply(text("Readable again.")));
        expect(await request(fire)).toBeUndefined();
    });

    it("never salts requests to other providers, even with a retry pending", async () => {
        const { ctx, fire, end, settleCheck } = setup();
        await end(reply(GARBAGE["732"]));
        await settleCheck();
        ctx.model.provider = "claude-bridge";
        expect(await request(fire)).toBeUndefined();
    });

    it("leaves a payload that is not an object unchanged", async () => {
        const { fire, end, settleCheck } = setup();
        await end(reply(GARBAGE["732"]));
        await settleCheck();
        expect(await request(fire, "raw")).toBeUndefined();
    });
});
