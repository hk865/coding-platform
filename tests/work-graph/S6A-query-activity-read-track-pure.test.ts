/**
 * Slice 6A L16: the track's Query-bar rules that are pure decisions.
 *
 * A5: hand-written inputs, no store/Host/Workflow/Runtime. A selected
 * Session's own Queries are drawn by its provenance: a plain Session's as
 * turns, a readonly copy's as consultations asked from its source, or not at
 * all when the source is selected too (the source's copy stream draws them).
 * A Query's identity for one read's dedupe is its full `QueryRunRef`, so two
 * attempts of the same QueryJob stay two bars. A readonly copy counts on the
 * line it was asked from: the QueryActivity record's formal field wins, else
 * the track's provenance.
 */
import { describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import {
  dedupeQueryBarsByRunRef, queryBarAskedOf, queryOwnScanOf,
} from '../../src/core/work-graph/views/track-read-model.js';
import type { QueryActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';

const asked: SessionRef = { projectId: 'p1', sessionId: 'asked' };
const copy: SessionRef = { projectId: 'p1', sessionId: 'copy' };

function queryRunRef(queryJobId: string, runId: string): QueryRunRef {
  return { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId, runId };
}

function activityView(askedSessionRef: SessionRef | null): QueryActivityViewV1 {
  return {
    queryRunRef: queryRunRef('job-1', 'run-1'), status: 'counted', reason: null, error: false,
    totals: { steps: 2, edits: 0, editsUnknown: 0 },
    changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false },
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, complete: true },
    recordedBy: 'query_end', recordedAt: '2026-10-14T11:00:00.000Z',
    countedThroughTurnEnd: true, unresolvedCalls: 0,
    sessionRef: copy, askedSessionRef, goalId: 'goal-1',
  };
}

const readonlyCopyOf = (from: SessionRef): SessionProvenanceV1 => ({
  schemaVersion: 1, kind: 'readonly_copy', from,
  messageRef: { aggregateType: 'SessionMessage', projectId: 'p1', workspaceId: 'w1', messageId: 'm1' },
});

describe('queryOwnScanOf', () => {
  it('draws a plain Session\'s own Queries as its turns, also a handoff or continuation', () => {
    expect(queryOwnScanOf({ schemaVersion: 1, kind: 'new' }, [asked])).toEqual({ draw: 'turn' });
    expect(queryOwnScanOf({ schemaVersion: 1, kind: 'handoff', from: copy }, [asked, copy])).toEqual({ draw: 'turn' });
    expect(queryOwnScanOf(null, [asked])).toEqual({ draw: 'turn' });
  });

  it('draws a readonly copy\'s own Queries as consultations asked from its source when the source is not selected', () => {
    expect(queryOwnScanOf(readonlyCopyOf(asked), [copy])).toEqual({ draw: 'consultation', from: asked });
  });

  it('draws nothing from a copy\'s own scan when its source is selected, in either order', () => {
    expect(queryOwnScanOf(readonlyCopyOf(asked), [copy, asked])).toEqual({ draw: 'none' });
    expect(queryOwnScanOf(readonlyCopyOf(asked), [asked, copy])).toEqual({ draw: 'none' });
  });

  it('compares the source by project and Session id', () => {
    const elsewhere: SessionRef = { projectId: 'p2', sessionId: 'asked' };
    expect(queryOwnScanOf(readonlyCopyOf(asked), [copy, elsewhere])).toEqual({ draw: 'consultation', from: asked });
  });
});

describe('dedupeQueryBarsByRunRef', () => {
  it('drops a repeat of an emitted QueryRunRef', () => {
    const ref = queryRunRef('job-1', 'run-1');
    const kept = dedupeQueryBarsByRunRef([
      { queryRunRef: ref, via: 'consultation', sessionRef: copy, askedSessionRef: asked },
      { queryRunRef: { ...ref }, via: 'consultation', sessionRef: copy, askedSessionRef: asked },
    ]);

    expect(kept).toEqual([{ queryRunRef: ref, via: 'consultation', sessionRef: copy, askedSessionRef: asked }]);
  });

  it('keeps both attempts of one QueryJob: the full QueryRunRef, not queryJobId, is the identity', () => {
    const first = queryRunRef('job-1', 'run-1');
    const second = queryRunRef('job-1', 'run-2');
    const kept = dedupeQueryBarsByRunRef([
      { queryRunRef: first, via: 'turn', sessionRef: asked, askedSessionRef: null },
      { queryRunRef: second, via: 'turn', sessionRef: asked, askedSessionRef: null },
    ]);

    expect(kept).toHaveLength(2);
    expect(kept.map((candidate) => candidate.queryRunRef.runId)).toEqual(['run-1', 'run-2']);
  });
});

describe('queryBarAskedOf', () => {
  it('uses the record asked Session when the QueryActivity record carries one', () => {
    expect(queryBarAskedOf(activityView(asked), copy)).toBe(asked);
  });

  it('falls back to the provenance Session when the record carries no asked Session', () => {
    expect(queryBarAskedOf(activityView(null), asked)).toBe(asked);
  });

  it('is null for a plain turn, which has neither', () => {
    expect(queryBarAskedOf(activityView(null), null)).toBeNull();
  });
});
