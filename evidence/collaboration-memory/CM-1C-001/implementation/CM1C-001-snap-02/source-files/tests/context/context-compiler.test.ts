import { describe, expect, it } from "vitest";
import { ContextCompilerImpl } from "../../src/data/context-compiler/context-compiler.js";
import { ScriptedStateLedger, notFoundResult } from "../contract-support/testing/state-ledger.double.js";
import type { AggregateRef, SnapshotResult } from "../../src/contracts/ledger.js";
import { ArtifactVault } from "../../src/data/artifact-vault/artifact-vault.js";
import { artifactBodyDigest, artifactBodySize } from "../../src/contracts/artifact.js";
import type {
  ArtifactOpenResult,
  ArtifactPort,
  ArtifactPutRecord,
  ArtifactPutResult,
  ArtifactRef,
} from "../../src/contracts/artifact.js";
import type { TaskContextRequestV1 } from "../../src/contracts/task-envelope.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import {
  BUDGET_FIXTURE_V1,
  DECLARED_PERMISSIONS_FIXTURE_V1,
  DISPATCH_ELIGIBLE_TASK_ID,
  DISPATCH_PLAN_REVISION_FIXTURE_V1,
  ROLE_BINDING_FIXTURE_V1,
} from "../../src/fixtures/dispatch-fixtures.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../../src/contracts/governance.js";
import { buildEnvelopeFixture } from "../../src/fixtures/dispatch-fixtures.js";
import { validateTaskEnvelope } from '../../src/contracts/validation/dispatch.js';

const NOW = "2026-09-05T12:00:00.000Z";
const now = () => NOW;
const REQUEST_ID = "req-1";
const RUN = runRefFor("proj-alpha", "goal-1", "run-0001");
const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: "proj-alpha", planId: "plan-dispatch-mvp" };

/** Minimal, well-typed PlanRevisionSnapshot reusing the shared dispatch fixtures. */
function buildPlanSnapshot(): PlanRevisionSnapshot {
  const draft = DISPATCH_PLAN_REVISION_FIXTURE_V1;
  return {
    ref: PLAN_REF,
    revision: 1,
    schemaVersion: 1,
    goalRef: { aggregateType: "Goal", projectId: "proj-alpha", goalId: draft.goalId },
    planId: draft.planId,
    planRevision: draft.planRevision,
    acceptedAt: NOW,
    effectiveCompletionPolicy: {} as CompletionPolicyPin,
    effectiveArchitectureBaseline: {} as ArchitectureBaselinePin,
    stages: draft.stages,
    tasks: draft.tasks,
    obligations: draft.obligations,
    taskHierarchy: draft.taskHierarchy,
    executionDag: draft.executionDag,
  };
}

function buildLedger(canonicalWsRevision: number, planSnap: PlanRevisionSnapshot): ScriptedStateLedger {
  return new ScriptedStateLedger({
    load: (ref: AggregateRef): SnapshotResult => {
      if (ref.aggregateType === "Workspace") {
        return { status: "found", snapshot: { ref, revision: canonicalWsRevision } };
      }
      if (ref.aggregateType === "PlanRevision") {
        return { status: "found", snapshot: planSnap };
      }
      return notFoundResult(ref);
    },
  });
}

/** A recording vault that asserts vault.put happens BEFORE assemble returns ready. */
class SpyVault implements ArtifactPort {
  readonly puts: ArtifactPutRecord[] = [];
  async put(record: ArtifactPutRecord): Promise<ArtifactPutResult> {
    this.puts.push(record);
    const ref: ArtifactRef = {
      kind: "artifact",
      contentType: record.contentType,
      digest: artifactBodyDigest(record.body),
      sizeBytes: artifactBodySize(record.body),
      source: record.sourceRefs[0]!,
    };
    return { status: "stored", ref, replayed: false };
  }
  async open(): Promise<ArtifactOpenResult> {
    return { status: "unavailable", ref: {} as ArtifactRef };
  }
}

function makeRequest(overrides: Partial<TaskContextRequestV1> = {}): TaskContextRequestV1 {
  return {
    schemaVersion: 1,
    requestId: REQUEST_ID,
    projectId: "proj-alpha",
    workspaceId: "ws-shared",
    goalId: "goal-1",
    taskId: DISPATCH_ELIGIBLE_TASK_ID,
    planRef: PLAN_REF,
    runRef: RUN,
    attemptRef: taskAttemptRefFor("proj-alpha", "goal-1", DISPATCH_ELIGIBLE_TASK_ID, "att-run-0001"),
    roleBinding: ROLE_BINDING_FIXTURE_V1,
    workspaceSnapshot: { workspaceId: "ws-shared", revision: 2 },
    declaredPermissions: DECLARED_PERMISSIONS_FIXTURE_V1,
    scope: { tools: ["read"], writeScope: ["src/contracts"] },
    budget: BUDGET_FIXTURE_V1,
    submittedAt: NOW,
    ...overrides,
  };
}

