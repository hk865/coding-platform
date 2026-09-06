/**
 * P1-06 DispatchEngine.HandoffPort implementation (src/control/handoff-drive.ts).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane A fills the
 * implementation). Frozen ordering (mirrors P1-03 drive + outbox-before-
 * side-effect):
 *   1. ledger.pendingDispatchIntents(maxIntents ?? 8);
 *   2. for each pending intent: load the ReplacementAttempt for
 *      (projectId, goalId, taskId, attemptId); missing -> failure
 *      not_a_replacement (this intent belongs to the NORMAL drive);
 *   3. HandoffContextPort.assemble(HandoffContextRequestV1) — bounded context
 *      derived from the registered packet (never a transcript);
 *   4. Control.startRun(B's envelope) — the intent -> started;
 *   5. ONLY THEN RunPort.start(envelope) + poll events via Control.runFact.
 * The NORMAL DispatchPort.drive SKIPS replacement intents (baseline guard).
 */
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine } from "../contracts/modules.js";
import type { RunPort } from "../contracts/ports.js";
import type { HandoffContextPort } from "../contracts/handoff-context.js";
import type { HandoffPort, HandoffDriveResult, HandoffDriveTrigger } from "../contracts/handoff.js";

export type HandoffDriveDeps = {
  ledger: StateLedger;
  control: ControlEngine;
  handoffContext: HandoffContextPort;
  runtime: RunPort;
};

export class HandoffDriveEngineImpl implements HandoffPort {
  constructor(private readonly deps: HandoffDriveDeps) {}

  async driveHandoff(trigger: HandoffDriveTrigger): Promise<HandoffDriveResult> {
    void this.deps;
    void trigger;
    throw new Error("P1-06: driveHandoff not implemented yet");
  }
}

export function createHandoffDriveEngine(deps: HandoffDriveDeps): HandoffPort {
  return new HandoffDriveEngineImpl(deps);
}
