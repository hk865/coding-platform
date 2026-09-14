import type { CommitCursor } from '../../contracts/command-event.js';
import type { ControlIntentRef, ControlIntentStatus, ControlKind } from '../../contracts/control-intent.js';
import type { DomainEvent } from '../../contracts/events.js';
import { consoleWorkspaceKey } from '../../contracts/console-views.js';

export type ControlIntentProjectionRow = {
  ref: ControlIntentRef;
  scope: { goalId: string | null; taskId: string | null };
  kind: ControlKind;
  desiredState: string;
  status: ControlIntentStatus;
  ackCount: number;
  cursor: CommitCursor;
};

export type ControlIntentProjectionChange = {
  kind: 'timeline';
  key: string;
  rows: ControlIntentProjectionRow[];
  sourceCursor: CommitCursor;
};

/** Fold one intent/ack event into a new timeline value without mutating prior rows. */
export function projectControlIntentEvent(
  event: DomainEvent,
  sourceCursor: CommitCursor,
  priorRows: readonly ControlIntentProjectionRow[],
): ControlIntentProjectionChange | null {
  if (event.eventType !== 'ControlIntentRecorded' && event.eventType !== 'SafePointAcknowledged') return null;
  const key = consoleWorkspaceKey(event.projectId, event.workspaceId);
  if (event.eventType === 'ControlIntentRecorded') {
    const intent = event.payload.intent;
    return {
      kind: 'timeline',
      key,
      rows: [...priorRows, {
        ref: { aggregateType: 'ControlIntent', projectId: event.projectId, workspaceId: event.workspaceId, intentId: intent.intentId },
        scope: { goalId: intent.scope.goalId, taskId: intent.scope.taskId },
        kind: intent.kind,
        desiredState: intent.desiredState,
        status: intent.status,
        ackCount: 0,
        cursor: sourceCursor,
      }],
      sourceCursor,
    };
  }
  const intentId = event.payload.ack.intentRef.intentId;
  return {
    kind: 'timeline',
    key,
    rows: priorRows.map(row => row.ref.intentId === intentId
      ? { ...row, status: event.payload.status, ackCount: row.ackCount + 1, cursor: sourceCursor }
      : { ...row }),
    sourceCursor,
  };
}
