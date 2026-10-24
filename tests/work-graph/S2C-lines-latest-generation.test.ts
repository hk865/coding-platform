/**
 * Slice 2C row 2C-37 (LE3): the latest Work execution and the latest Query by
 * generation (L4, L20, §3.2, §3.8).
 *
 * Work claims run through the real `TaskClaimPort` with an injected clock and
 * id sequence; the QueryRuns through the real Query owners. Assertions read the
 * public line name, which is where both picks become visible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { lineReaderOver, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { completedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

describe.each(['memory', 'sqlite'] as const)('2C-37 latest work and latest Query by generation (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-37 (1) the executor line names the third claim even with reversed clocks and refKeys', async () => {
    const f = await lineFixture();
    const work = await f.addGoal('g37-work', [
      { taskId: 't1', title: 'T1 task' }, { taskId: 't2', title: 'T2 task' }, { taskId: 't3', title: 'T3 task' },
    ]);
    const session = (await f.createSession('s37-exec')).ref;
    let seed = 0;
    const gen = (prefix: string) => () => `s2c-l-${prefix}-${++seed}`;
    const run = async (taskId: string, at: string, prefix: string) => {
      const claimed = await f.claimWith(taskId, session, { goal: work, now: () => at, newId: gen(prefix) });
      await f.runs.enter(claimed.claim);
      await f.runs.recordResult(claimed.claim, completedEvent(claimed.claim, taskId));
      return claimed;
    };
    await run('t1', '2026-01-02T00:00:00.000Z', 'z');
    await run('t2', '2026-01-02T00:00:00.000Z', 'm');
    await run('t3', '2026-01-01T00:00:00.000Z', 'a');

    // A Query afterwards moves `lastExecutionRef` to the QueryRun, so the
    // latest Work must come from the generation-ordered claim index (L4).
    const queryGoal = await f.runs.bareGoal('g37-q');
    const queryRun = await f.runs.claimQuery(session, queryGoal, 'exec');
    await f.runs.completeConsultation(queryRun, session, 'answered', 'exec');

    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, session);
    expect(row?.name.source).toBe('recent_task');
    expect(row?.name.primary).toBe('T3 task');
  });

  it('2C-37 (2) the secretary goalRef follows the latest Query generation despite reversed clocks and refKeys', async () => {
    // The Sessions' creation instants are fixed (the fixture's two, then this one a second later), so the secretary
    // number below never depends on two creations landing in the same millisecond.
    vi.useFakeTimers({ toFake: ['Date'] });
    let f: LineFixture;
    let session: SessionRef;
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      f = await lineFixture();
      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      // The injected duty resolver reports this Work-capable Session as secretary.
      session = (await f.createSession('s37-sec')).ref;
    } finally {
      vi.useRealTimers();
    }
    const g1 = await f.runs.bareGoal('g37-g1');
    const g2 = await f.runs.bareGoal('g37-g2');
    const q1 = await f.runs.claimQuery(session, g1, 'sec1');
    await f.runs.completeConsultation(q1, session, 'answered', 'sec1', '2026-01-02T00:00:00.000Z');
    const q2 = await f.runs.claimQuery(session, g2, 'sec2');
    await f.runs.completeConsultation(q2, session, 'answered', 'sec2', '2026-01-01T00:00:00.000Z');
    // A finished Work claim makes `lastExecutionRef` a Run, so the latest Query
    // must come from the generation-ordered Query index (L4).
    const claimed = await f.claimWith('implement-a', session, { now: () => '2026-01-03T00:00:00.000Z' });
    await f.runs.enter(claimed.claim);
    await f.runs.recordResult(claimed.claim, completedEvent(claimed.claim, 'sec-work'));

    const reader = lineReaderOver(f.base, f.records, () => 'secretary');
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, session);
    expect(row?.name.source).toBe('secretary_ordinal');
    // Every Session reads as a secretary here: the fixture's two Sessions come first.
    expect(row?.name.primary).toBe('秘书 3');
    expect(row?.name.goalRef).toEqual(g2);
    expect(row?.name.complete).toBe(true);
  });

  // L10 / review item 4b: a Run that has neither startedAt nor endedAt (the real
  // `starting` occupancy here) must take its activity time from the claim the
  // read model now reads, not fall back to the Session's createdAt.
  it('L10 (review item 4b) a run with no start or end time takes its activity from the claim', async () => {
    const f = await lineFixture();
    const work = await f.addGoal('g37-claimtime', [{ taskId: 'w', title: 'W task' }]);
    const session = (await f.createSession('s37-claimtime')).ref;
    const at = '2027-06-01T12:00:00.000Z';
    await f.claimWith('w', session, { goal: work, now: () => at });
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, session);
    expect(row?.status.own).toBe('starting');
    expect(row?.lastActivityAt).toBe(at);
  });
});
