/**
 * Slice 2B BE4 row 2B-30: track bars.
 *
 * Data is built by `S2B-track-fixture.ts` (real claim/entry/end, real public
 * RunActivity writes, real verification rounds, real pause/resume control
 * observations). Assertions read only the public `readTrackBars`; every
 * expected value is a hand-computed literal from spec L12.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackBarsPageV1 } from '../../src/core/work-graph/views/track-read-model.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';

const opened: S2BTrackFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BTrackFixture> {
  const fixture = await openS2BTrackFixture(kind);
  opened.push(fixture);
  return fixture;
}

function ready(result: Awaited<ReturnType<S2BTrackFixture['readTrack']>>): TrackBarsPageV1 {
  if (result.status !== 'ready') throw new Error(`track read failed: ${JSON.stringify(result)}`);
  return result.value;
}

/** The full 2026-10-14 UTC day, a quarter-aligned window. */
const DAY_FROM = '2026-10-14T00:00:00.000Z';
const DAY_TO = '2026-10-15T00:00:00.000Z';

describe.each(['memory', 'sqlite'] as const)('S2B track bars (%s)', (kind) => {
  it('2B-30 smoke: a counted Run is drawn as a run bar with its L10 activity', async () => {
    const f = await open(kind);
    const run = await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-10-14T10:10:00.000Z',
      quarters: [{ at: '2026-10-14T10:00:00.000Z', steps: 5, edits: 2, editsUnknown: 0 }],
    }));

    const page = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO }));

    expect(page.bars).toHaveLength(1);
    const bar = page.bars[0]!;
    expect(bar.kind).toBe('run');
    if (bar.kind !== 'run') return;
    expect(bar.runRef).toEqual(run);
    expect(bar.taskId).toBe('work-1');
    expect(bar.sessionRef).toEqual(f.computeSessionRef());
    expect(bar.startAt).toBe('2026-10-14T10:00:00.000Z');
    expect(bar.endAt).toBe('2026-10-14T10:30:00.000Z');
    expect(bar.result).toBe('completed');
    expect(bar.reason).toBeNull();
    expect(bar.pauses).toEqual([]);
    expect(bar.previous).toBeNull();
    expect(bar.attempt).toEqual({ attemptId: expect.any(String), via: 'first', requeue: null });
    expect(bar.activity).toMatchObject({
      status: 'counted', reason: null, error: false,
      totals: { steps: 5, edits: 2, editsUnknown: 0 },
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false },
      countedThroughTurnEnd: true, unresolvedCalls: 0,
    });
    expect(page.queriesIncluded).toBe(false);
    expect(page.unplaced).toEqual({ runs: 0, rounds: 0, gateRounds: 0 });
  });

  it('2B-30 run segments overlap the window: an earlier start ending inside is drawn, an open Run has endAt null, and segments keep their order', async () => {
    const f = await open(kind);
    const session = f.computeSessionRef();
    const early = await f.runAndEnd('work-1', session,
      '2026-10-14T09:00:00.000Z', '2026-10-14T10:10:00.000Z');
    const first = await f.runAndEnd('work-2', session,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    const second = await f.runAndEnd('work-3', session,
      '2026-10-14T11:00:00.000Z', '2026-10-14T11:30:00.000Z');
    const openRun = await f.runOpen('work-4', session, '2026-10-14T12:00:00.000Z');

    const page = ready(await f.readTrack({ from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T13:00:00.000Z' }));

    expect(page.bars.map((bar) => bar.kind)).toEqual(['run', 'run', 'run', 'run']);
    const runRefs = page.bars.map((bar) => (bar.kind === 'run' ? bar.runRef.runId : ''));
    expect(runRefs).toEqual([early.runId, first.runId, second.runId, openRun.runId]);

    const openBar = page.bars[3]!;
    expect(openBar.kind).toBe('run');
    if (openBar.kind !== 'run') return;
    expect(openBar.runRef).toEqual(openRun);
    expect(openBar.startAt).toBe('2026-10-14T12:00:00.000Z');
    expect(openBar.endAt).toBeNull();
    expect(openBar.result).toBe('running');
    // An open Run with no RunActivity is `in_progress`, never a counted 0.
    expect(openBar.activity.status).toBe('in_progress');
  });

  it('2B-30 a pause observed at 10:20:05 and resumed at 10:50:03 gives the pause interval [10:20:05, 10:50:03)', async () => {
    const f = await open(kind);
    const run = await f.runOpen('work-1', f.computeSessionRef(), '2026-10-14T10:00:00.000Z');
    const { pause } = await f.pauseThenResume(run,
      '2026-10-14T10:20:05.000Z', '2026-10-14T10:50:03.000Z');

    const page = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO }));
    const bar = page.bars.find((candidate) => candidate.kind === 'run' && candidate.runRef.runId === run.runId);
    expect(bar).toBeDefined();
    if (bar === undefined || bar.kind !== 'run') return;
    expect(bar.pauses).toEqual([{
      from: '2026-10-14T10:20:05.000Z', to: '2026-10-14T10:50:03.000Z', intentRef: pause,
    }]);
  });

  it('2B-30 limit must be 1..500; 0 and 501 are invalid', async () => {
    const f = await open(kind);
    await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    expect((await f.readTrack({ from: DAY_FROM, to: DAY_TO, limit: 0 })).status).toBe('rejected');
    expect(await f.readTrack({ from: DAY_FROM, to: DAY_TO, limit: 501 })).toMatchObject({ code: 'invalid' });
    const one = await f.readTrack({ from: DAY_FROM, to: DAY_TO, limit: 1 });
    expect(one.status).toBe('ready');
    if (one.status === 'ready') expect(one.value.bars).toHaveLength(1);
  });

  it('2B-30 from and to must be UTC quarter boundaries', async () => {
    const f = await open(kind);
    expect(await f.readTrack({ from: '2026-10-14T10:10:00.000Z', to: DAY_TO })).toMatchObject({ code: 'invalid' });
    expect(await f.readTrack({ from: DAY_FROM, to: '2026-10-14T11:00:30.000Z' })).toMatchObject({ code: 'invalid' });
  });

  it('2B-30 pagination limit 2 over 5 run bars yields three pages with no loss or duplication', async () => {
    const f = await open(kind);
    const session = f.computeSessionRef();
    const runs = [];
    for (let index = 0; index < 5; index += 1) {
      runs.push(await f.runAndEnd(`work-${String(index + 1)}`, session,
        `2026-10-14T1${String(index)}:00:00.000Z`, `2026-10-14T1${String(index)}:30:00.000Z`));
    }

    const first = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, limit: 2 }));
    expect(first.bars).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, limit: 2, cursor: first.next }));
    expect(second.bars).toHaveLength(2);
    expect(second.next).not.toBeNull();
    const third = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, limit: 2, cursor: second.next }));
    expect(third.bars).toHaveLength(1);
    expect(third.next).toBeNull();

    const ids = [...first.bars, ...second.bars, ...third.bars]
      .map((bar) => (bar.kind === 'run' ? bar.runRef.runId : ''));
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(runs.map((run) => run.runId));
  });

  it('2B-30 check bars carry start/end/result/ordinal/checksBegun and the attributed Session', async () => {
    const f = await open(kind);
    const session = f.computeSessionRef();
    const subject = await f.runAndEnd('work-1', session,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');

    f.setClock('2026-10-14T10:05:00.000Z');
    const round = await f.beginChecks(await f.openRound(subject, 'work-1'), 2);
    f.setClock('2026-10-14T10:40:00.000Z');
    const finalized = await f.finalize(await f.interruptExecutingChecks(round));

    const openSubject = await f.runAndEnd('work-2', session,
      '2026-10-14T10:50:00.000Z', '2026-10-14T10:55:00.000Z');
    f.setClock('2026-10-14T11:10:00.000Z');
    const openRound = await f.beginChecks(await f.openRound(openSubject, 'work-2'), 1);

    const page = ready(await f.readTrack({ from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z' }));
    const checks = page.bars.filter((bar) => bar.kind === 'check');
    expect(checks).toHaveLength(2);
    const [closed, stillOpen] = checks;
    expect(closed).toMatchObject({
      kind: 'check', roundRef: finalized.ref, taskId: 'work-1',
      sessionRef: session, ownerSessionRefs: null,
      startAt: '2026-10-14T10:05:00.000Z', endAt: '2026-10-14T10:40:00.000Z',
      result: 'INCONCLUSIVE', ordinal: 1, checksBegun: 2, previous: null,
    });
    expect(stillOpen).toMatchObject({
      kind: 'check', roundRef: openRound.ref, taskId: 'work-2',
      sessionRef: session, ownerSessionRefs: null,
      startAt: '2026-10-14T11:10:00.000Z', endAt: null, result: 'open', checksBegun: 1,
    });
    expect(page.unplaced.rounds).toBe(0);
  });

  it('2B-30 a Goal-gate round with no responsible Session shows with sessionRef null and ownerSessionRefs [], and a filtered read counts it in unplaced.gateRounds', async () => {
    const f = await open(kind);
    const session = f.computeSessionRef();
    const producer = await f.runAndEnd('work-1', session,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');

    f.setClock('2026-10-14T10:05:00.000Z');
    const gate = await f.beginChecks(await f.openGateRound(producer), 2);
    f.setClock('2026-10-14T10:40:00.000Z');
    const finalized = await f.finalize(await f.interruptExecutingChecks(gate));

    const whole = ready(await f.readTrack({ from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z' }));
    const gateBar = whole.bars.find((bar) => bar.kind === 'check');
    expect(gateBar).toMatchObject({
      kind: 'check', roundRef: finalized.ref, taskId: 'gate-1',
      sessionRef: null, ownerSessionRefs: [], result: 'INCONCLUSIVE', checksBegun: 2,
    });
    expect(whole.unplaced.gateRounds).toBe(0);

    const filtered = ready(await f.readTrack({ from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z',
      sessionRefs: [session] }));
    expect(filtered.bars.filter((bar) => bar.kind === 'check')).toHaveLength(0);
    expect(filtered.unplaced.gateRounds).toBe(1);
    expect(filtered.queriesIncluded).toBe(true);
  });

  it('2B-30 sessionRefs narrows run bars to the claiming Session', async () => {
    const f = await open(kind);
    const mine = f.computeSessionRef();
    const other = await f.newSession('2b30-other-session');
    const kept = await f.runAndEnd('work-1', mine,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.runAndEnd('work-2', other,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');

    const page = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, sessionRefs: [mine] }));
    expect(page.bars.map((bar) => (bar.kind === 'run' ? bar.runRef.runId : ''))).toEqual([kept.runId]);
    expect(page.queriesIncluded).toBe(true);
  });

  it('2B-30 a Monday-start/Wednesday-finalized round is drawn on Tuesday with its real start and finalize times', async () => {
    const f = await open(kind);
    const session = f.computeSessionRef();
    const subject = await f.runAndEnd('work-1', session,
      '2026-10-12T08:00:00.000Z', '2026-10-12T08:30:00.000Z');
    f.setClock('2026-10-12T09:00:00.000Z');
    const round = await f.beginChecks(await f.openRound(subject, 'work-1'), 2);
    f.setClock('2026-10-14T10:40:00.000Z');
    const finalized = await f.finalize(await f.interruptExecutingChecks(round));

    const page = ready(await f.readTrack({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' }));
    const bar = page.bars.find((candidate) => candidate.kind === 'check');
    expect(bar).toMatchObject({
      kind: 'check', roundRef: finalized.ref, taskId: 'work-1',
      startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-14T10:40:00.000Z',
      result: 'INCONCLUSIVE', checksBegun: 2,
    });
    expect(page.unplaced.rounds).toBe(0);
  });

  it('2B-30 a Goal-gate round with exactly one open responsible Session places the bar on it', async () => {
    const f = await open(kind);
    const producerSession = f.computeSessionRef();
    const gateSession = await f.newSession('2b30-gate-a');
    const producer = await f.runAndEnd('work-1', producerSession,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    f.setClock('2026-10-14T10:05:00.000Z');
    const gate = await f.beginChecks(await f.openGateRound(producer), 2);
    f.setClock('2026-10-14T10:40:00.000Z');
    const finalized = await f.finalize(await f.interruptExecutingChecks(gate));
    await f.linkResponsible(gateSession, 'gate-1');

    const whole = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO }));
    const bar = whole.bars.find((candidate) => candidate.kind === 'check');
    expect(bar).toMatchObject({
      kind: 'check', roundRef: finalized.ref, taskId: 'gate-1',
      sessionRef: gateSession, ownerSessionRefs: [gateSession],
    });

    const byGate = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, sessionRefs: [gateSession] }));
    expect(byGate.bars.filter((candidate) => candidate.kind === 'check')).toHaveLength(1);
    expect(byGate.unplaced.gateRounds).toBe(0);

    const byProducer = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, sessionRefs: [producerSession] }));
    expect(byProducer.bars.filter((candidate) => candidate.kind === 'check')).toHaveLength(0);
    expect(byProducer.unplaced.gateRounds).toBe(0);
  });

  it('2B-30 a Goal-gate round with two open responsible Sessions reports both sorted and no single sessionRef', async () => {
    const f = await open(kind);
    const producerSession = f.computeSessionRef();
    const gateA = await f.newSession('2b30-gate-a');
    const gateB = await f.newSession('2b30-gate-b');
    const producer = await f.runAndEnd('work-1', producerSession,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    f.setClock('2026-10-14T10:05:00.000Z');
    const gate = await f.beginChecks(await f.openGateRound(producer), 2);
    f.setClock('2026-10-14T10:40:00.000Z');
    const finalized = await f.finalize(await f.interruptExecutingChecks(gate));
    await f.linkResponsible(gateB, 'gate-1');
    await f.linkResponsible(gateA, 'gate-1');

    const whole = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO }));
    const bar = whole.bars.find((candidate) => candidate.kind === 'check');
    expect(bar).toMatchObject({
      kind: 'check', roundRef: finalized.ref, taskId: 'gate-1',
      sessionRef: null, ownerSessionRefs: [gateA, gateB],
    });

    for (const filtered of [gateA, gateB]) {
      const page = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, sessionRefs: [filtered] }));
      expect(page.bars.filter((candidate) => candidate.kind === 'check')).toHaveLength(1);
      expect(page.unplaced.gateRounds).toBe(0);
    }
    const byProducer = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, sessionRefs: [producerSession] }));
    expect(byProducer.bars.filter((candidate) => candidate.kind === 'check')).toHaveLength(0);
    expect(byProducer.unplaced.gateRounds).toBe(0);
  });

  it('2B-30 a host_instance_takeover reconciliation appears in hostRestarts once with its recordedAt', async () => {
    const f = await open(kind);
    const run = await f.runOpen('work-1', f.computeSessionRef(), '2026-10-14T10:00:00.000Z');
    await f.reconcileHostTakeover(run, '2026-10-14T10:30:00.000Z');

    const page = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO }));
    expect(page.hostRestarts).toEqual([{ at: '2026-10-14T10:30:00.000Z', approximate: true }]);
  });

  it('2B-30 a second attempt after a real TaskRequeue reports via requeue and links the first Run', async () => {
    const f = await open(kind);
    const session = f.computeSessionRef();
    const first = await f.runAndFail('work-1', session,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    const second = await f.requeueRunAndEnd('work-1', session, first,
      '2026-10-14T11:00:00.000Z', '2026-10-14T11:20:00.000Z');

    const page = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO }));
    const bars = page.bars.filter((bar) => bar.kind === 'run');
    expect(bars.map((bar) => (bar.kind === 'run' ? bar.runRef.runId : ''))).toEqual([first.runId, second.runId]);
    expect(bars[1]).toMatchObject({
      kind: 'run', runRef: second, previous: first,
      attempt: { via: 'requeue', requeue: { reason: 'S2B track system requeue' } },
    });
  });

  it('2B-30 sessionRefs reads the secretary turn and the readonly consultation, excluding other-goal queries', async () => {
    const f = await open(kind);
    const asked = f.computeSessionRef();
    f.setClock('2026-10-14T10:00:00.000Z');
    const turn = await f.submitAndFinishQuery(asked, f.goalRef.goalId, 'secretary');
    f.setClock('2026-10-14T10:30:00.000Z');
    await f.submitAndFinishQuery(asked, 'b2-second-goal', 'other-goal');
    const copy = await f.newReadonlyCopy(asked, 's2b-track-consultation-message');
    f.setClock('2026-10-14T11:00:00.000Z');
    const consultation = await f.submitAndFinishQuery(copy, f.goalRef.goalId, 'consultation');

    const withRefs = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO, sessionRefs: [asked] }));
    expect(withRefs.queriesIncluded).toBe(true);
    const queries = withRefs.bars.filter((bar) => bar.kind === 'query');
    expect(queries).toHaveLength(2);
    const turnBar = queries.find((bar) => bar.kind === 'query' && bar.via === 'turn');
    const consultationBar = queries.find((bar) => bar.kind === 'query' && bar.via === 'consultation');
    expect(turnBar).toMatchObject({
      kind: 'query', queryRunRef: turn, sessionRef: asked, askedSessionRef: null, via: 'turn',
      startAt: '2026-10-14T10:00:00.000Z', endAt: '2026-10-14T10:00:00.000Z', result: 'answered',
    });
    expect(consultationBar).toMatchObject({
      kind: 'query', queryRunRef: consultation, sessionRef: copy, askedSessionRef: asked, via: 'consultation',
      startAt: '2026-10-14T11:00:00.000Z', endAt: '2026-10-14T11:00:00.000Z', result: 'answered',
    });

    const without = ready(await f.readTrack({ from: DAY_FROM, to: DAY_TO }));
    expect(without.queriesIncluded).toBe(false);
    expect(without.bars.filter((bar) => bar.kind === 'query')).toHaveLength(0);
  });
});
