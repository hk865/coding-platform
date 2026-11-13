/**
 * One reconciliation of a line's knowledge files with the platform's index (kls-design §2.2.5 and §2.2.11). The
 * files are the knowledge: the reconciliation never writes one. It completes the platform's own writes that landed,
 * hands those that did not to the person as recovery items, finds the person's reverts of uncommitted files,
 * re-indexes what changed and marks a note changed outside the platform for verification, tells the person of the
 * files that do not read as knowledge and offers each a source to restore it from, and the conflicts among them,
 * then keeps the uncommitted files' snapshots. The disk and git reads are the line's (`readKnowledgeFiles`); the
 * order and every judgment are here.
 */
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  ARCHITECTURE_FILE_PATH, type KnowledgeConflictV1, type KnowledgeIssueV1, type KnowledgeProblemV1,
  type ReconcileResult, type ReconcileTrigger,
} from '../../../contracts/knowledge.js';
import type { ProjectNoticeKindV1 } from '../../../contracts/role-lines.js';
import { truncateUtf8 } from '../../../contracts/utf8.js';
import type { KnowledgeRecoveryRow, KnowledgeSnapshots } from '../../record-store/knowledge-snapshot-ports.js';
import type { EncodedRecord, StoreResult } from '../../record-store/ports.js';
import { gitBlobId } from '../../workspace/workspace-change-capture.js';
import {
  lineRefKey, type KnowledgeArchitecture, type KnowledgeDiskFileV1, type KnowledgeLineScope, type KnowledgeRecordedArchitecture,
  type KnowledgeWriteDeps, type LineKnowledge,
} from '../model/line-knowledge.js';
import {
  KNOWLEDGE_WRITES_BY_LINE_STATE_LOOKUP, knowledgeWriteCodec, type KnowledgeWriteV1,
} from '../persistence/knowledge-record-codecs.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { projectNoticeIdentity } from '../state/project-notice.js';
import { withKnowledgeLeases } from './knowledge-write.js';
import { completeKnowledgeWrites, markKnowledgeWritesUnconfirmed } from './write-log.js';

/** One path this round finds new, changed or deleted against the index. */
type Change = { path: string; before: string | null; file: KnowledgeDiskFileV1 | null };
type RecoveryItem = Omit<KnowledgeRecoveryRow, 'noticeId' | 'itemNo' | 'lineRef'>;

/**
 * [2C1-10]: in the write queue and the line's cross-Host lease (held by another Host → `unavailable`, the next round
 * comes again). A directory that cannot be read is `unavailable` with the index and the files untouched; one bad
 * file does not fail the round.
 */
export async function reconcileKnowledgeLine(write: KnowledgeWriteDeps, line: LineKnowledge,
  trigger: ReconcileTrigger, projectLines: readonly LineKnowledge[] | null): Promise<ReadResult<ReconcileResult>> {
  return write.queue.run(line.projectId, [line.line.folder], async () => {
    const leased = await withKnowledgeLeases(write, [line], () =>
      withSnapshots(write, line.projectId, snapshots => reconcileLeased(write, line, trigger, projectLines, snapshots)));
    return leased.status === 'ready' ? leased.value : storeFailureToRejection(leased);
  });
}

/**
 * The project's snapshots for one use (a reconciliation, a recovery, a read of recovery items): a SQLite store opens
 * its file and closes it after (C4); a throw is `unavailable`.
 */
export async function withSnapshots<T>(write: KnowledgeWriteDeps, projectId: string,
  use: (snapshots: KnowledgeSnapshots) => Promise<T>): Promise<T | CoreRejection> {
  let snapshots: KnowledgeSnapshots | null = null;
  try {
    snapshots = write.openSnapshots(projectId);
    return await use(snapshots);
  } catch (error) {
    return storeFailureToRejection(error);
  } finally {
    snapshots?.close();
  }
}

