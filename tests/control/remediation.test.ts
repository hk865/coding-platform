/**
 * P1-13 lane-B unit tests: RemediationEngineImpl (patch / task / dedup / advance)
 * over a real ControlEngineImpl + real InMemoryLedger (RecordingLedger captures
 * the submitted commit for fold-equality).
 *
 * Setup: bootstrap + goal + CP/AB governance via p111BootstrapGoalGovernance
 * (real ledger), the active ArchitectureEvolutionPolicy installed + activated
 * through the REAL third-branch ledger validators (buildP113InstallLedgerCommit /
 * buildP113ActivateLedgerCommit — lane A merged into main closed the validator
 * gap), and the delta finding recorded through buildRecordArchitectureFindingCommand.
 *
 * NOTE on the finding id: the P1-13 PATCH fixture (buildP113PlanPatchV1) pins
 * findingRef at P113_FINDING ("finding-p113-1"), whereas buildP112DeltaFinding
 * uses P112_FINDING_DELTA ("finding-p112-delta"). The integrator ruled the
 * scenario finding be recorded at P113_FINDING (p1-13-harness), so this suite
 * records the delta finding at P113_FINDING as well.
 */
import { describe, expect, it } from "vitest";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { p111BootstrapGoalGovernance } from "../contract-suite/p1-11-harness.js";
import {
  ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1,
  buildP113InstallCommand,
  buildP113ActivateCommand,
  buildP113InstallLedgerCommit,
  buildP113ActivateLedgerCommit,
  p113PolicyPin,
  P113_PROJECT,
} from "../../src/contracts/fixtures/architecture-evolution-policy-fixtures.js";
import {
  P113_WORKSPACE,
  P113_FINDING,
  P113_TASK,
  buildP113PlanPatchV1,
  buildP113TaskV1,
  buildP113SubmitPatchCommand,
  buildP113CreateTaskCommand,
  buildP113AdvanceTaskCommand,
  buildP113PlanPatchRecordCommit,
  buildP113TaskRecordCommit,
  buildP113TaskAdvanceCommit,
  p113PatchRef,
  p113FindingRef,
} from "../../src/contracts/fixtures/remediation-fixtures.js";
import { buildP112DeltaFinding, buildP112ReportFinding, buildRecordArchitectureFindingCommand } from "../../src/contracts/fixtures/architecture-fixtures.js";
import { architectureFindingRefFor } from "../../src/contracts/architecture-inspection.js";
import type { ArchitectureFindingV1 } from "../../src/contracts/architecture-inspection.js";
import type { RemediationPlanPatchV1, RemediationTaskV1 } from "../../src/contracts/remediation.js";
import { remediationPlanPatchRefFor } from "../../src/contracts/remediation.js";

const FIXED = FIXED_ISO_2026_09_05;
const PROJECT = P113_PROJECT;
const WS = P113_WORKSPACE;

/** Recorder over the real InMemoryLedger (captures the submitted batch). */
class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

type Harness = { ledger: RecordingLedger; engine: ReturnType<typeof createControlEngine> };

function makeHarness(): Harness {
  const ledger = new RecordingLedger();
  const deps = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: deps.clock, eventId: deps.eventId });
  return { ledger, engine };
}

/** Delta finding (allowlist-hit) recorded at the PATCH fixture's finding id. */
function deltaFindingForP113(): ArchitectureFindingV1 {
  return { ...buildP112DeltaFinding(), findingId: P113_FINDING };
}

function highRiskFindingForP113(): ArchitectureFindingV1 {
  return { ...buildP112DeltaFinding(), findingId: P113_FINDING, risk: "high" as const };
}

