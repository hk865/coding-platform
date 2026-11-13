/**
 * PL-48 (v4 §15-48): the changed-lines 2x line and the growth 2x line.
 *
 * Task A is `small` with `estimatedLines:10`. A's first Run reports 1.2M growth
 * (reminder only); its second Run edits 21 real lines and raises the task growth
 * to 2.1M. Both `growth` and `lines` deviations are sent once on the same plan
 * revision, the adviser's plain-text answers make two `plan_notice` items, and
 * a separate 20-line Run (exactly the 2x boundary) sends no `lines` round.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { advanceUntil, post } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import {
  openPLDeviationConsumptionWorld, runSoftLineDeviationPair, type PLDeviationConsumptionWorld,
} from '../helpers/PL-deviation-fixture.js';

const opened: PLDeviationConsumptionWorld[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close().catch(() => undefined); });

const LINES_20 = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join('\n');

async function step(world: PLDeviationConsumptionWorld, flowId: string, kind: string) {
  return await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
    flowId, sessionHint: null, kind: 'select_work' }, kind);
}

it('PL-48: growth and lines coexist on one plan revision, each once, and the text answer reaches the person', async () => {
  const fixture = opened[0] = await openPLDeviationConsumptionWorld({
    label: 'pl48', taskIds: ['pl48-a', 'pl48-b'], write: true, checks: true,
    sizes: [{ taskId: 'pl48-a', sizeClass: 'small', estimatedLines: 10 },
      { taskId: 'pl48-b', sizeClass: 'small' }],
  });
  const { world, goal, tasks, line, adviser } = fixture;
  const [a, b] = tasks;
  if (a === undefined || b === undefined) throw new Error('PL-48: the Plan needs two Tasks');

  // Task B: 1.2M growth is the reminder line only.
  await fixture.runTask({ line, taskId: b.taskId, flowId: 'pl48-b1', replies: [
    { kind: 'calls', calls: [{ callId: 'pl48-b-read', name: 'read', args: { path: 'src/module.ts' } }], usage: usage(0, 0) },
    { kind: 'calls', calls: [{ callId: 'pl48-b-read2', name: 'read', args: { path: 'src/module.ts' } }], usage: usage(1_200_000, 0) },
    { kind: 'text', text: 'PL-48 B done', usage: usage(0, 0) },
  ] });
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE,
    await step(fixture, 'pl48-notify', 'notify_plan_reminder'))), 'the PL-48 reminder');
  const inbox = ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
    plain(S6A_SCOPE, { recipient: adviser.ref, page: { limit: 50 } })), 'the adviser inbox');
  expect(inbox.items.filter(message => message.intent === 'notify')).toHaveLength(1);

  // Task A: 21 real edited lines and 2.1M growth in one normally ended Run.
  const pair = await runSoftLineDeviationPair(fixture, {
    taskId: a.taskId, flowId: 'pl48-a1', path: 'pl48-lines.txt', prefix: 'PL-48',
  });
  expect(pair.growthMessage.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
  expect(pair.linesMessage.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
  expect(await readBody(world, pair.linesRef, 'message')).toContain('pl48-lines.txt');

  // Both kinds stay on revision 2 and each produces its own person notice.
  const queue = await fixture.main.readNotices({ goal, categories: ['plan_notice'], limit: 100 });
  const keys = queue.notices.map(notice => notice.itemKey);
  expect(keys).toContain(`deviation-notice:${goal.goalId}:deviation:${goal.goalId}:${a.taskId}:growth:2`);
  expect(keys).toContain(`deviation-notice:${goal.goalId}:deviation:${goal.goalId}:${a.taskId}:lines:2`);
  expect(keys.filter(key => key === `deviation-notice:${goal.goalId}:deviation:${goal.goalId}:${a.taskId}:growth:2`))
    .toHaveLength(1);
  const lineNotice = queue.notices.find(notice =>
    notice.itemKey === `deviation-notice:${goal.goalId}:deviation:${goal.goalId}:${a.taskId}:lines:2`);
  expect(lineNotice?.summary).toContain(pair.linesAnswer);

  // 20 edited lines are exactly 2 x 10: no lines round.
  const boundary = opened[1] = await openPLDeviationConsumptionWorld({
    label: 'pl48b', taskIds: ['pl48-c'], write: true, checks: true,
    sizes: [{ taskId: 'pl48-c', sizeClass: 'small', estimatedLines: 10 }],
  });
  const c = boundary.tasks[0];
  if (c === undefined) throw new Error('PL-48: the boundary Plan needs its Task');
  await boundary.runTask({ line: boundary.line, taskId: c.taskId, flowId: 'pl48-c1', replies: [
    { kind: 'calls', calls: [{ callId: 'pl48-c-edit', name: 'edit',
      args: { mode: 'create', path: 'pl48-boundary.txt', newText: LINES_20 } }] },
    { kind: 'text', text: 'PL-48 C done', usage: usage(0, 0) },
  ] });
  const boundaryLines = systemRoundMessageRef(S6A_SCOPE, `deviation:${boundary.goal.goalId}:${c.taskId}:lines:2`);
  if (boundaryLines.status !== 'ready') throw new Error('PL-48: no boundary lines ref');
  expect((await boundary.world.post('messages/read', plain(S6A_SCOPE, boundaryLines.value))).body)
    .toMatchObject({ status: 'not_found' });
  const next = await post(boundary.world.ag2b, 'workflow/advance', plain(S6A_SCOPE, {
    schemaVersion: 1, goalRef: boundary.goal, flowId: 'pl48-c2', sessionHint: null, kind: 'select_work' }));
  expect(JSON.stringify(next)).not.toContain(`deviation:${boundary.goal.goalId}:${c.taskId}:lines`);
}, 240_000);

const LONG_PATH_COUNT = 500;
const LONG_PATH_BYTES = 141;
const LONG_PATH_STEM = 'x'.repeat(120);

function longChangedPath(index: number): string {
  return `src/pl48-cap-${String(index).padStart(3, '0')}-${LONG_PATH_STEM}.txt`;
}

it('PL-48: 500 long changed-file paths keep the growth round sendable and omit the tail', async () => {
  const fixture = opened[0] = await openPLDeviationConsumptionWorld({
    label: 'pl48cap', taskIds: ['pl48-cap-a'], write: true, checks: true,
    sizes: [{ taskId: 'pl48-cap-a', sizeClass: 'small', estimatedLines: 10 }],
  });
  const { world, goal, tasks, line } = fixture;
  const a = tasks[0];
  if (a === undefined) throw new Error('PL-48: the cap Plan needs its Task');
  const paths = Array.from({ length: LONG_PATH_COUNT }, (_, index) => longChangedPath(index));
  expect(paths.every(path => Buffer.byteLength(path, 'utf8') === LONG_PATH_BYTES)).toBe(true);
  expect(paths.reduce((total, path) => total + Buffer.byteLength(path, 'utf8'), 0))
    .toBeGreaterThan(64 * 1024);

  // One real shell command writes the 500 real files; the real activity tally records them.
  await fixture.runTask({ line, taskId: a.taskId, flowId: 'pl48-cap-run', replies: [
    { kind: 'calls', calls: [{ callId: 'pl48-cap-read', name: 'read', args: { path: 'src/module.ts' } }],
      usage: usage(0, 0) },
    { kind: 'calls', calls: [{ callId: 'pl48-cap-write', name: 'shell',
      args: { command: `for i in $(seq -w 0 499); do printf 'changed\\n' > "src/pl48-cap-$i-${LONG_PATH_STEM}.txt"; done` } }],
      usage: usage(2_100_000, 0) },
    { kind: 'text', text: 'PL-48 cap done', usage: usage(0, 0) },
  ] });

  const ref = systemRoundMessageRef(S6A_SCOPE, `deviation:${goal.goalId}:${a.taskId}:growth:2`);
  if (ref.status !== 'ready') throw new Error('PL-48: the cap growth request id has no message ref');
  const step = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal,
    flowId: 'pl48-cap-round', sessionHint: null, kind: 'select_work' }, 'send_system_round');
  expect(JSON.stringify(step)).toContain(`deviation:${goal.goalId}:${a.taskId}:growth:2`);
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, step)), 'the 500-path growth round');

  const message = ready<SessionMessage>((await world.post('messages/read',
    plain(S6A_SCOPE, ref.value))).body, 'the 500-path growth message');
  expect(message.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
  const body = await readBody(world, ref.value, 'message');
  expect(body).toContain('changed files: 500 definite');
  expect(body).toContain('0 possible');
  const listed = paths.filter(path => body.includes(path));
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.length).toBeLessThan(paths.length);
  expect(body).toContain(`另有 ${paths.length - listed.length} 个未列出`);
  expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(64 * 1024);
}, 240_000);