async function reconcileLeased(write: KnowledgeWriteDeps, line: LineKnowledge, trigger: ReconcileTrigger,
  projectLines: readonly LineKnowledge[] | null, snapshots: KnowledgeSnapshots): Promise<ReadResult<ReconcileResult>> {
  const { projectId, objectFormat } = line;
  const lineRef = lineRefKey(line.scope, line.line);
  // Step 1: the complete list from disk, with git's view.
  const disk = await line.readKnowledgeFiles();
  if (disk.status !== 'ready') return storeFailureToRejection(disk);
  const files = new Map(disk.value.files.map(file => [file.path, file]));
  const blobAt = (path: string): string | null => files.get(path)?.blobSha ?? null;
  // Step 8's graph of these bytes, and its one exemption read now, before this round changes anything (a failed read
  // leaves the round undone): a line with no architecture.json in a project whose records never adopted an
  // architecture has no graph, which is no issue (b2 Astra 1: the records' fact, never the disk or last round's index).
  const architecture = line.architectureOfDisk(disk.value.files);
  const recorded = await write.recordedArchitecture(projectId);
  if (recorded.status !== 'ready') return recorded;
  let noGraphYet = false;
  if (architecture.status !== 'ready' && !files.has(ARCHITECTURE_FILE_PATH)) noGraphYet = recorded.value === null;
  const now = write.now();
  // Step 2: what the index held after the last round (or the platform's last write).
  const index = write.indexOf(projectId);
  const indexed = index.listFiles(lineRef);
  const previous = new Map(indexed.map(row => [row.path, row.blobSha]));

  // Step 3, unconfirmed writes: a platform write whose file is its written bytes is completed; one whose file is anything else
  // keeps the file and becomes a recovery item once, then `unconfirmed`. An `unconfirmed` log whose file came to be
  // its written bytes is completed too. A pending log's path is not an outside edit this round; a path with a log of
  // either state is classified and indexed as usual but is no revert (its recovery item is the write's).
  const logs = await openWriteLogs(write, projectId, lineRef);
  const notLanded = logs.filter(log => log.state === 'pending' && blobAt(log.path) !== log.afterBlob);
  const platformPaths = new Set(logs.filter(log => log.state === 'pending').map(log => log.path));
  const loggedPaths = new Set(logs.map(log => log.path));
  await completeKnowledgeWrites(write, projectId, logs.filter(log => blobAt(log.path) === log.afterBlob));
  const r18 = notLanded.filter(log => !snapshots.hasRecoveryForWrite(log.ref.writeId))
    .sort((left, right) => left.path !== right.path ? (left.path < right.path ? -1 : 1)
      : left.ref.writeId < right.ref.writeId ? -1 : 1);

  // Step 4: classify against the last round.
  const changes: Change[] = [];
  for (const path of [...new Set([...previous.keys(), ...files.keys()])].sort()) {
    const before = previous.get(path) ?? null;
    if (before !== blobAt(path)) changes.push({ path, before, file: files.get(path) ?? null });
  }
  // Step 5, reverts: a changed or deleted path back at an older content (deleted, HEAD's, or an earlier snapshot's), so
  // not at last round's; its recovery is the snapshot of last round's content, else the newest one; none, no item.
  const reverted: RecoveryItem[] = [];
  for (const change of changes) {
    if (change.before === null || loggedPaths.has(change.path)) continue;
    const current = change.file?.blobSha ?? null;
    const refs = snapshots.listRefs(lineRef, change.path).map(ref => ({ ...ref, blob: gitBlobId(ref.content, objectFormat) }));
    if (current !== null && current !== change.file?.headBlob && !refs.some(ref => ref.blob === current)) continue;
    const chosen = refs.filter(ref => ref.blob === change.before).at(-1) ?? refs.at(-1);
    if (chosen !== undefined) {
      reverted.push({ kind: 'reverted', writeId: null, path: change.path, takenAt: chosen.takenAt, expectedBlob: current });
    }
  }

  // Step 6: the recovery items first, then the notice.
  await notifyRecovery(write, snapshots, projectId, lineRef, 'knowledge_write_unconfirmed', r18.map(log => ({
    kind: 'write_unconfirmed', writeId: log.ref.writeId, path: log.path, takenAt: null, expectedBlob: blobAt(log.path) })));
  await markKnowledgeWritesUnconfirmed(write, projectId, notLanded);   // a failure leaves them for the next round
  const newReverts = await notifyRecovery(write, snapshots, projectId, lineRef, 'knowledge_reverted', reverted);

  // KC-2: the module each changed module file named last round, read before step 7 drops a bad file's index rows and
  // maybe its blob: a bad module file's record source needs it, its bytes name none. The index keeps a module file's
  // file-frame parse, which reads as a module file again (`writeLogFileOf`).
  const namedBefore = new Map<string, string>();
  for (const change of changes) {
    const parsed = change.before === null || change.file?.kind !== 'module' ? null : index.readBlob(change.before);
    if (parsed?.kind === 'module') namedBefore.set(change.path,
      write.files.writeLogFileOf(line.scope, change.path, new TextEncoder().encode(parsed.parsedJson)).moduleId!);
  }

  // Step 7: one index transaction; a file that cannot be read as knowledge is an issue (its rows are dropped). A note
  // the platform did not just write is marked for verification: `merged` when git has it committed.
  const issues: KnowledgeIssueV1[] = [];
  index.transaction(tx => {
    for (const change of changes) {
      const indexed = write.indexFile(tx, line, change.path, change.file?.bytes ?? null);
      if (indexed.status !== 'decoded') { issues.push({ path: change.path, reason: indexed.reason }); continue; }
      if (indexed.value.kind !== 'note' || change.file === null || platformPaths.has(change.path)) continue;
      tx.setNoteState(lineRef, change.file.blobSha, { verifyState: 'needs_verification',
        verifyReason: change.file.committed ? 'merged' : 'external_edit' });
    }
  });

  // Step 8: the graph read every round and the conflicts among the module files, with the files above that do not
  // read, in one `knowledge_conflict` notice; the same problems keep its identity ([2C1-15]), so finding them again
  // notifies nothing. Only the graph step 1 found missing in a never-adopted project is no issue. Both judge step 1's
  // bytes, never the disk again (stk16: an edit landing mid-round).
  const fileIssues = [...issues];
  const conflicts = write.conflictsOf(disk.value.files.filter(file => file.kind === 'module'), line.scope);
  const graphReason = architecture.status !== 'ready' && !noGraphYet ? architecture.reason : null;
  if (graphReason !== null) issues.push({ path: ARCHITECTURE_FILE_PATH, reason: graphReason });
  // 4-4: every line whose own graph reads checks the project merge. A line another workspace cannot read skips only
  // this check (协调: its own reconciliation reports it; this line's round must not stop).
  let projectReason: string | null = null;
  if (architecture.status === 'ready' && projectLines !== null) {
    const parts: { scope: KnowledgeLineScope; architecture: KnowledgeArchitecture }[] = [];
    let complete = true;
    for (const other of projectLines) {
      if (lineRefKey(other.scope, other.line) === lineRef) {
        parts.push({ scope: other.scope, architecture: architecture.value });
        continue;
      }
      const read = await other.readArchitecture();
      if (read.status !== 'ready') { complete = false; break; }
      parts.push({ scope: other.scope, architecture: read.value });
    }
    if (complete) {
      const merged = write.projectArchitectureOf(parts, projectId);
      if (merged.status !== 'decoded') projectReason = merged.reason;
    }
  }
  if (projectReason !== null) issues.push({ path: ARCHITECTURE_FILE_PATH, reason: projectReason });
  const conflictNotice = conflictNoticeOf(projectId, lineRef, issues, conflicts);
  let problems: KnowledgeProblemV1[] = [];
  if (conflictNotice !== null) {
    problems = write.problemsOf({ files: disk.value.files, fileIssues, graphReason, projectReason,
      scope: line.scope, recorded: recorded.value });
    const { noticeId } = conflictNotice;
    // KC-2 (121-106 ④): a notice's bad files get their source once, when its rows are first written; a later round of
    // the same notice reads no snapshot, git or record again.
    let rows = snapshots.readProblems(noticeId);
    if (rows.length === 0) {
      const sourced = await withRecoverySources(write, line, snapshots,
        { lineRef, files, namedBefore, recorded: recorded.value }, problems);
      if (sourced.status !== 'ready') return storeFailureToRejection(sourced);
      rows = sourced.value;
      snapshots.recordProblems(noticeId, lineRef, rows);                      // rows first,
    }
    // then each bad file's item under its row's itemNo (one a recovery removed comes back while the same problems stand),
    snapshots.recordRecovery(unreadableItemsOf(noticeId, lineRef, rows, blobAt));
    await write.notify({ projectRef: { projectId }, subject: conflictNotice.subject, kind: 'knowledge_conflict',
      summary: conflictNotice.summary, operation: conflictNotice.operation });  // then the notice
  }

  // Step 9, last: a copy of every uncommitted file; a file clean, tracked and as last round was committed, so its
  // copies go (a revert back to HEAD that differs from last round keeps them).
  for (const file of disk.value.files) {
    if (!file.committed) snapshots.put(lineRef, file.path, now, file.bytes);
    else if (previous.get(file.path) === file.blobSha) snapshots.deletePath(lineRef, file.path);
  }
  // Step 10.
  index.transaction(tx => tx.writeMeta(lineRef, now));
  for (const path of disk.value.temporaries) await line.applyChange({ path, before: null, after: null });
  return { status: 'ready', value: { lineRef, trigger, changed: changes.length, issues, conflicts, problems,
    unconfirmed: r18.length, reverted: newReverts } };
}


