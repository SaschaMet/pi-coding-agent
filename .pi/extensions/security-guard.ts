import { execFileSync } from "node:child_process";
import os from "node:os";
import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type * as GuardCore from "../security/guard-core.ts";
import type * as PolicyModule from "../security/policy.ts";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const SECURITY_GUARD_REGISTERED = Symbol.for(
	"pi.extensions.security-guard.registered",
);
const SCANNED_SOURCES = new Set(["interactive", "rpc"]);

type LoadedGuard =
	| { ok: true; core: typeof GuardCore; policy: PolicyModule.Policy }
	| { ok: false; error: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// A static import that throws makes PI skip the whole extension, which would
// fail open; a dynamic import inside try keeps the handlers registered.
async function loadGuard(): Promise<LoadedGuard> {
	try {
		const [core, policyModule] = await Promise.all([
			import(new URL("../security/guard-core.ts", import.meta.url).href) as Promise<typeof GuardCore>,
			import(new URL("../security/policy.ts", import.meta.url).href) as Promise<typeof PolicyModule>,
		]);
		return { ok: true, core, policy: policyModule.policy };
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	}
}

function currentBranch(cwd: string): string | undefined {
	try {
		const out = execFileSync("git", ["-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

function loadFailureReason(error: string): string {
	return `Security guard failed to load (${error}). Fix it from a plain shell: npm run pi:sync-global.`;
}

// notify is a no-op in print mode, so headless runs also get the message on stderr.
function report(ctx: ExtensionContext, message: string, level: "warning" | "error"): void {
	ctx.ui?.notify(message, level);
	if (!ctx.hasUI) process.stderr.write(`${message}\n`);
}

export default function securityGuardExtension(pi: ExtensionAPI): void {
	if (isShadowedProjectCopy(import.meta.url)) return;
	const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
	if (guardPi[SECURITY_GUARD_REGISTERED]) return;
	guardPi[SECURITY_GUARD_REGISTERED] = true;
	const loaded = loadGuard();

	pi.on(
		"tool_call",
		async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | undefined> => {
			const guard = await loaded;
			if (!guard.ok) return { block: true, reason: loadFailureReason(guard.error) };
			try {
				const result = guard.core.evaluateToolCall(
					{
						tool: event.toolName,
						input: (event.input ?? {}) as Record<string, unknown>,
						cwd: ctx.cwd,
						home: os.homedir(),
						getCurrentBranch: () => currentBranch(ctx.cwd),
					},
					guard.policy,
				);
				return result.decision === "deny" ? { block: true, reason: result.reason } : undefined;
			} catch (error) {
				return { block: true, reason: `Security guard error: ${errorMessage(error)}` };
			}
		},
	);

	// PI swallows a throwing input handler and sends the prompt on, so every
	// failure here returns "handled" itself.
	pi.on("input", async (event: InputEvent, ctx): Promise<InputEventResult> => {
		try {
			const guard = await loaded;
			if (!guard.ok) {
				report(ctx, `Prompt dropped. ${loadFailureReason(guard.error)}`, "error");
				return { action: "handled" };
			}
			if (!SCANNED_SOURCES.has(event.source)) return { action: "continue" };
			const scan = guard.core.scanText(event.text, guard.policy);
			if (guard.core.isScanBlocked(scan)) {
				report(ctx, `Prompt dropped. ${guard.core.scanBlockMessage(scan, guard.policy)}`, "error");
				return { action: "handled" };
			}
			if (scan.warned.length) report(ctx, guard.core.scanWarnMessage(scan), "warning");
			return { action: "continue" };
		} catch (error) {
			try {
				report(ctx, `Prompt dropped: security scan failed (${errorMessage(error)}).`, "error");
			} catch {
				// Reporting must not turn a drop into a send.
			}
			return { action: "handled" };
		}
	});
}
