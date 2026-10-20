/**
 * Slice 2B BE4: `readActivityCalendar` acceptance row 2B-26 — a cell's top-3
 * tasks, its sessions, `sessionRefs` filtering, the unknown claiming Session,
 * and the Goal-gate check attribution.
 *
 * Data is built by `S2B-activity-fixture.ts` through real claim/entry/end, the
 * public RunActivity write port, real `linkSessionWork` responsible links and
 * real verification rounds. Assertions read only the public
 * `readActivityCalendar`; every expected value is a hand-computed literal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
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

function readyCalendar(result: Awaited<ReturnType<S2BActivityFixture['readCalendar']>>) {
  if (result.status !== 'ready') throw new Error(`calendar read failed: ${JSON.stringify(result)}`);
  return result.value;
}

function cellAt(value: ReturnType<typeof readyCalendar>, localHour: number) {
  const cell = value.cells.find((candidate) => candidate.localHour === localHour);
  if (cell === undefined) throw new Error(`no cell for local hour ${String(localHour)}`);
  return cell;
}

const UTC_HOURS = { from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T11:00:00.000Z',
  granularity: 'hour' as const, timeZone: 'UTC' };

async function countedQuarter(f: S2BActivityFixture, taskId: string, session: SessionRef, steps: number) {
  const run = await f.runAndEnd(taskId, session, '2026-10-14T09:50:00.000Z', '2026-10-14T10:00:00.000Z');
  await f.writeActivity(run, countedFacts({
    turnStartedAt: '2026-10-14T09:50:00.000Z', lastRecordAt: '2026-10-14T10:00:00.000Z',
    quarters: [{ at: '2026-10-14T10:00:00.000Z', steps, edits: 0, editsUnknown: 0 }],
  }));
  return run;
}

describe.each(['memory', 'sqlite'] as const)('S2B activity calendar tasks (%s)', (kind) => {
  it('2B-26 takes a cell\'s top 3 tasks by steps+edits+checks, breaks ties by taskId and reports moreTasks', async () => {
    const f = await open(kind);
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    // weights 5, 4, 3, 3, 1 -> the top three are work-1, work-2 and work-3
    // (work-3 beats work-4 on the taskId byte order); work-5 is left out.
    await countedQuarter(f, 'work-1', session, 5);
    await countedQuarter(f, 'work-2', session, 4);
    await countedQuarter(f, 'work-3', session, 3);
    await countedQuarter(f, 'work-4', session, 3);
    await countedQuarter(f, 'work-5', session, 1);
    f.setClock('2026-10-14T10:30:00.000Z');

    const calendar = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS }));

    expect(cellAt(calendar, 10)).toMatchObject({
      steps: 16, checks: 0, complete: true,
      tasks: [
        { taskId: 'work-1', steps: 5, edits: 0, checks: 0 },
        { taskId: 'work-2', steps: 4, edits: 0, checks: 0 },
        { taskId: 'work-3', steps: 3, edits: 0, checks: 0 },
      ],
      moreTasks: 2,
    });
    expect(cellAt(calendar, 10).tasks.some((task) => task.taskId === 'work-5')).toBe(false);
  });

  it('2B-26 lists at most 10 Sessions of a cell in sessionId order and reports moreSessions', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    const sessions: SessionRef[] = [];
    for (let index = 0; index < 11; index += 1) {
      const session = await f.b2.base.createSession(`s2b-many-sessions-${String(index)}`);
      sessions.push(session);
      await countedQuarter(f, `work-${String(index + 1)}`, session, 1);
    }
    f.setClock('2026-10-14T10:30:00.000Z');

    const calendar = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS }));
    const cell = cellAt(calendar, 10);
    const ids = cell.sessions.map((session) => session.sessionId);
    expect(cell.steps).toBe(11);
    expect(cell.sessions).toHaveLength(10);
    expect(cell.moreSessions).toBe(1);
    // Literal ascending sessionId order for the 11 `s2b-many-sessions-*` request
    // ids (the sessionId is the deterministic sha256 digest of actor/project/
    // requestId), so the largest of the 11 is the one left out.
    expect(ids).toEqual([
      'session-091bc170b390674f2e6b33c537839e09d98369f16f99effeef5412d8f43b26cd',
      'session-2216ef9da868a000df4ef0e3f6a30202b77678e7013e3df8e55e9d2de4892e07',
      'session-2449c3326989b5029fa807620c00d44674b3674501cbfa584ba4b92cd4e6c7e1',
      'session-5666fa2259dcc675b5fe82a0c62df4789220658c803cb0767ad2e5b8d4c131b0',
      'session-65040fe01142db9ffbb65346111b5bfe9b319267fd2aeba734080df7ca8c6291',
      'session-82c75a8d9a412abdea45d22de5093bd3f64cbb6defd0598d468f69c25ae2d37f',
      'session-967220ae16a17170659d0ee7c4771c0f00ae1fe33d59a66f01d7dcf11edd02e4',
      'session-bd55fd351ed621e1ee5a622a4c610324c7f21914cb615417234808319828912a',
      'session-c0ee8b6608687f42850c813fa9b5c5d497dee913e49612a998e3b25b5964ea8d',
      'session-e9023235af0161f857a5d1c0e84d1f6e9df503904b810df3c5249cf108e0983f',
    ]);
    expect(ids).toEqual([...sessions.map((session) => session.sessionId)].sort().slice(0, 10));
  });

  it('2B-26 filters a cell to one line with sessionRefs and reports no Session-unknown count unfiltered', async () => {
    const f = await open(kind);
    const sessionA = await f.b2.base.createSession('s2b-line-a');
    const sessionB = await f.b2.base.createSession('s2b-line-b');
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    await countedQuarter(f, 'work-1', sessionA, 3);
    await countedQuarter(f, 'work-2', sessionB, 2);
    f.setClock('2026-10-14T10:30:00.000Z');

    const filtered = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
      sessionRefs: [sessionA] }));
    expect(cellAt(filtered, 10).steps).toBe(3);
    expect(cellAt(filtered, 10).sessions).toEqual([sessionA]);
    expect(filtered.coverage).toMatchObject({ runsCounted: 1, runsSessionUnknown: 0 });

    const whole = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS }));
    expect(cellAt(whole, 10).steps).toBe(5);
    expect(whole.coverage).toMatchObject({ runsCounted: 2, runsSessionUnknown: null });
  });

  it('2B-26 sessionRefs skips a foreign-line uncounted Run and reports no unresolvable claiming Session', async () => {
    const f = await open(kind);
    const sessionA = await f.b2.base.createSession('s2b-filter-line-a');
    const sessionB = await f.b2.base.createSession('s2b-filter-line-b');
    // `since` sits before the two real Runs end.
    await f.ensureRecording('2026-10-14T09:45:00.000Z');

    await countedQuarter(f, 'work-1', sessionA, 3);
    // A foreign line's real Run with no record: uncounted (not_recorded) without
    // the filter, and it marks the 09:00 cell.
    await f.runAndEnd('work-2', sessionB, '2026-10-14T09:50:00.000Z', '2026-10-14T10:00:00.000Z');
    f.setClock('2026-10-14T10:30:00.000Z');

    const filtered = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
      sessionRefs: [sessionA] }));
    // Only line A's Run may count: the foreign Run is skipped entirely, neither
    // marking a cell nor joining the uncounted bucket.
    expect(cellAt(filtered, 10)).toMatchObject({ steps: 3, uncountedRuns: 0, complete: true });
    expect(cellAt(filtered, 9)).toMatchObject({ uncountedRuns: 0 });
    expect(filtered.coverage).toMatchObject({
      runsCounted: 1, runsNotEntered: 0, runsUncounted: [], runsUnplaced: 0, runsSessionUnknown: 0,
    });

    const whole = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS }));
    expect(cellAt(whole, 9).uncountedRuns).toBe(1);
    expect(whole.coverage).toMatchObject({
      runsCounted: 1, runsNotEntered: 0, runsSessionUnknown: null,
      runsUncounted: [
        { reason: 'not_recorded', count: 1 },
      ],
    });
  });

  it('2B-26 attributes Goal-gate checks to the open responsible Sessions of the gate task', async () => {
    const f = await open(kind);
    const producer = f.b2.base.sessions.second;
    const gateOwner = await f.b2.base.createSession('s2b-gate-owner');
    const gateOwner2 = await f.b2.base.createSession('s2b-gate-owner-2');
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    const runP = await f.runAndEnd('work-1', producer, '2026-10-14T09:50:00.000Z', '2026-10-14T10:00:00.000Z');
    await f.writeActivity(runP, countedFacts({ turnStartedAt: '2026-10-14T09:50:00.000Z',
      lastRecordAt: '2026-10-14T10:00:00.000Z', quarters: [] }));

    f.setClock('2026-10-14T10:05:00.000Z');
    // The gate's producer Run is `runP` (Session P); the gate subject itself is gate-1.
    const gateRound = await f.openRound(runP, 'gate-1', { gateSubject: 'goal' });
    await f.beginChecks(gateRound, 2);
    // A normal check on the same producer Session P.
    const normalRound = await f.openRound(runP, 'work-1');
    await f.beginChecks(normalRound, 1);

    await f.linkResponsible(gateOwner, 'gate-1');

    f.setClock('2026-10-14T10:30:00.000Z');
    const withOwner = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
      sessionRefs: [gateOwner] }));
    expect(cellAt(withOwner, 10).checks).toBe(2);
    expect(cellAt(withOwner, 10).sessions).toEqual([gateOwner]);
    expect(withOwner.coverage.checksGateUnplaced).toBe(0);

    const withProducer = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
      sessionRefs: [producer] }));
    expect(cellAt(withProducer, 10).checks).toBe(1);
    expect(cellAt(withProducer, 10).tasks).toEqual([{ taskId: 'work-1', steps: 0, edits: 0, checks: 1 }]);
    expect(withProducer.coverage.checksGateUnplaced).toBe(0);

    // Handover in flight: two open responsible links on the gate task.
    await f.linkResponsible(gateOwner2, 'gate-1');
    const owners = [gateOwner.sessionId, gateOwner2.sessionId].sort();
    for (const owner of [gateOwner, gateOwner2]) {
      const read = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
        sessionRefs: [owner] }));
      expect(cellAt(read, 10).checks).toBe(2);
      expect(cellAt(read, 10).sessions.map((session) => session.sessionId)).toEqual(owners);
      expect(read.coverage.checksGateUnplaced).toBe(0);
    }
    const stillProducer = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
      sessionRefs: [producer] }));
    expect(cellAt(stillProducer, 10).checks).toBe(1);

    // Both responsible links closed, none opened again: the gate checks are unplaced.
    await f.closeResponsible(gateOwner, 'gate-1');
    await f.closeResponsible(gateOwner2, 'gate-1');
    const closedForOwner = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
      sessionRefs: [gateOwner] }));
    expect(cellAt(closedForOwner, 10).checks).toBe(0);
    expect(closedForOwner.coverage.checksGateUnplaced).toBe(2);
    const closedForProducer = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS,
      sessionRefs: [producer] }));
    expect(cellAt(closedForProducer, 10).checks).toBe(1);
    expect(closedForProducer.coverage.checksGateUnplaced).toBe(2);

    // Without sessionRefs every check is in the cell and the gate count is null.
    const unfiltered = readyCalendar(await f.readCalendar({ goalRef: f.goalRef, ...UTC_HOURS }));
    expect(cellAt(unfiltered, 10).checks).toBe(3);
    expect(unfiltered.coverage.checksGateUnplaced).toBeNull();
  });
});
