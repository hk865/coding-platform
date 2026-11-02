/**
 * The pure decision of `projects/role-limits/set`: the expected-revision check, the merge of the partial levels,
 * and the complete next record. The record is built here so no owner outside `state/` assigns a protected field of
 * `ProjectRoleLimitsV1`; the owner only checks and encodes it.
 */
import type { ProjectScope } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import {
  ROLE_LINE_DEFAULT_LIMITS, type ProjectRoleLimitsV1, type RoleLimitsSetRequestV1, type RoleLimitsViewV1,
} from '../../../contracts/role-lines.js';

export type RoleLimitsLevelsV1 = Pick<RoleLimitsViewV1, 'running' | 'open'>;
export type RoleLimitsChangeV1 = Pick<RoleLimitsSetRequestV1, 'expectedRevision' | 'running' | 'open'>;
export type RoleLimitsDecisionV1 = { from: RoleLimitsLevelsV1; to: RoleLimitsLevelsV1; revision: number;
  record: ProjectRoleLimitsV1 };

export function projectRoleLimitsNext(projectRef: ProjectScope, current: ProjectRoleLimitsV1 | null,
  change: RoleLimitsChangeV1):
  { ok: true; decision: RoleLimitsDecisionV1 } | { ok: false; rejection: CoreRejection } {
  const at = current === null ? 0 : current.revision;
  if (change.expectedRevision !== at) {
    return { ok: false, rejection: rejectedWithCurrent('revision_conflict', `the role limits are at revision ${at}`,
      current === null ? [] : [{ ref: current.ref, revision: at }]) };
  }
  const from: RoleLimitsLevelsV1 = current === null
    ? { running: { ...ROLE_LINE_DEFAULT_LIMITS.running }, open: { ...ROLE_LINE_DEFAULT_LIMITS.open } }
    : { running: { ...current.running }, open: { ...current.open } };
  // A lower `open` merges and revokes nothing: no holder or reservation is read here.
  const to: RoleLimitsLevelsV1 = {
    running: { ...from.running, ...(change.running ?? {}) },
    open: { ...from.open, ...(change.open ?? {}) },
  };
  const revision = at + 1;
  const record: ProjectRoleLimitsV1 = {
    ref: { aggregateType: 'ProjectRoleLimits', projectId: projectRef.projectId },
    revision,
    projectRef,
    running: { ...to.running },
    open: { ...to.open },
  };
  return { ok: true, decision: { from, to, revision, record } };
}
