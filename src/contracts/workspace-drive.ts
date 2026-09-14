/**
 * Workspace-concurrency parallel drive port. The DispatchPort shape remains unchanged.
 * Authority: workspace-concurrency contracts and the DispatchEngine module specification.
 *
 * driveParallel processes the pending intents of ONE (projectId, goalId)
 * slice: ALL eligible intents are assembled and started CONCURRENTLY (the
 * runs overlap in real time — no implicit ordering inside a Stage), then the
 * runtime handles are consumed in parallel. Replacement intents are skipped
 * (handoff; they are driven by HandoffPort). outbox-before-side-effect order
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