/** Install + activate the evolution policy through the REAL third-branch validators. */
async function installActivatePolicy(ledger: StateLedger): Promise<void> {
  const installCmd = buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, {
    commandId: "p113-cmd-policy-install",
    projectId: PROJECT,
  });
  const ir = await ledger.commit(
    buildP113InstallLedgerCommit(installCmd, { eventId: "evt-policy-install", occurredAt: FIXED }),
  );
  expect(ir.status).toBe("committed");
  const actCmd = buildP113ActivateCommand(p113PolicyPin(), {
    commandId: "p113-cmd-policy-activate",
    projectId: PROJECT,
    expectedRevision: 1,
  });
  const ar = await ledger.commit(
    buildP113ActivateLedgerCommit(actCmd, {
      eventId: "evt-policy-activate",
      occurredAt: FIXED,
      activeAggregateRevision: 1,
      projectRevision: 1,
    }),
  );
  expect(ar.status).toBe("committed");
}

async function recordFinding(
  engine: ReturnType<typeof createControlEngine>,
  finding: ArchitectureFindingV1,
  commandId = "p113-cmd-finding",
): Promise<void> {
  const result = await engine.recordArchitectureFinding(buildRecordArchitectureFindingCommand(finding, { commandId }));
  expect(result.status).toBe("committed");
}

/** Full happy-path state: bootstrap+goal+governance, active policy, delta finding, committed patch. */
async function setupCommittedPatch(): Promise<Harness> {
  const { ledger, engine } = makeHarness();
  await p111BootstrapGoalGovernance(ledger, PROJECT);
  await installActivatePolicy(ledger);
  await recordFinding(engine, deltaFindingForP113());
  const sub = await engine.submitRemediationPlanPatch(
    buildP113SubmitPatchCommand(buildP113PlanPatchV1(), { commandId: "p113-cmd-patch" }),
  );
  expect(sub.status).toBe("committed");
  return { ledger, engine };
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 100000 });
  return page.events.length;
}

async function eventTypes(ledger: StateLedger): Promise<string[]> {
  const page = await ledger.events({ afterCursor: null, limit: 100000 });
  return page.events.map((p) => p.event.eventType);
}

async function resolveTask(
  engine: ReturnType<typeof createControlEngine>,
  taskId: string,
  evidenceId = "p113-evidence-1",
): Promise<void> {
  const adv1 = await engine.advanceRemediationTask(
    buildP113AdvanceTaskCommand(taskId, 1, { status: "writing" }, { commandId: "p113-adv-w-" + taskId }),
  );
  expect(adv1.status).toBe("committed");
  const adv2 = await engine.advanceRemediationTask(
    buildP113AdvanceTaskCommand(taskId, 2, { status: "verifying" }, { commandId: "p113-adv-v-" + taskId }),
  );
  expect(adv2.status).toBe("committed");
  const adv3 = await engine.advanceRemediationTask(
    buildP113AdvanceTaskCommand(
      taskId,
      3,
      {
        status: "resolved",
        evidenceRefs: [{ aggregateType: "Evidence" as const, projectId: PROJECT, evidenceId }],
        result: { workspaceRevisionAfter: 2, verified: true, outcome: "PASS" },
      },
      { commandId: "p113-adv-r-" + taskId },
    ),
  );
  expect(adv3.status).toBe("committed");
}

