import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearSecretCache, getScopedSecret } from "../src/secrets.ts";

describe("scoped secrets", () => {
  const scopedKey = "PI_TEST_SCOPED_SECRET";

  afterEach(() => {
    clearSecretCache();
    delete process.env[scopedKey];
  });

  it("reads secrets from local .env without hydrating process.env", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-secrets-test-"));
    fs.writeFileSync(path.join(tmp, ".env"), `${scopedKey}=scoped-secret\n`, "utf-8");

    const value = getScopedSecret(tmp, scopedKey);
    expect(value).toBe("scoped-secret");
    expect(process.env[scopedKey]).toBeUndefined();
  });

  it("prefers process env over .env values", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-secrets-env-priority-test-"));
    fs.writeFileSync(path.join(tmp, ".env"), `${scopedKey}=dotenv-secret\n`, "utf-8");
    process.env[scopedKey] = "process-secret";

    const value = getScopedSecret(tmp, scopedKey);
    expect(value).toBe("process-secret");
  });
});
