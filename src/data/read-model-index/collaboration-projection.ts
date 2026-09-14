import type { CommitCursor } from '../../contracts/command-event.js';
import type { DomainEvent } from '../../contracts/events.js';
import { consoleWorkspaceKey } from '../../contracts/console-views.js';
import {
  initialDesignDecisionRefFor,
  initialDesignProposalRefFor,
  type CoordinationPolicyRevisionSnapshot,
  type InitialDesignDecisionSnapshot,
  type InitialDesignProposalSnapshot,
  type ProjectCoordinationPolicyActiveSnapshot,
} from '../../contracts/human-role-collaboration.js';

export type CollaborationProjectionChange =
  | { kind: 'proposal'; key: string; snapshot: InitialDesignProposalSnapshot; sourceCursor: CommitCursor }
  | { kind: 'decision'; key: string; snapshot: InitialDesignDecisionSnapshot; sourceCursor: CommitCursor }
  | { kind: 'policy'; key: string; snapshot: CoordinationPolicyRevisionSnapshot; sourceCursor: CommitCursor }
  | { kind: 'activation'; key: string; snapshot: ProjectCoordinationPolicyActiveSnapshot; sourceCursor: CommitCursor };

/** Interpret one collaboration event without choosing a storage mutation. */
export function projectCollaborationEvent(event: DomainEvent, sourceCursor: CommitCursor): CollaborationProjectionChange | null {
  if (event.eventType === 'InitialDesignProposalRecorded') {
    const proposal = event.payload.proposal;
    return {
      kind: 'proposal',
      key: `${consoleWorkspaceKey(proposal.projectId, proposal.workspaceId)}\u0000${proposal.designId}`,
      snapshot: {
        ref: initialDesignProposalRefFor(proposal.projectId, proposal.workspaceId, proposal.designId),
        revision: 1,
        schemaVersion: 1,
        proposal,
        recordedAt: event.payload.recordedAt,
      },
      sourceCursor,
    };
  }
  if (event.eventType === 'InitialDesignDecisionRecorded') {
    const decision = event.payload.decision;
    return {
      kind: 'decision',
      key: `${consoleWorkspaceKey(decision.projectId, decision.workspaceId)}\u0000${decision.decisionId}`,
      snapshot: {
        ref: initialDesignDecisionRefFor(decision.projectId, decision.workspaceId, decision.decisionId),
        revision: 1,
        schemaVersion: 1,
        decision,
        recordedAt: event.payload.recordedAt,
      },
      sourceCursor,
    };
  }
  if (event.eventType === 'CoordinationPolicyInstalled') {
    const snapshot = event.payload.revision;
    return {
      kind: 'policy',
      key: `${consoleWorkspaceKey(snapshot.ref.projectId, '')}\u0000${snapshot.ref.policyId}`,
      snapshot,
      sourceCursor,
    };
  }
  if (event.eventType === 'CoordinationPolicyActivated') {
    const snapshot: ProjectCoordinationPolicyActiveSnapshot = {
      ref: event.payload.activeRef,
      projectId: event.payload.activeRef.projectId,
      activeRevision: event.payload.activeRevision,
      revision: event.aggregateRevision,
    };
    return {
      kind: 'activation',
      key: `${consoleWorkspaceKey(snapshot.projectId, '')}\u0000${snapshot.ref.projectId}`,
      snapshot,
      sourceCursor,
    };
  }
  return null;
}
