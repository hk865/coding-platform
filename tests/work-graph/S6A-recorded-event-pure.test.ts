/**
 * The one `QueryExecutionRecorded` builder (`buildRecordedEvent`), called with
 * literal input. The event projects the QueryRun its commit writes: when a
 * request command ends a claimed or prepared round that never entered the
 * Kernel, that Run is `settled`, so the event carries `settled` and the Run's
 * execution state, never a null projection.
 *
 * A5: a pure file. It imports no store, platform, Host, Workflow, Runtime or
 * stub port; every expected value is a literal.
 */
import { describe, expect, it } from 'vitest';
import type { QueryExecutionStateV1, QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { buildRecordedEvent } from '../../src/core/work-graph/queries/query-execution.js';

const at = '2026-10-23T09:00:00.000Z';
const runRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' };

/** The execution state a claimed Run has once it is settled without entering the Kernel. */
function settledState(): QueryExecutionStateV1 {
  return {
    schemaVersion: 1,
    phase: 'settled',
    sessionRef: { projectId: 'p1', sessionId: 's1' },
    sessionGeneration: 2,
    role: { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' },
    roleBinding: { schemaVersion: 1, bindingId: 'b1', templateId: 'tpl', templateRevision: 'r1', bindingVersion: 1,
      policyRevision: 'pol-1' },
    roleResolution: { status: 'absent', roleId: 'role-1', reason: 'no role spec' },
    priorHistoryCursor: null,
    prepared: null,
    entry: null,
    history: null,
    requests: [],
    requestProfile: null,
  };
}

function settledRun(): QueryRunSnapshot {
  return {
    ref: { ...runRef },
    revision: 3,
    schemaVersion: 1,
    run: {
      schemaVersion: 1,
      queryJobRef: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
      runId: 'qr-1',
      status: 'closed',
      startedAt: null,
      endedAt: at,
      outcome: 'not_entered',
      executionState: settledState(),
    },
  };
}

describe('buildRecordedEvent', () => {
  it('projects a Run settled without entering the Kernel as settled with its execution state', () => {
    const run = settledRun();
    const event = buildRecordedEvent({
      eventId: 'evt-1', identityKey: 'request.end_unbound:k1', fingerprint: 'f'.repeat(64),
      actor: { kind: 'system', id: 'automation' }, occurredAt: at, queryRunRef: runRef, requestId: 'op-1',
      correlationId: 'corr-1', operation: 'observed', result: run, run,
    });
    expect(event.aggregateType).toBe('QueryRun');
    expect(event.aggregateId).toBe('qr-1');
    expect(event.aggregateRevision).toBe(3);
    expect(event.payload.phase).toBe('settled');
    expect(event.payload.executionState).toEqual(settledState());
  });
});
