/**
 * The one too-long rule and the one reader of the shared basis.
 *
 * `secretaryHandoffBasis` is the pure table: `tooLong = usage !== null && inputTokens >= threshold`, with
 * `threshold = min(SECRETARY_HANDOFF_INPUT_TOKENS, floor(0.8 × contextWindowTokens))`. The caller gives the profile's
 * real window; there is no unknown-window branch and no zero default.
 *
 * `roleLineInputBasis` pages one ordered index (`S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP`) to its end through the
 * one complete ordered reader, newest generation first, and inside each run walks the model requests last-to-first
 * until one reports `inputTokens`. For each given task it also reads the task's Work Runs (`RUN_BY_TASK_INDEX`) and
 * their stored `RunActivity`, keeping only the Runs of this Session, and takes each Run's newest request that reports
 * `inputTokens`. The later run wins (QueryRun `endedAt`, `RunActivity.runEndedAt`; a QueryRun still running is the
 * latest; a tie takes the Work Run). It returns the run and request index the usage came from and the ordered read's
 * watermark. `run`/`requestIndex` are `null` only when there is no usage at all; `readThrough` is `null` only for an
 * empty ledger. A read failure or a damaged QueryRun, Run or RunActivity is a rejection (`unavailable`), never
 * "not too long". `readSecretaryHandoffBasis` is the same read with no tasks.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import { SECRETARY_HANDOFF_INPUT_TOKENS } from '../model/request-contracts.js';
import type { SecretaryHandoffBasisV1 } from '../model/secretary-lifecycle-contracts.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { readAllOrdered } from '../persistence/lookup-ordered-all.js';
import { decodeRunActivitySnapshot, runActivityRefKey } from '../persistence/run-activity-codecs.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import {
  decodeQueryRunSnapshotRecord, S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
} from '../queries/query-record-codecs.js';
import { RUN_BY_TASK_INDEX } from './plan-readers.js';
import { runActivityRefOf } from './run-activity-service.js';

export type RoleLineInputUsageV1 =
  | { kind: 'query'; run: QueryRunRef; requestIndex: number; inputTokens: number; at: string }
  | { kind: 'work'; run: RunRef; requestIndex: number; inputTokens: number; at: string };

/**
 * The pure table: `tooLong = usage !== null && inputTokens >= threshold`. `readThrough` is the reader's watermark,
 * unchanged.
 */
export function secretaryHandoffBasis(input: {
  contextWindowTokens: number;
  usage: { inputTokens: number; run: QueryRunRef | RunRef; requestIndex: number } | null;
  readThrough: CommitCursor | null;
}): SecretaryHandoffBasisV1 {
  const threshold = Math.min(SECRETARY_HANDOFF_INPUT_TOKENS,
    Math.floor(0.8 * input.contextWindowTokens));
  const usage = input.usage;
  return {
    tooLong: usage !== null && usage.inputTokens >= threshold,
    threshold,
    lastInputTokens: usage === null ? null : usage.inputTokens,
    run: usage === null ? null : usage.run,
    requestIndex: usage === null ? null : usage.requestIndex,
    readThrough: input.readThrough,
  };
}

/** One original: the QueryRun scan plus the line's Work Runs through RunActivity. */
type RoleLineBasisStore =
  Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort & Pick<RecordOrderedLookupPort, 'lookupOrdered'>;

