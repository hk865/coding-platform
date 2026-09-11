/**
 * WorkerRuntime execution and Dispatch outbox driver ports.
 * Artifact and Task Context ports are defined and imported directly from
 * artifact.ts and task-envelope.ts. This file does not forward those exports.
 */

import type { DispatchOutboxRef, RunRef, RuntimeEventV1 } from "./dispatch.js";
import type { TaskEnvelopeV1 } from "./task-envelope.js";

export type RunCapabilities = {
  /** Adapter-declared replay capability; fake capability does not imply real replay safety. */
  replayable: boolean;
  supportsSnapshot: boolean;
  maxEnvelopeBytes: number;
};

/** Pull-based execution handle. Control and cancellation use their separate ports. */
export type RunHandle = {
  runRef: RunRef;
  /** Returns events not yet polled (empty after the script is drained). */
  pollFreshEvents(): Promise<RuntimeEventV1[]>;
};

export interface RunPort {
  capabilities(): Promise<RunCapabilities>;
  start(envelope: TaskEnvelopeV1): Promise<RunHandle>;
}

// ------------------------------------------------------------------------ //
// DispatchEngine driver                                                     //
// ------------------------------------------------------------------------ //

export type DispatchDriveTrigger = {
  reason: string;
  /** Bound the number of intents processed per drive (default 8). */
  maxIntents?: number;
};

export type DispatchDriveFailure = {
  intentId: string;
  outboxRef: DispatchOutboxRef;
  code: "not_found" | "context_rejected" | "runtime_error" | "rejected";
  message: string;
};

export type DispatchDriveResult = {
  scanned: number;
  started: number;
  completed: number;
  pendingRemaining: number;
  failures: DispatchDriveFailure[];
};

/**
 * DispatchPort: processes the durable outbox — every intent is FIRST loaded
 * from the ledger (pending), THEN assembled via TaskContextPort, THEN the run
 * is started via Control (RunStarted commit) and ONLY THEN the RunPort is
 * invoked (outbox-before-side-effect ordering).
 */
export interface DispatchPort {
  drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult>;
}