/** The line's `pending` and `unconfirmed` write logs (the lookup is a candidate index: each is re-checked). */
async function openWriteLogs(write: KnowledgeWriteDeps, projectId: string, lineRef: string): Promise<KnowledgeWriteV1[]> {
  const logs: KnowledgeWriteV1[] = [];
  for (const state of ['pending', 'unconfirmed'] as const) {
    const found = await lookupAll(write.records, KNOWLEDGE_WRITES_BY_LINE_STATE_LOOKUP, [projectId, lineRef, state]);
    for (const record of found.items) {
      const decoded = knowledgeWriteCodec.decode(record);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `${record.refKey}: ${decoded.reason}`);
      const log = decoded.value;
      if (log.ref.projectId === projectId && log.lineRef === lineRef && log.state === state) logs.push(log);
    }
  }
  return logs;
}

/** [2C1-14]: the count only, never a file's content. */
const SUMMARIES = {
  knowledge_write_unconfirmed: (n: number) => `平台有 ${n} 次写没确认落盘`,
  knowledge_reverted: (n: number) => `架构图和注记被撤回了 ${n} 处`,
};

/**
 * [2C1-15]: a knowledge notice's identity is its kind, the line and its items, so the same items are one notice and
 * its id is known before it is written.
 */
function knowledgeNoticeOf(projectId: string, lineRef: string, kind: ProjectNoticeKindV1, items: readonly unknown[]) {
  const subject = { kind: 'project' as const, projectRef: { projectId } };
  const operation = { aggregateType: 'CoreOperation' as const, projectId,
    operationId: `knowledge:${sha256Hex(canonicalJson({ kind, lineRef, items } as unknown as JsonValue))}` };
  return { subject, operation, noticeId: projectNoticeIdentity({ subject, kind, operation }).noticeId };
}

