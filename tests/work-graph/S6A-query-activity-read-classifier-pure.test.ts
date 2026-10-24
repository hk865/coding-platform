/**
 * The one missing-activity classifier and the Query activity view. Both are
 * pure projections over facts a reader already holds, so every row builds its
 * input by hand and asserts a literal outcome (A5).
 */
import { describe, expect, it } from 'vitest';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import type { QueryActivitySnapshot, RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import {
  classifyMissingActivity, queryActivityViewOf,
} from '../../src/core/work-graph/views/activity-read-helpers.js';

const QUERY_RUN_REF: QueryRunRef = {
  aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-7', runId: 'qr-7',
};
const SESSION_REF = { projectId: 'p1', sessionId: 'sess-runner' };
const ASKED_SESSION_REF = { projectId: 'p1', sessionId: 'sess-asked' };

const COUNTED_FACTS: RunActivityFactsV1 = {
  status: 'counted',
  ruleVersion: 1,
  window: {
    kernelRunId: 'kr-7', kernelTurnId: 'kt-7', fromPosition: 0, throughPosition: 12,
    bound: 'end_position', turnTerminal: true, unresolvedCalls: 2,
    turnStartedAt: '2026-10-24T09:00:00.000Z', lastRecordAt: '2026-10-24T09:04:00.000Z',
  },
  quarters: [],
  overflow: null,
  totals: { steps: 7, edits: 3, editsUnknown: 1 },
  changedFiles: {
    definite: ['src/a.ts', 'src/b.ts'], possible: ['src/c.ts'],
    definiteOmitted: 0, possibleOmitted: 0,
    possiblyIncomplete: true, incompleteBecause: ['command_ran'],
  },
  usage: {
    requests: [], omitted: 2,
    totals: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 100 }, complete: false,
  },
};

/** One stored Query activity record; only the fields the projection reads vary. */
function queryActivity(fields: {
  recordedBy: 'query_end' | 'backfill'; queryEndedAt: string; facts: RunActivityFactsV1;
}): QueryActivitySnapshot {
  return {
    ref: { aggregateType: 'QueryActivity', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-7', runId: 'qr-7' },
    revision: 3,
    schemaVersion: 1,
    queryRunRef: QUERY_RUN_REF,
    sessionRef: SESSION_REF,
    askedSessionRef: ASKED_SESSION_REF,
    goalId: 'g1',
    queryEndedAt: fields.queryEndedAt,
    recordedAt: '2026-10-24T09:05:00.000Z',
    recordedBy: fields.recordedBy,
    facts: fields.facts,
    span: { firstAt: '2026-10-24T09:00:00.000Z', lastAt: '2026-10-24T09:05:00.000Z', basis: 'kernel' },
  };
}

const COUNTED_VIEW = {
  queryRunRef: QUERY_RUN_REF,
  status: 'counted', reason: null, error: false,
  totals: { steps: 7, edits: 3, editsUnknown: 1 },
  changedFiles: { definite: 2, possible: 1, possiblyIncomplete: true },
  usage: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 100, complete: false },
  recordedBy: 'query_end', recordedAt: '2026-10-24T09:05:00.000Z',
  countedThroughTurnEnd: true, unresolvedCalls: 2,
  sessionRef: SESSION_REF, askedSessionRef: ASKED_SESSION_REF, goalId: 'g1',
} as const;

