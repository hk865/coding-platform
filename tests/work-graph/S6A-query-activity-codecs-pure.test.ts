/**
 * The persisted Query-activity shapes: the `QueryActivity@1` record and its
 * `QueryActivityRecorded` replay event, plus the current `ActivityRecording`
 * format whose `querySince` names the Query epoch. A5: pure encode/decode,
 * every expected value a literal.
 */
import { describe, expect, it } from 'vitest';
import type {
  ActivityRecordingSnapshot, QueryActivitySnapshot, RunActivityFactsV1,
} from '../../src/contracts/run-activity.js';
import {
  decodeQueryActivitySnapshot, encodeQueryActivityRecordedEvent, encodeQueryActivitySnapshot,
  queryActivityRecordedEventFromEvent, queryActivityRefKey, type QueryActivityRecordedEventV1,
} from '../../src/core/work-graph/persistence/query-activity-codecs.js';
import {
  decodeActivityRecordingSnapshot, encodeActivityRecordingSnapshot,
} from '../../src/core/work-graph/persistence/run-activity-codecs.js';

/** The two record-store shapes the codec takes and returns; the row never opens a store. */
type EncodedRecordValue = { refKey: string; schemaId: string; revision: number; json: string };

const QUERY_ACTIVITY_KEY =
  '{"aggregateType":"QueryActivity","projectId":"p1","queryJobId":"qj-1","runId":"qr-1","workspaceId":"w1"}';
const ACTIVITY_RECORDING_KEY = '{"aggregateType":"ActivityRecording","projectId":"p1","workspaceId":"w1"}';

const QUERY_RUN_REF = {
  aggregateType: 'QueryRun' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1',
};
const QUERY_ACTIVITY_REF = {
  aggregateType: 'QueryActivity' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1',
};

function recordFacts(): RunActivityFactsV1 {
  return {
    status: 'counted',
    ruleVersion: 1,
    window: {
      kernelRunId: 'kr-1',
      kernelTurnId: 'kt-1',
      fromPosition: 0,
      throughPosition: 12,
      bound: 'end_position',
      turnTerminal: true,
      unresolvedCalls: 0,
      turnStartedAt: '2026-10-24T10:00:00.000Z',
      lastRecordAt: '2026-10-24T10:05:00.000Z',
    },
    quarters: [{ at: '2026-10-24T10:00:00.000Z', steps: 3, edits: 2, editsUnknown: 0 }],
    overflow: null,
    totals: { steps: 3, edits: 2, editsUnknown: 0 },
    changedFiles: {
      definite: ['src/a.ts'], possible: [], definiteOmitted: 0, possibleOmitted: 0,
      possiblyIncomplete: false, incompleteBecause: [],
    },
    usage: {
      requests: [{
        requestId: 'req-1', startedAt: '2026-10-24T10:01:00.000Z', usageStatus: 'reported',
        inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, costUsdMicros: null,
      }],
      omitted: 0,
      totals: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
      complete: true,
    },
  };
}

function countedSnapshot(): QueryActivitySnapshot {
  return {
    ref: QUERY_ACTIVITY_REF,
    revision: 1,
    schemaVersion: 1,
    queryRunRef: QUERY_RUN_REF,
    sessionRef: { projectId: 'p1', sessionId: 's1' },
    askedSessionRef: null,
    goalId: 'g1',
    queryEndedAt: '2026-10-24T10:06:00.000Z',
    recordedAt: '2026-10-24T10:06:01.000Z',
    recordedBy: 'query_end',
    facts: recordFacts(),
    span: { firstAt: '2026-10-24T10:00:00.000Z', lastAt: '2026-10-24T10:05:00.000Z', basis: 'kernel' },
  };
}

function recordedEvent(overrides: Partial<QueryActivityRecordedEventV1> = {}): QueryActivityRecordedEventV1 {
  return {
    eventId: 'e-1',
    eventType: 'QueryActivityRecorded',
    schemaVersion: 1,
    occurredAt: '2026-10-24T10:06:01.000Z',
    projectId: 'p1',
    workspaceId: 'w1',
    queryActivity: countedSnapshot(),
    ...overrides,
  };
}

