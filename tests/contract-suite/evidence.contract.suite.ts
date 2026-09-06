/**
 * P1-04 evidence contract suite — shared by InMemory AND SQLite adapters.
 * Covers ticket Acceptance 1/2/3/4/5/7 (evidence admission, binding atomicity,
 * applicability/supersession, claim/exit/verdict never satisfy alone, old FAIL
 * auditable, revision changes only recompute applicability).
 */
import { describe, expect, it } from "vitest";
import { evidenceRefFor, taskEvidenceIndexRefFor, evidenceApplicability, selectEffectiveEvidenceSet } from "../../src/contracts/evidence.js";
import type { EvidenceSnapshot, TaskEvidenceIndexSnapshot, EvidenceV1 } from "../../src/contracts/evidence.js";
import {
  P104_OBL_GATE,
  P104_OBL_IMPLEMENT,
  P104_OBL_REVIEW,
  P104_TASK_GATE,
  P104_TASK_IMPLEMENT,
  P104_TASK_REVIEW,
} from "../../src/contracts/fixtures/evidence-fixtures.js";
import {
  anchorFor,
  evidenceCommandFor,
  evidenceFor,
  freshP104Id,
  prepareP104Scenario,
  runP104ClaimedRun,
  reduceCommand,
  P104_GOAL,
  P104_PLAN_REF,
  P104_PROJECT,
  P104_VPLAN,
  SCHEMA,
  type P1_04HarnessFactory,
  type P104Preview,
} from "./p1-04-harness.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import { buildSubmitEvidenceCommand } from "../../src/contracts/fixtures/evidence-fixtures.js";

const IMPLEMENT = P104_TASK_IMPLEMENT;
const REVIEW = P104_TASK_REVIEW;

function covStatic() {
  return [{ obligationId: P104_OBL_IMPLEMENT, requirementId: "vr-impl-static" }];
}
function covDynamic() {
  return [{ obligationId: P104_OBL_IMPLEMENT, requirementId: "vr-impl-dynamic" }];
}
function covReview() {
  return [{ obligationId: P104_OBL_REVIEW, requirementId: "vr-review" }];
}
function covReviewStatic() {
  return [{ obligationId: P104_OBL_REVIEW, requirementId: "vr-review-static" }];
}

