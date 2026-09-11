import type { RunRef } from './dispatch.js';
import type { DispatchDriveResult } from './ports.js';

export type DispatchScope = { projectId: string; workspaceId: string };
export type RuntimeDriveRequest = { reason: string; runRef: RunRef };
export type RecoveryResult = { recorded: number; rejected: { runRef: RunRef; receipt: unknown }[] };

/** Application-facing Dispatch orchestration. It owns serialization and fact
 * reconciliation; callers schedule work and render receipts, never classify
 * unknown side effects or replay an unconfirmed run themselves. */
export interface RuntimeDispatchPort {
  drive(request: RuntimeDriveRequest): Promise<DispatchDriveResult>;
  recover(scopes: readonly DispatchScope[]): Promise<RecoveryResult>;
}
