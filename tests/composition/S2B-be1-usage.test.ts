/**
 * Slice 2B BE1 acceptance row 2B-07 (spec §5.2, entry BE1).
 *
 * Usage: four scripted model requests, three report a `usage_snapshot` (hand
 * written 100/10/1, 200/20/2, 300/30/3) and one reports none. The public
 * `readRunActivities` totals are the sum of the three (600/60/6) and
 * `complete: false`, because a request without usage is unknown, never zero
 * (L3).
 */
import { afterEach, expect, it } from 'vitest';
import { createS2BBe1Platform, S2B_SLOW_TIMEOUT_MS, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

it('2B-07 sums the reported usage of three of four requests and marks the totals incomplete', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read'],
    writeScope: [],
    initialAt: '2026-10-15T10:00:00.000Z',
    workspaceFiles: { 'a.ts': 'usage\n' },
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1-usage-1', name: 'read', args: { path: 'a.ts' } }],
        usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 1, costUsdMicros: null } },
      { kind: 'calls', calls: [{ callId: 'be1-usage-2', name: 'read', args: { path: 'a.ts' } }],
        usage: { inputTokens: 200, outputTokens: 20, cachedInputTokens: 2, costUsdMicros: null } },
      // The third request reports no usage: unknown, not a zero.
      { kind: 'calls', calls: [{ callId: 'be1-usage-3', name: 'read', args: { path: 'a.ts' } }] },
      { kind: 'text', text: '2B-07 done',
        usage: { inputTokens: 300, outputTokens: 30, cachedInputTokens: 3, costUsdMicros: null } },
    ],
  });
  opened.push(f);

  await f.run('2b07');
  expect(f.scripted.calls()).toBe(4);

  const views = await f.readRuns();
  expect(views[0]).toMatchObject({
    status: 'counted',
    totals: { steps: 3, edits: 0, editsUnknown: 0 },
    usage: { inputTokens: 600, outputTokens: 60, cachedInputTokens: 6, complete: false },
  });
}, S2B_SLOW_TIMEOUT_MS);
