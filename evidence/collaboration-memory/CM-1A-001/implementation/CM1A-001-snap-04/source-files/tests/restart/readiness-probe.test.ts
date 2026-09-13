import { describe, expect, it } from "vitest";
import { classifyRestartProbeError, isUnimplementedRestartCapability } from "./readiness-probe.js";

describe("restart readiness probe classification", () => {
  it("turns only an explicit unfinished P1 lane sentinel into not-ready", () => {
    const sentinel = new Error("P1-14 lane not implemented yet");
    expect(isUnimplementedRestartCapability(sentinel)).toBe(true);
    expect(classifyRestartProbeError(sentinel)).toBe(false);
  });

  it.each([
    new Error("database is locked"),
    new Error("projection assertion regressed"),
    new Error("P1-14 happened to mention not implemented yet but then failed"),
    "P1-14 lane not implemented yet",
  ])("propagates a real readiness-path failure instead of converting it to SKIP", (failure) => {
    expect(() => classifyRestartProbeError(failure)).toThrow(failure instanceof Error ? failure : undefined);
  });
});
