/**
 * PL-20 (spec §15.3): explicit usage snapshots whose last output is non-zero,
 * on the same-Session second-task public step `runS7ASameSessionAgain`.
 *
 * B reports inputs `[100,180,90,150]` and outputs `[10,10,10,20]`: cumulative
 * 570, growth 160. The single-request variant reports input 1000, output 7:
 * cumulative 1007, growth 7. Both are read through `activity/runs`.
 */
import { afterEach, expect, it } from 'vitest';
import { runS7ASameSessionAgain } from '../helpers/S7A-fixture.js';
import { openPLReadingsWorld, runView, usage, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';

const opened: PLReadingsWorld[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

/** The first task ends normally so the same Session has a pending second Task. */
async function runFirstTask(fixture: PLReadingsWorld, line: Awaited<ReturnType<PLReadingsWorld['line']>>) {
  const first = fixture.tasks[0];
  if (first === undefined) throw new Error('PL-20: the Plan needs two tasks');
  await fixture.runTask({ line, taskId: first.taskId, flowId: 'pl20-first',
    replies: [{ kind: 'text', text: 'PL-20 first task done' }] });
  return first;
}

const CASES = [
  {
    label: 'B reports cumulative 570 and growth 160 on the same-Session second task',
    taskIds: ['pl20-first', 'pl20-second'],
    line: 'pl20-line',
    replies: [
      { kind: 'calls', calls: [{ callId: 'pl20-b-1', name: 'read', args: { path: 'src/module.ts' } }],
        usage: usage(100, 10) },
      { kind: 'calls', calls: [{ callId: 'pl20-b-2', name: 'read', args: { path: 'src/module.ts' } }],
        usage: usage(180, 10) },
      { kind: 'calls', calls: [{ callId: 'pl20-b-3', name: 'read', args: { path: 'src/module.ts' } }],
        usage: usage(90, 10) },
      { kind: 'text', text: 'PL-20 B done', usage: usage(150, 20) },
    ],
    tokens: 570,
    growth: { tokens: 160, complete: true },
  },
  {
    label: 'a single-request second task reports cumulative 1007 and growth 7',
    taskIds: ['pl20-single-first', 'pl20-single-second'],
    line: 'pl20-single-line',
    replies: [
      { kind: 'text', text: 'PL-20 single answer', usage: usage(1000, 7) },
    ],
    tokens: 1007,
    growth: { tokens: 7, complete: true },
  },
] as const;

it.each(CASES)('PL-20: $label', async (row) => {
  const fixture = await openPLReadingsWorld({ taskIds: row.taskIds });
  opened.push(fixture);
  const line = await fixture.line(row.line, fixture.tasks);
  await runFirstTask(fixture, line);

  await fixture.world.scripted.script(line, row.replies);
  const { run } = await runS7ASameSessionAgain(fixture.world, line);

  const view = runView(await fixture.readRuns([run]), run);
  expect(view.status).toBe('counted');
  expect(view.readings.usage.tokens).toBe(row.tokens);
  expect(view.readings.usage.complete).toBe(true);
  expect(view.readings.usage.growth).toEqual(row.growth);
});
