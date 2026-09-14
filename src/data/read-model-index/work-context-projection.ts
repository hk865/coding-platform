import type { DomainEvent } from '../../contracts/events.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import {
  continuationRecordRefFor, workContextRefFor,
  type WorkContextBindingSnapshot, type WorkContextNoteRow,
  type ContinuationRecordSnapshot,
} from '../../contracts/context-continuity.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

type ContextProjectionChange =
  | { kind: 'binding'; key: string; snapshot: WorkContextBindingSnapshot }
  | { kind: 'note'; key: string; row: WorkContextNoteRow }
  | { kind: 'continuation'; key: string; snapshot: ContinuationRecordSnapshot };

/** Interpret one committed event. Only linking needs an existing binding;
 * adapters fetch that exact row and retain their own write/transaction strategy. */
export function projectWorkContext(
  event: DomainEvent,
  cursor: CommitCursor,
  getBinding: (key: string) => WorkContextBindingSnapshot | undefined,
): ContextProjectionChange | undefined {
  if (event.eventType === 'WorkContextBound') {
    const ref = workContextRefFor(event.projectId, event.workspaceId, event.aggregateId);
    return { kind: 'binding', key: canonicalJson(ref), snapshot: {
      ref, revision: event.aggregateRevision, schemaVersion: 1, binding: event.payload.binding,
    } };
  }
  if (event.eventType === 'WorkRunLinked') {
    const ref = workContextRefFor(event.projectId, event.workspaceId, event.aggregateId);
    const key = canonicalJson(ref), previous = getBinding(key);
    if (!previous) return undefined;
    return { kind: 'binding', key, snapshot: {
      ref, revision: event.aggregateRevision, schemaVersion: 1,
      binding: { ...previous.binding, linkedRunRefs: event.payload.linkedRunRefs.map(r => ({ ...r })) },
    } };
  }
  if (event.eventType === 'ExecutionNoteRecorded') {
    const note = event.payload.note;
    return { kind: 'note', key: canonicalJson(workContextRefFor(event.projectId, event.workspaceId, note.workId)), row: {
      noteRef: { aggregateType: 'ExecutionNote', projectId: event.projectId, workspaceId: event.workspaceId,
        workId: note.workId, noteId: note.noteId },
      kind: note.kind, summary: note.summary, runRef: { ...note.runRef },
      createdAt: note.createdAt, sourceCursor: cursor,
    } };
  }
  if (event.eventType === 'ContinuationRecorded') {
    const result = event.payload.result;
    return { kind: 'continuation', key: canonicalJson(workContextRefFor(event.projectId, event.workspaceId, result.workId)), snapshot: {
      ref: continuationRecordRefFor(event.projectId, event.workspaceId, result.workId, result.reportId),
      revision: 1, schemaVersion: 1, result,
    } };
  }
  return undefined;
}