describe("remediation: happy path", () => {
  it("patch committed (verdict recompute consistent) -> task committed -> advance to resolved; event order + fold-equality", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    await recordFinding(engine, deltaFindingForP113());
    // engine eventId sequence so far: recordArchitectureFinding consumed evt-0001.
    const evtPatch = "evt-0002";

    const patch = buildP113PlanPatchV1();
    const patchCmd = buildP113SubmitPatchCommand(patch, { commandId: "p113-cmd-patch" });
    const sub = await engine.submitRemediationPlanPatch(patchCmd);
    expect(sub.status).toBe("committed");
    if (sub.status !== "committed") return;
    expect(sub.replayed).toBe(false);
    expect(sub.patchRef).toEqual(remediationPlanPatchRefFor(PROJECT, WS, patch.patchId));
    // Engine authority: verdict replaced by the recompute (== default allowed verdict).
    const expectedPatch: RemediationPlanPatchV1 = { ...patch, verdict: { allowed: true, reasons: [] } };
    const expectedPatchCmd = buildP113SubmitPatchCommand(expectedPatch, { commandId: "p113-cmd-patch" });
    const expectedPatchBatch = buildP113PlanPatchRecordCommit(expectedPatchCmd, { eventId: evtPatch, occurredAt: FIXED, recordedAt: FIXED });
    expect(ledger.commits[ledger.commits.length - 1]!).toEqual(expectedPatchBatch);
    const patchLoad = await ledger.load(remediationPlanPatchRefFor(PROJECT, WS, patch.patchId));
    expect(patchLoad.status).toBe("found");

    // ---- create task ----
    const taskCmd = buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" });
    const taskReceipt = await engine.createRemediationTask(taskCmd);
    expect(taskReceipt.status).toBe("committed");
    if (taskReceipt.status !== "committed") return;
    expect(taskReceipt.deduplicated).toBe(false);
    expect(taskReceipt.existingTaskRef).toBeNull();
    const expectedTask: RemediationTaskV1 = buildP113TaskV1("pending", { createdAt: FIXED, updatedAt: FIXED });
    const expectedTaskBatch = buildP113TaskRecordCommit(taskCmd, { eventId: "evt-0003", occurredAt: FIXED, task: expectedTask });
    expect(ledger.commits[ledger.commits.length - 1]!).toEqual(expectedTaskBatch);

    // ---- advance writing / verifying / resolved ----
    const adv1 = await engine.advanceRemediationTask(
      buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-cmd-adv-1" }),
    );
    expect(adv1.status).toBe("committed");
    const writingTask: RemediationTaskV1 = { ...expectedTask, status: "writing", updatedAt: FIXED };
    expect(ledger.commits[ledger.commits.length - 1]!).toEqual(
      buildP113TaskAdvanceCommit(
        buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-cmd-adv-1" }),
        { eventId: "evt-0004", occurredAt: FIXED, nextRevision: 2, task: writingTask },
      ),
    );

    const adv2 = await engine.advanceRemediationTask(
      buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "verifying" }, { commandId: "p113-cmd-adv-2" }),
    );
    expect(adv2.status).toBe("committed");
    const verifyingTask: RemediationTaskV1 = { ...writingTask, status: "verifying" };
    expect(ledger.commits[ledger.commits.length - 1]!).toEqual(
      buildP113TaskAdvanceCommit(
        buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "verifying" }, { commandId: "p113-cmd-adv-2" }),
        { eventId: "evt-0005", occurredAt: FIXED, nextRevision: 3, task: verifyingTask },
      ),
    );

    const evidenceRef = { aggregateType: "Evidence" as const, projectId: PROJECT, evidenceId: "p113-evidence-1" };
    const adv3 = await engine.advanceRemediationTask(
      buildP113AdvanceTaskCommand(
        P113_TASK,
        3,
        { status: "resolved", evidenceRefs: [evidenceRef], result: { workspaceRevisionAfter: 2, verified: true, outcome: "PASS" } },
        { commandId: "p113-cmd-adv-3" },
      ),
    );
    expect(adv3.status).toBe("committed");
    const resolvedTask: RemediationTaskV1 = { ...verifyingTask, status: "resolved", evidenceRefs: [evidenceRef], result: { workspaceRevisionAfter: 2, verified: true, outcome: "PASS" } };
    expect(ledger.commits[ledger.commits.length - 1]!).toEqual(
      buildP113TaskAdvanceCommit(
        buildP113AdvanceTaskCommand(
          P113_TASK,
          3,
          { status: "resolved", evidenceRefs: [evidenceRef], result: { workspaceRevisionAfter: 2, verified: true, outcome: "PASS" } },
          { commandId: "p113-cmd-adv-3" },
        ),
        { eventId: "evt-0006", occurredAt: FIXED, nextRevision: 4, task: resolvedTask },
      ),
    );

    const types = (await eventTypes(ledger)).filter((t) => t.startsWith("Remediation"));
    expect(types).toEqual([
      "RemediationPlanPatchRecorded",
      "RemediationTaskCreated",
      "RemediationTaskAdvanced",
      "RemediationTaskAdvanced",
      "RemediationTaskAdvanced",
    ]);

    const taskLoad = await ledger.load({ aggregateType: "RemediationTask" as const, projectId: PROJECT, workspaceId: WS, taskId: P113_TASK });
    expect(taskLoad.status).toBe("found");
    if (taskLoad.status === "found") {
      const snap = taskLoad.snapshot as { task: RemediationTaskV1 };
      expect(snap.task.status).toBe("resolved");
      expect(snap.task.result?.verified).toBe(true);
      expect(snap.task.result?.outcome).toBe("PASS");
      expect(snap.task.evidenceRefs).toEqual([evidenceRef]);
    }
  });
});

