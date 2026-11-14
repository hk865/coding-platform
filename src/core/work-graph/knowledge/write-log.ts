/**
 * The knowledge write log. Every file change of a write gets one `KnowledgeWrite@1` record in the write point's own
 * commit (`pending`, before and after blob, `since` bound to the event that carries the file's content); once the
 * files landed one more commit marks the landed logs `completed`. A log left `pending` is a write that may not have
 * landed: the reconciliation compares the file with `afterBlob`.
 */
import { rejected } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { CommitCursorBinding, EncodedDomainEvent, EncodedRecord, RecordGuard, StoreResult } from '../../record-store/ports.js';
import { gitBlobId } from '../../workspace/workspace-change-capture.js';
import { lineRefKey, type KnowledgeFileChange, type KnowledgeWriteDeps, type LineKnowledge } from '../model/line-knowledge.js';
import {
  KNOWLEDGE_WRITES_BY_LINE_STATE_LOOKUP, knowledgeWriteCodec, knowledgeWritesCompletedCodec,
  knowledgeWritesUnconfirmedCodec, type KnowledgeWriteV1,
} from '../persistence/knowledge-record-codecs.js';
import { lookupAll, type LookupBatch } from '../persistence/lookup-all.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';

const READY: StoreResult<void> = { status: 'ready', value: undefined };

/** 2c-1d: the reason a read or a write gives while a knowledge write it depends on is `pending`. */
export const KNOWLEDGE_WRITE_UNCONFIRMED = '有未确认的知识写';

/**
 * 2c-1d (split ruling §7, lead 11-12): the `pending` write logs of these lines: writes in flight, or ones whose files
 * may not have landed, so those files may still be older than the records. A read lists the lines it reads (each
 * workspace's current line, so a crash left on another branch does not stop this checkout): the current architecture
 * read looks at the architecture and module logs, a note window at its notes' logs; a write lists its changed line
 * and looks at every log. An `unconfirmed` log is not listed: it was handed to the person and the file rules.
 */
export async function pendingKnowledgeWrites(records: RecordLookupPort, projectId: string,
  lines: readonly Pick<LineKnowledge, 'scope' | 'line'>[]): Promise<StoreResult<KnowledgeWriteV1[]>> {
  const logs: KnowledgeWriteV1[] = [];
  for (const line of lines) {
    let listed: LookupBatch<EncodedRecord>;
    try {
      listed = await lookupAll(records, KNOWLEDGE_WRITES_BY_LINE_STATE_LOOKUP,
        [projectId, lineRefKey(line.scope, line.line), 'pending']);
    } catch (failure) {
      return rejected('unavailable', `the pending knowledge writes cannot be read: ${storeFailureToRejection(failure).reason}`);
    }
    for (const record of listed.items) {
      const decoded = knowledgeWriteCodec.decode(record);
      if (decoded.status !== 'decoded') return rejected('unavailable', decoded.reason);
      if (decoded.value.branch === line.line.branch) logs.push(decoded.value);
    }
  }
  return { status: 'ready', value: logs };
}

/**
 * One `pending` log per file change, joined to the write point's commit: a guard that the log is new and its `since`
 * bound to the event that carries the file's content ([2C1-02]). `logs` names each change's log so the landed ones
 * can be completed. A change without a carrying event throws (the write point's commit answers `unavailable`).
 */
export function writeLogExtras(write: KnowledgeWriteDeps, projectId: string,
  plans: readonly { line: LineKnowledge; changes: readonly KnowledgeFileChange[] }[], events: readonly EncodedDomainEvent[]):
{ records: EncodedRecord[]; guards: RecordGuard[]; commitCursorBindings: CommitCursorBinding[];
  logs: Map<KnowledgeFileChange, string> } {
  const records: EncodedRecord[] = [];
  const guards: RecordGuard[] = [];
  const commitCursorBindings: CommitCursorBinding[] = [];
  const logs = new Map<KnowledgeFileChange, string>();
  for (const { line, changes } of plans) {
    for (const change of changes) {
      const file = write.files.writeLogFileOf(line.scope, change.path, (change.after ?? change.before)!);
      const encoded = knowledgeWriteCodec.encode({
        ref: { aggregateType: 'KnowledgeWrite', projectId, writeId: write.newId() }, revision: 1,
        lineRef: lineRefKey(line.scope, line.line), branch: line.line.branch, path: change.path, kind: file.kind,
        moduleId: file.moduleId,
        beforeBlob: change.before === null ? null : gitBlobId(change.before, line.objectFormat),
        afterBlob: change.after === null ? null : gitBlobId(change.after, line.objectFormat),
        state: 'pending', since: null,
      });
      records.push(encoded);
      guards.push({ refKey: encoded.refKey, expectedRevision: null });
      commitCursorBindings.push({ refKey: encoded.refKey, field: 'since',
        eventIndex: write.files.carrierEventIndex(events, change.path) });
      logs.set(change, encoded.refKey);
    }
  }
  return { records, guards, commitCursorBindings, logs };
}

