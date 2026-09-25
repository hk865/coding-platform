import type { ArtifactOwnerRunRef, ArtifactRef } from '../../../contracts/artifact.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { MaterialAccessGrantSnapshot } from '../../../contracts/material-access.js';

export type MaterialCanonicalSnapshot = GoalSnapshot | WorkspaceSnapshot | RunSnapshot | QueryRunSnapshot | MaterialAccessGrantSnapshot;
export type MaterialCanonicalRef = MaterialCanonicalSnapshot['ref'];
export type MaterialSnapshotResult =
  | { status: 'found'; snapshot: MaterialCanonicalSnapshot }
  | { status: 'not_found'; ref: MaterialCanonicalRef }
  | { status: 'unavailable'; reason: string };
/** A local capability whose production provider is the target RecordStore. */
export type MaterialAuthorityReads = {
  load(ref: MaterialCanonicalRef): Promise<MaterialSnapshotResult>;
};
export type MaterialCandidateReads = {
  materialAccessCandidates(query: { reader: ArtifactOwnerRunRef; material: ArtifactRef }): Promise<
    | { status: 'ready'; grants: MaterialAccessGrantSnapshot[] }
    | { status: 'unavailable'; reason: string }
  >;
};
