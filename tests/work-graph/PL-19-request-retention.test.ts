/**
 * PL-19 (spec §15.3): one Run past the 256-request retention cap.
 *
 * The i-th request reports `input=i`, `output=1`. 256 requests keep every
 * request: cumulative 33,152, growth 256, complete, omitted 0. 257 requests
 * keep the first 256: cumulative still 33,152 but incomplete, growth null
 * incomplete, omitted 1. The cumulative run limits are cleared to `null`
 * (unlimited; numbers are forbidden here); the world is built by the PC Work
 * fixture through the public platform steps.
 */
import { afterEach, expect, it } from 'vitest';
import type { RunActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { openPCWorkFixture, scriptedModel, type PCReply } from '../helpers/PC-platform-fixture.js';
import { runView, usage } from '../helpers/PL-readings-fixture.js';

const opened: Array<Awaited<ReturnType<typeof openPCWorkFixture>>> = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const CASES = [
  { label: '256 requests keep every request', count: 256, growth: { tokens: 256, complete: true },
    complete: true, omitted: 0 },
  { label: '257 requests omit the last request', count: 257, growth: { tokens: null, complete: false },
    complete: false, omitted: 1 },
] as const;

it.each(CASES)('PL-19: $label — cumulative 33,152, growth/complete/omitted as the cap', async (row) => {
  const taskId = `pl19-${String(row.count)}`;
  const replies: PCReply[] = Array.from({ length: row.count }, (_unused, index) => {
    const request = index + 1;
    return request === row.count
      ? { text: `PL-19 done ${String(row.count)}`, usage: usage(request, 1) }
      : { toolCalls: [{ callId: `${taskId}-${String(request)}`, name: 'read',
        arguments: { path: 'wp2-read.txt' } }], usage: usage(request, 1) };
  });
  const fixture = await openPCWorkFixture({
    model: scriptedModel(replies), tools: ['read'],
    budget: { maxRequests: null, maxToolCalls: null, timeoutMs: null },
  });
  opened.push(fixture);

  await fixture.work.prepare();
  const started = await fixture.work.start();
  if (started.status !== 'ready') throw new Error(`PL-19 start: ${JSON.stringify(started)}`);
  const runRef = fixture.base.runRef;
  if (runRef === null) throw new Error('PL-19: the PC work fixture claimed no Run');
  const read = await fixture.base.platform.activity.readRunActivities(fixture.base.ctx, { runRefs: [runRef] });
  if (read.status !== 'ready') throw new Error(`PL-19 activity read: ${JSON.stringify(read)}`);

  const view: RunActivityViewV1 = runView(read.value, runRef);
  expect(view.status).toBe('counted');
  expect(view.readings.usage.tokens).toBe(33_152);
  expect(view.readings.usage.growth).toEqual(row.growth);
  expect(view.readings.usage.complete).toBe(row.complete);
  expect(view.usage?.omitted).toBe(row.omitted);
}, 180_000);
