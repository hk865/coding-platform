/**
 * Slice 2C §3.4 AT4 / §3.12 (LE3): a currently-responsible Task that carries an
 * unclaimed anomaly anchor makes its line read attention `unknown`
 * (`anomaly_pending`), and a failed anchor read marks the attention incomplete
 * instead of "no anchor".
 *
 * The anchor is written by the real WorkGraph archive step (`recordSessionAnomaly`
 * through `requestSessionArchive`); the line reader is the public
 * `WorkLineReadPort`. Assertions read only the public port.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { LineRowV1 } from '../../src/contracts/work-line.js';
import { openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { completedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

describe.each(['memory', 'sqlite'] as const)('2C AT4 unclaimed task anchors (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }
  async function rowOfHead(f: LineFixture, head: SessionRef): Promise<LineRowV1 | undefined> {
    return rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
  }

  it('a line that now owns a Task with an unclaimed anchor reads unknown / anomaly_pending', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g-anchor', [{ taskId: 't', title: 'T task' }]);
    // A real Run of the Task ends and the archive step writes its anchor.
    const writer = (await f.createSession('s-anchor-writer')).ref;
    const claim = await f.claim('t', writer, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, completedEvent(claim.claim, 'g-anchor'));
    await f.writeAnchors(writer, [claim.runRef], 'g-anchor');

    // Another line now owns the same Task; the anchor was never picked up.
    const head = (await f.createSession('s-anchor-owner')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['t']! }, 'responsible', true);

    const row = await rowOfHead(f, head);
    expect(row?.status.attention?.code).toBe('unknown');
    expect(row?.status.attention?.reason.code).toBe('anomaly_pending');
    expect(row?.status.attentionCounts.unknown).toBe(1);
    expect(row?.status.bucket).toBe('standby');
  });

  it('a written-anchor attention uses the authoritative archive-state next, not a guessed dispatch', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g-anchor-next', [{ taskId: 't', title: 'T task' }]);
    const writer = (await f.createSession('s-anchor-next')).ref;
    const claim = await f.claim('t', writer, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, completedEvent(claim.claim, 'g-anchor-next'));
    await f.writeAnchors(writer, [claim.runRef], 'g-anchor-next');
    // The Goal stops after the anchor was written: the authoritative next is goal_stopped.
    await f.setGoalDesired(goal.goalRef, 'paused');

    const row = await rowOfHead(f, writer);
    expect(row?.status.attention?.code).toBe('unknown');
    expect(row?.status.attention?.reason.code).toBe('anomaly_pending');
    expect(row?.status.attention?.reason.params).toMatchObject({ next: 'goal_stopped', goal: 'paused' });
  });
});
