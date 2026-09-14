import type { CommitCursor } from '../../contracts/command-event.js';
import type { DomainEvent } from '../../contracts/events.js';
import type { MaterialAccessGrantRow } from '../../contracts/material-access.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

export type MaterialAccessProjectionChange = {
  kind: 'grant';
  key: string;
  row: MaterialAccessGrantRow;
};

/** Build the immutable display row shared by both adapters. */
export function projectMaterialAccessEvent(event: DomainEvent, sourceCursor: CommitCursor): MaterialAccessProjectionChange | null {
  if (event.eventType !== 'MaterialAccessGranted' && event.eventType !== 'MaterialAccessRevoked') return null;
  const grant = event.payload.grant;
  const ref = {
    aggregateType: 'MaterialAccessGrant' as const,
    projectId: event.projectId,
    workspaceId: event.workspaceId,
    goalId: grant.scope.goalId,
    grantId: grant.grantId,
  };
  return {
    kind: 'grant',
    key: canonicalJson(ref),
    row: {
      ...(event.eventType === 'MaterialAccessRevoked' ? { revocation: event.payload.revocation } : {}),
      ref,
      revision: event.aggregateRevision,
      grant,
      sourceCursor,
    },
  };
}
