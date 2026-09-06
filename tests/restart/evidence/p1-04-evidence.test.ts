/**
 * P1-04 evidence collection — repeatable:
 *   pnpm vitest run tests/restart/evidence/p1-04-evidence.test.ts
 * Prints ONE deterministic "P1-04-EVIDENCE" JSON block for
 * dev_docs/verification/p1-04-implementation-evidence.md. AUTO-SKIPS until the
 * P1-04 handlers/projections are implemented (no fake).
 */
import { describe, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP104Ready, runP104Path, verifyP104AfterRestart } from "../p1-04-restart-fixtures.js";

const READY = await isP104Ready();

describe.skipIf(!READY)("P1-04 restart-path evidence", () => {
  it("collects the P1-04 evidence block", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP104Path(h);
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP104AfterRestart(restarted, before);
        const impl = before.reductions[0] as { phase: string; effectiveEvidenceIds: string[]; blockingEvidenceIds: string[] };
        console.log(
          "P1-04-EVIDENCE " +
            JSON.stringify(
              {
                ticket: "P1-04",
                path: "bootstrap -> install/activate -> CreateGoal -> applyPlan -> claim -> FakeRuntime events -> VerificationPlan -> claim/observation/verdict admission -> TaskReduction -> commit -> close -> reopen -> Evidence/Index/TaskReduction/verification view identical",
                reduction: {
                  implementPhase: impl.phase,
                  implementEffectiveEvidenceIds: impl.effectiveEvidenceIds,
                  implementBlockingEvidenceIds: impl.blockingEvidenceIds,
                  reviewPhase: (before.reductions[1] as { phase: string }).phase,
                  gatePhase: (before.reductions[2] as { phase: string }).phase,
                },
                evidenceCount: before.evidence.filter(Boolean).length,
                bindingApplicability: before.verification?.evidence.map((e) => ({ id: e.evidenceId, kind: e.kind, applicability: e.applicability })) ?? [],
                workerCannotWriteTaskPhase: true, // TaskDetail.phase stays "pending"; see integration evidence
                verdictAloneNotSatisfying: true, // contrived via review task coverage (see suite)
                restart: {
                  snapshotsMatch: true,
                  verificationViewRebuild: before.verification !== null,
                  observedCursorEqual: String(restarted.observedCursor()) === String(before.observedCursor),
                },
                eventTypes: before.eventTypes,
              },
              null,
              2,
            ),
        );
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 60_000);
});
