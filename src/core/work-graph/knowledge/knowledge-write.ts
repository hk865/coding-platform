/**
 * The ONE order of a knowledge write: take every line of
 * the project, let the service read the current knowledge, plan, validate and
 * compute the file changes inside `prepare`, commit the records, and only then
 * write the files. The files are the knowledge and the committed event is the
 * write log, so a replayed receipt touches no file, and a file that could not
 * be written after a committed record is reported as such, never as success.
 */
import { messageOf } from '../../../contracts/error-message.js';
import type {
  CommitCursorBinding, EncodedDomainEvent, EncodedRecord, PreparedCommit, RecordGuard, StoreCommitReceipt, StoreFailure,
  StoreResult,
} from '../../record-store/ports.js';
import type { KnowledgeCaller, KnowledgeFileChange, KnowledgeLines, LineKnowledge } from '../model/line-knowledge.js';

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
  /** The lines could not be taken, or the commit was refused. */
  | { kind: 'rejected'; failure: StoreFailure }
  | { kind: 'committed'; receipt: Extract<StoreCommitReceipt, { status: 'committed' }>;
      /** null: a replay, no file touched; ready: every file written; rejected: the records committed and a file was not written (the reason names it). */
      files: StoreResult<void> | null };

const NO_EXTRAS: KnowledgeCommitExtras = { records: [], guards: [], commitCursorBindings: [] };

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
  const prepared = await prepare(lines.value);
  if (prepared.kind === 'exit') return prepared;
  const receipt = await prepared.commit(() => NO_EXTRAS);
  if (receipt.status !== 'committed') return { kind: 'rejected', failure: receipt };
  if (receipt.replayed) return { kind: 'committed', receipt, files: null };
  for (const plan of prepared.plans) {
    for (const change of plan.changes) {
      const applied = await plan.line.applyChange(change);
      if (applied.status !== 'ready') return { kind: 'committed', receipt, files: applied };
    }
  }
  return { kind: 'committed', receipt, files: { status: 'ready', value: undefined } };
}
