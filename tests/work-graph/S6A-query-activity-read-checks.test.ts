/**
 * L9/L16: the workspace calendar counts verification checks as a Goal's
 * calendar does: a round's begun checks fall in the cell of the round's start,
 * on the round's task and Goal.
 *
 * Data: the activity fixture (`S2B-activity-fixture.ts`): a real claim, entry
 * and end of the subject Run, then the real verification owner opens a round on
 * it and begins its checks; no check command runs. Assertions read only the
 * public `readActivityCalendar`; every expected number is hand-computed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { openS2BActivityFixture, type S2BActivityFixture } from '../helpers/S2B-activity-fixture.js';

const opened: S2BActivityFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function openActivityFixture(kind: 'memory' | 'sqlite'): Promise<S2BActivityFixture> {
  const fixture = await openS2BActivityFixture(kind);
  opened.push(fixture);
  return fixture;
}

function calendarValue(result: ReadResult<ActivityCalendarV1>): ActivityCalendarV1 {
  if (result.status !== 'ready') throw new Error(`calendar read failed: ${JSON.stringify(result)}`);
  return result.value;
}

function cellAt(value: ActivityCalendarV1, localHour: number) {
  const cell = value.cells.find((candidate) => candidate.localHour === localHour);
  if (cell === undefined) throw new Error(`no cell for local hour ${String(localHour)}`);
  return cell;
}

describe.each(['memory', 'sqlite'] as const)('the workspace calendar\'s checks (%s)', (kind) => {
  it('counts a round\'s begun checks at the round start, on its task and Goal', async () => {
    const f = await openActivityFixture(kind);
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', session, '2026-10-14T09:50:00.000Z', '2026-10-14T10:00:00.000Z');
    // The round starts at 10:05 and three of its checks begin.
    f.setClock('2026-10-14T10:05:00.000Z');
    const round = await f.openRound(run, 'work-1');
    await f.beginChecks(round, 3);

    f.setClock('2026-10-14T13:00:00.000Z');
    const workspace = calendarValue(await f.model.readActivityCalendar(f.ctx, {
      scope: { kind: 'workspace' }, from: '2026-10-14T00:00:00.000Z', to: '2026-10-14T18:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    }));
    expect(cellAt(workspace, 10)).toMatchObject({
      checks: 3,
      tasks: [{ taskId: 'work-1', goalId: f.goalRef.goalId, steps: 0, edits: 0, checks: 3 }], moreTasks: 0,
    });
    expect(workspace.totals.checks).toBe(3);
  });
});
