/**
 * P1-07 Control entry: WorkspaceDrivePort implementation (parallel drive).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane B fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" item 7/三路并行 B: ALL eligible intents of the (projectId, goalId)
 * slice are assembled + started CONCURRENTLY (real run overlap — no implicit
 * ordering inside a Stage), then runtime handles are consumed in parallel;
 * replacement intents are skipped (P1-06 HandoffPort); outbox-before-side-effect
 * unchanged.
 */
import type { DispatchDriveResult, RunPort } from "../contracts/ports.js";
import type { WorkspaceDrivePort, WorkspaceDriveTriggerV1 } from "../contracts/workspace-drive.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine } from "../contracts/modules.js";
import type { TaskContextPort } from "../contracts/task-envelope.js";

export type WorkspaceDriveDeps = {
  ledger: StateLedger;
  control: ControlEngine;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
  now: () => string;
};

export class WorkspaceDriveEngineImpl implements WorkspaceDrivePort {
  constructor(private readonly deps: WorkspaceDriveDeps) {}

  driveParallel(trigger: WorkspaceDriveTriggerV1): Promise<DispatchDriveResult> {
    throw new Error("P1-07 lane B: driveParallel not implemented yet");
  }
}
