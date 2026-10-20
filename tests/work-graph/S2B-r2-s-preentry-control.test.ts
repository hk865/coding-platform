/**
 * Round-2 R11 Group S: the pre-entry pause/resume of row 2B-32 fold order (a)
 * reached through the REAL public flows — a real claim (`TaskClaimPort`), real
 * `ControlIntent` submissions of the claimed-but-not-entered Run (the intent
 * machine applies them at once with a `platform_not_entered` observation,
 * CTL-02 / D-7) and a real `ExecutionEntryPort` entry — then read through the
 * public `readTaskStateTimeline`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import {
  openS2BR2TimelinePublicFixture, type S2BR2TimelinePublicFixture,
} from '../helpers/S2B-r2-timeline-public-flows.js';

const opened: S2BR2TimelinePublicFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

function spans(segments: { from: string | null; to: string | null; state: string }[]): (string | null)[][] {
  return segments.map((segment) => [segment.from, segment.to, segment.state]);
}

describe.each(['memory', 'sqlite'] as const)('S2B-r2 Group S pre-entry control (%s)', (kind) => {
  it('2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running', async () => {
    const fx = await openS2BR2TimelinePublicFixture(kind);
    opened.push(fx);
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef: GoalRef = await fx.createGoal({ goalId: 's2b-r2-preentry', workTaskIds: ['work-1'] });
    fx.setClock('2026-10-01T09:05:00.000Z');
    const claim = await fx.claimRun({ goalRef, taskId: 'work-1' });
    await fx.submitNotEnteredControl({ runRef: claim.runRef, kind: 'pause', at: '2026-10-01T09:10:00.000Z' });
    await fx.submitNotEnteredControl({ runRef: claim.runRef, kind: 'resume', at: '2026-10-01T09:20:00.000Z' });
    await fx.enterClaim(claim, '2026-10-01T09:30:00.000Z');

    const read = await fx.timeline({ goalRef, limit: 200 });
    if (read.status !== 'ready') throw new Error(`timeline not ready: ${JSON.stringify(read)}`);
    const task = read.value.tasks.find((candidate) => candidate.taskId === 'work-1');
    if (task === undefined) throw new Error('work-1 is not in the timeline page');

    expect(spans(task.segments)).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T09:10:00.000Z', 'pending'],
      ['2026-10-01T09:10:00.000Z', '2026-10-01T09:20:00.000Z', 'paused'],
      ['2026-10-01T09:20:00.000Z', '2026-10-01T09:30:00.000Z', 'pending'],
      ['2026-10-01T09:30:00.000Z', null, 'running'],
    ]);
  });
});
