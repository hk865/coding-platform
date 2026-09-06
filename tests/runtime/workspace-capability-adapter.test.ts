/**
 * P1-07 lane A unit tests: FakeWorkspaceCapabilityAdapter + the pure
 * evaluateWorkspaceOperation / scopeWithinCapability rules.
 *
 * Capability = runtime support matrix (per-envelope selector) ∩ declared
 * permissions (envelope.permissions.tools: "read" -> workspaceRead, "write" ->
 * workspaceWrite). A reader run (tools=["read"]) can NEVER declare
 * workspaceWrite. selector === null -> { status: "unsupported" } — never a
 * silent degrade.
 */
import { describe, expect, it } from "vitest";
import { FakeWorkspaceCapabilityAdapter, type FakeWorkspaceCapabilitySupport } from "../../src/runtime/workspace-capability-adapter.js";
import { evaluateWorkspaceOperation, scopeWithinCapability, type WorkspaceCapabilitiesV1 } from "../../src/contracts/workspace-capability.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import type { ConflictScopeV1 } from "../../src/contracts/workspace-lease.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import {
  P107_PROJECT,
  P107_WORKSPACE,
  P107_GOAL,
  P107_ROLE_BINDING_READER_V1,
  P107_BUDGET_READER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_DECLARED_WRITE_PERMISSIONS_V1,
  P107_SCOPE_WRITER,
  P107_SCOPE_READER_A,
  buildP107ArtifactRef,
  P107_TASK_READER_A,
} from "../../src/contracts/fixtures/workspace-fixtures.js";

function envelope(permissions: { tools: string[]; writeScope: string[] }, workspaceId = P107_WORKSPACE): TaskEnvelopeV1 { const fullPermissions = { policyRevision: "auth-policy-runtime-v1", ...permissions };
  const taskId = P107_TASK_READER_A;
  const runRef = runRefFor(P107_PROJECT, P107_GOAL, "run-cap-1");
  return {
    schemaVersion: 1,
    envelopeId: "env-cap-1",
    projectId: P107_PROJECT,
    workspaceId,
    goalId: P107_GOAL,
    taskId,
    runRef,
    attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, taskId, "att-cap-1"),
    planRef: { aggregateType: "PlanRevision", projectId: P107_PROJECT, planId: "plan-1" },
    roleBinding: P107_ROLE_BINDING_READER_V1,
    workspaceSnapshot: { workspaceId, revision: 1 },
    permissions: fullPermissions,
    budget: P107_BUDGET_READER_V1,
    sourceRefs: [],
    bundleRef: buildP107ArtifactRef("bundle"),
  };
}

describe("FakeWorkspaceCapabilityAdapter", () => {
  it("default selector supports read+write with no max scope", async () => {
    const adapter = new FakeWorkspaceCapabilityAdapter();
    const result = await adapter.capabilitiesFor(envelope(P107_DECLARED_WRITE_PERMISSIONS_V1));
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.capabilities.workspaceRead).toBe(true);
      expect(result.capabilities.workspaceWrite).toBe(true);
      expect(result.capabilities.maxWriteScope).toBeNull();
      expect(result.capabilities.workspaceId).toBe(P107_WORKSPACE);
      expect(result.capabilities.source).toBe("runtime");
    }
  });

  it("reader run (tools=['read']) -> workspaceWrite=false (reader never upgrades to write)", async () => {
    const adapter = new FakeWorkspaceCapabilityAdapter();
    const result = await adapter.capabilitiesFor(envelope(P107_DECLARED_READ_PERMISSIONS_V1));
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.capabilities.workspaceRead).toBe(true);
      expect(result.capabilities.workspaceWrite).toBe(false);
    }
  });

  it("read port not declared -> workspaceRead=false even when support allows it", async () => {
    const adapter = new FakeWorkspaceCapabilityAdapter();
    const result = await adapter.capabilitiesFor(envelope({ tools: ["write"], writeScope: [] }));
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.capabilities.workspaceRead).toBe(false);
      expect(result.capabilities.workspaceWrite).toBe(true);
    }
  });

  it("tools include 'write' but support matrix closes write -> workspaceWrite=false", async () => {
    const selector = () => ({ workspaceRead: true, workspaceWrite: false, maxWriteScope: null });
    const adapter = new FakeWorkspaceCapabilityAdapter(selector);
    const result = await adapter.capabilitiesFor(envelope(P107_DECLARED_WRITE_PERMISSIONS_V1));
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.capabilities.workspaceWrite).toBe(false);
  });

  it("selector returns null -> { status: 'unsupported' } (no silent degrade)", async () => {
    const adapter = new FakeWorkspaceCapabilityAdapter((_env) => null);
    const result = await adapter.capabilitiesFor(envelope(P107_DECLARED_WRITE_PERMISSIONS_V1));
    expect(result).toEqual({ status: "unsupported" });
  });

  it("maxWriteScope is carried through to the capabilities", async () => {
    const support: FakeWorkspaceCapabilitySupport = { workspaceRead: true, workspaceWrite: true, maxWriteScope: P107_SCOPE_WRITER };
    const adapter = new FakeWorkspaceCapabilityAdapter(() => support);
    const result = await adapter.capabilitiesFor(envelope(P107_DECLARED_WRITE_PERMISSIONS_V1));
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.capabilities.maxWriteScope).toEqual(P107_SCOPE_WRITER);
  });

  it("capabilitiesFor is async and does not throw on missing writeScope", async () => {
    const adapter = new FakeWorkspaceCapabilityAdapter();
    const result = await adapter.capabilitiesFor(envelope({ tools: ["read"], writeScope: [] }));
    expect(result.status).toBe("ready");
  });
});

