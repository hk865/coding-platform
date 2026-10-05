import type { ArtifactOwnerRunRef, ArtifactRef } from '../../../contracts/artifact.js';
import type { GoalRef, GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { MaterialAccessGrantSnapshot } from '../../../contracts/material-access.js';
import type { RecordGuard } from '../../record-store/ports.js';

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

/**
 * LA-2 (STATE-MACHINES-SPEC §3.3 point 5, lead decision 2026-10-03): whether a
 * reader Run's Task is carried unchanged from `fromPlanRef` (the Run's claim
 * Plan, which a grant's `basis.planRef` names) into the Goal's active Plan
 * `toPlanRef`: the `carried_unchanged` rule of W3's `entryPlanVerdict`. The
 * composition root injects the `tasks/` reader; materials never reads a
 * PlanRevision. `carried` lists the immutable Plans the decision read, for a
 * caller that pins its read window; a read failure is `unavailable`.
 */
export type TaskCarriedUnchanged = (input: {
  goalRef: GoalRef; taskId: string; fromPlanRef: PlanRevisionRef; toPlanRef: PlanRevisionRef;
}) => Promise<
  | { status: 'carried'; guards: readonly RecordGuard[] }
  | { status: 'not_carried'; reason: string }
  | { status: 'unavailable'; reason: string }
>;
