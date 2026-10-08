/**
 * Slice 1 §3.5: the pure responsibility transfer/close machine. It closes the
 * source `SessionWorkLink` and opens the destination one; the owner service
 * binds both to the same commit cursor. No Task completion algorithm lives here.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import { accept, reject, unreachable, type Transition } from './transition.js';

export type PendingResponsibleLinkV1 = Omit<SessionWorkLink, 'since'> & {
  since: CommitCursor | null;
};
export type ResponsibilityStateV1 = {
  source: SessionRecord; destination: SessionRecord | null;
  sourceLink: SessionWorkLink | null; destinationLink: SessionWorkLink | null;
};
export type ResponsibilityEventV1 =
  | { kind: 'responsibility_transferred'; to: SessionRef }
  | { kind: 'responsibility_released'; mode: 'drop' | 'terminal' };
export type ResponsibilityGuardV1 = {
  sameScope: boolean; targetValid: boolean; taskTerminal: boolean;
  writerStopped: boolean; destinationEligible: boolean; pinsMatch: boolean;
};
export type ResponsibilityEffectV1 = {
  kind: 'write_responsibility'; source: SessionRecord; destination: SessionRecord | null;
  closed: PendingResponsibleLinkV1; opened: PendingResponsibleLinkV1 | null;
  openedBound: 'since' | null;
} | { kind: 'emit_event'; eventType: 'SessionResponsibilityChanged' };
export type PendingResponsibilityStateV1 = Omit<ResponsibilityStateV1, 'sourceLink' | 'destinationLink'> & {
  sourceLink: PendingResponsibleLinkV1 | null; destinationLink: PendingResponsibleLinkV1 | null;
};
export function transitionResponsibility(
  state: ResponsibilityStateV1, event: ResponsibilityEventV1, ctx: ResponsibilityGuardV1,
): Transition<PendingResponsibilityStateV1, ResponsibilityEventV1, ResponsibilityEffectV1> {
  if (!ctx.sameScope) {
    return reject('guard_failed', 'forbidden', 'archive_scope: the destination Session is outside the archive scope');
  }
  const sourceLink = state.sourceLink;
  if (sourceLink === null) return reject('guard_failed', 'not_found', 'the source has no open responsible link');
  if (sourceLink.until !== null) return reject('guard_failed', 'invalid', 'the source responsible link is already closed');
  // §3.4 S:612 check order: the open link and its pin precede the Task/terminal
  // evidence and the writer-stopped proof. A pin mismatch is
  // `revision_conflict` even while the old writer is still running.
  if (!ctx.pinsMatch) return reject('stale', 'revision_conflict', 'the responsibility records changed since the caller read them');
  if (!ctx.writerStopped) {
    return reject('guard_failed', 'busy', 'archive_execution_pending: the source Task writer is still running');
  }

  switch (event.kind) {
    case 'responsibility_transferred': {
      if (!ctx.targetValid) return reject('guard_failed', 'not_found', 'the transfer target is not a valid Task or Work target');
      if (state.destination === null) return reject('guard_failed', 'invalid', 'a transfer needs the destination Session record');
      if (!ctx.destinationEligible) {
        return reject('guard_failed', 'unavailable',
          'the destination Session is retired, archived, archiving or a readonly copy');
      }
      const closed: PendingResponsibleLinkV1 = { ...sourceLink, revision: sourceLink.revision + 1, until: null };
      const { opened, openedBound } = openDestination(state.destinationLink, event.to, sourceLink.ref.target);
      const source: SessionRecord = { ...state.source, revision: state.source.revision + 1 };
      const destination: SessionRecord = { ...state.destination, revision: state.destination.revision + 1 };
      return accept<PendingResponsibilityStateV1, ResponsibilityEffectV1>(
        { source, destination, sourceLink: closed, destinationLink: opened },
        [
          { kind: 'write_responsibility', source, destination, closed, opened, openedBound },
          { kind: 'emit_event', eventType: 'SessionResponsibilityChanged' },
        ],
      );
    }
    case 'responsibility_released': {
      if (event.mode === 'terminal' && !ctx.taskTerminal) {
        return reject('guard_failed', 'invalid', 'a terminal close needs the trusted terminal Task proof');
      }
      const closed: PendingResponsibleLinkV1 = { ...sourceLink, revision: sourceLink.revision + 1, until: null };
      const source: SessionRecord = { ...state.source, revision: state.source.revision + 1 };
      return accept<PendingResponsibilityStateV1, ResponsibilityEffectV1>(
        { source, destination: null, sourceLink: closed, destinationLink: null },
        [
          { kind: 'write_responsibility', source, destination: null, closed, opened: null, openedBound: null },
          { kind: 'emit_event', eventType: 'SessionResponsibilityChanged' },
        ],
      );
    }
    default:
      return unreachable(event, 'responsibility event');
  }
}

/**
 * The destination link of a transfer: an absent link opens at revision 1 with
 * its `since` left for the owner to bind; an already open one is reused
 * unchanged and binds nothing; a closed one is reopened at revision + 1 and
 * rebound.
 */
function openDestination(
  existing: SessionWorkLink | null, to: SessionRef, target: SessionWorkLink['ref']['target'],
): { opened: PendingResponsibleLinkV1; openedBound: 'since' | null } {
  if (existing !== null && existing.until === null) return { opened: existing, openedBound: null };
  const ref: SessionWorkLink['ref'] = {
    aggregateType: 'SessionWorkLink',
    projectId: to.projectId,
    sessionId: to.sessionId,
    target,
    relation: 'responsible',
  };
  if (existing === null) return { opened: { ref, revision: 1, since: null, until: null }, openedBound: 'since' };
  return { opened: { ...existing, revision: existing.revision + 1, since: null, until: null }, openedBound: 'since' };
}