describe("remediation: submit guards (zero write)", () => {
  it("finding missing -> not_found, zero write", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    const before = await eventCount(ledger);
    const patch = buildP113PlanPatchV1({ findingRef: architectureFindingRefFor(PROJECT, WS, "finding-p113-ghost"), findingId: "finding-p113-ghost" });
    const sub = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(patch, { commandId: "p113-cmd-patch" }));
    expect(sub.status).toBe("rejected");
    if (sub.status === "rejected") expect(sub.code).toBe("not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("policy not installed/activated -> policy_unresolved, zero write", async () => {
    const { ledger, engine } = makeHarness();
    // bootstrap+goal+governance (CP/AB active) but NO evolution policy.
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await recordFinding(engine, deltaFindingForP113());
    const before = await eventCount(ledger);
    const sub = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(buildP113PlanPatchV1(), { commandId: "p113-cmd-patch" }));
    expect(sub.status).toBe("rejected");
    if (sub.status === "rejected") expect(sub.code).toBe("policy_unresolved");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("report finding (no deltaRef) -> allowlist_rejected with reasons, zero write", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    const reportFinding: ArchitectureFindingV1 = { ...buildP112ReportFinding(), findingId: P113_FINDING };
    await recordFinding(engine, reportFinding);
    const before = await eventCount(ledger);
    const patch = buildP113PlanPatchV1({ findingRef: p113FindingRef(), findingId: P113_FINDING });
    const sub = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(patch, { commandId: "p113-cmd-patch" }));
    expect(sub.status).toBe("rejected");
    if (sub.status === "rejected") {
      expect(sub.code).toBe("allowlist_rejected");
      expect(sub.issues).toContain("material_or_ambiguous_finding_requires_decision_brief");
    }
    expect(await eventCount(ledger)).toBe(before);
  });

  it("high-risk finding exceeds allowlist max -> allowlist_rejected (risk_exceeds_allowlist_max), zero write", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    await recordFinding(engine, highRiskFindingForP113());
    const before = await eventCount(ledger);
    const patch = buildP113PlanPatchV1({ findingRef: p113FindingRef(), findingId: P113_FINDING });
    const sub = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(patch, { commandId: "p113-cmd-patch" }));
    expect(sub.status).toBe("rejected");
    if (sub.status === "rejected") {
      expect(sub.code).toBe("allowlist_rejected");
      expect(sub.issues).toContain("risk_exceeds_allowlist_max");
    }
    expect(await eventCount(ledger)).toBe(before);
  });

  it("stale finding (patch.workspaceRevision != finding) -> stale_finding, zero write", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    await recordFinding(engine, deltaFindingForP113()); // finding.workspaceRevision = 2
    const before = await eventCount(ledger);
    const patch = buildP113PlanPatchV1({ workspaceRevision: 3 });
    const sub = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(patch, { commandId: "p113-cmd-patch" }));
    expect(sub.status).toBe("rejected");
    if (sub.status === "rejected") expect(sub.code).toBe("stale_finding");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("recompute is authoritative: patch.verdict.allowed=true with fail reasons is recorded with the recomputed verdict", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    await recordFinding(engine, deltaFindingForP113());
    const patch = buildP113PlanPatchV1({ verdict: { allowed: true, reasons: ["someone_set_a_reason"] } });
    const sub = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(patch, { commandId: "p113-cmd-patch" }));
    expect(sub.status).toBe("committed");
    const loaded = await ledger.load(remediationPlanPatchRefFor(PROJECT, WS, patch.patchId));
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    const snap = loaded.snapshot as { patch: RemediationPlanPatchV1 };
    expect(snap.patch.verdict).toEqual({ allowed: true, reasons: [] });
  });
});

