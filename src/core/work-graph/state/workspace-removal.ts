/**
 * WD-25: the one pure constructor of a removed Workspace snapshot. The service
 * reads the current snapshot, calls this, encodes the result and commits; it
 * never assigns `removedAt` itself (`state-writes` protects the field).
 */
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';

/** Mark the current Workspace removed on the same record at revision + 1. */
export function nextWorkspaceRemoved(current: WorkspaceSnapshot, at: string): WorkspaceSnapshot {
  return { ...current, revision: current.revision + 1, removedAt: at };
}
