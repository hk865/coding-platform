/**
 * 7D2 WD: the result of withdrawing a workspace that never entered the
 * architecture graph or removing one that did. The Host settings routes wrap
 * this in a `SettingsResponse`; the core port returns it directly.
 */
import type { ProjectScope } from './core/identity.js';
import type { WorkspaceRef } from './ledger.js';

export type WorkspaceRemovalKindV1 = 'withdraw' | 'remove';

/** One withdrawal/removal's result; the Host settings route wraps it as a SettingsResponse. */
export type WorkspaceRemovalViewV1 = {
  projectRef: ProjectScope;
  workspaceRef: WorkspaceRef;
  removedAt: string;              // the same instant as WorkspaceSnapshot.removedAt
  releasedClaims: number;         // the region claims this call closed
  deletedIndexRows: number;       // this project's index rows deleted
  deletedLinks: number;           // cross-workspace link rows deleted
};