function recording(querySince: string | null): ActivityRecordingSnapshot {
  return {
    ref: { aggregateType: 'ActivityRecording', projectId: 'p1', workspaceId: 'w1' },
    revision: 2,
    schemaVersion: 1,
    since: '2026-10-01T00:00:00.000Z',
    querySince,
  };
}

function encodedRecording(body: Record<string, unknown>): EncodedRecordValue {
  return { refKey: ACTIVITY_RECORDING_KEY, schemaId: 'ActivityRecording@1', revision: 2, json: JSON.stringify(body) };
}

describe('the QueryActivity record codec', () => {
  it('round-trips a counted snapshot unchanged and keys it by the canonical ref', () => {
    const snapshot = countedSnapshot();
    const encoded = encodeQueryActivitySnapshot(snapshot);
    expect(encoded.schemaId).toBe('QueryActivity@1');
    expect(encoded.revision).toBe(1);
    expect(encoded.refKey).toBe('{"aggregateType":"QueryActivity","projectId":"p1","queryJobId":"qj-1","runId":"qr-1","workspaceId":"w1"}');
    const decoded = decodeQueryActivitySnapshot(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(snapshot);
  });

  it('derives the record key from the full QueryActivity ref', () => {
    expect(queryActivityRefKey(QUERY_ACTIVITY_REF)).toBe('{"aggregateType":"QueryActivity","projectId":"p1","queryJobId":"qj-1","runId":"qr-1","workspaceId":"w1"}');
  });
});

describe('rejects: a QueryActivity record missing one required body field', () => {
  const requiredFields = [
    'ref', 'revision', 'schemaVersion', 'queryRunRef', 'sessionRef', 'askedSessionRef', 'goalId',
    'queryEndedAt', 'recordedAt', 'recordedBy', 'facts', 'span',
  ] as const;
  for (const field of requiredFields) {
    it(`a record without ${field}`, () => {
      const body = { ...countedSnapshot() } as unknown as Record<string, unknown>;
      delete body[field];
      expect(decodeQueryActivitySnapshot({
        refKey: QUERY_ACTIVITY_KEY, schemaId: 'QueryActivity@1', revision: 1, json: JSON.stringify(body),
      }).status).toBe('invalid');
    });
  }
});

describe('rejects: a QueryActivity record whose ref and queryRunRef disagree', () => {
  it('a queryRunRef naming another run', () => {
    const snapshot = { ...countedSnapshot(), queryRunRef: { ...QUERY_RUN_REF, runId: 'qr-2' } };
    expect(decodeQueryActivitySnapshot(encodeQueryActivitySnapshot(snapshot)).status).toBe('invalid');
  });
});

describe('the QueryActivityRecorded event codec', () => {
  it('round-trips the recorded snapshot', () => {
    const event = recordedEvent();
    const decoded = queryActivityRecordedEventFromEvent(encodeQueryActivityRecordedEvent(event));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(event);
  });
});

describe('rejects: a QueryActivityRecorded event whose scope disagrees with the record', () => {
  it('an event body in another project', () => {
    const event = recordedEvent({ projectId: 'p2' });
    expect(queryActivityRecordedEventFromEvent(encodeQueryActivityRecordedEvent(event)).status).toBe('invalid');
  });
});

describe('the ActivityRecording codec with the Query epoch', () => {
  it('round-trips a recording whose querySince is set', () => {
    const snapshot = recording('2026-10-24T09:00:00.000Z');
    const decoded = decodeActivityRecordingSnapshot(encodeActivityRecordingSnapshot(snapshot));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(snapshot);
  });

  it('round-trips a recording whose querySince is null', () => {
    const snapshot = recording(null);
    const decoded = decodeActivityRecordingSnapshot(encodeActivityRecordingSnapshot(snapshot));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(snapshot);
  });
});

describe('rejects: a malformed ActivityRecording body', () => {
  it('a body without querySince', () => {
    const body = { ...recording('2026-10-24T09:00:00.000Z') } as unknown as Record<string, unknown>;
    delete body['querySince'];
    expect(decodeActivityRecordingSnapshot(encodedRecording(body)).status).toBe('invalid');
  });

  it('a body with an unknown extra key', () => {
    const body = { ...recording(null), extra: true } as unknown as Record<string, unknown>;
    expect(decodeActivityRecordingSnapshot(encodedRecording(body)).status).toBe('invalid');
  });
});
