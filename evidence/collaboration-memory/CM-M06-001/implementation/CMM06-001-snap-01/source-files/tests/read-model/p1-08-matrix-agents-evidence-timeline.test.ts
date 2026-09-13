import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-08 LANE-B InMemory projection tests — consolePlanMatrix / consoleActiveAgents /
 * consoleTaskEvidence / consoleTimeline (dual-adapter view semantics). Run the SHARED
 * two-project scenario and assert the four views field-for-field, plus rebuild
 * equivalence from the SAME event pages.
 */
import { describe, expect, it } from "vitest";
import { ReadModelIndexImpl } from "../../src/data/read-model-index/read-model-index.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import {
  createP108ScenarioRuntime,
  runP108TwoProjectScenario,
  toP1_08Harness,
  type P1_08HarnessLike,
  P108_PROJECT_A,
  P108_PROJECT_B,
  P108_WORKSPACE,
  P108_GOAL,
  P108_TASK_WORK,
  P108_TASK_GATE,
  P108_TASK_EXTRA,
  P108_EVIDENCE_WORK,
  P108_EVIDENCE_CLAIM,
} from "../contract-suite/p1-08-harness.js";

function json(v: unknown): string {
  return JSON.stringify(v);
}

async function runScenario(): Promise<{
  h: ReturnType<typeof createInMemoryHarness>;
  H: import("../contract-suite/p1-08-harness.js").P1_08TestHarness;
}> {
  const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  const H = toP1_08Harness(h as unknown as P1_08HarnessLike);
  await runP108TwoProjectScenario(H);
  return { h, H };
}

