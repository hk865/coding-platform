/**
 * PL-19 (spec §15.3): one Run past the 256-request retention cap.
 *
 * The i-th request reports `input=i`, `output=1`. 256 requests keep every
 * request: cumulative 33,152, growth 256, complete, omitted 0. 257 requests
 * keep the first 256: cumulative still 33,152 but incomplete, growth null
 * incomplete, omitted 1. The cumulative run limits are cleared to `null`
 * (unlimited; numbers are forbidden here); the world is built by
 * `PL-readings-fixture.ts` through the public steps.
 */
import { afterEach, expect, it } from 'vitest';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { openPLReadingsWorld, runView, usage, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';

const opened: PLReadingsWorld[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const CASES = [
  { label: '256 requests keep every request', count: 256, growth: { tokens: 256, complete: true },
    complete: true, omitted: 0 },
  { label: '257 requests omit the last request', count: 257, growth: { tokens: null, complete: false },
    complete: false, omitted: 1 },
] as const;

it.each(CASES)('PL-19: $label — cumulative 33,152, growth/complete/omitted as the cap', async (row) => {
  const taskId = `pl19-${String(row.count)}`;
  const fixture = await openPLReadingsWorld({ taskIds: [taskId], unlimitedRunLimits: true });
  opened.push(fixture);
  const task = fixture.tasks[0];
  if (task === undefined) throw new Error('PL-19: the Plan needs one task');
  const line = await fixture.line(`pl19-${String(row.count)}`, [task]);

  const replies: S6AReply[] = Array.from({ length: row.count }, (_unused, index) => {
    const request = index + 1;
    return request === row.count
      ? { kind: 'text' as const, text: `PL-19 done ${String(row.count)}`, usage: usage(request, 1) }
      : { kind: 'calls' as const, calls: [{ callId: `${taskId}-${String(request)}`, name: 'read',
        args: { path: 'src/module.ts' } }], usage: usage(request, 1) };
  });
  const run = await fixture.runTask({ line, taskId, flowId: taskId, replies });

  const view = runView(await fixture.readRuns([run]), run);
  expect(view.status).toBe('counted');
  expect(view.readings.usage.tokens).toBe(33_152);
  expect(view.readings.usage.growth).toEqual(row.growth);
  expect(view.readings.usage.complete).toBe(row.complete);
  expect(view.usage?.omitted).toBe(row.omitted);
}, 180_000);
