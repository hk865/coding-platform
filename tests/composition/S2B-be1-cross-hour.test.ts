/**
 * Slice 2B BE1 acceptance row 2B-05 (spec §5.2, entry BE1).
 *
 * One Run spans 10:40–12:10; the only replaced clock moves between scripted
 * model replies, so the four tool calls start at 10:44, 10:46, 11:20 and 12:05.
 * The hour calendar reads 10:00 = 2, 11:00 = 1, 12:00 = 1: the 10:30 and 10:45
 * fifteen-minute quarters merge into the 10:00 cell (L2, decision 50).
 */
import { afterEach, expect, it } from 'vitest';
import { createS2BBe1Platform, S2B_SLOW_TIMEOUT_MS, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

it('2B-05 buckets four cross-hour tool calls by their start hour and merges the 15-minute quarters', async () => {
  const reads = ['read a.ts', 'read a.ts', 'read a.ts', 'read a.ts'];
  const f = await createS2BBe1Platform({
    toolNames: ['read'],
    writeScope: [],
    initialAt: '2026-10-15T10:40:00.000Z',
    workspaceFiles: { 'a.ts': 'cross hour\n' },
    beforeReply: async (_request, index) => {
      const at = ['2026-10-15T10:44:00.000Z', '2026-10-15T10:46:00.000Z',
        '2026-10-15T11:20:00.000Z', '2026-10-15T12:05:00.000Z', '2026-10-15T12:10:00.000Z'][index];
      if (at !== undefined) f.setClock(at);
    },
    scriptedReplies: [
      ...reads.map((_, index) => ({ kind: 'calls' as const,
        calls: [{ callId: `be1-cross-${index + 1}`, name: 'read', args: { path: 'a.ts' } }] })),
      { kind: 'text', text: '2B-05 done' },
    ],
  });
  opened.push(f);

  const record = await f.run('2b05');
  expect(record.run.status).toBe('ended');
  expect(record.run.startedAt).toBe('2026-10-15T10:40:00.000Z');
  expect(record.run.endedAt).toBe('2026-10-15T12:10:00.000Z');

  const views = await f.readRuns();
  expect(views[0]).toMatchObject({ status: 'counted', totals: { steps: 4, edits: 0, editsUnknown: 0 } });

  const calendar = await f.calendar({ from: '2026-10-15T10:00:00.000Z', to: '2026-10-15T13:00:00.000Z',
    granularity: 'hour', timeZone: 'UTC' });
  const byHour = new Map(calendar.cells.map(cell => [cell.localHour, cell]));
  // 10:44 (quarter 10:30) and 10:46 (quarter 10:45) merge into the 10:00 cell.
  expect(byHour.get(10)).toMatchObject({ localDate: '2026-10-15', steps: 2, edits: 0, editsUnknown: 0, complete: true });
  expect(byHour.get(11)).toMatchObject({ steps: 1, complete: true });
  expect(byHour.get(12)).toMatchObject({ steps: 1, complete: true });
  expect(calendar.totals).toMatchObject({ steps: 4, edits: 0, editsUnknown: 0, complete: true });
}, S2B_SLOW_TIMEOUT_MS);
