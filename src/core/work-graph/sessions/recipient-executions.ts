/**
 * The withdraw's one live-offer read (R7A1-12; SR3 item 6b).
 *
 * One horizon is taken from the recipient Session's record BEFORE the first
 * execution read. The line's open Work executions are the Run its occupancy
 * names: the Work claim, the starting Run and the Session occupancy are one
 * commit, and an occupied Session cannot be claimed again, so one line holds
 * at most that Run. Its real execution facts are read through
 * `ExecutionReadPort.readExecution` at project scope (a project-level line can
 * run in another workspace of the project). The QueryRun enumeration is then
 * walked to exhaustion; a Query's stage is its `executionState.phase`. The
 * Session record is read again after the last read: only a complete result at
 * the same horizon is a fact. A moved window is `revision_conflict`; an
 * incomplete set, a damaged record, a null watermark or any failed read is
 * the failure, never an empty list. The reader is read-only.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionOccupancy } from '../../../contracts/core/session.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort, StoreFailure } from '../../record-store/ports.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import {
  OPEN_QUERY_PHASES, OPEN_WORK_STAGES,
  type RecipientExecutionsPort, type RecipientOpenExecutionV1, type RecipientOpenExecutionsV1,
  type SessionFactsPort,
} from '../model/session-facts-contracts.js';
import { decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from './session-record-codecs.js';

const PAGE_LIMIT = 100;

function unavailable(reason: string): CoreRejection {
  return rejected('unavailable', reason);
}

function openExecutionCursorSequence(cursor: CommitCursor | null): number | null {
  if (cursor === null) return null;
  try {
    return seqOfCommitCursor(cursor);
  } catch {
    return null;
  }
}

/** A page or execution read that observed a later watermark moved the window. */
function readPastHorizon(cursor: CommitCursor | null, horizon: CommitCursor): CoreRejection | null {
  const observed = openExecutionCursorSequence(cursor);
  const at = openExecutionCursorSequence(horizon);
  if (observed === null || at === null) return unavailable('the execution window has no readable watermark');
  return observed > at
    ? rejected('revision_conflict', 'the execution window moved during the read')
    : null;
}

function recipientRejectionOf(result: ReadResult<unknown> | StoreFailure): CoreRejection {
  if (result.status === 'rejected') {
    return result.code === 'corrupt' || result.code === 'unique_conflict'
      ? unavailable(result.reason)
      : rejected(result.code, result.reason);
  }
  if (result.status === 'not_found') return rejected('not_found', 'the recipient Session does not exist');
  return unavailable('the recipient Session facts are not readable at the required watermark');
}