/** The basis over the Session's QueryRuns and the given tasks' Work Runs; every failure is `unavailable`. */
export async function roleLineInputBasis(
  records: RoleLineBasisStore,
  scope: WorkspaceScope, session: SessionRef, contextWindowTokens: number,
  tasks: readonly TaskTriple[] = [],
): Promise<ReadResult<SecretaryHandoffBasisV1>> {
  type OrderedAll = Awaited<ReturnType<typeof readAllOrdered>>;
  let read: OrderedAll;
  try {
    read = await readAllOrdered(records, { index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
      values: [scope.projectId, scope.workspaceId, session.sessionId], direction: 'desc' });
  } catch (error) {
    return { status: 'rejected', code: 'unavailable',
      reason: `the Session QueryRuns could not be read: ${messageOf(error)}` };
  }
  if (read.status !== 'ready') {
    return { status: 'rejected', code: 'unavailable',
      reason: `the Session QueryRuns read failed: ${read.code}: ${read.reason}` };
  }
  let query: { inputTokens: number; run: QueryRunRef; requestIndex: number; endedAt: string | null } | null = null;
  scan: for (const record of read.value.records) {
    const decoded = decodeQueryRunSnapshotRecord(record);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `a Session QueryRun is damaged: ${decoded.reason}` };
    }
    const run = decoded.value;
    if (run.ref.workspaceId !== scope.workspaceId) continue;
    const requests = run.run.executionState?.requests ?? [];
    for (let index = requests.length - 1; index >= 0; index -= 1) {
      const tokens = requests[index]!.inputTokens;
      if (tokens === null) continue;
      query = { inputTokens: tokens, run: run.ref, requestIndex: index, endedAt: run.run.endedAt };
      break scan;
    }
  }
  const work = await latestWorkUsage(records, session, tasks);
  if (work.status !== 'ready') return work;
  const latest = work.value;
  const usage = latest !== null && (query === null || (query.endedAt !== null && latest.at >= query.endedAt))
    ? latest : query;
  return { status: 'ready', value: secretaryHandoffBasis({ contextWindowTokens,
    usage: usage === null ? null : { inputTokens: usage.inputTokens, run: usage.run, requestIndex: usage.requestIndex },
    readThrough: read.value.readThrough }) };
}

/** The newest reported request of this Session's ended Work Runs on the given tasks; `null` when none reports one. */
async function latestWorkUsage(records: RoleLineBasisStore, session: SessionRef, tasks: readonly TaskTriple[]):
Promise<ReadResult<Extract<RoleLineInputUsageV1, { kind: 'work' }> | null>> {
  if (tasks.length === 0) return { status: 'ready', value: null };
  const keys: string[] = [];
  for (const task of tasks) {
    let runs: readonly EncodedRecord[];
    try {
      runs = (await lookupAll(records, RUN_BY_TASK_INDEX, [task.projectId, task.goalId, task.taskId])).items;
    } catch (error) {
      return { status: 'rejected', code: 'unavailable', reason: `the task Work Runs could not be read: ${messageOf(error)}` };
    }
    for (const record of runs) {
      const run = decodeRun(record);
      if (!run.ok) return { status: 'rejected', code: 'unavailable', reason: `a task Work Run is damaged: ${run.reason}` };
      keys.push(runActivityRefKey(runActivityRefOf(run.value)));
    }
  }
  if (keys.length === 0) return { status: 'ready', value: null };
  const activities = await records.readMany(keys);
  if (activities.status !== 'ready') {
    return { status: 'rejected', code: 'unavailable',
      reason: `the Work Run activities read failed: ${activities.code}: ${activities.reason}` };
  }
  let latest: Extract<RoleLineInputUsageV1, { kind: 'work' }> | null = null;
  for (const record of activities.value.records) {
    const decoded = decodeRunActivitySnapshot(record);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `a Work Run activity is damaged: ${decoded.reason}` };
    }
    const activity = decoded.value;
    // Only this line's Runs count; an `unknown` tally has no usage.
    if (activity.sessionRef === null || activity.sessionRef.projectId !== session.projectId
      || activity.sessionRef.sessionId !== session.sessionId || activity.facts.status !== 'counted') continue;
    const requests = activity.facts.usage.requests;
    for (let index = requests.length - 1; index >= 0; index -= 1) {
      const tokens = requests[index]!.inputTokens;
      if (tokens === null) continue;
      if (latest === null || activity.runEndedAt > latest.at) {
        latest = { kind: 'work', run: activity.runRef, requestIndex: index, inputTokens: tokens, at: activity.runEndedAt };
      }
      break;
    }
  }
  return { status: 'ready', value: latest };
}

/** Kept name for the secretary callers; it is the same read with no tasks. */
export async function readSecretaryHandoffBasis(
  records: RoleLineBasisStore, scope: WorkspaceScope, session: SessionRef, contextWindowTokens: number,
): Promise<ReadResult<SecretaryHandoffBasisV1>> {
  return roleLineInputBasis(records, scope, session, contextWindowTokens);
}