describe("evaluateWorkspaceOperation (pure, frozen)", () => {
  const caps: WorkspaceCapabilitiesV1 = {
    schemaVersion: 1,
    workspaceId: P107_WORKSPACE,
    workspaceRead: true,
    workspaceWrite: true,
    maxWriteScope: P107_SCOPE_WRITER,
    source: "runtime",
  };

  it("no capability -> capability_unsupported (never silent)", () => {
    const verdict = evaluateWorkspaceOperation(null, { kind: "read", scope: P107_SCOPE_READER_A });
    expect(verdict).toEqual({
      allowed: false,
      code: "capability_unsupported",
      message: "no workspace capability declared (unsupported — no silent degrade)",
    });
  });

  it("workspace mismatch -> workspace_mismatch", () => {
    const verdict = evaluateWorkspaceOperation(caps, { kind: "read", scope: { ...P107_SCOPE_READER_A, workspaceId: "ws-other" } });
    expect(verdict).toMatchObject({ allowed: false, code: "workspace_mismatch" });
  });

  it("read allowed only when workspaceRead", () => {
    expect(evaluateWorkspaceOperation(caps, { kind: "read", scope: P107_SCOPE_READER_A })).toEqual({ allowed: true });
    const noRead: WorkspaceCapabilitiesV1 = { ...caps, workspaceWrite: false };
    expect(evaluateWorkspaceOperation(noRead, { kind: "write", scope: P107_SCOPE_READER_A })).toMatchObject({
      allowed: false,
      code: "capability_readonly",
    });
  });

  it("write scope exceeds the capability cap -> scope_exceeds_capability", () => {
    const inner: ConflictScopeV1 = { ...P107_SCOPE_WRITER, id: "src/p107/sub" };
    // cap is P107_SCOPE_WRITER (src/p107); inner is covered -> allowed.
    expect(evaluateWorkspaceOperation(caps, { kind: "write", scope: inner })).toEqual({ allowed: true });
    const outer: ConflictScopeV1 = { ...P107_SCOPE_WRITER, id: "src/other" };
    const verdict = evaluateWorkspaceOperation(caps, { kind: "write", scope: outer });
    expect(verdict).toMatchObject({ allowed: false, code: "scope_exceeds_capability" });
  });

  it("scopeWithinCapability: path-like cap covers descendants path, NOT a sibling", () => {
    const cap: ConflictScopeV1 = { ...P107_SCOPE_WRITER, id: "src/p107" };
    expect(scopeWithinCapability(cap, { ...P107_SCOPE_WRITER, id: "src/p107/sub" })).toBe(true);
    expect(scopeWithinCapability(cap, { ...P107_SCOPE_WRITER, id: "src/p107" })).toBe(true);
    expect(scopeWithinCapability(cap, { ...P107_SCOPE_WRITER, id: "src/other" })).toBe(false);
  });

  it("scopeWithinCapability: label cap requires exact kind+id", () => {
    const stageCap: ConflictScopeV1 = { ...P107_SCOPE_WRITER, kind: "stage", id: "stage-1" };
    expect(scopeWithinCapability(stageCap, { ...P107_SCOPE_WRITER, kind: "stage", id: "stage-1" })).toBe(true);
    expect(scopeWithinCapability(stageCap, { ...P107_SCOPE_WRITER, kind: "stage", id: "stage-2" })).toBe(false);
    // a path-like cap can never statically cover a label scope.
    expect(scopeWithinCapability(capPath(), { ...P107_SCOPE_WRITER, kind: "task", id: "t" })).toBe(false);
  });
});

function capPath(): ConflictScopeV1 {
  return { ...P107_SCOPE_WRITER, id: "src/p107" };
}