describe("remediation: createTask guards + dedup", () => {
  it("patch missing -> patch_not_found, zero write", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    await recordFinding(engine, deltaFindingForP113());
    const before = await eventCount(ledger);
    const ghostPatchRef = remediationPlanPatchRefFor(PROJECT, WS, "patch-p113-ghost");
    const result = await engine.createRemediationTask(buildP113CreateTaskCommand(ghostPatchRef, { commandId: "p113-cmd-task" }));
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("patch_not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("same dedup key with a DIFFERENT taskId -> deduplicated=true + existingTaskRef, zero write", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    const first = await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    const before = await eventCount(ledger);
    const dedup = await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task-2", taskId: "task-p113-1-dup" }));
    expect(dedup.status).toBe("committed");
    if (dedup.status === "committed") {
      expect(dedup.deduplicated).toBe(true);
      expect(dedup.existingTaskRef?.taskId).toBe(P113_TASK);
      expect(dedup.replayed).toBe(false);
    }
    expect(await eventCount(ledger)).toBe(before);
  });

  it("terminal (resolved) does NOT occupy the dedup key -> a new task on the same key is allowed", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    const first = await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    expect(first.status).toBe("committed");
    await resolveTask(engine, P113_TASK);
    const before = await eventCount(ledger);
    const second = await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task-after", taskId: "task-p113-after" }));
    expect(second.status).toBe("committed");
    if (second.status === "committed") expect(second.deduplicated).toBe(false);
    expect(await eventCount(ledger)).toBe(before + 1);
  });

  it("replay of the SAME create command -> committed/replayed (idempotent, not deduplicated)", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    const cmd = buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" });
    const first = await engine.createRemediationTask(cmd);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    const firstEventIds = first.eventIds;
    const replay = await engine.createRemediationTask(cmd);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") {
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(firstEventIds);
      expect(replay.deduplicated).toBe(false);
    }
  });
});

