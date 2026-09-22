import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

/**
 * Vitest `setupFiles` entry: `npm test` must not depend on the
 * developer's real `~/.pi/agent`. With `isolate: true`, each test file gets
 * a fresh run of this module, so `beforeAll`/`afterAll` here bracket exactly
 * one test file — a fresh, empty `PI_CODING_AGENT_DIR` per file, restored
 * (and removed) afterwards. Tests that set their own `PI_CODING_AGENT_DIR`
 * (see `test/extension-dedup.test.ts`) still work: they capture whatever
 * value is current in their own `beforeEach`/`afterEach` and restore that,
 * regardless of what this file set it to.
 */
let previousAgentDir: string | undefined;
let isolatedAgentDir: string | undefined;

beforeAll(() => {
   previousAgentDir = process.env.PI_CODING_AGENT_DIR;
   isolatedAgentDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pi-test-agent-dir-"),
   );
   process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
});

afterAll(() => {
   if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
   else process.env.PI_CODING_AGENT_DIR = previousAgentDir;

   if (isolatedAgentDir) fs.rmSync(isolatedAgentDir, { recursive: true, force: true });
   isolatedAgentDir = undefined;
});
