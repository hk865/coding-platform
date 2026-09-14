/**
 * P1-02 integration test — REAL SQLite adapters (SqliteStateLedger +
 * SqliteReadModelIndex + ControlEngineImpl + HumanCollaborationImpl), no fakes.
 * Covers the ticket Acceptance items end-to-end:
 *   bootstrap -> install(CompletionPolicy/ArchitectureBaseline) ->
 *   activate (CAS) -> CreateGoal -> applyPlan (pins) -> SQLite commit ->
 *   close -> reopen -> canonical refs/pins/Plan Graph/Task Detail/active
 *   revision identical; immutability; CAS failures zero-write; idempotency;
 *   pin immutability under active-ref movement; no dispatch outbox.
 */
import { describe, expect, it } from "vitest";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildActivateCommand,
  buildInstallCommand,
  completionPolicyPinFor,
  architectureBaselinePinFor,
} from "../../src/fixtures/governance-fixtures.js";
import {
  HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1,
  buildApplyPlanCommand,
} from "../../src/fixtures/plan-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { runP102Path, verifyP102AfterRestart } from "../restart/p1-02-restart-fixtures.js";

const SCHEMA = "2026-09-05T12:00:00.000Z";

describe("P1-02 integration (real SQLite adapters)", () => {
  it("A1-A4: fixture digest/schema; install persists immutable revision; same identity/revision never overwritten", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
        commandId: "cmd-int-boot", correlationId: "corr", submittedAt: SCHEMA,
      }));
      // fixture carries explicit schemaVersion + identity + revision + digest
      expect(COMPLETION_POLICY_FIXTURE_V1.schemaVersion).toBe(1);
      expect(COMPLETION_POLICY_FIXTURE_V1.identity.policyId).toBe("policy-completion-mvp");
      expect(COMPLETION_POLICY_FIXTURE_V1.revision).toBe(1);

      const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
        commandId: "cmd-int-cp", correlationId: "corr", submittedAt: SCHEMA,
        projectId: "proj-alpha", idempotencyKey: "int-cp-1",
      });
      const first = await h.install(cp);
      expect(first.status).toBe("committed");

      // missing/invalid fixture -> invalid, zero-write
      const bad = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
        commandId: "cmd-int-cp-bad", correlationId: "corr", submittedAt: SCHEMA,
        projectId: "proj-alpha", idempotencyKey: "int-cp-bad",
      });
      const before = await h.ledger.events({ afterCursor: null, limit: 100 });
      if (bad.commandType !== "InstallCompletionPolicyRevision") throw new Error("kind");
      const invalid = await h.install({
        ...bad,
        payload: { ...bad.payload, fixture: { ...bad.payload.fixture, revision: 0 } },
      });
      expect(invalid.status).toBe("rejected");
      if (invalid.status !== "rejected") return;
      expect(invalid.code).toBe("invalid");

      // digest mismatch -> digest_mismatch, zero-write
      const digestMismatch = await h.install({
        ...bad,
        payload: { ...bad.payload, contentDigest: "0".repeat(64) },
      });
      expect(digestMismatch.status).toBe("rejected");
      if (digestMismatch.status !== "rejected") return;
      expect(digestMismatch.code).toBe("digest_mismatch");

      // same identity/revision with a DIFFERENT command -> revision_conflict (immutable, zero-write)
      const overwrite = await h.install(buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
        commandId: "cmd-int-cp-overwrite", correlationId: "corr", submittedAt: SCHEMA,
        projectId: "proj-alpha", idempotencyKey: "int-cp-overwrite",
      }));
      expect(overwrite.status).toBe("rejected");
      if (overwrite.status !== "rejected") return;
      expect(overwrite.code).toBe("revision_conflict");

      const after = await h.ledger.events({ afterCursor: null, limit: 100 });
      expect(after.events.length).toBe(before.events.length); // zero write on all rejections
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("A3: activation accepts only installed exact target; CAS failure leaves active ref unmoved", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
        commandId: "cmd-int-boot2", correlationId: "corr", submittedAt: SCHEMA,
      }));
      const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
        commandId: "cmd-int-cp2", correlationId: "corr", submittedAt: SCHEMA,
        projectId: "proj-alpha", idempotencyKey: "int-cp-2",
      });
      await h.install(cp);
      if (cp.commandType !== "InstallCompletionPolicyRevision") throw new Error("kind");
      const pin = completionPolicyPinFor(cp);

      // dangling target -> not_found zero-write
      const dangling = await h.activate({
        commandId: "cmd-int-act-dangling", commandType: "ActivateProjectCompletionPolicy",
        schemaVersion: 1,
        identity: { projectId: "proj-alpha", actor: { kind: "human", id: "user-1" }, idempotencyKey: "act-dangling" },
        aggregateId: "proj-alpha", expectedRevision: 1, correlationId: "corr", submittedAt: SCHEMA,
        payload: { target: { ...pin, ref: { ...pin.ref, policyId: "policy-absent" } } },
      });
      expect(dangling.status).toBe("rejected");
      if (dangling.status !== "rejected") return;
      expect(dangling.code).toBe("not_found");

      // digest mismatch -> digest_mismatch zero-write
      const dm = await h.activate({
        commandId: "cmd-int-act-dm", commandType: "ActivateProjectCompletionPolicy",
        schemaVersion: 1,
        identity: { projectId: "proj-alpha", actor: { kind: "human", id: "user-1" }, idempotencyKey: "act-dm" },
        aggregateId: "proj-alpha", expectedRevision: 1, correlationId: "corr", submittedAt: SCHEMA,
        payload: { target: { ...pin, digest: "f".repeat(64) } },
      });
      expect(dm.status).toBe("rejected");
      if (dm.status !== "rejected") return;
      expect(dm.code).toBe("digest_mismatch");

      // valid activation
      const ok = await h.activate(buildActivateCommand(pin, {
        commandId: "cmd-int-act-ok", correlationId: "corr", submittedAt: SCHEMA,
        projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "act-int-ok",
      }));
      expect(ok.status).toBe("committed");

      const activeBefore = await h.ledger.load({ aggregateType: "ProjectCompletionPolicyActive", projectId: "proj-alpha" });
      expect(activeBefore.status).toBe("found");
      if (activeBefore.status !== "found") return;
      const revBefore = (activeBefore.snapshot as { revision: number }).revision;

      // CAS race: stale expected Project revision -> revision_conflict; active ref unmoved
      const stale = await h.activate(buildActivateCommand(pin, {
        commandId: "cmd-int-act-stale", correlationId: "corr", submittedAt: SCHEMA,
        projectId: "proj-alpha", expectedRevision: 99, idempotencyKey: "act-int-stale",
      }));
      expect(stale.status).toBe("rejected");
      if (stale.status !== "rejected") return;
      expect(stale.code).toBe("revision_conflict");
      const activeAfter = await h.ledger.load({ aggregateType: "ProjectCompletionPolicyActive", projectId: "proj-alpha" });
      expect(activeAfter.status).toBe("found");
      if (activeAfter.status !== "found") return;
      expect((activeAfter.snapshot as { revision: number }).revision).toBe(revBefore);
      expect((activeAfter.snapshot as { activeRevision: unknown }).activeRevision).toEqual(pin.ref);
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("A4/A5/A6/A7/A12/A13: full path with restart; pins survive default-ref movement; idempotency", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP102Path(h);
      // plan revision bound to the goal
      expect(before.goalSnapshotActivePlan).toEqual({
        aggregateType: "PlanRevision", projectId: "proj-alpha", planId: "plan-mvp-1",
      });

      // -- restart FIRST (canonical active refs must match the pre-restart snapshot) --
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP102AfterRestart(restarted, before);

        // pin immutability: default-ref movement AFTER acceptance never changes the pin
        const cp2 = buildInstallCommand({ ...COMPLETION_POLICY_FIXTURE_V1, revision: 2, content: { ...COMPLETION_POLICY_FIXTURE_V1.content } }, {
          commandId: "cmd-int-cp2-rev2", correlationId: "corr", submittedAt: SCHEMA,
          projectId: "proj-alpha", idempotencyKey: "int-cp2-rev2",
        });
        expect((await restarted.install(cp2)).status).toBe("committed");
        if (cp2.commandType !== "InstallCompletionPolicyRevision") throw new Error("kind");
        expect((await restarted.activate(buildActivateCommand(completionPolicyPinFor(cp2), {
          commandId: "cmd-int-act-rev2", correlationId: "corr", submittedAt: SCHEMA,
          projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "int-act-rev2",
        }))).status).toBe("committed");

        // the accepted plan pins stay EXACTLY the original refs+digest
        await restarted.advanceProjection();
        const graph = await restarted.planGraph({ projectId: "proj-alpha", goalId: "goal-1" });
        expect(graph.status).toBe("ready");
        if (graph.status !== "ready") return;
        expect(graph.graph.pinnedCompletionPolicy.ref.revision).toBe(1);
        expect(graph.graph.pinnedCompletionPolicy.digest).toBe(before.planPinPolicyDigest);
        // ...while the project ACTIVE ref moved to rev2 (canonical) — pins and active refs diverge by design
        const active = await restarted.ledger.load({ aggregateType: "ProjectCompletionPolicyActive", projectId: "proj-alpha" });
        expect(active.status).toBe("found");
        if (active.status !== "found") return;
        expect((active.snapshot as { activeRevision: { revision: number } }).activeRevision.revision).toBe(2);

        // old expected revision CAS: same plan content but a DIFFERENT command identity;
        // goal is at rev2 -> CAS conflict (old expected revision rejected zero-write)
        const before2 = await restarted.ledger.events({ afterCursor: null, limit: 500 });
        const stalePlan = await restarted.control.applyPlan(buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
          commandId: "cmd-int-plan-stale", correlationId: "corr", submittedAt: SCHEMA,
          projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "int-plan-stale-dup",
        }));
        expect(stalePlan.status).toBe("rejected");
        if (stalePlan.status !== "rejected") return;
        expect(["revision_conflict", "plan_guard_failed", "invalid"]).toContain(stalePlan.code);
        const after2 = await restarted.ledger.events({ afterCursor: null, limit: 500 });
        expect(after2.events.length).toBe(before2.events.length);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("A14: no dispatch outbox / TaskAttempt / AgentRun on the whole path", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP102Path(h);
      // evidence record dedupes by first occurrence (8 event classes)
      expect(before.eventTypes).toEqual([
        "ProjectBootstrapped", "WorkspaceBootstrapped",
        "CompletionPolicyInstalled", "ArchitectureBaselineInstalled",
        "CompletionPolicyActivated", "ArchitectureBaselineActivated",
        "GoalCreated", "PlanRevisionAccepted",
      ]);
      const page = await h.ledger.events({ afterCursor: null, limit: 500 });
      // raw stream is the deterministic 10-event sequence
      expect(page.events.map((p) => p.event.eventType)).toEqual([
        "ProjectBootstrapped", "ProjectBootstrapped", "WorkspaceBootstrapped", "WorkspaceBootstrapped",
        "CompletionPolicyInstalled", "ArchitectureBaselineInstalled",
        "CompletionPolicyActivated", "ArchitectureBaselineActivated",
        "GoalCreated", "PlanRevisionAccepted",
      ]);
      const json = JSON.stringify(page);
      expect(json).not.toMatch(/TaskAttempt/);
      expect(json).not.toMatch(/AgentRun/);
      expect(json).not.toMatch(/outbox/);
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });
});