describe("remediation: advance guards (zero write)", () => {
  it("task missing -> not_found, zero write", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    const before = await eventCount(ledger);
    const result = await engine.advanceRemediationTask(buildP113AdvanceTaskCommand("task-p113-ghost", 1, { status: "writing" }, { commandId: "p113-adv-ghost" }));
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("terminal status -> terminal_status, zero write", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    await resolveTask(engine, P113_TASK);
    const before = await eventCount(ledger);
    const result = await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 4, { status: "failed" }, { commandId: "p113-adv-after" }));
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("terminal_status");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("no evidence on resolved -> evidence_mismatch, zero write", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-adv-w" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "verifying" }, { commandId: "p113-adv-v" }));
    const before = await eventCount(ledger);
    const result = await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 3, { status: "resolved" }, { commandId: "p113-adv-r" }));
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("evidence_mismatch");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("result.verified=false on resolved -> evidence_mismatch, zero write", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-adv-w" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "verifying" }, { commandId: "p113-adv-v" }));
    const before = await eventCount(ledger);
    const result = await engine.advanceRemediationTask(
      buildP113AdvanceTaskCommand(P113_TASK, 3, {
        status: "resolved",
        evidenceRefs: [{ aggregateType: "Evidence" as const, projectId: PROJECT, evidenceId: "e" }],
        result: { workspaceRevisionAfter: 2, verified: false, outcome: "FAIL" },
      }, { commandId: "p113-adv-r" }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("evidence_mismatch");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("stale workspaceRevisionAfter (< patch.workspaceRevision) on resolved -> evidence_mismatch, zero write", async () => {
    const { ledger, engine } = await setupCommittedPatch(); // patch.workspaceRevision = 2
    await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-adv-w" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "verifying" }, { commandId: "p113-adv-v" }));
    const before = await eventCount(ledger);
    const result = await engine.advanceRemediationTask(
      buildP113AdvanceTaskCommand(P113_TASK, 3, {
        status: "resolved",
        evidenceRefs: [{ aggregateType: "Evidence" as const, projectId: PROJECT, evidenceId: "e" }],
        result: { workspaceRevisionAfter: 1, verified: true, outcome: "PASS" },
      }, { commandId: "p113-adv-r" }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("evidence_mismatch");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("illegal transition pending -> resolved -> invalid, zero write", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    const before = await eventCount(ledger);
    const result = await engine.advanceRemediationTask(
      buildP113AdvanceTaskCommand(P113_TASK, 1, {
        status: "resolved",
        evidenceRefs: [{ aggregateType: "Evidence" as const, projectId: PROJECT, evidenceId: "e" }],
        result: { workspaceRevisionAfter: 2, verified: true, outcome: "PASS" },
      }, { commandId: "p113-adv-skip" }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("invalid");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("writing -> blocked is legal and blocked is terminal", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    const w = await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-adv-w" }));
    expect(w.status).toBe("committed");
    const blk = await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "blocked" }, { commandId: "p113-adv-b" }));
    expect(blk.status).toBe("committed");
    const after = await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 3, { status: "verifying" }, { commandId: "p113-adv-x" }));
    expect(after.status).toBe("rejected");
    if (after.status === "rejected") expect(after.code).toBe("terminal_status");
  });

  it("verifying -> failed is legal", async () => {
    const { ledger, engine } = await setupCommittedPatch();
    await engine.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-adv-w" }));
    await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "verifying" }, { commandId: "p113-adv-v" }));
    const failed = await engine.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 3, { status: "failed" }, { commandId: "p113-adv-f" }));
    expect(failed.status).toBe("committed");
    const taskLoad = await ledger.load({ aggregateType: "RemediationTask" as const, projectId: PROJECT, workspaceId: WS, taskId: P113_TASK });
    if (taskLoad.status === "found") expect((taskLoad.snapshot as { task: RemediationTaskV1 }).task.status).toBe("failed");
  });
});

describe("remediation: submit idempotency", () => {
  it("replay of an identical acceptance command -> committed/replayed, same eventIds & cursor", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    await recordFinding(engine, deltaFindingForP113());
    const cmd = buildP113SubmitPatchCommand(buildP113PlanPatchV1(), { commandId: "p113-cmd-patch-idem" });
    const first = await engine.submitRemediationPlanPatch(cmd);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    const firstEventIds = first.eventIds;
    const firstPatchRef = first.patchRef;
    const replay = await engine.submitRemediationPlanPatch(cmd);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") {
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(firstEventIds);
      expect(replay.patchRef).toEqual(firstPatchRef);
    }
  });

  it("same identity, different payload -> idempotency_conflict (via ledger)", async () => {
    const { ledger, engine } = makeHarness();
    await p111BootstrapGoalGovernance(ledger, PROJECT);
    await installActivatePolicy(ledger);
    await recordFinding(engine, deltaFindingForP113());
    const first = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(buildP113PlanPatchV1(), { commandId: "p113-cmd-patch-x" }));
    expect(first.status).toBe("committed");
    const differentPatch = buildP113PlanPatchV1({ proposedPatch: { changedPaths: ["src/other.ts"], changeSummary: "other", bodyRef: null } });
    const second = await engine.submitRemediationPlanPatch(buildP113SubmitPatchCommand(differentPatch, { commandId: "p113-cmd-patch-x" }));
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") expect(second.code).toBe("idempotency_conflict");
  });
});