export function defineEvidenceContractSuite(createHarness: P1_04HarnessFactory): void {
  describe("P1-04 evidence contract suite", () => {
    async function setup(withFastPathBeta = false) {
      const h = await createHarness();
      const sc = await prepareP104Scenario(h, { withFastPathBeta });
      return { h, sc };
    }

    it("claim admission: commit -> immutable evidence + atomic index; replay; conflicts; zero-write", async () => {
      const { h, sc } = await setup();
      const run = await runP104ClaimedRun(h, {
        projectId: sc.alpha.projectId, taskId: IMPLEMENT, runId: "run-ev-claim", attemptId: "att-ev-claim",
      });
      const evidence = evidenceFor(sc.alpha, {
        evidenceId: "ev-claim-1", kind: "claim", outcome: "INCONCLUSIVE",
        taskId: IMPLEMENT, coverage: covStatic(), runRef: run.runRef,
      });
      const cmd = evidenceCommandFor(sc.alpha, {
        commandId: "cmd-ev-claim-1", evidence, idempotencyKey: "p104-ev-claim-1",
      });
      const before = await h.ledger.events({ afterCursor: null, limit: 500 });

      const committed = await h.submitEvidence(cmd);
      expect(committed.status).toBe("committed");
      if (committed.status !== "committed") return;
      expect(committed.replayed).toBe(false);
      expect(committed.evidenceIndex).toBe(1);
      expect(committed.evidenceCount).toBe(1);

      // Immutable evidence + atomic binding anchor + index.
      const evLoad = await h.ledger.load(evidenceRefFor(sc.alpha.projectId, "ev-claim-1"));
      expect(evLoad.status).toBe("found");
      if (evLoad.status !== "found") return;
      const snap = evLoad.snapshot as EvidenceSnapshot;
      expect(snap.revision).toBe(1);
      expect(snap.evidence.evidenceId).toBe("ev-claim-1");
      expect(snap.evidence.anchor.planRef.planId).toBe("plan-evidence-mvp");
      const indexLoad = await h.ledger.load(taskEvidenceIndexRefFor(sc.alpha.projectId, sc.alpha.goalId, IMPLEMENT));
      expect(indexLoad.status).toBe("found");
      if (indexLoad.status !== "found") return;
      const index = indexLoad.snapshot as TaskEvidenceIndexSnapshot;
      expect(index.revision).toBe(1);
      expect(index.evidenceIds).toEqual(["ev-claim-1"]);

      // Replay: same identity+fingerprint -> committed(replayed), no new event.
      const replay = await h.submitEvidence(evidenceCommandFor(sc.alpha, {
        commandId: "cmd-ev-claim-1b", evidence, idempotencyKey: "p104-ev-claim-1",
      }));
      expect(replay.status).toBe("committed");
      if (replay.status === "committed") {
        expect(replay.replayed).toBe(true);
        expect(replay.eventIds).toEqual(committed.eventIds);
      }
      const after1 = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(after1.events.length).toBe(before.events.length + 1);

      // Same evidenceId, DIFFERENT identity -> revision_conflict (zero-write).
      const other = await h.submitEvidence(
        buildSubmitEvidenceCommand({
          commandId: "cmd-ev-claim-1c",
          correlationId: "corr-other",
          submittedAt: SCHEMA,
          evidence,
          idempotencyKey: "other-identity-key",
        }),
      );
      expect(other.status).toBe("rejected");
      if (other.status === "rejected") expect(other.code).toBe("revision_conflict");

      // Same identity, different fingerprint (different coverage) -> idempotency_conflict.
      const altered = evidenceFor(sc.alpha, {
        evidenceId: "ev-claim-1", kind: "claim", outcome: "INCONCLUSIVE",
        taskId: IMPLEMENT, coverage: covDynamic(), runRef: run.runRef,
      });
      const conflict = await h.submitEvidence(evidenceCommandFor(sc.alpha, {
        commandId: "cmd-ev-claim-1d", evidence: altered, idempotencyKey: "p104-ev-claim-1",
      }));
      expect(conflict.status).toBe("rejected");
      if (conflict.status === "rejected") expect(conflict.code).toBe("idempotency_conflict");

      const after2 = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(after2.events.length).toBe(before.events.length + 1);
    });

    it("a CompletionClaim is never evidence PASS: PASS claim rejected, invalid claim zero-write", async () => {
      const { h, sc } = await setup();
      const run = await runP104ClaimedRun(h, {
        projectId: sc.alpha.projectId, taskId: IMPLEMENT, runId: "run-ev-claim2", attemptId: "att-ev-claim2",
      });
      const passClaim = evidenceFor(sc.alpha, {
        evidenceId: "ev-claim-pass", kind: "claim", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covStatic(), runRef: run.runRef,
      });
      const rejected = await h.submitEvidence(evidenceCommandFor(sc.alpha, {
        commandId: "cmd-ev-claim-pass", evidence: passClaim,
      }));
      expect(rejected.status).toBe("rejected");
      if (rejected.status === "rejected") expect(rejected.code).toBe("invalid");
      const events = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(events.events.filter((p) => p.event.eventType === "EvidenceAdmitted").length).toBe(0);
    });

    it("claim/verdict without a producing run and dangling coverage are rejected zero-write", async () => {
      const { h, sc } = await setup();
      const noRunClaim = evidenceFor(sc.alpha, {
        evidenceId: "ev-claim-norun", kind: "claim", outcome: "INCONCLUSIVE",
        taskId: IMPLEMENT, coverage: covStatic(), runRef: null,
      });
      const r1 = await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-norun", evidence: noRunClaim }));
      expect(r1.status).toBe("rejected");
      if (r1.status === "rejected") expect(r1.code).toBe("invalid");

      const dangling = evidenceFor(sc.alpha, {
        evidenceId: "ev-obs-dangling", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: [{ obligationId: "obl-does-not-exist", requirementId: "vr-x" }],
        checkId: "static-check-lint",
      });
      const r2 = await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-dangling", evidence: dangling }));
      expect(r2.status).toBe("rejected");
      const events = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(events.events.filter((p) => p.event.eventType === "EvidenceAdmitted").length).toBe(0);
    });

    it("single exit=0 / claim alone NEVER satisfy: blocked with missing-evidence causes", async () => {
      const { h, sc } = await setup();
      const runEv9 = await runP104ClaimedRun(h, {
        projectId: sc.alpha.projectId, taskId: IMPLEMENT, runId: "run-ev-exit0", attemptId: "att-ev-exit0",
      });
      const reduce = await h.reduceTask(reduceCommand(sc.alpha, {
        commandId: "cmd-reduce-exit0", taskId: IMPLEMENT, expectedRevision: 0,
      }));
      expect(reduce.status).toBe("committed");
      if (reduce.status !== "committed") return;
      expect(reduce.phase).toBe("blocked");

      // With a claim but still no PASS: still blocked (claim is neutral). One run per task (P1-03 frozen lease).
      const claim = evidenceFor(sc.alpha, {
        evidenceId: "ev-claim-only", kind: "claim", outcome: "INCONCLUSIVE",
        taskId: IMPLEMENT, coverage: [{ obligationId: P104_OBL_IMPLEMENT, requirementId: "vr-impl-static" }, { obligationId: P104_OBL_IMPLEMENT, requirementId: "vr-impl-dynamic" }],
        runRef: runEv9.runRef,
      });
      const admit = await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-claim-only", evidence: claim }));
      expect(admit.status).toBe("committed");
      const reduce2 = await h.reduceTask(reduceCommand(sc.alpha, {
        commandId: "cmd-reduce-claim", taskId: IMPLEMENT, expectedRevision: 1, idempotencyKey: "p104-reduce-claim",
      }));
      expect(reduce2.status).toBe("committed");
      if (reduce2.status === "committed") expect(reduce2.phase).toBe("blocked");
    });

    it("FAIL -> failed (rework); newer PASS supersedes -> satisfied; old FAIL stays auditable", async () => {
      const { h, sc } = await setup();
      await runP104ClaimedRun(h, {
        projectId: sc.alpha.projectId, taskId: IMPLEMENT, runId: "run-ev-sup", attemptId: "att-ev-sup",
      });
      const fail = evidenceFor(sc.alpha, {
        evidenceId: "ev-fail-1", kind: "observation", outcome: "FAIL",
        taskId: IMPLEMENT, coverage: covStatic(), checkId: "static-check-lint",
      });
      const a1 = await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-fail-1", evidence: fail }));
      expect(a1.status).toBe("committed");
      const r1 = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-reduce-fail", taskId: IMPLEMENT, expectedRevision: 0 }));
      expect(r1.status).toBe("committed");
      if (r1.status !== "committed") return;
      expect(r1.phase).toBe("failed");

      const passStatic = evidenceFor(sc.alpha, {
        evidenceId: "ev-pass-1", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covStatic(), checkId: "static-check-lint",
      });
      const passDynamic = evidenceFor(sc.alpha, {
        evidenceId: "ev-pass-2", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covDynamic(), checkId: "dynamic-check-tests",
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-pass-1", evidence: passStatic }))).status).toBe("committed");
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-pass-2", evidence: passDynamic }))).status).toBe("committed");
      const r2 = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-reduce-sat", taskId: IMPLEMENT, expectedRevision: 1, idempotencyKey: "p104-reduce-sat" }));
      expect(r2.status).toBe("committed");
      if (r2.status !== "committed") return;
      expect(r2.phase).toBe("satisfied");

      // Old FAIL remains auditable; reduction snapshot records the effective set.
      const evLoad = await h.ledger.load(evidenceRefFor(sc.alpha.projectId, "ev-fail-1"));
      expect(evLoad.status).toBe("found");
      if (evLoad.status !== "found") return;
      expect((evLoad.snapshot as EvidenceSnapshot).evidence.outcome).toBe("FAIL");
      const redLoad = await h.ledger.load({
        aggregateType: "TaskReduction", projectId: sc.alpha.projectId, goalId: sc.alpha.goalId, taskId: IMPLEMENT,
      });
      expect(redLoad.status).toBe("found");
      if (redLoad.status !== "found") return;
      const red = redLoad.snapshot as import("../../src/contracts/reduction.js").TaskReductionSnapshot;
      expect(red.phase).toBe("satisfied");
      expect(red.effectiveEvidenceIds).toEqual(expect.arrayContaining(["ev-pass-1", "ev-pass-2"]));
      expect(red.blockingEvidenceIds).toEqual([]);
    });

    it("revision change only recomputes applicability: STALE / OUT_OF_SCOPE displayed, history untouched", async () => {
      const { h, sc } = await setup();
      await runP104ClaimedRun(h, {
        projectId: sc.alpha.projectId, taskId: IMPLEMENT, runId: "run-ev-app", attemptId: "att-ev-app",
      });
      const passStatic = evidenceFor(sc.alpha, {
        evidenceId: "ev-app-pass", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covStatic(), checkId: "static-check-lint",
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-app-pass", evidence: passStatic }))).status).toBe("committed");
      // Old-tuple evidence: workspaceRevision 2 while the current tuple is 1.
      const staleEv = evidenceFor(sc.alpha, {
        evidenceId: "ev-app-stale", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covStatic(), checkId: "static-check-lint", workspaceRevision: 2,
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-app-stale", evidence: staleEv, idempotencyKey: "p104-ev-app-stale" }))).status).toBe("committed");
      // Coverage of the REVIEW requirement but subject = implement: the entry is
      // ADMITTED (an existing obligation/VR fact — no hard dangling) and the frozen
      // applicability rule marks it OUT_OF_SCOPE (never written back).
      const oosEv = evidenceFor(sc.alpha, {
        evidenceId: "ev-app-oos", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covReview(), checkId: "static-check-lint",
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-app-oos", evidence: oosEv, idempotencyKey: "p104-ev-app-oos" }))).status).toBe("committed");
      const dynamic = evidenceFor(sc.alpha, {
        evidenceId: "ev-app-dyn", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covDynamic(), checkId: "dynamic-check-tests",
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-app-dyn", evidence: dynamic }))).status).toBe("committed");

      const reduce = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-reduce-app", taskId: IMPLEMENT, expectedRevision: 0 }));
      expect(reduce.status).toBe("committed");
      if (reduce.status !== "committed") return;
      expect(reduce.phase).toBe("satisfied");

      await h.advanceProjection();
      const view = await h.taskVerification({ projectId: sc.alpha.projectId, goalId: sc.alpha.goalId, taskId: IMPLEMENT });
      expect(view.status).toBe("ready");
      if (view.status !== "ready") return;
      const bindingApplicability = new Map(
        view.verification.evidence.map((e) => [e.evidenceId, e.applicability] as const),
      );
      expect(bindingApplicability.get("ev-app-pass")).toBe("APPLICABLE");
      expect(bindingApplicability.get("ev-app-stale")).toBe("STALE");
      expect(bindingApplicability.get("ev-app-oos")).toBe("OUT_OF_SCOPE");
      // History untouched: the stale evidence still anchors workspaceRevision 2.
      const staleLoad = await h.ledger.load(evidenceRefFor(sc.alpha.projectId, "ev-app-stale"));
      expect(staleLoad.status).toBe("found");
      if (staleLoad.status !== "found") return;
      expect((staleLoad.snapshot as EvidenceSnapshot).evidence.anchor.workspaceRevision).toBe(2);
    });

    it("reviewer verdict alone never satisfies; verdict + bounded-packet static evidence satisfies", async () => {
      const { h, sc } = await setup();
      const runVerdict = await runP104ClaimedRun(h, {
        projectId: sc.alpha.projectId, taskId: REVIEW, runId: "run-ev-verdict", attemptId: "att-ev-verdict",
      });
      const verdict = evidenceFor(sc.alpha, {
        evidenceId: "ev-verdict-1", kind: "verdict", outcome: "PASS",
        taskId: REVIEW, coverage: covReview(), checkId: "reviewer-semantic-check", runRef: runVerdict.runRef,
      });
      const admit = await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-verdict-1", evidence: verdict }));
      expect(admit.status).toBe("committed");
      const r1 = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-reduce-verdict", taskId: REVIEW, expectedRevision: 0 }));
      expect(r1.status).toBe("committed");
      if (r1.status !== "committed") return;
      expect(r1.phase).toBe("blocked"); // vr-review-static missing -> blocked (verdict alone insufficient)

      const pktStatic = evidenceFor(sc.alpha, {
        evidenceId: "ev-verdict-static", kind: "observation", outcome: "PASS",
        taskId: REVIEW, coverage: covReviewStatic(), checkId: "static-check-lint",
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-verdict-static", evidence: pktStatic }))).status).toBe("committed");
      const r2 = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-reduce-verdict2", taskId: REVIEW, expectedRevision: 1, idempotencyKey: "p104-reduce-verdict2" }));
      expect(r2.status).toBe("committed");
      if (r2.status !== "committed") return;
      expect(r2.phase).toBe("satisfied");
    });

    it("pure applicability table: APPLICABLE / STALE / OUT_OF_SCOPE and effective-set supersession", async () => {
      const { h, sc } = await setup();
      const planLoad = await h.ledger.load(P104_PLAN_REF);
      expect(planLoad.status).toBe("found");
      if (planLoad.status !== "found") return;
      const plan = planLoad.snapshot as PlanRevisionSnapshot;
      const current = anchorFor(sc.alpha, 1);
      const base = evidenceFor(sc.alpha, {
        evidenceId: "ev-table-pass", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covStatic(), checkId: "static-check-lint",
      });
      const stale = evidenceFor(sc.alpha, {
        evidenceId: "ev-table-stale", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covStatic(), checkId: "static-check-lint", workspaceRevision: 3,
      });
      const oos = evidenceFor(sc.alpha, {
        evidenceId: "ev-table-oos", kind: "observation", outcome: "PASS",
        taskId: IMPLEMENT, coverage: covReview(), checkId: "static-check-lint",
      });
      const fail = evidenceFor(sc.alpha, {
        evidenceId: "ev-table-fail", kind: "observation", outcome: "FAIL",
        taskId: IMPLEMENT, coverage: covStatic(), checkId: "static-check-lint",
      });
      expect(evidenceApplicability(base, plan, current)).toBe("APPLICABLE");
      expect(evidenceApplicability(stale, plan, current)).toBe("STALE");
      expect(evidenceApplicability(oos, plan, current)).toBe("OUT_OF_SCOPE");
      // A FAIL before a PASS in admission order is superseded; a FAIL after blocks.
      const superseded = selectEffectiveEvidenceSet([fail, base], plan, current);
      expect(superseded.blockingByRequirement[P104_OBL_IMPLEMENT + "\u0000vr-impl-static"]).toBeUndefined();
      expect(superseded.coverageByRequirement[P104_OBL_IMPLEMENT + "\u0000vr-impl-static"]).toBe("ev-table-pass");
      const blocked = selectEffectiveEvidenceSet([base, fail], plan, current);
      expect(blocked.blockingByRequirement[P104_OBL_IMPLEMENT + "\u0000vr-impl-static"]).toEqual(["ev-table-fail"]);
      // A claim NEVER covers or blocks.
      const claim = evidenceFor(sc.alpha, {
        evidenceId: "ev-table-claim", kind: "claim", outcome: "INCONCLUSIVE",
        taskId: IMPLEMENT, coverage: covStatic(), runRef: { aggregateType: "Run", projectId: sc.alpha.projectId, goalId: sc.alpha.goalId, runId: "run-table" },
      });
      const withClaim = selectEffectiveEvidenceSet([claim], plan, current);
      expect(Object.keys(withClaim.coverageByRequirement).length).toBe(0);
      expect(Object.keys(withClaim.blockingByRequirement).length).toBe(0);
    });
  });
}
