import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyRows, bootDone, DONE_NO_PLAN_GOAL_ID, DONE_SAMPLE_TEXTS, openDoneDeliveryWorld, openDoneNoGateWorld,
  openDoneNoGoalWorld, openDoneNoPlanWorld, openDoneTerminalOnlyWorld, openDoneUndrivenGateWorld, openRow, openSection,
  rowMain, sectionSum,
} from './helpers/E3DN-done-world.js';
import { bootPage, findAllClass, findButton, findClass, findLink } from './helpers/boot-page.js';
import { press, settle, worldSlot } from './helpers/E3M-world.js';
import { click, notConnected } from './helpers/E3N-interact.js';
import { dlElement } from './helpers/E3C-world.js';
import { openW2 } from './helpers/E3N-world.js';
import { bootE3N, countRoute, hasClass, textOf } from './helpers/E3N-page.js';

/**
 * E3DN-7 D16–D17b (test sheet §2.6, R5): the empty states are sentences, not
 * errors and not the prototype's goal 1; `verification/round`'s `not_found`
 * is a Goal gate without a round; a first `verification/round` that fails on
 * the network shows the base's error and retry, and the retry reads again.
 * ② is a world whose Goals are all terminal (goal 1 completed, goal 2
 * cancelled), opened without `?goal=`.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

describe('E3DN-7 empty states and a failed read', () => {
  it.each([
    { entry: '① 没有目标', sentence: '还没有目标' },
    { entry: '② 只有终态的目标', sentence: '选一个已完成的目标查看交付' },
    { entry: '③ 没有采用计划', sentence: '这个目标还没有采用的计划。' },
    { entry: '④ 没有 gate', sentence: '还没有验收轮次' },
  ])('D16 $entry: $sentence', async ({ entry, sentence }) => {
    const done = await slot.use(entry, () => (entry.startsWith('①') ? openDoneNoGoalWorld()
      : entry.startsWith('②') ? openDoneTerminalOnlyWorld()
        : entry.startsWith('③') ? openDoneNoPlanWorld() : openDoneNoGateWorld()), (world) => world.close());
    const goalId = entry.startsWith('③') ? DONE_NO_PLAN_GOAL_ID : entry.startsWith('④') ? done.goal!.goalId : null;
    const { page } = await bootDone(done.world, goalId);
    try {
      await settle(() => textOf(page.root).includes(sentence), 10_000);
      /* 具名改坏: ① 无目标时落回样例目标；② 有目标但没得选时写“还没有目标”；③ 无计划时当首读错误；
         ④ 无 gate 时落回样例交付——各自只让本条目红。 */
      expect(textOf(page.root)).toContain(sentence);
      expect(findButton(page.root, '重试')).toBeUndefined();
      for (const sample of DONE_SAMPLE_TEXTS) expect(textOf(page.root)).not.toContain(sample);
      if (entry.startsWith('②')) expect(textOf(page.root)).not.toContain('还没有目标');
      /* 具名改坏: D 为 null 时五段段头写 `0 个文件` / `以后再做 0 项` / `0 token`；本行红。
         具名改坏: no_plan 的段头再写一遍空态句；③ 红。 */
      if (entry.startsWith('①') || entry.startsWith('②')) {
        for (const name of ['验收要求与证据', '改动的文件', '没有做的', '返工与接续', '用量']) {
          expect(sectionSum(page.root, name), name).toBe('');
        }
      }
      if (entry.startsWith('③')) expect(sectionSum(page.root, '验收要求与证据')).toBe('');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D20 a Done page without a token mounts the prototype sample', async () => {
    /* The working copy's sample branch keeps the prototype's sample values (§2.1);
       without them `sc-for list="{{inboxRows}}"` runs `''.forEach` and throws. */
    const page = await bootPage({ name: 'Done', token: null,
      request: async () => new Response('{}', { status: 404 }) });
    try {
      expect(page.pageFetches()).toBe(1);
      const text = page.root.textContent;
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('状态机可靠性改造');
      expect(text).not.toContain('{{');
      expect(text).not.toContain('undefined');
      /* 具名改坏: 样例 gb 不给 `decideHref`；N31 的 href 为空，红。 */
      expect(findLink(page.root, '需要你决定')?.getAttribute('href')).toBe('Main.dc.html');
    } finally {
      await page.restore();
    }
  }, 30_000);

  it('D22 a data-branch archived line row carries the three unconnected marks', async () => {
    /* E3N W2 has one archived line; the Done page's own archived read (§2.12) fills the rail from it. */
    const world = await slot.use('archived', () => openW2(), (opened) => opened.world.close());
    const { page, log } = await bootE3N(world.world, 'Done', { mode: 'controlled', gate: true });
    try {
      await settle(() => findClass(page.root, 'rail-arch') !== undefined, 10_000);
      press(findClass(page.root, 'rail-arch'), '已归档');
      await settle(() => findAllClass(page.root, 'rail-arch-ln').length > 0, 10_000);
      const rows = findAllClass(page.root, 'rail-arch-ln');
      expect(rows.length).toBeGreaterThan(0);
      /* 具名改坏: 归档行缺 title/aria 或用活跃线的 `row wl-row lv-line`；本行红。 */
      const before = log.calls.length;
      for (const row of rows) {
        notConnected(row);
        expect(hasClass(row, 'rail-arch-ln')).toBe(true);
        expect(hasClass(row, 'wl-row')).toBe(false);
      }
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 30_000);

  it('D17 a goal gate without a round: verification/round not_found is 还没有验收轮次, not an error', async () => {
    const done = await slot.use('undriven', () => openDoneUndrivenGateWorld(), (world) => world.close());
    const { page, log } = await bootDone(done.world, done.goal!.goalId);
    try {
      await settle(() => countRoute(log, 'verification/round') >= 1 && textOf(page.root).includes('还没有验收轮次'), 10_000);
      expect(countRoute(log, 'verification/round')).toBeGreaterThanOrEqual(1);
      /* 具名改坏: 把 `verification/round` 的 `not_found` 当首读错误；本行红。 */
      expect(findButton(page.root, '重试')).toBeUndefined();
      expect(textOf(page.root)).toContain('还没有验收轮次');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D17c a report whose materials/open is lost shows the read failure, not the write failure', async () => {
    const done = await slot.use('report-fail', () => openDoneDeliveryWorld(), (world) => world.close());
    const { page, log } = await bootDone(done.world, done.goal.goalId, { failOnce: 'materials/open' });
    try {
      const acc = '验收要求与证据';
      await settle(() => sectionSum(page.root, acc) !== '', 10_000);
      const body = await openSection(page.root, acc);
      const row = bodyRows(body).find((entry) => rowMain(entry) === 'pl-obligation-goal static check');
      const more = await openRow(page.root, row, 'dv-more', 'pl-obligation-goal static check');
      press(findClass(dlElement(more, '报告') ?? page.root, 'd-file'), '报告');
      await settle(() => textOf(page.root).includes('读取失败。'), 10_000);
      /* 具名改坏: 报告读失败用写入码表 `writeTextOf`；本行读 `写入失败。`，红。
         `failOnce` 在转发前抛错，所以失败的那次不在 log 里。 */
      expect(textOf(page.root)).toContain('读取失败。');
      expect(textOf(page.root)).not.toContain('写入失败。');
      expect(textOf(page.root)).not.toContain('暂时写不了');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D17b a first verification/round lost on the network shows retry, and the retry reads it again', async () => {
    const done = await slot.use('main', () => openDoneDeliveryWorld(), (world) => world.close());
    const { page, log } = await bootDone(done.world, done.goal.goalId, { failOnce: 'verification/round' });
    try {
      await settle(() => findButton(page.root, '重试') !== undefined, 10_000);
      const retry = findButton(page.root, '重试');
      expect(retry, '重试').toBeDefined();
      click(retry!);
      /* 具名改坏: 重试不发第二次读；本行红（失败的那一次没进 log）。 */
      await settle(() => countRoute(log, 'verification/round') === 1 && findButton(page.root, '重试') === undefined, 10_000);
      expect(countRoute(log, 'verification/round')).toBe(1);
      expect(findButton(page.root, '重试')).toBeUndefined();
      expect(sectionSum(page.root, '验收要求与证据')).toBe('1/1 通过 · 验收检查 2 轮');
    } finally {
      await page.restore();
    }
  }, 180_000);
});
