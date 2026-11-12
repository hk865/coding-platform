/**
 * The person's "恢复" of one recovery item of a knowledge notice ([2C1-19], [2C1-20]), and the read of a notice's
 * items ([2C1-23]). The items are this project's (its snapshots); the content never leaves here. A recovery writes
 * the item's file in the write queue and the line's cross-Host lease, only while the file is still what the notice
 * saw: an unconfirmed platform write is rebuilt from the one event that carries it and must come out as the bytes
 * the write logged; a revert writes back the snapshot it chose. It never re-runs a service or writes a business
 * event, and a failure is answered as it is, never retried. Only a recovery reads an event ([2C1-21]).
 */
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { KnowledgeRecoverResult, KnowledgeRecoveryItemV1 } from '../../../contracts/knowledge.js';
import type { KnowledgeRecoveryRow, KnowledgeSnapshots } from '../../record-store/knowledge-snapshot-ports.js';
import type { StoreResult } from '../../record-store/ports.js';
import { gitBlobId } from '../../workspace/workspace-change-capture.js';
import {
  lineRefKey, lineRefWorkspaceId, type KnowledgeCaller, type KnowledgeLines, type KnowledgeWriteDeps, type LineKnowledge,
} from '../model/line-knowledge.js';
import { knowledgeWriteCodec, type KnowledgeWriteV1 } from '../persistence/knowledge-record-codecs.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { indexLanded, withKnowledgeLeases } from './knowledge-write.js';
import { withSnapshots } from './reconcile.js';
import { completeKnowledgeWrites } from './write-log.js';

/** The bytes a recovery writes (null deletes) and, for an unconfirmed write, the log it completes. */
type Recovered = { bytes: Uint8Array | null; log: KnowledgeWriteV1 | null };

/** [2C1-23]: a notice's items by `itemNo` (path and kind only); a notice with none here is `not_found`. */
export async function recoveryItemsOf(write: KnowledgeWriteDeps, projectId: string, noticeId: string):
Promise<ReadResult<{ items: readonly KnowledgeRecoveryItemV1[] }>> {
  return withSnapshots(write, projectId, async snapshots => {
    const rows = snapshots.readRecovery(noticeId);
    return rows.length === 0 ? { status: 'not_found' }
      : { status: 'ready', value: { items: rows.map(({ itemNo, kind, path }) => ({ itemNo, kind, path })) } };
  });
}

/**
 * [2C1-19], [2C1-20]: the item is read first (another project's notice is not found in this project's snapshots),
 * then its line is recovered in the queue and the lease. A recovered item is indexed as the platform's own write
 * (errata 2c1#6) and removed; the notice stays. Once the queue and the lease are released `reconcileLine` reconciles
 * the item's workspace once ('recovery'), before the answer.
 */
export async function recoverKnowledgeItem(lines: KnowledgeLines, caller: KnowledgeCaller, noticeId: string,
  itemNo: number, reconcileLine: (workspaceId: string) => Promise<unknown>): Promise<WriteResult<KnowledgeRecoverResult>> {
  const write = lines.write;
  let workspaceId = '';
  const recovered = await withSnapshots(write, caller.projectId, async (snapshots): Promise<WriteResult<KnowledgeRecoverResult>> => {
    const row = snapshots.readRecovery(noticeId).find(item => item.itemNo === itemNo);
    if (row === undefined) return rejected('not_found', `这条通知没有第 ${itemNo} 个恢复项：${noticeId}`);
    workspaceId = lineRefWorkspaceId(row.lineRef);
    const line = await lines.line(caller, workspaceId);
    if (line.status !== 'ready') return storeFailureToRejection(line);
    return write.queue.run(caller.projectId, [line.value.line.folder], async () => {
      const leased = await withKnowledgeLeases(write, [line.value], () => recoverLeased(write, line.value, snapshots, row));
      return leased.status === 'ready' ? leased.value : storeFailureToRejection(leased);
    });
  });
  if (recovered.status === 'committed') await reconcileLine(workspaceId);
  return recovered;
}

