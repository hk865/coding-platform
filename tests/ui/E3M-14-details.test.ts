import { afterAll, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import { hover } from './helpers/E3N-interact.js';
import {
  bootMemberAt, bootMemberOnHost, buttonText, callsOf, detailValue, elementsOf, memberSearch, openMemberW6,
  press, railRowOf, receiptBody, recordRows, settle, worldSlot,
} from './helpers/E3M-world.js';
import { bootPage } from './helpers/boot-page.js';
import { countRoute, forwardPage, gateChanges, newPageLog, quietPage, routeOf, textOf } from './helpers/E3N-page.js';
import { openPLReadingsWorld, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';

/** E3M-14 (test sheet ③④⑤): the claimed plan (B3), the same-Session
 * continuation (B4), and a selected Run's hosts read once (B6). Every state is
 * a real Host world; ⑤ forwards the sheet's two hosts on `network/read`. */

const slot = worldSlot();
let readings: { fixture: PLReadingsWorld; line: Awaited<ReturnType<PLReadingsWorld['line']>>; run: Awaited<ReturnType<PLReadingsWorld['runTask']>> } | undefined;
afterAll(async () => { await readings?.fixture.close(); await slot.close(); }, 240_000);

async function readingsWorld(): Promise<NonNullable<typeof readings>> {
  if (readings !== undefined) return readings;
  const fixture = await openPLReadingsWorld();
  const line = await fixture.line('e3m14-plan', [fixture.tasks[0]!]);
  const run = await fixture.runTask({
    line, taskId: fixture.tasks[0]!.taskId, flowId: 'e3m14-plan',
    replies: [
      { kind: 'calls', calls: [{ callId: 'e3m14-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 'E3M-14 done' },
    ],
  });
  readings = { fixture, line, run };
  return readings;
}

describe('E3M-14 the Member page’s plan, continuity and host details', () => {
  it('③ the task card names the claimed plan and no newer plan', async () => {
    const { fixture, line } = await readingsWorld();
    const booted = await bootMemberAt(fixture.world, memberSearch(fixture.goal.goalId, line.ref));
    try {
      const task = findClass(booted.page.root, 'mh-task');
      expect(task).toBeDefined();
      hover(task!);
      await settle(() => findClass(booted.page.root, 'hcard') !== undefined);
      const card = findClass(booted.page.root, 'hcard')!;
      /* 具名改坏: `claimedPlan` 回空表；本行的 dt/dd 红。 */
      expect(elementsOf(card, 'dt').map(textOf)).toEqual(['领取时用的计划']);
      expect(elementsOf(card, 'dd').map(textOf)).toEqual(['计划第 1 版']);
    } finally {
      await booted.page.restore();
    }
  }, 180_000);

  it('④ the continuation row names the same-Session history without its id', async () => {
    const w = await slot.use('W6', () => openMemberW6(), (opened) => opened.h.dispose());
    const first = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      press(buttonText(first.page.root, '重新入队'), '重新入队');
      await expect.poll(() => receiptBody(first, 'tasks/requeue') !== undefined,
        { timeout: 30_000, interval: 50 }).toBe(true);
      expect(receiptBody(first, 'tasks/requeue')?.['status']).toBe('committed');
    } finally {
      await first.page.restore();
    }
    await w.h.advance(w.h.select('clkc-p083-requeue', AG2B_WORK_TASK_ID), {
      stopBefore: (input) => input.kind === 'perform' && input.operation.kind === 'requeue_task',
    });
    const started = async (): Promise<boolean> => {
      const row = await w.h.taskRow();
      return row.attemptOrdinal === 5 && row.execution !== null;
    };
    await expect.poll(started, { timeout: 30_000, interval: 100 }).toBe(true);
    const booted = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      const brief = findClass(booted.page.root, 'brief-blk');
      expect(brief).toBeDefined();
      expect(elementsOf(brief, 'dt').map(textOf)).toEqual(['接续方式', '停下原因', '上次停在', '工作记录']);
      /* This world requeues in the same Session (its brief says
         `same_session_history`). 具名改坏: that branch writes 另开…; this row reds. */
      expect(elementsOf(brief, 'dd').map(textOf)[3]).toBe('接着原来的工作记录做，带着原来的历史');
      expect(textOf(brief)).not.toContain(w.line.sessionId);
    } finally {
      await booted.page.restore();
    }
  }, 240_000);

  it('⑤ a selected Run detail reads its hosts once and withdraws on close', async () => {
    const { fixture, line, run } = await readingsWorld();
    const other = await fixture.line('e3m14-other');
    const hosts = 'pkg.example:80、inner.example:8080（被拦，127.0.0.1）';
    const log = newPageLog();
    gateChanges(log);
    const forward = forwardPage(fixture.world, log, 'controlled');
    const page = await bootPage({ name: 'Member', search: memberSearch(fixture.goal.goalId, line.ref),
      token: () => fixture.world.token, request: async (url, init, realFetch) => routeOf(url) === 'network/read'
        ? forward(url, init, async () => new Response(JSON.stringify({ status: 'ready', value: { hosts: [
          { host: 'pkg.example', port: 80, address: '93.184.216.34', verdict: 'allowed', firstAt: '2026-10-27T10:00:00.000Z' },
          { host: 'inner.example', port: 8080, address: '127.0.0.1', verdict: 'refused', firstAt: '2026-10-27T10:01:00.000Z' },
        ], omitted: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
        : forward(url, init, realFetch) });
    try {
      const row = recordRows(page.root).find((entry) => textOf(entry).startsWith('工作记录 ·'));
      press(row, 'the Run record row');
      await settle(() => (detailValue(page.root, '关系') ?? '').includes('连过的主机'), 10_000);
      /* 具名改坏: the board does not send `memberRunHosts`; this relation reds. */
      expect((detailValue(page.root, '关系') ?? '').replace(/\s+/g, ''))
        .toBe('连过的主机' + hosts + '还没接通');
      const calls = callsOf(log, 'network/read');
      expect(calls.map((call) => call.input)).toEqual([{ subject: run }]);
      press(findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '关闭详情'), '关闭详情');
      await settle(() => findClass(page.root, 'detail') === undefined);
      await quietPage(log);
      /* 具名改坏: closing re-asks for the same Run; this count reds. */
      expect(countRoute(log, 'network/read')).toBe(1);
      /* B6's withdrawal also holds when the left rail opens another line
         while a Run detail is open: the old Run's demand goes away, and coming
         back shows no stale detail. Reopen the detail first (a second legit
         read), then switch lines and back without closing it. */
      press(recordRows(page.root).find((entry) => textOf(entry).startsWith('工作记录 ·')), 'the Run record row');
      await settle(() => (detailValue(page.root, '关系') ?? '').includes('连过的主机'), 10_000);
      await quietPage(log);
      expect(countRoute(log, 'network/read')).toBe(2);
      press(await railRowOf(page.root, fixture.world, other.ref), 'the other line row');
      await settle(() => findClass(page.root, 'lv-acts') !== undefined, 10_000);
      await quietPage(log);
      /* 具名改坏: `openLine` keeps `memberRunHosts`; this re-asks the old Run. */
      expect(countRoute(log, 'network/read')).toBe(2);
      press(await railRowOf(page.root, fixture.world, line.ref), 'the executor line row');
      await settle(() => findClass(page.root, 'mh-acts') !== undefined, 10_000);
      await quietPage(log);
      expect(countRoute(log, 'network/read')).toBe(2);
      expect(findClass(page.root, 'detail')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 240_000);
});