describe('classifyMissingActivity', () => {
  it('names a missing aggregate, an unfinished aggregate and a proven never-entered aggregate', () => {
    // The aggregate record itself is missing: there is no history to place, so
    // it is uncounted, never zero, and nothing about its end matters.
    expect(classifyMissingActivity({
      kind: 'absent', endedAt: null, neverEntered: false, since: '2026-10-01T00:00:00.000Z',
    })).toEqual({ kind: 'unknown', reason: 'no_history_locator', error: false });
    // An aggregate that has not ended yet is in progress, not uncounted.
    expect(classifyMissingActivity({
      kind: 'open', endedAt: null, neverEntered: false, since: '2026-10-01T00:00:00.000Z',
    })).toEqual({ kind: 'in_progress' });
    // The caller's own entry proof outranks every reason: it never entered the Kernel.
    expect(classifyMissingActivity({
      kind: 'ended', endedAt: '2026-10-24T09:00:00.000Z', neverEntered: true, since: '2026-10-01T00:00:00.000Z',
    })).toEqual({ kind: 'not_entered' });
  });

  it('an ended aggregate that entered the Kernel is uncounted for the reason its record is missing', () => {
    // No recording epoch: nothing can say whether the ended aggregate was covered.
    expect(classifyMissingActivity({
      kind: 'ended', endedAt: '2026-10-24T09:00:00.000Z', neverEntered: false, since: null,
    })).toEqual({ kind: 'unknown', reason: 'no_recording_epoch', error: false });
    // Recording was already on when it ended (the epoch instant counts): the record is missing for a reason that needs looking into.
    expect(classifyMissingActivity({
      kind: 'ended', endedAt: '2026-10-01T00:00:00.000Z', neverEntered: false, since: '2026-10-01T00:00:00.000Z',
    })).toEqual({ kind: 'unknown', reason: 'not_recorded', error: true });
    expect(classifyMissingActivity({
      kind: 'ended', endedAt: '2026-10-24T09:00:00.000Z', neverEntered: false, since: '2026-10-01T00:00:00.000Z',
    })).toEqual({ kind: 'unknown', reason: 'not_recorded', error: true });
    // It ended before recording started: the automatic backfill has not reached it yet.
    expect(classifyMissingActivity({
      kind: 'ended', endedAt: '2026-09-01T00:00:00.000Z', neverEntered: false, since: '2026-10-01T00:00:00.000Z',
    })).toEqual({ kind: 'unknown', reason: 'not_backfilled', error: false });
  });
});

describe('queryActivityViewOf', () => {
  it('projects a counted Query activity with its totals, changed-file counts and turn window', () => {
    expect(queryActivityViewOf(
      queryActivity({ recordedBy: 'query_end', queryEndedAt: '2026-10-24T09:05:00.000Z', facts: COUNTED_FACTS }),
      '2026-10-01T00:00:00.000Z',
    )).toEqual(COUNTED_VIEW);
  });

  it('projects an unknown tally as unknown with no numbers', () => {
    const unknownFacts: RunActivityFactsV1 = {
      status: 'unknown', ruleVersion: 1, reason: 'history_damaged', detail: 'the Kernel turn record is missing',
    };
    expect(queryActivityViewOf(
      queryActivity({ recordedBy: 'query_end', queryEndedAt: '2026-10-24T09:05:00.000Z', facts: unknownFacts }),
      '2026-10-01T00:00:00.000Z',
    )).toEqual({
      queryRunRef: QUERY_RUN_REF,
      status: 'unknown', reason: 'history_damaged', error: false,
      totals: null, changedFiles: null, usage: null,
      recordedBy: 'query_end', recordedAt: '2026-10-24T09:05:00.000Z',
      countedThroughTurnEnd: null, unresolvedCalls: null,
      sessionRef: SESSION_REF, askedSessionRef: ASKED_SESSION_REF, goalId: 'g1',
    });
  });

  it('a backfilled record that ended at or after the Query epoch is recorded late; earlier or before the epoch it is not', () => {
    const atEpoch = queryActivity({
      recordedBy: 'backfill', queryEndedAt: '2026-10-01T00:00:00.000Z', facts: COUNTED_FACTS,
    });
    const afterEpoch = queryActivity({
      recordedBy: 'backfill', queryEndedAt: '2026-10-24T09:05:00.000Z', facts: COUNTED_FACTS,
    });
    const late = {
      ...COUNTED_VIEW, reason: 'recorded_late', error: true, recordedBy: 'backfill',
    };
    expect(queryActivityViewOf(atEpoch, '2026-10-01T00:00:00.000Z')).toEqual(late);
    expect(queryActivityViewOf(afterEpoch, '2026-10-01T00:00:00.000Z')).toEqual(late);
    // No Query epoch at all, or the record ended before it: nothing can have been late.
    const notLate = { ...COUNTED_VIEW, recordedBy: 'backfill' };
    expect(queryActivityViewOf(afterEpoch, null)).toEqual(notLate);
    expect(queryActivityViewOf(afterEpoch, '2026-11-01T00:00:00.000Z')).toEqual(notLate);
  });
});
