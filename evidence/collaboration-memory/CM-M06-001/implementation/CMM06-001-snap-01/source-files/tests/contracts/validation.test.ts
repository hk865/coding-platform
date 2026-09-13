import { describe, expect, it } from "vitest";
import { validateCreateGoalCommand } from '../../src/contracts/validation/goal.js';
import { validateDomainEvent } from '../../src/contracts/validation/event.js';
import { validateWorkspaceBootstrapCommand, validateWorkspaceBootstrapFixture } from '../../src/contracts/validation/bootstrap.js';
import { buildCreateGoalCommand, goalCreatedEventFor } from "../contract-support/fixtures/goal-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1 } from "../contract-support/fixtures/goal-fixtures.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";

const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;

describe("validateCreateGoalCommand", () => {
  it("accepts the versioned shape", () => {
    const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: FIXED_ISO_2026_09_05 });
    expect(validateCreateGoalCommand(cmd)).toEqual([]);
  });

  it("rejects unknown schema version and wrong command type", () => {
    const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: "t" });
    expect(validateCreateGoalCommand({ ...cmd, schemaVersion: 2 })).toContainEqual(
      expect.objectContaining({ code: "unknown_schema_version" }),
    );
    expect(validateCreateGoalCommand({ ...cmd, commandType: "Nope" })).toContainEqual(
      expect.objectContaining({ code: "invalid_command_type" }),
    );
  });

  it("rejects wrong expectedRevision and empty-after-normalization objective", () => {
    const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: "t" });
    expect(validateCreateGoalCommand({ ...cmd, expectedRevision: 1 })).toContainEqual(
      expect.objectContaining({ code: "bad_expected_revision" }),
    );
    const blank = buildCreateGoalCommand(
      { ...scope, objective: " \u00a0 " },
      { commandId: "cmd-1", correlationId: "c", submittedAt: "t" },
    );
    expect(validateCreateGoalCommand(blank)).toContainEqual(
      expect.objectContaining({ code: "empty_objective" }),
    );
  });

  it("reports missing identity fields", () => {
    const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: "t" });
    const issues = validateCreateGoalCommand({
      ...cmd,
      identity: { ...cmd.identity, projectId: "" },
    });
    expect(issues.some((i) => i.path === "identity.projectId")).toBe(true);
  });
});

describe("validateWorkspaceBootstrapFixture", () => {
  it("accepts MVP fixture", () => {
    expect(validateWorkspaceBootstrapFixture(WORKSPACE_BOOTSTRAP_FIXTURE_V1)).toEqual([]);
  });

  it("rejects empty entries and duplicates", () => {
    expect(validateWorkspaceBootstrapFixture({ schemaVersion: 1, entries: [] })).toContainEqual(
      expect.objectContaining({ code: "empty_entries" }),
    );
    expect(
      validateWorkspaceBootstrapFixture({
        schemaVersion: 1,
        entries: [
          { projectId: "p", workspaceId: "w" },
          { projectId: "p", workspaceId: "w" },
        ],
      }),
    ).toContainEqual(expect.objectContaining({ code: "duplicate_identity" }));
  });

  it("rejects incomplete scope", () => {
    const issues = validateWorkspaceBootstrapFixture({
      schemaVersion: 1,
      entries: [{ projectId: "p" }],
    });
    expect(issues.some((i) => i.code === "incomplete_scope")).toBe(true);
    expect(issues.some((i) => i.path === "entries[0].workspaceId")).toBe(true);
  });
});

describe("validateWorkspaceBootstrapCommand", () => {
  it("accepts built command and rejects digest mismatch", () => {
    const cmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "c1", correlationId: "c", submittedAt: "t" });
    expect(validateWorkspaceBootstrapCommand(cmd)).toEqual([]);
    expect(
      validateWorkspaceBootstrapCommand({ ...cmd, payload: { ...cmd.payload, sourceDigest: "deadbeef" } }),
    ).toContainEqual(expect.objectContaining({ code: "digest_mismatch" }));
  });
});

describe("validateDomainEvent", () => {
  it("accepts a goal event and rejects unknown version/type", () => {
    const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-1", correlationId: "c", submittedAt: "t" });
    const event = goalCreatedEventFor(cmd, { eventId: "e1", occurredAt: "t" });
    expect(validateDomainEvent(event)).toEqual([]);
    expect(validateDomainEvent({ ...event, schemaVersion: 99 })).toContainEqual(
      expect.objectContaining({ code: "unknown_schema_version" }),
    );
    expect(validateDomainEvent({ ...event, eventType: "SomethingElse" })).toContainEqual(
      expect.objectContaining({ code: "unknown_event_type" }),
    );
  });
});