/**
 * [2C1-14], [2C1-15]: no item, no notice. The items' identity is by path (an unconfirmed write's path and id, a
 * revert's path and the snapshot it restores), so the id is known first: the recovery items go in under it first
 * (`itemNo` from 1), then the project notice. An id that already has items was notified before: nothing is added and
 * no notice is sent again. A notice that fails leaves items nobody is shown. Returns the number of items this round
 * added.
 */
async function notifyRecovery(write: KnowledgeWriteDeps, snapshots: KnowledgeSnapshots, projectId: string,
  lineRef: string, kind: keyof typeof SUMMARIES, items: readonly RecoveryItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const { subject, operation, noticeId } = knowledgeNoticeOf(projectId, lineRef, kind, items.map(item =>
    kind === 'knowledge_reverted' ? { path: item.path, takenAt: item.takenAt } : { path: item.path, writeId: item.writeId }));
  if (snapshots.readRecovery(noticeId).length > 0) return 0;
  snapshots.recordRecovery(items.map((item, index) => ({ ...item, noticeId, itemNo: index + 1, lineRef })));
  await write.notify({ projectRef: subject.projectRef, subject, kind, summary: SUMMARIES[kind](items.length), operation });
  return items.length;
}

/**
 * KC-2 (121-106 ④): each bad file's "恢复" source: the newest snapshot that reads as this file, else HEAD's version when
 * it is not the bad bytes and reads, else the platform's record (a module file only when last round's index named its
 * module). A HEAD git cannot give is a HEAD that does not read (the pick's own rule); a records read that fails is the
 * round's `unavailable` (src/AGENTS §4). No source: the row keeps its reason only (plan :165).
 */
