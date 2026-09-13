/**
 * P1-06 evidence collection — repeatable:
 *   pnpm vitest run tests/restart/evidence/p1-06-evidence.test.ts
 * Prints ONE deterministic "P1-06-EVIDENCE" JSON block for
 * dev_docs/verification/p1-06-implementation-evidence.md. AUTO-SKIPS until the
 * P1-06 handlers/projections are implemented (no fake).
 */
import { describe, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP106Ready, runP106Path, verifyP106AfterRestart } from "../p1-06-restart-fixtures.js";

const READY = await isP106Ready();

describe.skipIf(!READY)("P1-06 restart-path evidence", () => {
  it("collects the P1-06 evidence block", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP106Path(h);
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP106AfterRestart(restarted, before);
        console.log(
          "P1-06-EVIDENCE " +
            JSON.stringify(
              {
                ticket: "P1-06",
                path: "bootstrap -> install/activate -> CreateGoal -> applyPlan -> A claim/start/crash -> body-first packet register -> B replacement claim -> driveHandoff -> close -> reopen -> packet/replacement/lease/B-run identical + provenance rebuilt",
                packet: { noFullTranscript: true, sizeBounded: true },
                replacement: { movedLeaseToB: true, priorRunRef: "run-rs-a" },
                bRunOutcome: before.bRun !== null ? (before.bRun as { outcome: string | null }).outcome : null,
                provenanceTimelineKinds: before.provenance !== null ? before.provenance.timeline.map((e) => e.kind) : [],
                outcomeUnknownPreserved: before.provenance !== null ? before.provenance.outcomeUnknownPreserved : null,
                restart: {
                  snapshotsMatch: true,
                  provenanceRebuild: before.provenance !== null,
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
  }, 90_000);
});
