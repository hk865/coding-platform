/**
 * The persisted Query shapes the claim and answer writers add: the required
 * `requestProfile` on a QueryRun's execution state, and the stored answer's
 * bounded ideas. A5: pure encode/decode, every expected value a literal.
 */
import { describe, expect, it } from 'vitest';
import type {
  QueryJobAnswerSnapshot, QueryRunSnapshot,
} from '../../src/contracts/query-job.js';
import {
  decodeQueryJobAnswerSnapshot, decodeQueryRunSnapshotRecord, encodeQueryJobAnswerSnapshot, encodeQueryRunSnapshotRecord,
} from '../../src/core/work-graph/queries/query-record-codecs.js';

const JOB_REF = { aggregateType: 'QueryJob' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' };
const RUN_REF = { aggregateType: 'QueryRun' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' };
const PROFILE = {
  profileId: 'prof-1',
  runtimeBudget: {
    contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 1,
    maxToolCalls: 2, timeoutMs: 3000, perResponseTokens: 4096,
  },
  budget: { maxTokens: 2048, deadline: '2026-10-24T12:00:00.000Z' },
  consumerId: 'consumer-1',
};

function runSnapshot(requestProfile: unknown): QueryRunSnapshot {
  return {
    ref: RUN_REF,
    revision: 1,
    schemaVersion: 1,
    run: {
      schemaVersion: 1,
      queryJobRef: JOB_REF,
      runId: 'qr-1',
      status: 'pending',
      startedAt: null,
      endedAt: null,
      outcome: null,
      executionState: {
        schemaVersion: 1,
        phase: 'claimed',
        sessionRef: { projectId: 'p1', sessionId: 's1' },
        sessionGeneration: 1,
        role: { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' },
        roleBinding: {
          schemaVersion: 1, bindingId: 'b1', templateId: 'tpl', templateRevision: 'r1',
          bindingVersion: 1, policyRevision: 'pol-1',
        },
        roleResolution: { status: 'absent', roleId: 'role-1', reason: 'no role spec' },
        priorHistoryCursor: null,
        prepared: null,
        entry: null,
        history: null,
        requests: [],
        requestProfile,
      },
    },
  } as unknown as QueryRunSnapshot;
}

const ANSWER_REF = {
  aggregateType: 'QueryJobAnswer' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', answerId: 'a-1',
};

function answerSnapshot(ideas: { title: string; detail: string }[]): QueryJobAnswerSnapshot {
  return {
    ref: ANSWER_REF,
    revision: 1,
    schemaVersion: 1,
    answer: {
      schemaVersion: 1,
      answerId: 'a-1',
      queryJobRef: JOB_REF,
      runRef: RUN_REF,
      roundIndex: 0,
      answer: 'the answer',
      sources: [],
      followsAnswerRef: null,
      stale: false,
      staleReason: null,
      answeredAt: '2026-10-24T09:00:00.000Z',
      bodyRef: {
        kind: 'artifact', contentType: 'text/plain; charset=utf-8', digest: 'a'.repeat(64), sizeBytes: 10,
        source: { kind: 'workspace', refId: 'w1', revision: '1' },
      },
      ideas,
      goalCardDrafts: [], planDraftIndex: null,
    },
  };
}

describe('the persisted requestProfile', () => {
  it('round-trips a claimed request profile through the QueryRun codec', () => {
    const snapshot = runSnapshot(PROFILE);
    const decoded = decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(snapshot));
    expect(decoded).toEqual({ status: 'decoded', value: snapshot });
  });

  it('round-trips a plain Query mutation profile as null', () => {
    const snapshot = runSnapshot(null);
    const decoded = decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(snapshot));
    expect(decoded).toEqual({ status: 'decoded', value: snapshot });
  });
});

describe('rejects: a malformed persisted requestProfile', () => {
  it('a missing requestProfile on an execution state', () => {
    const snapshot = runSnapshot(PROFILE) as unknown as { run: { executionState: Record<string, unknown> } };
    delete snapshot.run.executionState['requestProfile'];
    expect(decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(snapshot as unknown as QueryRunSnapshot)).status)
      .toBe('invalid');
  });

  it('a requestProfile without its consumer', () => {
    expect(decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(runSnapshot({ ...PROFILE, consumerId: '' }))).status)
      .toBe('invalid');
  });

  it('a requestProfile whose runtime budget is out of range', () => {
    const bad = { ...PROFILE, runtimeBudget: { ...PROFILE.runtimeBudget, contextWindowTokens: 0 } };
    expect(decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(runSnapshot(bad))).status).toBe('invalid');
  });

  it('a requestProfile with a negative stored budget', () => {
    const bad = { ...PROFILE, budget: { maxTokens: -1, deadline: null } };
    expect(decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(runSnapshot(bad))).status).toBe('invalid');
  });
});

describe('the stored answer ideas', () => {
  it('round-trips no ideas', () => {
    const snapshot = answerSnapshot([]);
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(snapshot)))
      .toEqual({ status: 'decoded', value: snapshot });
  });

  it('round-trips two ideas', () => {
    const snapshot = answerSnapshot([{ title: 'one', detail: 'first' }, { title: 'two', detail: 'second' }]);
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(snapshot)))
      .toEqual({ status: 'decoded', value: snapshot });
  });

  it('round-trips three ideas', () => {
    const snapshot = answerSnapshot([
      { title: 'one', detail: 'first' }, { title: 'two', detail: 'second' }, { title: 'three', detail: 'third' },
    ]);
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(snapshot)))
      .toEqual({ status: 'decoded', value: snapshot });
  });
});

describe('rejects: a stored answer with a malformed idea list', () => {
  it('exactly one idea', () => {
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(
      answerSnapshot([{ title: 'only', detail: 'one' }]),
    )).status).toBe('invalid');
  });

  it('four ideas', () => {
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(answerSnapshot([
      { title: 'one', detail: 'a' }, { title: 'two', detail: 'b' },
      { title: 'three', detail: 'c' }, { title: 'four', detail: 'd' },
    ]))).status).toBe('invalid');
  });

  it('a title of 121 code points', () => {
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(
      answerSnapshot([{ title: 't'.repeat(121), detail: 'ok' }, { title: 'two', detail: 'ok' }]),
    )).status).toBe('invalid');
  });

  it('a detail of 601 code points', () => {
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(
      answerSnapshot([{ title: 'one', detail: 'd'.repeat(601) }, { title: 'two', detail: 'ok' }]),
    )).status).toBe('invalid');
  });

  it('a title that is more than one line', () => {
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(
      answerSnapshot([{ title: 'one\ntwo', detail: 'ok' }, { title: 'two', detail: 'ok' }]),
    )).status).toBe('invalid');
  });
});