describe("P1-08 LANE-B InMemory projection", () => {
  it("consolePlanMatrix: 3 rows, planned vs live phase separation, project isolation", async () => {
    const { h, H } = await runScenario();
    expect((await H.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL })).status).toBe("ready");
    const a = await H.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
    const b = await H.consolePlanMatrix({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
    if (a.status !== "ready" || b.status !== "ready") throw new Error("matrix not ready");
    expect(a.matrix.rows.length).toBe(3);
    const work = a.matrix.rows.find((r) => r.taskId === P108_TASK_WORK);
    expect(work).toBeTruthy();
    if (!work) return;
    expect(work.plannedPhase).toBe("pending");
    expect(work.livePhase).toBe("satisfied");
    expect(work.phaseMismatch).toBe(true);
    expect(work.phaseSources.planned.sourceCursor).toBeTruthy();
    expect(work.phaseSources.live.sourceCursor).toBeTruthy();
    expect(work.phaseSources.live.reductionRevision).toBeTruthy();
    // A and B reuse the same local goalId but the matrix rows differ by project.
    expect(a.matrix.planRef.projectId).toBe(P108_PROJECT_A);
    expect(b.matrix.planRef.projectId).toBe(P108_PROJECT_B);
    expect(json(a.matrix)).not.toBe(json(b.matrix));
  });

  it("consoleActiveAgents: sourcing, outcome_unknown, replacement handoff, isolation, goalId filter", async () => {
    const { h, H } = await runScenario();
    const a = await H.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    const b = await H.consoleActiveAgents({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
    if (a.status !== "ready" || b.status !== "ready") throw new Error("agents not ready");

    const aById = new Map(a.agents.rows.map((r) => [r.runRef.runId, r]));
    const bById = new Map(b.agents.rows.map((r) => [r.runRef.runId, r]));

    const aWork = aById.get("run-p108-a-work");
    expect(aWork).toBeTruthy();
    if (aWork) {
      expect(aWork.displayState).toBe("completed_run");
      expect(aWork.runOutcome).toBe("completed");
      expect(aWork.attemptEndOutcome).toBe("completed");
    }
    const aExtra = aById.get("run-p108-a-extra");
    expect(aExtra).toBeTruthy();
    if (aExtra) expect(aExtra.displayState).toBe("completed_run");

    // Replacement run (B) is ONGOING by source, with the handoff marker.
    const ongoing = aById.get("run-p108-a-extra-b");
    expect(ongoing).toBeTruthy();
    if (ongoing) {
      expect(ongoing.displayState).toBe("ongoing");
      expect(ongoing.runStatus).toBe("running");
      expect(ongoing.runOutcome).toBeNull();
      expect(ongoing.handoff).toBeTruthy();
      if (ongoing.handoff) {
        expect(ongoing.handoff.packetRef.packetId).toBe("packet-p108-a-extra");
        expect(ongoing.handoff.reason).toBe("run_ended");
        expect(ongoing.handoff.sourceCursor).toBeTruthy();
      }
    }

    // Project B: outcome_unknown is a committed fact, never inferred from a crash.
    const bExtra = bById.get("run-p108-b-extra");
    expect(bExtra).toBeTruthy();
    if (bExtra) {
      expect(bExtra.displayState).toBe("outcome_unknown");
      expect(bExtra.runOutcome).toBe("outcome_unknown");
      expect(bExtra.runStatus).toBe("ended");
    }

    // Isolation: same local run ids, never cross-read.
    const aRuns = new Set(a.agents.rows.map((r) => r.runRef.runId));
    const bRuns = new Set(b.agents.rows.map((r) => r.runRef.runId));
    expect(aRuns.has("run-p108-b-extra")).toBe(false);
    expect(bRuns.has("run-p108-a-extra")).toBe(false);

    // goalId drill-down filter equals the unfiltered set (this fixture has one goal).
    const aFiltered = await H.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
    if (aFiltered.status !== "ready") throw new Error("filtered agents not ready");
    expect(aFiltered.agents.rows.length).toBe(a.agents.rows.length);
    expect(aFiltered.agents.rows.map((r) => r.runRef.runId).sort())
      .toEqual(a.agents.rows.map((r) => r.runRef.runId).sort());
  });

  it("consoleTaskEvidence: admission order, report markers, effective set, ref_only", async () => {
    const { h, H } = await runScenario();
    const a = await H.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
    expect(a.status).toBe("ready");
    if (a.status !== "ready") return;
    expect(a.evidence.evidence.length).toBe(2);
    const claim = a.evidence.evidence.find((e) => e.evidenceId === P108_EVIDENCE_CLAIM);
    const obs = a.evidence.evidence.find((e) => e.evidenceId === P108_EVIDENCE_WORK);
    expect(claim?.marker).toBe("unverified_report");
    expect(obs?.marker).toBe("observed_fact");
    expect(a.evidence.reduction).toBeTruthy();
    if (a.evidence.reduction) expect(a.evidence.reduction.phase).toBe("satisfied");
    expect(a.evidence.effectiveEvidenceIds).toContain(P108_EVIDENCE_WORK);
    expect(a.evidence.effectiveEvidenceIds).not.toContain(P108_EVIDENCE_CLAIM);
    expect(a.evidence.modelExplanation.status).toBe("unavailable");
    expect(a.evidence.bodyPolicy).toBe("ref_only");
    expect(a.evidence.evidence.every((e) => e.sourceCursor)).toBe(true);

    const b = await H.consoleTaskEvidence({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
    expect(b.status).toBe("ready");
    if (b.status !== "ready") return;
    expect(b.evidence.evidence.length).toBe(1);
    expect(b.evidence.evidence.map((e) => e.evidenceId)).not.toContain(P108_EVIDENCE_CLAIM);
  });

  it("consoleTimeline: arrival seq, kinds, ref chain, bounded window, goalId filter", async () => {
    const { h, H } = await runScenario();
    const a = await H.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    expect(a.status).toBe("ready");
    if (a.status !== "ready") return;
    const kinds = new Set(a.timeline.entries.map((e) => e.kind));
    for (const k of ["goal_created", "plan_accepted", "task_claimed", "run_started", "evidence_admitted", "task_reduction", "goal_phase", "handoff_recorded", "replacement_claimed"] as const) {
      expect(kinds.has(k)).toBe(true);
    }
    expect(a.timeline.totalCount).toBeGreaterThanOrEqual(a.timeline.entries.length);
    a.timeline.entries.forEach((e, i) => {
      expect(e.refs.projectId).toBe(P108_PROJECT_A);
      expect(e.refs.workspaceId).toBe(P108_WORKSPACE);
      expect(e.seq).toBe(i + 1);
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.sourceCursor).toBeTruthy();
      expect(e.eventId).toBeTruthy();
    });
    // seq strictly increasing from 1
    const seqs = a.timeline.entries.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));

    // maxEntries:1 bounds to one entry.
    const a1 = await H.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, maxEntries: 1 });
    expect(a1.status).toBe("ready");
    if (a1.status === "ready") expect(a1.timeline.entries.length).toBe(1);

    // goalId filter: this workspace has only ONE goal -> equal total; other-workspace
    // entries never leak.
    const aFiltered = await H.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
    expect(aFiltered.status).toBe("ready");
    if (aFiltered.status === "ready") expect(aFiltered.timeline.totalCount).toBe(a.timeline.totalCount);
    for (const e of a.timeline.entries) expect(e.kind).not.toBe("run_outcome_unknown");

    const b = await H.consoleTimeline({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
    expect(b.status).toBe("ready");
    if (b.status === "ready") {
      expect(new Set(b.timeline.entries.map((e) => e.kind)).has("run_outcome_unknown")).toBe(true);
    }
  });

  it("rebuild equivalence: a fresh InMemory index from the same events reproduces the views", async () => {
    const { h, H } = await runScenario();
    const page = await h.ledger.events({ afterCursor: null, limit: 512 });
    const fresh = new ReadModelIndexImpl(new ControlPolicyExplanation());
    await fresh.advance(page);

    const a = await H.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
    const fa = await fresh.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
    expect(json(fa)).toBe(json(a));

    const ag = await H.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    const fag = await fresh.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    expect(json(fag)).toBe(json(ag));

    const ev = await H.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
    const fev = await fresh.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
    expect(json(fev)).toBe(json(ev));

    const tl = await H.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    const ftl = await fresh.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    expect(json(ftl)).toBe(json(tl));
  });
});
