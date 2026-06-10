import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../.pi/extensions/plan-mode/utils.ts";

describe("plan mode utils", () => {
  it("allows read-only shell commands", () => {
    expect(isSafeCommand("rg -n \"plan\" .pi")).toBe(true);
    expect(isSafeCommand("git status --short")).toBe(true);
  });

  it("blocks mutating shell commands", () => {
    expect(isSafeCommand("rm -rf .pi/extensions")).toBe(false);
    expect(isSafeCommand("git commit -m test")).toBe(false);
  });
});
