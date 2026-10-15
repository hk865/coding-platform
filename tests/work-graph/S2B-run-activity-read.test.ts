/**
 * Slice 2B BE4: `readRunActivities` acceptance row 2B-29.
 *
 * Data is built by `S2B-activity-fixture.ts` through the real claim/entry/end
 * services and the public RunActivity write port. Assertions read only the
 * public `readRunActivities`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  countedFacts, openS2BActivityFixture, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';

const opened: S2BActivityFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BActivityFixture> {
  const fixture = await openS2BActivityFixture(kind);
  opened.push(fixture);
  return fixture;
}

function readyViews(result: Awaited<ReturnType<S2BActivityFixture['readRuns']>>) {
  if (result.status !== 'ready') throw new Error(`Run activity read failed: ${JSON.stringify(result)}`);
  return result.value;
}

function viewOf(views: ReturnType<typeof readyViews>, runRef: RunRef) {
  const view = views.find((candidate) => candidate.runRef.runId === runRef.runId);
  if (view === undefined) throw new Error(`no view for Run ${runRef.runId}`);
  return view;
}

describe.each(['memory', 'sqlite'] as const)('S2B readRunActivities (%s)', (kind) => {
  it('2B-29 reports each Run status, reason and public facts and rejects 201 refs', async () => {
    const f = await open(kind);
    const session = f.b2.base.sessions.second;
    // `since` sits between the normal and the late Run, so both are observable.
    await f.ensureRecording('2026-10-14T10:00:00.000Z');

    const counted = await f.runAndEnd('work-1', session, '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(counted, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:30:00.000Z',
      quarters: [{ at: '2026-10-14T09:00:00.000Z', steps: 4, edits: 1, editsUnknown: 0 }],
      changedFiles: { definite: ['a.ts'], possiblyIncomplete: false },
    }));

    const late = await f.runAndEnd('work-2', session, '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(late, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-10-14T10:30:00.000Z',
      quarters: [{ at: '2026-10-14T10:00:00.000Z', steps: 2, edits: 0, editsUnknown: 0 }],
    }));

    const unknown = await f.runAndEnd('work-3', session, '2026-10-14T10:30:00.000Z', '2026-10-14T10:45:00.000Z');
    await f.writeActivity(unknown, { status: 'unknown', ruleVersion: 1,
      reason: 'history_read_failed', detail: 'S2B fixture unknown tally' });

    const notBackfilled = await f.runAndEnd('work-4', session, '2026-10-14T09:30:00.000Z', '2026-10-14T09:45:00.000Z');
    const notRecorded = await f.runAndEnd('work-5', session, '2026-10-14T10:05:00.000Z', '2026-10-14T10:15:00.000Z');
    const inProgress = await f.runOpen('work-6', session, '2026-10-14T11:00:00.000Z');
    const notEnteredSession = await f.b2.base.createSession('s2b-29-not-entered');
    const notEntered = await f.claimThenCancel('work-7', notEnteredSession, '2026-10-14T11:10:00.000Z');
    f.setClock('2026-10-14T12:00:00.000Z');

    const views = readyViews(await f.readRuns([counted, late, unknown, notBackfilled, notRecorded, inProgress, notEntered]));

    expect(viewOf(views, counted)).toMatchObject({
      status: 'counted', reason: null, error: false,
      totals: { steps: 4, edits: 1, editsUnknown: 0 },
      changedFiles: { definite: 1, possible: 0, possiblyIncomplete: false },
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, complete: true },
      recordedBy: 'backfill', countedThroughTurnEnd: true, unresolvedCalls: 0,
    });
    expect(viewOf(views, counted).recordedAt).not.toBeNull();

    expect(viewOf(views, late)).toMatchObject({
      status: 'counted', reason: 'recorded_late', error: true,
      totals: { steps: 2, edits: 0, editsUnknown: 0 }, recordedBy: 'backfill',
      countedThroughTurnEnd: true, unresolvedCalls: 0,
    });
    expect(viewOf(views, late).recordedAt).not.toBeNull();

    expect(viewOf(views, unknown)).toMatchObject({
      status: 'unknown', reason: 'history_read_failed', error: false,
      totals: null, changedFiles: null, usage: null,
      recordedBy: 'backfill', countedThroughTurnEnd: null, unresolvedCalls: null,
    });
    expect(viewOf(views, unknown).recordedAt).not.toBeNull();

    expect(viewOf(views, notBackfilled)).toMatchObject({
      status: 'unknown', reason: 'not_backfilled', error: false,
      recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null,
    });
    expect(viewOf(views, notRecorded)).toMatchObject({
      status: 'unknown', reason: 'not_recorded', error: true,
      recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null,
    });
    expect(viewOf(views, inProgress)).toMatchObject({
      status: 'in_progress', reason: null, error: false,
      recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null,
    });
    expect(viewOf(views, notEntered)).toMatchObject({
      status: 'not_entered', reason: null, error: false,
      totals: { steps: 0, edits: 0, editsUnknown: 0 },
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false }, usage: null,
      recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null,
    });

    const tooMany = Array.from({ length: 201 }, () => counted);
    expect(await f.readRuns(tooMany)).toMatchObject({ status: 'rejected', code: 'invalid' });
  });
});
