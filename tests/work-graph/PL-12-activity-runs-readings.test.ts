/**
 * PL-12 (spec §15.3): the three readings on `activity/runs`.
 *
 * Run U reports usage `(100,10)`, unknown, `(150,20)`: cumulative 280 (not
 * complete) and growth 20 (not complete). Run S creates two lines with a
 * confirmed `edit` and is then modified through `shell`: added 2, deleted 0,
 * not complete. The values are the ruling's literals, never read back from the
 * system.
 *
 * The world and its real Work write/shell grant are built by
 * `PL-readings-fixture.ts` through the public steps.
 */
import { afterEach, expect, it } from 'vitest';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { openPLReadingsWorld, runView, usage, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';

const opened: PLReadingsWorld[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

it('PL-12: activity/runs reports U cumulative 280 incomplete with growth 20 incomplete, and S added 2 incomplete', async () => {
  const fixture = await openPLReadingsWorld({ taskIds: ['pl12-u', 'pl12-s'] });
  opened.push(fixture);
  const [uTask, sTask] = fixture.tasks;
  if (uTask === undefined || sTask === undefined) throw new Error('PL-12: the Plan needs two tasks');
  const uLine = await fixture.line('pl12-u', [uTask]);
  const sLine = await fixture.line('pl12-s', [sTask]);

  const uReplies: S6AReply[] = [
    { kind: 'calls', calls: [{ callId: 'pl12-u-1', name: 'read', args: { path: 'src/module.ts' } }],
      usage: usage(100, 10) },
    // No usage snapshot: this request is unknown, not zero.
    { kind: 'calls', calls: [{ callId: 'pl12-u-2', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 'PL-12 U done', usage: usage(150, 20) },
  ];
  const runU = await fixture.runTask({ line: uLine, taskId: uTask.taskId, flowId: 'pl12-u', replies: uReplies });

  const sReplies: S6AReply[] = [
    { kind: 'calls', calls: [{ callId: 'pl12-s-create', name: 'edit',
      args: { mode: 'create', path: 'pl12-two-lines.txt', newText: 'first line\nsecond line' } }] },
    { kind: 'calls', calls: [{ callId: 'pl12-s-shell', name: 'shell',
      args: { command: 'printf "third line\\n" > pl12-two-lines.txt' } }] },
    { kind: 'text', text: 'PL-12 S done' },
  ];
  const runS = await fixture.runTask({ line: sLine, taskId: sTask.taskId, flowId: 'pl12-s', replies: sReplies });

  const views = await fixture.readRuns([runU, runS]);
  const u = runView(views, runU);
  const s = runView(views, runS);

  expect(u.status).toBe('counted');
  expect(u.readings.usage.tokens).toBe(280);
  expect(u.readings.usage.complete).toBe(false);
  expect(u.readings.usage.growth).toEqual({ tokens: 20, complete: false });
  expect(u.readings.usage.reason).toBeNull();
  expect(u.usage).toMatchObject({ omitted: 0 });

  expect(s.status).toBe('counted');
  expect(s.readings.lines).toEqual({ added: 2, deleted: 0, complete: false, reason: null });
});
