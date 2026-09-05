/**
 * P1-03 DispatchEngine driver (DispatchPort).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane A fills the
 * implementation; frozen ordering (Acceptance 3):
 *   1. ledger.pendingDispatchIntents() - the intent MUST be durably loadable;
 *   2. ContextCompiler.assemble(request) - bounded envelope + vault bundle;
 *   3. Control.startRun(commit) - envelope recorded, outbox intent -> started;
 *   4. ONLY THEN RunPort.start(envelope) (outbox-before-side-effect);
 *   5. poll RunPort events and Control.runFact() each until a terminal fact.
 * Context rejection / runtime errors are reported in DispatchDriveResult and
 * leave the outbox in its committed state (no new Run attempts in P1-03).
 */
import type { DispatchDriveResult, DispatchDriveTrigger, DispatchPort, RunPort } from "../contracts/ports.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine } from "../contracts/modules.js";
import type { TaskContextPort } from "../contracts/task-envelope.js";

export type DispatchEngineDeps = {
  ledger: StateLedger;
  control: ControlEngine;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
};

export class DispatchEngineImpl implements DispatchPort {
  constructor(private readonly deps: DispatchEngineDeps) {}

  drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult> {
    void this.deps;
    void trigger;
    return Promise.reject(new Error("P1-03: DispatchEngineImpl.drive not implemented yet"));
  }
}

export function createDispatchEngine(deps: DispatchEngineDeps): DispatchEngineImpl {
  return new DispatchEngineImpl(deps);
}
