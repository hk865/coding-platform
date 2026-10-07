import type { GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { QueryRunSnapshot } from '../../../contracts/query-job.js';

export type MaterialCanonicalSnapshot = GoalSnapshot | WorkspaceSnapshot | RunSnapshot | QueryRunSnapshot;
export type MaterialCanonicalRef = MaterialCanonicalSnapshot['ref'];
export type MaterialSnapshotResult =
  | { status: 'found'; snapshot: MaterialCanonicalSnapshot }
  | { status: 'not_found'; ref: MaterialCanonicalRef }
  | { status: 'unavailable'; reason: string };
/** A local capability whose production provider is the target RecordStore. */
export type MaterialAuthorityReads = {
  load(ref: MaterialCanonicalRef): Promise<MaterialSnapshotResult>;
};
