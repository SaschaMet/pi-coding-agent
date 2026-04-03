import { describe, expect, it } from "vitest";
import { sanitizeBashEnv } from "../.pi/extensions/bash-sandbox.ts";

describe("bash sandbox", () => {
  it("strips non-allowlisted env vars", () => {
    const sanitized = sanitizeBashEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      OPENAI_API_KEY: "secret",
      BRAVE_API_KEY: "secret2",
      CUSTOM_FLAG: "x",
    });

    expect(sanitized.PATH).toBe("/usr/bin");
    expect(sanitized.HOME).toBe("/tmp/home");
    expect(sanitized.OPENAI_API_KEY).toBeUndefined();
    expect(sanitized.BRAVE_API_KEY).toBeUndefined();
    expect(sanitized.CUSTOM_FLAG).toBeUndefined();
  });

  it("allows explicitly allowlisted keys", () => {
    const sanitized = sanitizeBashEnv(
      {
        PATH: "/usr/bin",
        CUSTOM_SAFE_VAR: "ok",
      },
      new Set(["CUSTOM_SAFE_VAR"]),
    );

    expect(sanitized.CUSTOM_SAFE_VAR).toBe("ok");
  });
});