async function recoverLeased(write: KnowledgeWriteDeps, line: LineKnowledge, snapshots: KnowledgeSnapshots,
  row: KnowledgeRecoveryRow): Promise<WriteResult<KnowledgeRecoverResult>> {
  // errata 2c1#15: the item's line is the one checked out now, or nothing is written.
  if (lineRefKey(line.scope, line.line) !== row.lineRef) return rejected('revision_conflict', '检出的分支已经变了');
  const disk = await line.readKnowledgeFiles();
  if (disk.status !== 'ready') return storeFailureToRejection(disk);
  const current = disk.value.files.find(file => file.path === row.path) ?? null;
  // The file must be exactly what the notice saw (both missing counts as the same), or a later change stays.
  if ((current?.blobSha ?? null) !== row.expectedBlob) return rejected('revision_conflict', '文件在通知之后又被改过');
  const recovered = row.kind === 'write_unconfirmed' ? await rebuiltWrite(write, line, row, current?.bytes ?? null)
    : chosenSnapshotOf(snapshots, row);
  if (recovered.status !== 'ready') return storeFailureToRejection(recovered);
  const change = { path: row.path, before: current?.bytes ?? null, after: recovered.value.bytes };
  const applied = await line.applyChange(change);
  if (applied.status !== 'ready') return storeFailureToRejection(applied);
  // A failed completion is left to the next reconciliation (the file is the written bytes then).
  if (recovered.value.log !== null) await completeKnowledgeWrites(write, line.projectId, [recovered.value.log]);
  indexLanded(write, line.projectId, [{ line, changes: [change] }]);
  snapshots.deleteRecovery(row.noticeId, row.itemNo);
  // No business record is written: the answer carries the records' position after the recovery (a notice was
  // committed before any item, so there is one).
  const head = await write.records.readMany([]);
  if (head.status !== 'ready') return storeFailureToRejection(head);
  return { status: 'committed', replayed: false, cursor: head.value.readThrough!,
    value: { path: row.path, blobSha: change.after === null ? null : gitBlobId(change.after, line.objectFormat) } };
}

/**
 * [2C1-19]: the write's file rebuilt from the one event its log's `since` names, on the current file; a rebuild that
 * is not the bytes the write logged (`afterBlob`) is `unavailable`, not guessed.
 */
async function rebuiltWrite(write: KnowledgeWriteDeps, line: LineKnowledge, row: KnowledgeRecoveryRow,
  current: Uint8Array | null): Promise<StoreResult<Recovered>> {
  const refKey = canonicalJson({ aggregateType: 'KnowledgeWrite', projectId: line.projectId, writeId: row.writeId });
  const read = await write.records.readMany([refKey]);
  if (read.status !== 'ready') return read;
  const record = read.value.records[0];
  const log = record === undefined ? null : knowledgeWriteCodec.decode(record);
  if (log === null || log.status !== 'decoded') return rejected('unavailable', `${row.path} 的写日志读不出来`);
  const located = await write.records.eventAt(log.value.since);
  if (located.status !== 'ready') return located;
  const rebuilt = write.files.knowledgeFileOfEvent(located.value.event, line.scope, log.value, current);
  if (rebuilt.status !== 'decoded') return rejected('unavailable', `${row.path} 按事件重建不出来：${rebuilt.reason}`);
  const blob = rebuilt.value === null ? null : gitBlobId(rebuilt.value, line.objectFormat);
  if (blob !== log.value.afterBlob) return rejected('unavailable', `${row.path} 按事件重建的内容不是平台当时写的`);
  return { status: 'ready', value: { bytes: rebuilt.value, log: log.value } };
}

/** [2C1-20]: the snapshot the revert item chose (a snapshot an item points at is never dropped). */
function chosenSnapshotOf(snapshots: KnowledgeSnapshots, row: KnowledgeRecoveryRow): StoreResult<Recovered> {
  const copy = snapshots.listRefs(row.lineRef, row.path).find(ref => ref.takenAt === row.takenAt);
  return copy === undefined ? rejected('unavailable', `${row.path} 的快照不在了`)
    : { status: 'ready', value: { bytes: copy.content, log: null } };
}
