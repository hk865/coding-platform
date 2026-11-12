/**
 * The ONE order of a knowledge write: take every line of the project, enter the
 * write queue (the project, then its folders), take every checkout's cross-Host
 * lease, let the service read the current knowledge, plan, validate and compute
 * the file changes inside `prepare`, commit the records with one write log per
 * file change, write the files, mark the landed logs completed, index the landed
 * files, and release the leases last. The files are the knowledge; a replayed
 * receipt touches no file, and a file that could not be written after a
 * committed record is reported as such, never as success.
 */
import { rejected } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import type {
  CommitCursorBinding, EncodedDomainEvent, EncodedRecord, PreparedCommit, RecordGuard, StoreCommitReceipt, StoreFailure,
  StoreResult,
} from '../../record-store/ports.js';
import {
  lineRefKey, type KnowledgeCaller, type KnowledgeFileChange, type KnowledgeLines, type KnowledgeWriteDeps,
  type KnowledgeWriteLease, type LineKnowledge, type LineRef,
} from '../model/line-knowledge.js';
import {
  completeLandedWrites, KNOWLEDGE_WRITE_UNCONFIRMED, pendingKnowledgeWrites, writeLogExtras,
} from './write-log.js';

export type KnowledgeWritePlan = { line: LineKnowledge; changes: readonly KnowledgeFileChange[] };
/** What joins the same `records.commit`. */
export type KnowledgeCommitExtras = {
  records: readonly EncodedRecord[];
  guards: readonly RecordGuard[];
  commitCursorBindings: readonly CommitCursorBinding[];
};
/** The service hands in every event of its commit in their final order and joins what comes back. */
export type KnowledgeExtrasOf = (events: readonly EncodedDomainEvent[]) => KnowledgeCommitExtras;
/** `prepare` either ends the service's own way (a refusal, a restored original result) or hands over the changes and the commit. */
export type KnowledgePrepared<X> =
  | { kind: 'exit'; value: X }
  | { kind: 'ready'; plans: readonly KnowledgeWritePlan[];
      /** Builds the service's `PreparedCommit` as before, joins `extrasOf(events)` and commits; a throw comes back as the service's own failure. */
      commit: (extrasOf: KnowledgeExtrasOf) => Promise<StoreCommitReceipt> };
export type KnowledgeWriteOutcome<X> =
  | { kind: 'exit'; value: X }
  /** The lines could not be taken, a changed line has a pending write log (2c-1d), or the commit was refused. */
  | { kind: 'rejected'; failure: StoreFailure }
  | { kind: 'committed'; receipt: Extract<StoreCommitReceipt, { status: 'committed' }>;
      /** null: a replay, no file touched; ready: every file written; rejected: the records committed and a file was not written (the reason names it). */
      files: StoreResult<void> | null };

function withKnowledgeExtras(prepared: PreparedCommit, extras: KnowledgeCommitExtras): PreparedCommit {
  const bindings = [...(prepared.commitCursorBindings ?? []), ...extras.commitCursorBindings];
  return { ...prepared, guards: [...prepared.guards, ...extras.guards], records: [...prepared.records, ...extras.records],
    ...(bindings.length === 0 ? {} : { commitCursorBindings: bindings }) };
}

/** Set when a write point's commit threw: the service re-checks by identity as it did before. */
export type KnowledgeCommitThrow = { message: string | null };

/**
 * The `ready.commit` every write point hands back: its own `PreparedCommit`
 * with the extras of its final events joined, committed once. A throw is kept
 * in `thrown` and comes back as `unavailable`.
 */
export function knowledgeCommit(commit: (prepared: PreparedCommit) => Promise<StoreCommitReceipt>,
  prepared: PreparedCommit, thrown: KnowledgeCommitThrow): (extrasOf: KnowledgeExtrasOf) => Promise<StoreCommitReceipt> {
  return async extrasOf => {
    try {
      return await commit(withKnowledgeExtras(prepared, extrasOf(prepared.events)));
    } catch (error) {
      thrown.message = messageOf(error);
      return { status: 'rejected', code: 'unavailable', reason: thrown.message };
    }
  };
}

/** A write whose records committed and whose files did not is answered as such, never as a success. */
export function knowledgeFilesNotWritten(failure: StoreFailure): string {
  return `记录已提交、知识文件没写成：${failure.reason}`;
}

export async function writeKnowledge<X>(knowledge: KnowledgeLines, caller: KnowledgeCaller,
  prepare: (lines: readonly LineKnowledge[]) => Promise<KnowledgePrepared<X>>): Promise<KnowledgeWriteOutcome<X>> {
  // Every line is taken: which lines one write changes is known only after the
  // current knowledge was read inside `prepare`.
  const lines = await knowledge.project(caller);
  if (lines.status !== 'ready') return { kind: 'rejected', failure: lines };
  const folders = lines.value.map(line => line.line.folder);
  const write = knowledge.write;
  // The queue holds the whole read-plan-commit-write-index span; it does not replace the records' CAS. The leases
  // cover the same span against another Host on the same checkout.
  return write.queue.run(caller.projectId, folders, async (): Promise<KnowledgeWriteOutcome<X>> => {
    const leased = await withKnowledgeLeases(write, lines.value, () => writeLeased(write, caller.projectId, lines.value, prepare));
    return leased.status === 'ready' ? leased.value : { kind: 'rejected', failure: leased };
  });
}