function compiler(ledger: ScriptedStateLedger, vault: ArtifactPort): ContextCompilerImpl {
  return new ContextCompilerImpl({ ledger, vault, now });
}

describe("ContextCompilerImpl.assemble", () => {
  it("returns ready with a bounded envelope, a manifest and a body-first bundleRef", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(makeRequest());

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const { envelope, manifest, bundleRef } = result;

    // body-first: vault.put received the bundle body exactly once, and its
    // digest flows into the returned bundleRef.
    expect(vault.puts).toHaveLength(1);
    const body = vault.puts[0]!.body;
    expect(bundleRef.digest).toBe(artifactBodyDigest(body));
    expect(bundleRef.contentType).toBe("application/json");
    expect(bundleRef.source).toEqual(vault.puts[0]!.sourceRefs[0]);

    // Envelope binds the workspace revision, permissions, budget and binding.
    expect(envelope.envelopeId).toBe("env-" + REQUEST_ID);
    expect(envelope.projectId).toBe("proj-alpha");
    expect(envelope.workspaceId).toBe("ws-shared");
    expect(envelope.goalId).toBe("goal-1");
    expect(envelope.taskId).toBe(DISPATCH_ELIGIBLE_TASK_ID);
    expect(envelope.workspaceSnapshot).toEqual({ workspaceId: "ws-shared", revision: 2 });
    expect(envelope.permissions).toEqual({
      policyRevision: ROLE_BINDING_FIXTURE_V1.policyRevision,
      tools: ["read"],
      writeScope: ["src/contracts"],
    });
    expect(envelope.budget).toEqual(BUDGET_FIXTURE_V1);
    expect(envelope.roleBinding).toEqual(ROLE_BINDING_FIXTURE_V1);
    expect(envelope.planRef).toEqual(PLAN_REF);
    expect(envelope.bundleRef).toEqual(bundleRef);
    expect(envelope.sourceRefs).toEqual([
      { kind: "plan-revision", refId: "plan-dispatch-mvp", revision: "1", digest: "plan-dispatch-mvp" },
      { kind: "workspace", refId: "ws-shared", revision: "2" },
    ]);
    expect(envelope.sourceRefs).not.toContainEqual(expect.objectContaining({ kind: "artifact" }));

    // Manifest: honest selectedRefs, no gaps, correct freshness.
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.gaps).toEqual([]);
    expect(manifest.selectedRefs).toEqual(envelope.sourceRefs);
    expect(manifest.freshness).toEqual({
      workspaceSnapshot: { workspaceId: "ws-shared", revision: 2 },
      planRef: PLAN_REF,
    });

    // Bundle body is bounded canonical JSON: task title + obligation SUMMARY,
    // NO full transcript.
    const bundle = JSON.parse(body);
    expect(bundle.projectId).toBe("proj-alpha");
    expect(bundle.task).toEqual({
      title: "经 DispatchEngine 唯一领取并运行 FakeRuntime",
      obligations: [{ obligationId: "obl-run", title: "eligible Task 被唯一领取并产生可重放 Run facts" }],
    });
    expect(bundle.sources).toEqual(envelope.sourceRefs);
    expect(bundle.transcript).toBeUndefined();
  });

  it("stores the bundle body first and the owner run can read it back", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new ArtifactVault();
    const result = await compiler(ledger, vault).assemble(makeRequest());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const opened = await vault.open(result.bundleRef, { requesterRunRef: RUN });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") return;
    const parsed = JSON.parse(opened.record.body);
    expect(parsed.projectId).toBe("proj-alpha");
    expect(parsed.task.title).toBe("经 DispatchEngine 唯一领取并运行 FakeRuntime");
  });

  it("returns needs_material (plan gap) and does not write the vault", async () => {
    const smart = buildPlanSnapshot();
    const ledger = new ScriptedStateLedger({
      load: (ref: AggregateRef): SnapshotResult => {
        if (ref.aggregateType === "Workspace") {
          return { status: "found", snapshot: { ref, revision: 2 } };
        }
        if (ref.aggregateType === "PlanRevision") return notFoundResult(ref);
        return notFoundResult(ref);
      },
    });
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(makeRequest());
    expect(result.status).toBe("needs_material");
    if (result.status !== "needs_material") return;
    expect(result.gaps).toEqual([
      { kind: "plan-revision", refId: "plan-dispatch-mvp", message: "accepted PlanRevision not found in the ledger" },
    ]);
    expect(result.selectedRefs).toEqual([{ kind: "workspace", refId: "ws-shared", revision: "2" }]);
    expect(vault.puts).toHaveLength(0);
    expect(ledger.commits).toHaveLength(0);
    expect(smart.tasks.length).toBeGreaterThan(0);
  });

  it("returns needs_material (workspace gap)", async () => {
    const ledger = new ScriptedStateLedger({
      load: (ref: AggregateRef): SnapshotResult => {
        if (ref.aggregateType === "Workspace") return notFoundResult(ref);
        if (ref.aggregateType === "PlanRevision") return { status: "found", snapshot: buildPlanSnapshot() };
        return notFoundResult(ref);
      },
    });
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(makeRequest());
    expect(result.status).toBe("needs_material");
    if (result.status !== "needs_material") return;
    expect(result.gaps).toEqual([
      { kind: "workspace-snapshot", refId: "ws-shared", message: "Workspace not found in the ledger" },
    ]);
    expect(result.selectedRefs).toEqual([
      { kind: "plan-revision", refId: "plan-dispatch-mvp", revision: "1", digest: "plan-dispatch-mvp" },
    ]);
    expect(vault.puts).toHaveLength(0);
    expect(ledger.commits).toHaveLength(0);
  });

  it("rejects a stale workspace snapshot (canonical 2, request 1) with zero writes", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(
      makeRequest({ workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 } }),
    );
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("stale_workspace_snapshot");
    expect(vault.puts).toHaveLength(0);
    expect(ledger.commits).toHaveLength(0);
  });

  it("rejects a tool outside declared permissions with zero writes", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(
      makeRequest({ scope: { tools: ["read", "sync"], writeScope: ["src/contracts"] } }),
    );
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("forbidden_tool_or_scope");
    expect(result.issues.some((m) => m.includes("'sync'"))).toBe(true);
    expect(vault.puts).toHaveLength(0);
    expect(ledger.commits).toHaveLength(0);
  });

  it("rejects a writeScope outside declared permissions", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(
      makeRequest({ scope: { tools: ["read"], writeScope: ["src/harness"] } }),
    );
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("forbidden_tool_or_scope");
    expect(result.issues.some((m) => m.includes("'src/harness'"))).toBe(true);
    expect(vault.puts).toHaveLength(0);
  });

  it("rejects a passed deadline as budget_exhausted with zero writes", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(
      makeRequest({ budget: { tokenBudget: 100_000, deadline: "2020-01-01T00:00:00.000Z" } }),
    );
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("budget_exhausted");
    expect(vault.puts).toHaveLength(0);
    expect(ledger.commits).toHaveLength(0);
  });

  it("rejects an invalid request (unknown schema version)", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(makeRequest({ schemaVersion: 2 as never }));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("invalid_request");
    expect(vault.puts).toHaveLength(0);
  });

  it("maps a zero token budget to invalid_request (validation subsumes it before the budget check)", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const result = await compiler(ledger, vault).assemble(
      makeRequest({ budget: { tokenBudget: 0, deadline: null } }),
    );
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("invalid_request");
    expect(vault.puts).toHaveLength(0);
  });

  it("rejects an envelope that exceeds the 64KiB cap AFTER body-first storage", async () => {
    const ledger = buildLedger(2, buildPlanSnapshot());
    const vault = new SpyVault();
    const bigId = "x".repeat(70_000);
    const result = await compiler(ledger, vault).assemble(
      makeRequest({ roleBinding: { ...ROLE_BINDING_FIXTURE_V1, templateId: bigId } }),
    );
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("exceeds_size_cap");
    // The bounded bundle body WAS stored first (body-first), still well under the
    // vault cap — but assemble does not return a queryable reference.
    expect(vault.puts).toHaveLength(1);
    expect(artifactBodySize(vault.puts[0]!.body)).toBeLessThan(256 * 1024);
  });

  it("validateTaskEnvelope unit: an oversized envelope is detected (size cap)", () => {
    const bundleRef: ArtifactRef = {
      kind: "artifact",
      contentType: "application/json",
      digest: "abc",
      sizeBytes: 20,
      source: { kind: "plan-revision", refId: "plan-dispatch-mvp", revision: "1" },
    };
    const environment = buildEnvelopeFixture({
      envelopeId: "env-x",
      projectId: "proj-alpha",
      workspaceId: "ws-shared",
      goalId: "goal-1",
      taskId: DISPATCH_ELIGIBLE_TASK_ID,
      runId: "run-0001",
      attemptId: "att-run-0001",
      planRef: PLAN_REF,
      workspaceRevision: 2,
      bundleRef,
      roleBinding: { ...ROLE_BINDING_FIXTURE_V1, templateId: "x".repeat(70_000) },
    });
    const issues = validateTaskEnvelope(environment);
    expect(issues.some((i) => i.code === "size_exceeded")).toBe(true);
  });
});
