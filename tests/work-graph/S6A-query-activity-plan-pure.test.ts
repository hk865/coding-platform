/**
 * The pure Query-activity write plan: it applies the shared activity
 * replacement rule to a QueryRun's tally and builds the next `QueryActivity`
 * snapshot. A5: pure inputs and hand-computed outcomes; every expected value a
 * literal.
 */
import { describe, expect, it } from 'vitest';
import type { QueryActivitySnapshot, RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import {
  planQueryActivityWrite, queryActivityRefOf, type QueryActivityRecordContent,
} from '../../src/core/work-graph/model/query-activity-plan.js';

const QUERY_RUN_REF = {
  aggregateType: 'QueryRun' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1',
};
const QUERY_ACTIVITY_REF = {
  aggregateType: 'QueryActivity' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1',
};
const SESSION_REF = { projectId: 'p1', sessionId: 's1' };

const CONTENT: QueryActivityRecordContent = {
  queryRunRef: QUERY_RUN_REF,
  sessionRef: SESSION_REF,
  askedSessionRef: null,
  goalId: 'g1',
  queryEndedAt: '2026-10-24T10:06:00.000Z',
  queryStartedAt: '2026-10-24T09:55:00.000Z',
  recordedBy: 'query_end',
  recordedAt: '2026-10-24T10:06:01.000Z',
};

function planFacts(throughPosition: number, options: {
  ruleVersion?: number; turnTerminal?: boolean; unresolvedCalls?: number;
} = {}): RunActivityFactsV1 {
  return {
    status: 'counted',
    ruleVersion: options.ruleVersion ?? 1,
    window: {
      kernelRunId: 'kr-1',
      kernelTurnId: 'kt-1',
      fromPosition: 0,
      throughPosition,
      bound: 'end_position',
      turnTerminal: options.turnTerminal ?? true,
      unresolvedCalls: options.unresolvedCalls ?? 0,
      turnStartedAt: '2026-10-24T10:00:00.000Z',
      lastRecordAt: '2026-10-24T10:05:00.000Z',
    },
    quarters: [],
    overflow: null,
    totals: { steps: 0, edits: 0, editsUnknown: 0 },
    changedFiles: {
      definite: [], possible: [], definiteOmitted: 0, possibleOmitted: 0,
      possiblyIncomplete: false, incompleteBecause: [],
    },
    usage: {
      requests: [],
      omitted: 0,
      totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      complete: true,
    },
  };
}

function planUnknownFacts(reason: 'kernel_unreadable' | 'turn_not_found', ruleVersion = 1): RunActivityFactsV1 {
  return { status: 'unknown', ruleVersion, reason, detail: 'the window could not be read' };
}

function existingSnapshot(facts: RunActivityFactsV1, revision = 2): QueryActivitySnapshot {
  return {
    ref: QUERY_ACTIVITY_REF,
    revision,
    schemaVersion: 1,
    queryRunRef: QUERY_RUN_REF,
    sessionRef: SESSION_REF,
    askedSessionRef: null,
    goalId: 'g1',
    queryEndedAt: '2026-10-24T10:02:00.000Z',
    recordedAt: '2026-10-24T10:02:01.000Z',
    recordedBy: 'backfill',
    facts,
    span: { firstAt: '2026-10-24T09:55:00.000Z', lastAt: '2026-10-24T10:02:00.000Z', basis: 'run_times' },
  };
}

describe('queryActivityRefOf', () => {
  it('keys the record by the full QueryRunRef', () => {
    expect(queryActivityRefOf(QUERY_RUN_REF)).toEqual({
      aggregateType: 'QueryActivity', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1',
    });
  });
});

describe('planQueryActivityWrite: an absent record', () => {
  it('creates revision 1 with the kernel span at a closing commit', () => {
    const facts = planFacts(12);
    const result = planQueryActivityWrite(null, facts, { ...CONTENT, endCommit: true });
    expect(result.outcome).toBe('created');
    expect(result.snapshot).toEqual({
      ref: QUERY_ACTIVITY_REF,
      revision: 1,
      schemaVersion: 1,
      queryRunRef: QUERY_RUN_REF,
      sessionRef: SESSION_REF,
      askedSessionRef: null,
      goalId: 'g1',
      queryEndedAt: '2026-10-24T10:06:00.000Z',
      recordedAt: '2026-10-24T10:06:01.000Z',
      recordedBy: 'query_end',
      facts,
      span: { firstAt: '2026-10-24T10:00:00.000Z', lastAt: '2026-10-24T10:05:00.000Z', basis: 'kernel' },
    });
  });

  it('creates revision 1 at a backfill commit', () => {
    const result = planQueryActivityWrite(null, planFacts(4), { ...CONTENT, endCommit: false });
    expect(result.outcome).toBe('created');
    expect(result.snapshot.revision).toBe(1);
  });

  it('creates an unknown record with the run-time span', () => {
    const facts = planUnknownFacts('kernel_unreadable');
    const result = planQueryActivityWrite(null, facts, { ...CONTENT, endCommit: true });
    expect(result.outcome).toBe('created');
    expect(result.snapshot.span).toEqual({
      firstAt: '2026-10-24T09:55:00.000Z', lastAt: '2026-10-24T10:06:00.000Z', basis: 'run_times',
    });
    expect(result.snapshot.facts).toEqual(facts);
  });
});

describe('planQueryActivityWrite: a current-rule counted record', () => {
  it('replaces an unfinished window with a terminal extension at a closing commit', () => {
    const existing = existingSnapshot(planFacts(5, { turnTerminal: false }));
    const facts = planFacts(12);
    const result = planQueryActivityWrite(existing, facts, { ...CONTENT, endCommit: true });
    expect(result.outcome).toBe('replaced');
    expect(result.snapshot.revision).toBe(3);
    expect(result.snapshot.queryRunRef).toEqual({
      aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1',
    });
    expect(result.snapshot.recordedBy).toBe('query_end');
    expect(result.snapshot.recordedAt).toBe('2026-10-24T10:06:01.000Z');
    expect(result.snapshot.facts).toEqual(facts);
    expect(result.snapshot.span).toEqual({
      firstAt: '2026-10-24T10:00:00.000Z', lastAt: '2026-10-24T10:05:00.000Z', basis: 'kernel',
    });
  });

  it('keeps the record when the same extension is not a closing commit', () => {
    const existing = existingSnapshot(planFacts(5, { turnTerminal: false }));
    const result = planQueryActivityWrite(existing, planFacts(12), { ...CONTENT, endCommit: false });
    expect(result.outcome).toBe('unchanged');
    expect(result.snapshot).toBe(existing);
  });

  it('keeps the record when a closing commit brings unknown facts', () => {
    const existing = existingSnapshot(planFacts(5, { unresolvedCalls: 1 }));
    const result = planQueryActivityWrite(existing, planUnknownFacts('turn_not_found'), { ...CONTENT, endCommit: true });
    expect(result.outcome).toBe('unchanged');
    expect(result.snapshot).toBe(existing);
  });
});

describe('planQueryActivityWrite: rule versions and unknown reasons', () => {
  it('replaces a record written under an older rule version', () => {
    const existing = existingSnapshot(planFacts(5, { ruleVersion: 1 }));
    const result = planQueryActivityWrite(existing, planUnknownFacts('kernel_unreadable', 2), { ...CONTENT, endCommit: false });
    expect(result.outcome).toBe('replaced');
    expect(result.snapshot.revision).toBe(3);
    expect(result.snapshot.span).toEqual({
      firstAt: '2026-10-24T09:55:00.000Z', lastAt: '2026-10-24T10:06:00.000Z', basis: 'run_times',
    });
  });

  it('keeps an unknown record retried for the same reason', () => {
    const existing = existingSnapshot(planUnknownFacts('kernel_unreadable'), 4);
    const result = planQueryActivityWrite(existing, planUnknownFacts('kernel_unreadable'), { ...CONTENT, endCommit: false });
    expect(result.outcome).toBe('unchanged');
    expect(result.snapshot).toBe(existing);
  });

  it('replaces an unknown record when a later read names another reason', () => {
    const existing = existingSnapshot(planUnknownFacts('kernel_unreadable'), 4);
    const result = planQueryActivityWrite(existing, planUnknownFacts('turn_not_found'), { ...CONTENT, endCommit: false });
    expect(result.outcome).toBe('replaced');
    expect(result.snapshot.revision).toBe(5);
  });

  it('replaces an unknown record with a counted one', () => {
    const existing = existingSnapshot(planUnknownFacts('kernel_unreadable'));
    const facts = planFacts(12);
    const result = planQueryActivityWrite(existing, facts, { ...CONTENT, endCommit: false });
    expect(result.outcome).toBe('replaced');
    expect(result.snapshot.revision).toBe(3);
    expect(result.snapshot.span).toEqual({
      firstAt: '2026-10-24T10:00:00.000Z', lastAt: '2026-10-24T10:05:00.000Z', basis: 'kernel',
    });
  });
});
