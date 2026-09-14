import type { RunRef } from './dispatch.js';
import type { DispatchDriveResult } from './ports.js';

export type DispatchScope = { projectId: string; workspaceId: string };
export type RuntimeDriveRequest = { reason: string; runRef?: RunRef; maxIntents?: number };
export type RecoveryResult = { quarantined?: RunRef[]; scheduledRetries?: RunRef[]; recorded: number; rejected: { runRef: RunRef; receipt: unknown }[] };

/** Application-facing Dispatch orchestration. It owns exact-Run fact
 * reconciliation; execution concurrency belongs to the shared outbox consumer; callers schedule work and render receipts, never classify
 * unknown side effects or replay an unconfirmed run themselves. */
export interface RuntimeDispatchPort {
  drive(request: RuntimeDriveRequest): Promise<DispatchDriveResult>;
  recover(scopes: readonly DispatchScope[]): Promise<RecoveryResult>;
}
