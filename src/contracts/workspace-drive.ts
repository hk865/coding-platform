/**
 * P1-07 parallel drive port (versioned addition; P1-03 DispatchPort shape is
 * unchanged). Authority: IMPLEMENTATION-HANDOFF.md "P1-07 契约与存储语义"
 * item 7/parallel plan + ticket acceptance 1/2.
 *
 * driveParallel processes the pending intents of ONE (projectId, goalId)
 * slice: ALL eligible intents are assembled and started CONCURRENTLY (the
 * runs overlap in real time — no implicit ordering inside a Stage), then the
 * runtime handles are consumed in parallel. Replacement intents are skipped
 * (P1-06; they are driven by HandoffPort). outbox-before-side-effect order
 * is unchanged.
 */
import type { DispatchDriveResult } from "./ports.js";

export type WorkspaceDriveTriggerV1 = {
  schemaVersion: 1;
  reason: string;
  projectId: string;
  goalId: string;
  /** Bound the number of intents processed per drive (default 8). */
  maxIntents?: number;
};

export interface WorkspaceDrivePort {
  driveParallel(trigger: WorkspaceDriveTriggerV1): Promise<DispatchDriveResult>;
}
