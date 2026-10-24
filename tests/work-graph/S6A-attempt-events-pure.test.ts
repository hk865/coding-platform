/**
 * The two Query-owner rules a new attempt of a request round adds, called with
 * literal input:
 * - `buildRecordedEvent` records the new attempt's pending Run as created: its
 *   event carries `pending` and no execution state, never a settled disguise,
 *   and only a pending Run at revision 1 with no execution state is recorded so;
 * - `beginReplayAnswer`: a repeated begin answers from the event its first call
 *   committed, the entry's ticket for an entry, and for a start that found
 *   another owner (its `observed` record) the same `busy` as the first call.
 *
 * A5: a pure file. It imports no store, platform, Host, Workflow, Runtime or
 * stub port; every expected value is a literal.
 */
import { describe, expect, it } from 'vitest';
import type { QueryExecutionStateV1, QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import { beginReplayAnswer, buildRecordedEvent } from '../../src/core/work-graph/queries/query-execution.js';

const at = '2026-10-24T03:00:00.000Z';
const oldRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' };
const newRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'attempt-1' };
const actor = { kind: 'system', id: 'host' } as const;

function newPendingRun(): QueryRunSnapshot {
  return {
    ref: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'attempt-1' },
    revision: 1,
    schemaVersion: 1,
    run: {
      schemaVersion: 1,
      queryJobRef: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
      runId: 'attempt-1', status: 'pending', startedAt: null, endedAt: null, outcome: null,
    },
  };
}

function state(phase: QueryExecutionStateV1['phase']): QueryExecutionStateV1 {
  return {
    schemaVersion: 1, phase, sessionRef: { projectId: 'p1', sessionId: 's1' }, sessionGeneration: 2,
    role: { kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' },
    roleBinding: { schemaVersion: 1, bindingId: 'b1', templateId: 'platform-secretary', templateRevision: 's3.1', bindingVersion: 1,
      policyRevision: 'pol-1' },
    roleResolution: { status: 'absent', roleId: 'role-1', reason: 'no role spec' },
    priorHistoryCursor: null, prepared: null, entry: null, history: null, requests: [],
    requestProfile: { profileId: 'secretary', runtimeBudget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 }, budget: { maxTokens: null, deadline: null },
    consumerId: 'secretary-consumer' },
  };
}

/** The old attempt's Run at the given phase and revision. */
function oldRun(phase: QueryExecutionStateV1['phase'], revision: number): QueryRunSnapshot {
  return {
    ref: { ...oldRef }, revision, schemaVersion: 1,
    run: {
      schemaVersion: 1, queryJobRef: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
      runId: 'qr-1', status: phase === 'settled' ? 'closed' : 'running', startedAt: null,
      endedAt: phase === 'settled' ? at : null, outcome: phase === 'settled' ? 'not_entered' : null, executionState: state(phase),
    },
  };
}

const TICKET = {
  queryRunRef: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' },
  sessionRef: { projectId: 'p1', sessionId: 's1' }, sessionGeneration: 2, entryGeneration: 1, consumerId: 'secretary-consumer',
  kernel: { adapterId: 'kernel', kernelSessionId: 'ks1', runId: 'kr1', turnId: 'kt1' },
  bundleRef: { kind: 'artifact', contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 42 },
  inputDigest: 'i'.repeat(64),
};

function beginEvent(operation: 'entering' | 'observed' | 'claimed', result: unknown, run: QueryRunSnapshot) {
  return buildRecordedEvent({
    eventId: 'evt-1', identityKey: 'entering:k1', fingerprint: 'f'.repeat(64), actor, occurredAt: at, queryRunRef: oldRef,
    requestId: 'begin-1', correlationId: 'corr-1', operation, result: result as never, run,
  });
}

