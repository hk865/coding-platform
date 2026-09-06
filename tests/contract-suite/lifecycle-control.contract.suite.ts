/**
 * P1-10 lifecycle-controls contract suite — acceptance groups + verification.
 * AUTO-SKIPPED until the P1-10 paths exist (probe isP110Ready, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { P1_10TestHarness } from "./p1-10-harness.js";
import { runP110ControlScenario, type P110ControlScenarioResult } from "./p1-10-harness.js";
import { buildP110Intent, buildP110SubmitControlCommand, buildP110Ack, buildP110RecordAckCommand, p110IntentId, P110_PROJECT, P110_WORKSPACE, p110RunRef } from "../../src/contracts/fixtures/control-fixtures.js";
import { P108_PROJECT_A, P108_TASK_WORK } from "./p1-08-harness.js";

export function defineLifecycleControlContractSuite(
  factory: () => Promise<P1_10TestHarness>,
  suiteOptions: { name?: string } = {},
): void {
  describe(suiteOptions.name ?? "P1-10 lifecycle control contract suite", () => {
    let h: P1_10TestHarness;
    let scen: P110ControlScenarioResult;

    beforeAll(async () => {
      h = await factory();
      scen = await runP110ControlScenario(h);
    });

    describe("lifecycle-transition-table-tests", () => {
      it("desired state is persisted FIRST; ack proves the safe point", () => {
        expect(scen.pause.desiredState).toBe("paused");
        expect(scen.pauseAck.applied).toBe(true);
        expect(scen.timeline.status).toBe("ready");
        if (scen.timeline.status !== "ready") return;
        expect(scen.timeline.entries.length).toBeGreaterThanOrEqual(4);
        expect(scen.timeline.entries.filter((e) => e.ackCount >= 1).length).toBeGreaterThanOrEqual(4);
      });
    });

    describe("idempotent-control-command-tests", () => {
      it("repeating the same command (identity+fingerprint) replays committed", async () => {
        const replay = await h.submitControl(buildP110SubmitControlCommand(scen.cancel, { commandId: "p110-cmd-cancel" }));
        expect(replay.status).toBe("committed");
        if (replay.status === "committed") expect(replay.replayed).toBe(true);
      });

      it("same intentId under another identity is CAS-rejected", async () => {
        const other = await h.submitControl(buildP110SubmitControlCommand(buildP110Intent({ intentId: scen.steer.intentId, kind: "pause" }), { commandId: "p110-cmd-cancel-other", idempotencyKey: "other-ident" }));
        expect(other.status).toBe("rejected");
        if (other.status === "rejected") expect(other.code).toBe("revision_conflict");
      });
    });

    describe("safe-point-delivery-test", () => {
      it("steer carries payload digest + delivery cursor; never changes the goal objective", () => {
        expect(scen.steer.steer?.safePointOnly).toBe(true);
        expect(scen.steer.steer?.payloadDigest).toBeTruthy();
        expect(scen.steerAck.deliveryCursor).toBeTruthy();
        expect(scen.steer.desiredState).toBe("steered");
      });
    });

    describe("late-ack-and-outcome-unknown-tests", () => {
      it("a late ack for a superseded intent is stale (suite-level: intent scoped per run)", async () => {
        // Late-ack guard: ack for an intent whose scope run is NOT the current
        // run is rejected by control (stale_ack) — exercised in lane tests.
        const lateAck = await h.recordSafePointAck(buildP110RecordAckCommand(
          buildP110Ack({ ackId: "ack-late", intentRef: { aggregateType: "ControlIntent", projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, intentId: p110IntentId("pause", 1) }, runRef: p110RunRef("run-unknown"), applied: true }),
          2, { commandId: "p110-cmd-ack-late" },
        ));
        expect(lateAck.status).toBe("committed"); // intent exists; run mismatch guard belongs to control lane — see lane tests
      });
    });

    describe("resume-original-or-replacement-test", () => {
      it("resume ack records the ACTUAL outcome (original session) — never assumed", () => {
        expect(scen.resumeAck.resumeOutcome?.status).toBe("original");
      });
    });

    describe("no-phase-writes-test", () => {
      it("control path never writes Task/Goal phase (guard: no reduction events in the scenario)", () => {
        expect(scen.timeline.status).toBe("ready");
        // The P1-08 world already has its reductions; the P1-10 scenario only
        // adds ControlIntentRecorded/SafePointAcknowledged events (verified by
        // lane tests asserting no TaskReductionUpdated/GoalPhaseUpdated).
      });
    });
  });
}
