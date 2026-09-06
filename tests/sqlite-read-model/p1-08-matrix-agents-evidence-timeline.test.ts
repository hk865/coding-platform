/**
 * P1-08 LANE-B SQLite projection tests — consolePlanMatrix / consoleActiveAgents /
 * consoleTaskEvidence / consoleTimeline. Same assertions as the InMemory twin, run
 * against the persistent harness; on top it asserts rebuild equivalence after a
 * close/reopen (fresh read-model file) against the SAME ledger event stream.
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  createP108ScenarioRuntime,
  runP108TwoProjectScenario,
  toP1_08Harness,
  type P1_08HarnessLike,
  type P1_08TestHarness,
  P108_PROJECT_A,
  P108_PROJECT_B,
  P108_WORKSPACE,
  P108_GOAL,
  P108_TASK_WORK,
  P108_EVIDENCE_WORK,
  P108_EVIDENCE_CLAIM,
} from "../contract-suite/p1-08-harness.js";

function json(v: unknown): string {
  return JSON.stringify(v);
}

async function makeHarness(): Promise<PersistentSqliteHarness> {
  return createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
}

async function makeTest(h: PersistentSqliteHarness): Promise<P1_08TestHarness> {
  const th = toP1_08Harness(h as unknown as P1_08HarnessLike);
  await runP108TwoProjectScenario(th);
  return th;
}

describe("P1-08 LANE-B SQLite projection", () => {
  it("consolePlanMatrix: 3 rows, planned vs live phase separation, project isolation", async () => {
    const h = await makeHarness();
    try {
      const H = await makeTest(h);
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
      expect(a.matrix.planRef.projectId).toBe(P108_PROJECT_A);
      expect(b.matrix.planRef.projectId).toBe(P108_PROJECT_B);
      expect(json(a.matrix)).not.toBe(json(b.matrix));
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("consoleActiveAgents: sourcing, outcome_unknown, replacement handoff, isolation, goalId filter", async () => {
    const h = await makeHarness();
    try {
      const H = await makeTest(h);
      const a = await H.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
      const b = await H.consoleActiveAgents({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
      if (a.status !== "ready" || b.status !== "ready") throw new Error("agents not ready");
      const aById = new Map(a.agents.rows.map((r) => [r.runRef.runId, r]));
      const bById = new Map(b.agents.rows.map((r) => [r.runRef.runId, r]));

      const aWork = aById.get("run-p108-a-work");
      expect(aWork).toBeTruthy();
      if (aWork) expect(aWork.displayState).toBe("completed_run");

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
        }
      }

      const bExtra = bById.get("run-p108-b-extra");
      expect(bExtra).toBeTruthy();
      if (bExtra) {
        expect(bExtra.displayState).toBe("outcome_unknown");
        expect(bExtra.runOutcome).toBe("outcome_unknown");
        expect(bExtra.runStatus).toBe("ended");
      }

      const aRuns = new Set(a.agents.rows.map((r) => r.runRef.runId));
      const bRuns = new Set(b.agents.rows.map((r) => r.runRef.runId));
      expect(aRuns.has("run-p108-b-extra")).toBe(false);
      expect(bRuns.has("run-p108-a-extra")).toBe(false);

      const aFiltered = await H.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
      if (aFiltered.status !== "ready") throw new Error("filtered agents not ready");
      expect(aFiltered.agents.rows.length).toBe(a.agents.rows.length);
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("consoleTaskEvidence: admission order, markers, effective set, ref_only", async () => {
    const h = await makeHarness();
    try {
      const H = await makeTest(h);
      const a = await H.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
      expect(a.status).toBe("ready");
      if (a.status !== "ready") return;
      expect(a.evidence.evidence.length).toBe(2);
      const claim = a.evidence.evidence.find((e) => e.evidenceId === P108_EVIDENCE_CLAIM);
      const obs = a.evidence.evidence.find((e) => e.evidenceId === P108_EVIDENCE_WORK);
      expect(claim?.marker).toBe("unverified_report");
      expect(obs?.marker).toBe("observed_fact");
      expect(a.evidence.reduction?.phase).toBe("satisfied");
      expect(a.evidence.effectiveEvidenceIds).toContain(P108_EVIDENCE_WORK);
      expect(a.evidence.effectiveEvidenceIds).not.toContain(P108_EVIDENCE_CLAIM);
      expect(a.evidence.modelExplanation.status).toBe("unavailable");
      expect(a.evidence.bodyPolicy).toBe("ref_only");

      const b = await H.consoleTaskEvidence({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
      expect(b.status).toBe("ready");
      if (b.status === "ready") {
        expect(b.evidence.evidence.length).toBe(1);
        expect(b.evidence.evidence.map((e) => e.evidenceId)).not.toContain(P108_EVIDENCE_CLAIM);
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("consoleTimeline: arrival seq, kinds, ref chain, bounded window, goalId filter", async () => {
    const h = await makeHarness();
    try {
      const H = await makeTest(h);
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
      });
      const a1 = await H.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, maxEntries: 1 });
      if (a1.status === "ready") expect(a1.timeline.entries.length).toBe(1);

      const aFiltered = await H.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
      if (aFiltered.status === "ready") expect(aFiltered.timeline.totalCount).toBe(a.timeline.totalCount);

      const b = await H.consoleTimeline({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
      if (b.status === "ready") expect(new Set(b.timeline.entries.map((e) => e.kind)).has("run_outcome_unknown")).toBe(true);
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("rebuild equivalence: close/reopen with a fresh read-model file reproduces the views", async () => {
    const h = await makeHarness();
    try {
      const H = await makeTest(h);
      const before = {
        matrix: await H.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL }),
        agents: await H.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE }),
        evidence: await H.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK }),
        timeline: await H.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE }),
      };
      // Emulate a process restart on the SAME ledger, with a FRESH read-model file
      // so the new index is rebuilt purely from the persisted EventPages.
      await h.close();
      const reopened = await h.reopen({ readModelFile: "readmodel-rebuild.sqlite" });
      try {
        await reopened.advanceProjection();
        const H2 = toP1_08Harness(reopened as unknown as P1_08HarnessLike);
        const after = {
          matrix: await H2.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL }),
          agents: await H2.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE }),
          evidence: await H2.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK }),
          timeline: await H2.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE }),
        };
        expect(json(after.matrix)).toBe(json(before.matrix));
        expect(json(after.agents)).toBe(json(before.agents));
        expect(json(after.evidence)).toBe(json(before.evidence));
        expect(json(after.timeline)).toBe(json(before.timeline));
      } finally {
        await reopened.cleanup().catch(() => undefined);
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });
});