export function createRecipientExecutions(deps: {
  sessions: Pick<SessionFactsPort, 'listSessionExecutions' | 'listSessionQueries'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
}): RecipientExecutionsPort {
  const sessionKeyOf = (sessionRef: SessionRef): string =>
    sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));

  /** One horizon read of the recipient Session; its `readThrough` is the window and its occupancy the holder. */
  async function readHorizon(
    ctx: CoreCallContext, sessionKey: string,
  ): Promise<{ ok: true; readThrough: CommitCursor; occupancy: SessionOccupancy | null }
    | { ok: false; rejection: CoreRejection }> {
    let read;
    try {
      read = await deps.records.readMany([sessionKey]);
    } catch (error) {
      return { ok: false, rejection: unavailable(`the recipient Session record could not be read: ${String(error)}`) };
    }
    if (read.status !== 'ready') return { ok: false, rejection: recipientRejectionOf(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === sessionKey);
    if (record === undefined) {
      return { ok: false, rejection: read.value.missing.includes(sessionKey)
        ? rejected('not_found', 'the recipient Session does not exist')
        : unavailable('the recipient Session record was neither returned nor reported missing') };
    }
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: unavailable(`the recipient Session record is damaged: ${decoded.reason}`) };
    }
    if (read.value.readThrough === null) {
      return { ok: false, rejection: unavailable('the recipient Session window has no readable watermark') };
    }
    return { ok: true, readThrough: read.value.readThrough, occupancy: decoded.value.occupancy };
  }

  async function readRecipientOpenExecutions(
    ctx: CoreCallContext, input: { sessionRef: SessionRef; messageRef: SessionMessageRef },
  ): Promise<ReadResult<RecipientOpenExecutionsV1>> {
    if (ctx.signal.aborted) return rejected('cancelled', 'the open-execution read was cancelled');
    const sessionKey = sessionKeyOf(input.sessionRef);
    const horizon = await readHorizon(ctx, sessionKey);
    if (!horizon.ok) return horizon.rejection;

    const executions: RecipientOpenExecutionV1[] = [];
    const queryRefs = new Set<string>();

    // The Session's occupancy names the line's one open Work Run: `claimTask` writes the claim, the
    // starting Run and the occupancy in one commit, and an occupied Session cannot be claimed again,
    // so a line holds at most the Run its occupancy names (claim-service.ts:4; session-availability.ts:754,
    // :787, :808). A QueryRun occupancy is covered by the Query enumeration below.
    const occupancy = horizon.occupancy;
    if (occupancy !== null && occupancy.kind === 'execution' && occupancy.executionRef.aggregateType === 'Run') {
      const runRef = occupancy.executionRef;
      let execution;
      try {
        // The Run may live in another workspace of the project (a project-level line); the project
        // read keeps the project and trusted-Host checks.
        execution = await deps.executions.readExecution(ctx, runRef,
          { atLeastCursor: horizon.readThrough, scope: 'project' });
      } catch (error) {
        return unavailable(`the recipient Work execution could not be read: ${String(error)}`);
      }
      if (execution.status !== 'ready') {
        return unavailable(execution.status === 'rejected'
          ? execution.reason : 'the recipient Work execution is not readable');
      }
      const record = execution.value;
      const past = readPastHorizon(record.readThrough, horizon.readThrough);
      if (past !== null) return past;
      if ((OPEN_WORK_STAGES as readonly string[]).includes(record.run.status)) {
        executions.push({ kind: 'work', ref: structuredClone(runRef),
          stage: record.run.status, startedAt: record.run.startedAt });
      }
    }

    // Every QueryRun of the recipient line, every page, to `nextCursor === null`.
    let queryCursor: string | undefined;
    for (;;) {
      let page: Awaited<ReturnType<typeof deps.sessions.listSessionQueries>>;
      try {
        page = await deps.sessions.listSessionQueries(ctx, {
          sessionRef: input.sessionRef,
          page: { limit: PAGE_LIMIT, ...(queryCursor === undefined ? {} : { cursor: queryCursor }) },
        });
      } catch (error) {
        return unavailable(`the recipient Query enumeration could not be read: ${String(error)}`);
      }
      if (page.status !== 'ready') return recipientRejectionOf(page);
      const moved = readPastHorizon(page.value.sourceCursor, horizon.readThrough);
      if (moved !== null) return moved;
      for (const snapshot of page.value.items) {
        const refKey = canonicalOf(snapshot.ref);
        if (refKey === null) return unavailable('a recipient QueryRun has no canonical ref');
        if (queryRefs.has(refKey)) {
          return unavailable('the recipient Query enumeration returned the same QueryRun twice');
        }
        queryRefs.add(refKey);
        const state = snapshot.run.executionState;
        if (state === undefined) return unavailable('a recipient QueryRun has no execution state');
        if ((OPEN_QUERY_PHASES as readonly string[]).includes(state.phase)) {
          executions.push({ kind: 'query', ref: structuredClone(snapshot.ref),
            stage: state.phase, startedAt: snapshot.run.startedAt });
        }
      }
      if (page.value.nextCursor === null) break;
      if (page.value.nextCursor === queryCursor) {
        return unavailable('the recipient Query enumeration did not advance');
      }
      queryCursor = page.value.nextCursor;
    }

    // The same Session record is read again: a moved window is a conflict.
    const after = await readHorizon(ctx, sessionKey);
    if (!after.ok) return after.rejection;
    if (after.readThrough !== horizon.readThrough) {
      return rejected('revision_conflict', 'the recipient Session window moved during the read');
    }
    return { status: 'ready', value: { executions, readCursor: horizon.readThrough } };
  }

  return { readRecipientOpenExecutions };
}
