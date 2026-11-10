import { afterAll, describe, expect, it } from 'vitest';
import { findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import { countRoute, hasClass, textOf, type PageLog } from './helpers/E3N-page.js';
import { openW1 } from './helpers/E3N-world.js';
import {
  UUID_V4, bootMemberAt, bootMemberOnHost, buttonText, callsOf, controlPins, headFact, memberSearch, metaOf, receiptBody,
  openMemberS7C, openMemberW4, openMemberW6, press, settle, worldSlot, type MemberPage,
} from './helpers/E3M-world.js';

/**
 * E3M-2 (test sheet §2.2, M08–M16, G03/G04/G06–G09): the page head — the
 * local theme and panel switches, 暂停/继续/取消 through `controls/submit`
 * with the pins `lines/read` gives, 重新入队 shown only for a failed Task a
 * person may requeue and sent through `tasks/requeue`, and the attempt word.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const w0 = () => slot.use('W0', () => openW1(), (opened) => opened.world.close());
const w1 = () => slot.use('W1', () => openMemberS7C(), (opened) => opened.s7c.close());
const w2 = () => slot.use('W2', () => openMemberS7C({ firstRun: 'held' }), (opened) => opened.s7c.close());
const w4 = () => slot.use('W4', () => openMemberW4(), (opened) => opened.h.dispose());
const w6 = () => slot.use('W6', () => openMemberW6(), (opened) => opened.h.dispose());

const acts = (page: BootedPage) => findClass(page.root, 'mh-acts');
const byLabel = (page: BootedPage, label: string) => findElement(page.root, (element) =>
  element.tagName.toLowerCase() === 'button' && element.getAttribute('aria-label') === label);
const writeDone = (log: PageLog, booted: MemberPage, route: string) =>
  () => countRoute(log, route) > 0 && booted.receipts.some((receipt) => receipt.route === route);

describe('E3M-2 the Member head', () => {
  it.each([
    { entry: '主题', label: '切换到浅色', className: 't-light', after: '切换到深色' },
    { entry: '右栏', label: '显示或隐藏右栏', className: 'no-panel', after: '显示或隐藏右栏' },
  ])('R08 the $entry button changes the page locally (M08/M09/G03)', async ({ label, className, after }) => {
    const { world } = await w0();
    const { page, log } = await bootMemberAt(world, '?goal=ag2b-goal');
    try {
      expect(countRoute(log, 'lines/list')).toBe(1);
      const before = log.calls.length;
      press(byLabel(page, label), label);
      await settle(() => hasClass(findClass(page.root, 'app')!, className));
      expect(hasClass(findClass(page.root, 'app')!, className)).toBe(true);
      expect(byLabel(page, after)).toBeDefined();
      /* 具名改坏: 主题/右栏点击触发 `refresh.reread()`；对应条目的“零请求”红。 */
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R09 暂停 submits one pause with the pins lines/read gives (M10/M12/G04/G06)', async () => {
    const w = await w2();
    const pins = await controlPins(w.s7c.world, w.module, 'pause');
    const booted = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    const { page, log } = booted;
    try {
      press(buttonText(acts(page), '暂停'), '暂停');
      await settle(writeDone(log, booted, 'controls/submit'));
      const calls = callsOf(log, 'controls/submit');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toEqual({ runRef: w.s7c.run.runRef, kind: 'pause', reason: null });
      expect(metaOf(calls[0]).requestId).toMatch(UUID_V4);
      /* 具名改坏: `submitRunControl` 发 `expected: []`；Host 回 `invalid`，本行的 `expected`/`committed` 红。 */
      expect(metaOf(calls[0]).expected).toEqual(pins);
      expect(receiptBody(booted, 'controls/submit')?.['status']).toBe('committed');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R12 取消 opens the confirm and writes nothing (M14/M30/G08/G18)', async () => {
    const w = await w2();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      expect(countRoute(log, 'lines/read')).toBe(1);
      press(buttonText(acts(page), '取消'), '取消');
      const dialog = () => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog');
      await settle(() => dialog() !== undefined);
      expect(textOf(findClass(dialog()!, 'dc-title'))).toBe('取消这次执行？');
      /* 具名改坏: 点 `取消` 就直接写；本行的零请求红。 */
      expect(countRoute(log, 'controls/submit')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R13 取消执行 submits one cancel (M14/M30/G08/G18)', async () => {
    const w = await w2();
    const booted = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    const { page, log } = booted;
    try {
      press(buttonText(acts(page), '取消'), '取消');
      await settle(() => findClass(page.root, 'decision') !== undefined);
      press(buttonText(findClass(page.root, 'decision'), '取消执行'), '取消执行');
      await settle(writeDone(log, booted, 'controls/submit'));
      const calls = callsOf(log, 'controls/submit');
      expect(calls).toHaveLength(1);
      /* 具名改坏: 确认框发 `pause`；本行的 `input.kind` 红。 */
      expect((calls[0]!.input as { kind?: string }).kind).toBe('cancel');
      expect(metaOf(calls[0]).expected?.map((pin) => pin.ref)).toEqual([w.s7c.run.runRef]);
      expect(receiptBody(booted, 'controls/submit')?.['status']).toBe('committed');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R10 a Run paused at its safe point: the head says 已暂停 and offers 继续, not 暂停 (M10/M12/G06)', async () => {
    const w = await w4();
    const { page } = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      /* lead 11-10: the pause has landed (`own:"paused"`, controls resume/cancel), so the prototype's word for it, not the sheet's 已请求暂停，等安全点.
         具名改坏: 页头拿 `run.status` 当状态词，仍写“工作中”；本行的 `已暂停` 红。 */
      expect(headFact(page.root, '状态')).toBe('已暂停');
      expect(buttonText(acts(page), '暂停')).toBeUndefined();
      expect(buttonText(acts(page), '继续')).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R11 继续 submits one resume (M13/G07)', async () => {
    const w = await w4();
    const booted = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    const { page, log } = booted;
    try {
      press(buttonText(acts(page), '继续'), '继续');
      await settle(writeDone(log, booted, 'controls/submit'));
      /* 具名改坏: 继续改发 `tasks/requeue`；本行的 `controls/submit` 红。 */
      const calls = callsOf(log, 'controls/submit');
      expect(calls).toHaveLength(1);
      expect((calls[0]!.input as { kind?: string }).kind).toBe('resume');
      expect(metaOf(calls[0]).expected?.map((pin) => pin.ref)).toEqual([w.run]);
      expect(receiptBody(booted, 'controls/submit')?.['status']).toBe('committed');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R15 an ended Run of a satisfied Task offers no 重新入队 (M15)', async () => {
    const w = await w1();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      expect(countRoute(log, 'tasks/query')).toBeGreaterThanOrEqual(1);
      /* 具名改坏: `requeueVisible` 恒真；本行的“没有按钮”红。 */
      expect(buttonText(acts(page), '重新入队')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 180_000);

  it.each([
    { entry: 'W1', literal: '第 1 次尝试' },
    { entry: 'W6', literal: '第 4 次尝试' },
  ])('R17 the head names the attempt: $entry (M16)', async ({ entry, literal }) => {
    const open = entry === 'W1'
      ? async () => { const w = await w1(); return await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module)); }
      : async () => { const w = await w6(); return await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line)); };
    const { page, log } = await open();
    try {
      expect(countRoute(log, 'tasks/query')).toBeGreaterThanOrEqual(1);
      /* 具名改坏: 适配器把 `attemptOrdinal` 缺省/任意值都写成 `第 1 次尝试`；W6 条目红。
         (The word before " · ": from the second attempt the prototype adds " · 接续".) */
      expect(headFact(page.root, '尝试').split(' · ')[0]).toBe(literal);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R14 a failed Task a person may requeue shows 重新入队 (M15/G09)', async () => {
    const w = await w6();
    const { page } = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      /* 具名改坏: `requeueVisible` 改看 `row.status.own`；本行的按钮红。 */
      expect(buttonText(acts(page), '重新入队')).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R16 重新入队 sends one tasks/requeue after the fourth Run with the Goal and Run pins (M15/G09)', async () => {
    const w = await w6();
    const booted = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    const { page, log } = booted;
    try {
      press(buttonText(acts(page), '重新入队'), '重新入队');
      await settle(writeDone(log, booted, 'tasks/requeue'));
      const calls = callsOf(log, 'tasks/requeue');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toEqual({
        taskRef: { projectId: 'ag2b-collab-project', goalId: 'ag2b-goal', taskId: 'ag2b-work' },
        afterRunRef: w.run, reason: '在工作线页面重新入队',
      });
      expect(metaOf(calls[0]).requestId).toMatch(UUID_V4);
      /* 具名改坏: `requeueLine` 不发 `afterRunRef` 这一项 pin；Host 回 `invalid`，本行的 `expected` 红。 */
      const refs = metaOf(calls[0]).expected?.map((pin) => pin.ref) ?? [];
      expect(refs).toHaveLength(2);
      expect(refs).toEqual(expect.arrayContaining([
        { aggregateType: 'Goal', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' }, w.run,
      ]));
      const receipt = receiptBody(booted, 'tasks/requeue');
      expect(receipt?.['status']).toBe('committed');
      expect((receipt?.['value'] as { kind?: string } | undefined)?.kind).toBe('requeued');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