async function withRecoverySources(write: KnowledgeWriteDeps, line: LineKnowledge, snapshots: KnowledgeSnapshots,
  at: { lineRef: string; files: ReadonlyMap<string, KnowledgeDiskFileV1>;
    namedBefore: ReadonlyMap<string, string>; recorded: KnowledgeRecordedArchitecture | null },
  problems: readonly KnowledgeProblemV1[]): Promise<StoreResult<KnowledgeProblemV1[]>> {
  const rows: KnowledgeProblemV1[] = [];
  for (const problem of problems) {
    if (problem.kind !== 'bad_file') { rows.push(problem); continue; }
    const path = problem.files[0]!.path;
    const reads = (bytes: Uint8Array): boolean => write.files.readsAsKnowledge(line.scope, path, bytes);
    const copy = snapshots.listRefs(at.lineRef, path).filter(ref => reads(ref.content)).at(-1);       // oldest first
    if (copy !== undefined) { rows.push({ ...problem, recovery: { source: 'snapshot', takenAt: copy.takenAt } }); continue; }
    const file = at.files.get(path)!;
    if (file.headBlob !== null && file.headBlob !== file.blobSha) {
      const head = await line.readHeadFile(path, file.headBlob);
      if (head.status === 'ready' && reads(head.value.bytes)) {
        rows.push({ ...problem, recovery: { source: 'head', takenAt: head.value.committedAt, headBlob: file.headBlob } });
        continue;
      }
    }
    const moduleId = at.namedBefore.get(path) ?? null;
    const record = await recordedBytesOf(write, line, { path, moduleId }, at.recorded);
    if (record.status !== 'ready') return record;
    rows.push(record.value === null ? problem : { ...problem, recovery: { source: 'record', moduleId } });
  }
  return { status: 'ready', value: rows };
}

/** KC-2: the recovery item of each bad file with a source, under its row's itemNo; `expectedBlob` is the file now ([2C1-19]). */
function unreadableItemsOf(noticeId: string, lineRef: string, rows: readonly KnowledgeProblemV1[],
  blobAt: (path: string) => string | null): KnowledgeRecoveryRow[] {
  return rows.flatMap(row => row.recovery === undefined ? [] : [{ noticeId, itemNo: row.itemNo, kind: 'unreadable' as const,
    writeId: null, lineRef, path: row.files[0]!.path,
    takenAt: row.recovery.source === 'snapshot' ? row.recovery.takenAt : null, expectedBlob: blobAt(row.files[0]!.path) }]);
}

/**
 * KC-2 (121-106 ④): the platform's record of one knowledge file now, the third source; the recovery calls it again
 * (“当场重算”). `knowledge/` reads the note head, the rule builds the bytes. A records read that fails, or a record the
 * file format refuses, is `unavailable`.
 */
export async function recordedBytesOf(write: KnowledgeWriteDeps, line: LineKnowledge, target: { path: string; moduleId: string | null },
  architecture: KnowledgeRecordedArchitecture | null): Promise<StoreResult<Uint8Array | null>> {
  const key = write.files.noteHeadKeyOf(line.projectId, target.path);
  let noteHead: EncodedRecord | null = null;
  if (key !== null) {
    const read = await write.records.readMany([key]);
    if (read.status !== 'ready') return read;
    noteHead = read.value.records.find(record => record.refKey === key) ?? null;
  }
  const built = write.files.recordedFileOf(line.scope, target, { architecture, noteHead });
  return built.status === 'decoded' ? { status: 'ready', value: built.value } : rejected('unavailable', `${target.path}: ${built.reason}`);
}

/**
 * [2C1-15], [2C1-17]: the one `knowledge_conflict` notice of a round's problems, null when it has none. Its items are
 * the issues by path, then the conflicts (sorted already), so the same problems keep one id, which the region
 * advisers' requests key on too; its summary counts and lists the places (paths), cut to a notice's 512 bytes.
 */
export function conflictNoticeOf(projectId: string, lineRef: string, issues: readonly KnowledgeIssueV1[],
  conflicts: readonly KnowledgeConflictV1[]): (ReturnType<typeof knowledgeNoticeOf> & { summary: string }) | null {
  if (issues.length === 0 && conflicts.length === 0) return null;
  const byPath = [...issues].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const paths = [...new Set([...byPath.map(issue => issue.path), ...conflicts.flatMap(conflict => conflict.paths)])].sort();
  return { ...knowledgeNoticeOf(projectId, lineRef, 'knowledge_conflict', [...byPath, ...conflicts]),
    summary: truncateUtf8(`知识文件有 ${paths.length} 处问题：${paths.join('、')}`, 512) };
}
