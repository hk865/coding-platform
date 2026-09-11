import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../../src/contracts/fingerprint.js";
import { commandFingerprint, normalizeObjective } from "../../src/contracts/command-event.js";
import { buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1 } from "../../src/contracts/fixtures/goal-fixtures.js";

describe("canonicalJson (JCS subset)", () => {
  it("sorts object keys by UTF-16 code unit", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ "10": 1, "2": 2 })).toBe('{"10":1,"2":2}');
  });

  it("handles nested arrays and primitives", () => {
    expect(canonicalJson({ x: [1, "a b", null, true] })).toBe('{"x":[1,"a b",null,true]}');
  });

  it("is stable across repeated invocations", () => {
    const v = { schemaVersion: 1, commandType: "CreateGoal", payload: { workspaceId: "ws", objective: "x" } };
    expect(canonicalJson(v)).toBe(canonicalJson(v));
  });

  it("sha256 is lowercase hex of UTF-8 bytes", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("objective normalization", () => {
  it("trims Unicode whitespace and keeps interior", () => {
    expect(normalizeObjective("  a" + "\u00a0" + "b  ")).toBe("a" + "\u00a0" + "b");
  });

  it("normalizes empty-after-trim to empty string", () => {
    expect(normalizeObjective(" \u00a0\t ")).toBe("");
  });
});

describe("commandFingerprint", () => {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;

  it("normalizes objective before hashing (whitespace variants collide)", () => {
    const a = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: "t" });
    const b = buildCreateGoalCommand(
      { ...scope, objective: "  " + scope.objective + "  " },
      { commandId: "cmd-9", correlationId: "c9", submittedAt: "t9" },
    );
    expect(commandFingerprint(a)).toBe(commandFingerprint(b));
  });

  it("differs when scope or payload differs", () => {
    const a = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: "t" });
    const b = buildCreateGoalCommand(
      { ...scope, goalId: "goal-2" },
      { commandId: "cmd-2", correlationId: "c", submittedAt: "t" },
    );
    expect(commandFingerprint(a)).not.toBe(commandFingerprint(b));
  });

  it("excludes commandId/correlationId/submittedAt/actor/idempotencyKey", () => {
    const a = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: "t" });
    const b = buildCreateGoalCommand(
      { ...scope, actor: { kind: "system", id: "different-actor" } },
      { commandId: "cmd-2", correlationId: "c2", submittedAt: "t2" },
    );
    expect(commandFingerprint(a)).toBe(commandFingerprint(b));
  });
});