/**
 * [2C1-07]: marks these logs `completed` in one commit (each guarded on the revision it was read at) with one
 * `KnowledgeWritesCompleted` event, the Store's one-event minimum. Its identity is the sorted write ids, so the same
 * completion replays. The write's landing, the reconciliation's "the file is the written bytes" and a recovery all
 * complete through here. A failure changes no caller's answer: the logs stay as they were and the next
 * reconciliation completes them.
 */
export async function completeKnowledgeWrites(write: KnowledgeWriteDeps, projectId: string,
  logs: readonly KnowledgeWriteV1[]): Promise<StoreResult<void>> {
  return moveKnowledgeWrites(write, projectId, logs.filter(log => log.state !== 'completed'), 'completed');
}

/**
 * The `pending` logs a reconciliation handed to the person as recovery items become `unconfirmed` (the file
 * rules from then on), in one commit with one `KnowledgeWritesUnconfirmed` event; the same set replays. A failure
 * leaves them `pending` and the next reconciliation moves them (their recovery items are already there).
 */
export async function markKnowledgeWritesUnconfirmed(write: KnowledgeWriteDeps, projectId: string,
  logs: readonly KnowledgeWriteV1[]): Promise<StoreResult<void>> {
  return moveKnowledgeWrites(write, projectId, logs.filter(log => log.state === 'pending'), 'unconfirmed');
}

/** The one state commit of a set of logs: each guarded on the revision it was read at, identity the sorted ids. */
async function moveKnowledgeWrites(write: KnowledgeWriteDeps, projectId: string, logs: readonly KnowledgeWriteV1[],
  state: 'completed' | 'unconfirmed'): Promise<StoreResult<void>> {
  if (logs.length === 0) return READY;
  try {
    const writeIds = logs.map(log => log.ref.writeId).sort();
    const digest = sha256Hex(canonicalJson(writeIds));
    const records = logs.map(log => knowledgeWriteCodec.encode({ ...log, state, revision: log.revision + 1 }));
    const header = { eventId: write.newId(), schemaVersion: 1 as const, occurredAt: write.now(), projectId, writeIds };
    const event = state === 'completed'
      ? knowledgeWritesCompletedCodec.encode({ ...header, eventType: 'KnowledgeWritesCompleted' })
      : knowledgeWritesUnconfirmedCodec.encode({ ...header, eventType: 'KnowledgeWritesUnconfirmed' });
    const identity = state === 'completed' ? 'knowledge-complete' : 'knowledge-unconfirmed';
    const receipt = await write.records.commit({ identityKey: `${identity}:${digest}`, fingerprint: digest,
      guards: logs.map((log, index) => ({ refKey: records[index]!.refKey, expectedRevision: log.revision })),
      records, claims: [], indexGuards: [], indexChanges: [], events: [event] });
    return receipt.status === 'committed' ? READY : receipt;
  } catch (error) {
    return rejected('unavailable', `the knowledge write logs could not be marked ${state}: ${messageOf(error)}`);
  }
}

/** The landed changes' logs read back (their bound `since` included) and completed; a failed read completes none. */
export async function completeLandedWrites(write: KnowledgeWriteDeps, projectId: string,
  refKeys: readonly string[]): Promise<StoreResult<void>> {
  if (refKeys.length === 0) return READY;
  try {
    const read = await write.records.readMany(refKeys);
    if (read.status !== 'ready') return read;
    const logs: KnowledgeWriteV1[] = [];
    for (const record of read.value.records) {
      const decoded = knowledgeWriteCodec.decode(record);
      if (decoded.status !== 'decoded') return rejected('unavailable', decoded.reason);
      logs.push(decoded.value);
    }
    return await completeKnowledgeWrites(write, projectId, logs);
  } catch (error) {
    return rejected('unavailable', `the knowledge write logs could not be read: ${messageOf(error)}`);
  }
}
