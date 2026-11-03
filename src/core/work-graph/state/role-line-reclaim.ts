/**
 * The retained-cap reclaim (pure; imports only `src/contracts` and this directory): which idle adviser/scribe line
 * gives up its seat, and the narrow ports the reclaim and the capacity episode are injected through. There is no idle
 * clock and no card from the reclaim itself (decision 91).
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  ProjectRoleLimitsV1, RoleCapacityEpisodeV1, RoleLineAllocationV1, RoleLineDutyV1,
} from '../../../contracts/role-lines.js';
import { roleLineIdleOf, type RoleLineIdleFactsV1 } from './session-availability.js';

export type ReclaimSeatV1 = {
  reclaimed: SessionRef;
  allocation: RoleLineAllocationV1 | null; limits: ProjectRoleLimitsV1;
  /** The record-store guard's shape, written structurally (pure state imports only contracts; D-11). */
  allocationGuard: { refKey: string; expectedRevision: number | null };
  limitsGuard: { refKey: string; expectedRevision: number | null };
};
export interface RoleLineReclaimPort {
  reclaimForAdmission(ctx: CoreCallContext, input: { projectRef: ProjectScope; duty: RoleLineDutyV1 }):
    Promise<ReadResult<ReclaimSeatV1 | null>>;
}
/** O2 lands this narrow DI type; O3's `role-capacity-service.ts` implements it. */
export type RoleCapacityObservationV1 = { episode: RoleCapacityEpisodeV1; opened: boolean };
/** A branch that writes nothing must not report committed, so a clean close has its own arm. */
export type CapacityCloseV1 =
  | { status: 'closed'; episode: RoleCapacityEpisodeV1; cursor: CommitCursor }
  | { status: 'clean' }
  | CoreRejection;
export type RoleCapacityPort = {
  /** The platform automatic add's one call after O2's reclaim: opens/closes the episode, never writes a card row. */
  observeAtCap(ctx: CoreCallContext, input: {
    projectRef: ProjectScope; duty: RoleLineDutyV1; operation: OperationRef;
    capValue: number; holders: number; reservations: number; open: number;
  }): Promise<WriteResult<RoleCapacityObservationV1>>;
  /** b11: after a release, one `PreparedCommit` guarded by the open episode's revision; `operation` is the
   *  released line's operation and `null` when the release came from the public cap set. */
  closeIfStale(ctx: CoreCallContext, input: {
    projectRef: ProjectScope; duty: RoleLineDutyV1; operation: OperationRef | null;
  }): Promise<CapacityCloseV1>;
};

/**
 * The line to reclaim: same duty, idle by `roleLineIdleOf`, not the last unarchived line of that duty and with no
 * pending decision card; the earliest `lastActivityAt` wins, tie by `sessionId`. `null` when no line qualifies.
 */
export function reclaimIdleLineOf(input: {
  duty: 'adviser' | 'scribe'; lines: readonly RoleLineIdleFactsV1[];
}): SessionRef | null {
  let chosen: RoleLineIdleFactsV1 | null = null;
  for (const line of input.lines) {
    if (line.duty !== input.duty || line.lastUnarchivedOfDuty || line.pendingDecisionCard) continue;
    if (!roleLineIdleOf(line).idle) continue;
    if (chosen === null || line.lastActivityAt < chosen.lastActivityAt
      || (line.lastActivityAt === chosen.lastActivityAt && line.session.sessionId < chosen.session.sessionId)) {
      chosen = line;
    }
  }
  return chosen === null ? null : chosen.session;
}