/** Inside the queue and the leases: prepare, commit with the write logs, land the files, complete, index. */
async function writeLeased<X>(write: KnowledgeWriteDeps, projectId: string, lines: readonly LineKnowledge[],
  prepare: (lines: readonly LineKnowledge[]) => Promise<KnowledgePrepared<X>>): Promise<KnowledgeWriteOutcome<X>> {
  const prepared = await prepare(lines);
  if (prepared.kind === 'exit') return prepared;
  // 2c-1d: a line with a pending write log may hold files older than its records; a write planned on them would
  // drop that write's effect. An `unconfirmed` log does not refuse (it was handed to the person; the file rules).
  for (const plan of prepared.plans) {
    if (plan.changes.length === 0) continue;
    const pending = await pendingKnowledgeWrites(write.records, projectId, [plan.line]);
    if (pending.status !== 'ready') return { kind: 'rejected', failure: pending };
    if (pending.value.length > 0) return { kind: 'rejected', failure: rejected('unavailable', KNOWLEDGE_WRITE_UNCONFIRMED) };
  }
  let logs = new Map<KnowledgeFileChange, string>();
  const receipt = await prepared.commit(events => {
    const extras = writeLogExtras(write, projectId, prepared.plans, events);
    logs = extras.logs;
    return extras;
  });
  if (receipt.status !== 'committed') return { kind: 'rejected', failure: receipt };
  if (receipt.replayed) return { kind: 'committed', receipt, files: null };
  if (write.hold !== null) await write.hold('committed');
  const landed: KnowledgeWritePlan[] = [];
  let files: StoreResult<void> = { status: 'ready', value: undefined };
  for (const plan of prepared.plans) {
    const changes: KnowledgeFileChange[] = [];
    landed.push({ line: plan.line, changes });
    for (const change of plan.changes) {
      const applied = await plan.line.applyChange(change);
      if (applied.status !== 'ready') { files = applied; break; }
      changes.push(change);
    }
    if (files.status !== 'ready') break;
  }
  if (write.hold !== null) await write.hold('applied');
  // A log whose file did not land stays `pending`; a failed completion changes nothing here (the reconciliation
  // completes a log whose file is its written bytes).
  await completeLandedWrites(write, projectId, landed.flatMap(plan => plan.changes.map(change => logs.get(change)!)));
  indexLanded(write, projectId, landed);
  return { kind: 'committed', receipt, files };
}

/**
 * [2C1-04]: inside the write queue, every checkout's cross-Host lease, one per folder in sorted order. A lease held
 * by another Host, or a lease directory that cannot be made, releases what was taken and answers `unavailable`:
 * `work` does not run and nothing is committed; no wait, no retry. The leases are released last, a failed release
 * swallowed. Writes, reconciliations and recoveries take them the same way.
 */
export async function withKnowledgeLeases<T>(write: KnowledgeWriteDeps, lines: readonly LineKnowledge[],
  work: () => Promise<T>): Promise<StoreResult<T>> {
  const byFolder = new Map<string, LineRef>();
  for (const { line } of lines) if (!byFolder.has(line.folder)) byFolder.set(line.folder, line);
  const held: KnowledgeWriteLease[] = [];
  try {
    for (const folder of [...byFolder.keys()].sort()) {
      let lease: KnowledgeWriteLease;
      try {
        lease = await write.acquireLease(byFolder.get(folder)!);
      } catch (error) {
        return rejected('unavailable', `租约目录建不了：${messageOf(error)}`);
      }
      if (lease.lease !== 'owned') return rejected('unavailable', `另一个 Host 正在写这个检出：${folder}`);
      held.push(lease);
    }
    return { status: 'ready', value: await work() };
  } finally {
    for (const lease of held) await lease.release().catch(() => undefined);
  }
}

/**
 * The index is a cache and is updated last: every landed file is indexed in one transaction and a note file's
 * new blob is confirmed (no "needs verification" row). A throw here leaves the write's answer as it is and is not
 * reported as indexed; the next reconciliation rebuilds the file's rows from the file. A recovery indexes the file
 * it wrote here too (errata 2c1#6).
 */
export function indexLanded(write: KnowledgeWriteDeps, projectId: string, landed: readonly KnowledgeWritePlan[]): void {
  if (landed.every(plan => plan.changes.length === 0)) return;
  try {
    write.indexOf(projectId).transaction(tx => {
      for (const plan of landed) {
        for (const change of plan.changes) {
          const indexed = write.indexFile(tx, plan.line, change.path, change.after);
          if (indexed.status === 'decoded' && indexed.value.kind === 'note' && indexed.value.blobSha !== null) {
            tx.setNoteState(lineRefKey(plan.line.scope, plan.line.line), indexed.value.blobSha, null);
          }
        }
      }
    });
  } catch {
    // The index stays as it was; the files and the records are the facts.
  }
}