describe("a new attempt's pending Run", () => {
  it('is recorded as created: pending, with no execution state', () => {
    const run = newPendingRun();
    const event = buildRecordedEvent({
      eventId: 'evt-2', identityKey: 'entering:k1', fingerprint: 'f'.repeat(64), actor, occurredAt: at, queryRunRef: newRef,
      requestId: 'begin-1', correlationId: 'corr-1', operation: 'observed', result: run, run, createsPending: true,
    });
    expect(event).toEqual({
      eventId: 'evt-2', eventType: 'QueryExecutionRecorded', schemaVersion: 1, identityKey: 'entering:k1', fingerprint: 'f'.repeat(64),
      projectId: 'p1', workspaceId: 'w1', aggregateType: 'QueryRun', aggregateId: 'attempt-1', aggregateRevision: 1,
      causationId: 'entering:k1', correlationId: 'corr-1', idempotencyKey: 'begin-1', actor: { kind: 'system', id: 'host' },
      occurredAt: at,
      payload: {
        queryRunRef: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'attempt-1' },
        operation: 'observed',
        result: {
          ref: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'attempt-1' },
          revision: 1, schemaVersion: 1,
          run: { schemaVersion: 1, queryJobRef: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
            runId: 'attempt-1', status: 'pending', startedAt: null, endedAt: null, outcome: null },
        },
        phase: 'pending',
        executionState: null,
      },
    });
  });

  /** Records `run` as created; each refusal row below changes one thing of the valid new pending Run. */
  function recordCreated(run: QueryRunSnapshot, endsUnstarted?: true) {
    return () => buildRecordedEvent({
      eventId: 'evt-3', identityKey: 'entering:k1', fingerprint: 'f'.repeat(64), actor, occurredAt: at, queryRunRef: newRef,
      requestId: 'begin-1', correlationId: 'corr-1', operation: 'observed', result: run, run, createsPending: true,
      ...(endsUnstarted === undefined ? {} : { endsUnstarted }),
    });
  }

  it('refuses one with an execution state', () => {
    const run = newPendingRun();
    expect(recordCreated({ ...run, run: { ...run.run, executionState: state('claimed') } })).toThrow(/only a new pending Run/);
  });

  it('refuses one that is not pending', () => {
    const run = newPendingRun();
    expect(recordCreated({ ...run, run: { ...run.run, status: 'running' } })).toThrow(/only a new pending Run/);
  });

  it('refuses one past revision 1', () => {
    expect(recordCreated({ ...newPendingRun(), revision: 2 })).toThrow(/only a new pending Run/);
  });

  it('refuses one also marked as ending unstarted', () => {
    expect(recordCreated(newPendingRun(), true)).toThrow(/only a new pending Run/);
  });
});

describe('a repeated begin', () => {
  it("restores the entry's ticket", () => {
    expect(beginReplayAnswer(beginEvent('entering', TICKET, oldRun('entering', 4)), makeCommitCursor(7))).toEqual({
      status: 'committed', replayed: true, cursor: 'c0000000007',
      value: {
        queryRunRef: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' },
        sessionRef: { projectId: 'p1', sessionId: 's1' }, sessionGeneration: 2, entryGeneration: 1, consumerId: 'secretary-consumer',
        kernel: { adapterId: 'kernel', kernelSessionId: 'ks1', runId: 'kr1', turnId: 'kt1' },
        bundleRef: { kind: 'artifact', contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 42 },
        inputDigest: 'i'.repeat(64),
      },
    });
  });

  it('of a start that found another owner answers busy, as its first call did', () => {
    const abandoned = oldRun('settled', 4);
    const record = { job: null, run: abandoned, session: null, answer: null };
    expect(beginReplayAnswer(beginEvent('observed', record, abandoned), makeCommitCursor(7))).toEqual({
      status: 'rejected', code: 'busy',
      reason: 'the request has another owner; this attempt was abandoned and the round waits for a new attempt',
    });
  });

  it('is not answered from a receipt of any other operation', () => {
    expect(beginReplayAnswer(beginEvent('claimed', { job: null, run: oldRun('claimed', 2), session: null, answer: null },
      oldRun('claimed', 2)), makeCommitCursor(7))).toBeNull();
  });
});
