import { afterAll, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { bootE3N, descendants, hasClass, lineRowNamed, lineRows, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  bootDecide, callsOf, count, hostTarget, opened, pinSet, quiet, settle, typeInto, worldTarget, writeOf, type E3DLogLike,
} from './helpers/E3D-page.js';
import {
  buttonText, controlPins, openMemberS7C, openMemberW4, openMemberW6, worldSlot,
} from './helpers/E3M-world.js';

/**
 * E3D-16 (Z5 of the 7D book): the Decide page's open line. The four controls
 * go through `controls/submit`, the safe-point confirm only after 不取消, 重新入队
 * through `tasks/requeue`, and 问一问 through `queries/ask` with the line's own
 * page link. Real Host, memory backend, scripted model; the change stream is
 * the page's own and the rows wait on it.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 240_000);

const held = () => slot.use('held', () => openMemberS7C({ firstRun: 'held' }), (w) => w.s7c.close());
const ended = () => slot.use('ended', () => openMemberS7C({ firstRun: 'ended' }), (w) => w.s7c.close());
const paused = () => slot.use('MW4', () => openMemberW4(), (w) => w.h.dispose());
const capped = () => slot.use('W6', () => openMemberW6(), (w) => w.h.dispose());

/** A control of `.lv-acts` by its label (暂停/取消/重新入队). */
const lineAct = (root: FakeElement, label: string): FakeElement | undefined => buttonText(findClass(root, 'lv-acts'), label);

/** The line view's own composer (the `.composer` holding `#lv-input`): its send button and foot. */
function lineComposer(root: FakeElement): { send: FakeElement | undefined; to: FakeElement | undefined } {
  const composer = findAllClass(root, 'composer')
    .find((element) => findElement(element, (child) => child.getAttribute('id') === 'lv-input') !== undefined);
  return { send: composer && findClass(composer, 'send'), to: composer && findClass(composer, 'to') };
}

/** The S7C module line's rail button: the secretary link, then the non-secretary `lines/list` rows. */
async function s7cModuleRow(root: FakeElement, world: { scope: unknown; post(route: string, body: unknown): Promise<{ body: unknown }> },
  key: { sessionId: string }): Promise<FakeElement | undefined> {
  const answer = await world.post('lines/list', { scope: world.scope, input: { workspace: world.scope } });
  const rows = ((answer.body as { value?: { rows?: Array<{ key: { sessionId: string }; duty?: string }> } }).value?.rows ?? [])
    .filter((row) => row.duty !== 'secretary');
  const holder = lineRows(root)[rows.findIndex((row) => row.key.sessionId === key.sessionId) + 1];
  return holder === undefined ? undefined
    : descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

/** Clicks the rail row and waits until the centre's line view and its read have landed. */
async function openRailRow(root: FakeElement, log: E3DLogLike, row: FakeElement | undefined): Promise<void> {
  expect(row).toBeDefined();
  click(row!);
  expect(await settle(() => findClass(root, 'lv-acts') !== undefined)).toBe(true);
  await quiet(log);
}

describe('E3D-16 the Decide line view', () => {
  it('Z5 暂停 submits one pause with the pins lines/read gives', async () => {
    const w = await held();
    const pins = await controlPins(w.s7c.world, w.module, 'pause');
    const { page, log } = await bootDecide(worldTarget(w.s7c.world), { search: '?goal=s7c-goal' });
    try {
      await opened(log);
      await openRailRow(page.root, log, await s7cModuleRow(page.root, w.s7c.world, w.module));
      expect(await settle(() => lineAct(page.root, '暂停') !== undefined)).toBe(true);
      const pause = lineAct(page.root, '暂停')!;
      expect(hasClass(pause, 'is-off')).toBe(false);
      expect(pause.getAttribute('aria-disabled')).not.toBe('true');
      click(pause);
      expect(await settle(() => count(log, 'controls/submit') === 1)).toBe(true);
      await quiet(log);
      /* 具名改坏: Decide.dc.html 线视图覆盖的 pause 不接 `A.controlLine('pause')`；这一行红。 */
      const sent = writeOf(callsOf(log, 'controls/submit')[0]!);
      expect(sent.input).toEqual({ runRef: w.s7c.run.runRef, kind: 'pause', reason: null });
      /* A pin set's meaning does not depend on its array order: compare the sorted JSON set. */
      expect(pinSet(sent.meta.expected)).toEqual(pinSet(pins));
      expect(textOf(page.root)).toContain('已请求暂停，等安全点');
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('Z5 暂停 double click sends one pause and greys the control', async () => {
    const w = await slot.use('held-double', () => openMemberS7C({ firstRun: 'held' }), (v) => v.s7c.close());
    const pins = await controlPins(w.s7c.world, w.module, 'pause');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { page, log } = await bootE3N(w.s7c.world, 'Decide',
      { search: '?goal=s7c-goal', before: { 'controls/submit': () => gate } });
    try {
      await opened(log);
      await openRailRow(page.root, log, await s7cModuleRow(page.root, w.s7c.world, w.module));
      expect(await settle(() => lineAct(page.root, '暂停') !== undefined)).toBe(true);
      const pause = lineAct(page.root, '暂停')!;
      /* Both clicks come from the same captured button, before the is-off class can skip the second. */
      click(pause);
      click(pause);
      await settle(() => hasClass(lineAct(page.root, '暂停') ?? page.root, 'is-off'));
      const busy = lineAct(page.root, '暂停')!;
      const busyCls = hasClass(busy, 'is-off');
      const busyOff = busy.getAttribute('aria-disabled');
      release();
      await quiet(log);
      /* 具名改坏: `lineWrites` 不查在途；第二下再发一次 controls/submit，这一行红。 */
      expect(count(log, 'controls/submit')).toBe(1);
      const sent = writeOf(callsOf(log, 'controls/submit')[0]!);
      expect(sent.input).toEqual({ runRef: w.s7c.run.runRef, kind: 'pause', reason: null });
      expect(pinSet(sent.meta.expected)).toEqual(pinSet(pins));
      expect([busyCls, busyOff]).toEqual([true, 'true']);
    } finally {
      release();
      await page.restore();
    }
  }, 240_000);

  /* Lead 11-25: Main's line view keeps one in-flight state for every line write
     (the four controls, 我来处理 and its 继续); while 暂停 is in flight all the
     controls there grey together and the second click sends nothing. */
  it('Z5 on Main, 暂停 double click sends one pause and greys every line control', async () => {
    const w = await slot.use('held-main', () => openMemberS7C({ firstRun: 'held' }), (v) => v.s7c.close());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { page, log } = await bootE3N(w.s7c.world, 'Main',
      { search: '?goal=s7c-goal', before: { 'controls/submit': () => gate } });
    try {
      await quiet(log);
      /* Main's rail orders its lines its own way; the module line is the one on s7c-m1. */
      const moduleRow = lineRows(page.root).find((row) => textOf(row).includes('s7c-m1'));
      await openRailRow(page.root, log, moduleRow && (descendants(moduleRow)
        .find((element) => element.tagName.toLowerCase() === 'button') ?? moduleRow));
      expect(await settle(() => lineAct(page.root, '暂停') !== undefined)).toBe(true);
      const pause = lineAct(page.root, '暂停')!;
      click(pause);
      click(pause);
      await settle(() => hasClass(lineAct(page.root, '暂停') ?? page.root, 'is-off'));
      const busy = descendants(findClass(page.root, 'lv-acts')!)
        .filter((element) => element.tagName.toLowerCase() === 'button')
        .map((button) => [textOf(button), hasClass(button, 'is-off'), button.getAttribute('aria-disabled')]);
      release();
      await quiet(log);
      expect(count(log, 'controls/submit')).toBe(1);
      expect(busy.length).toBeGreaterThan(1);
      expect(busy).toEqual(busy.map(([text]) => [text, true, 'true']));
    } finally {
      release();
      await page.restore();
    }
  }, 240_000);

  it('Z5 取消 opens the safe-point confirm and submits one cancel', async () => {
    const w = await paused();
    const { page, log } = await bootDecide(hostTarget(w.h));
    try {
      await opened(log);
      await openRailRow(page.root, log, lineRowNamed(page.root, 'Independent work ag2b-work'));
      expect(await settle(() => lineAct(page.root, '取消') !== undefined)).toBe(true);
      click(lineAct(page.root, '取消')!);
      const dialog = (): FakeElement | undefined =>
        findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog');
      expect(dialog()).toBeDefined();
      expect(textOf(findClass(dialog()!, 'dc-line'))).toMatch(/^它已停在安全点，取消立即生效/);
      expect(count(log, 'controls/submit')).toBe(0);
      click(findButton(dialog()!, '不取消')!);
      expect(dialog()).toBeUndefined();
      expect(count(log, 'controls/submit')).toBe(0);
      click(lineAct(page.root, '取消')!);
      /* 具名改坏: 确认卡的 go 绕过 `A.controlLine('cancel')`；这一行红。 */
      click(findButton(dialog()!, '取消执行')!);
      expect(await settle(() => count(log, 'controls/submit') === 1)).toBe(true);
      await quiet(log);
      expect(writeOf(callsOf(log, 'controls/submit')[0]!).input).toEqual({ runRef: w.run, kind: 'cancel', reason: null });
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('Z5 重新入队 requeues after the cap', async () => {
    const w = await capped();
    const { page, log } = await bootDecide(hostTarget(w.h));
    try {
      await opened(log);
      await openRailRow(page.root, log, lineRowNamed(page.root, 'Independent work ag2b-work'));
      expect(await settle(() => lineAct(page.root, '重新入队') !== undefined)).toBe(true);
      click(lineAct(page.root, '重新入队')!);
      expect(await settle(() => count(log, 'tasks/requeue') === 1)).toBe(true);
      await quiet(log);
      /* 具名改坏: canRequeue 不读 `D.canRequeue`；重新入队 还在，这一行红。 */
      const sent = writeOf(callsOf(log, 'tasks/requeue')[0]!);
      expect(sent.input['reason']).toBe('在工作线页面重新入队');
      const expected = sent.meta.expected as Array<{ ref: { aggregateType?: string; goalId?: string; runId?: string }; revision: number }>;
      expect(expected).toHaveLength(2);
      expect([expected[0]!.ref.aggregateType, typeof expected[0]!.revision]).toEqual(['Goal', 'number']);
      expect(expected[0]!.ref.goalId).toBe(w.run.goalId);
      expect([expected[1]!.ref.aggregateType, typeof expected[1]!.revision]).toEqual(['Run', 'number']);
      expect([expected[1]!.ref.runId, expected[1]!.ref.goalId]).toEqual([w.run.runId, w.run.goalId]);
      const reply = callsOf(log, 'tasks/requeue')[0]!.reply as { status?: string; value?: { kind?: string } };
      expect([reply.status, reply.value?.kind]).toEqual(['committed', 'requeued']);
      expect(await settle(() => lineAct(page.root, '重新入队') === undefined)).toBe(true);
      expect(lineAct(page.root, '重新入队')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('Z5 问一问 sends one queries/ask and the page link carries the line', async () => {
    const w = await ended();
    const { page, log } = await bootDecide(worldTarget(w.s7c.world), { search: '?goal=s7c-goal' });
    try {
      await opened(log);
      await openRailRow(page.root, log, await s7cModuleRow(page.root, w.s7c.world, w.module));
      expect(await settle(() => lineComposer(page.root).send !== undefined)).toBe(true);
      typeInto(page.root, 'lv-input', '刚才改了哪些文件');
      expect(await settle(() => lineComposer(page.root).send?.getAttribute('aria-disabled') !== 'true')).toBe(true);
      click(lineComposer(page.root).send!);
      expect(await settle(() => callsOf(log, 'queries/ask').some((call) => call.reply !== undefined), 10_000)).toBe(true);
      await quiet(log);
      /* 具名改坏: 线视图的 send 仍走原型 `cm.send` 的本地模拟；`queries/ask` 是 0 次，这一行红。 */
      expect(count(log, 'queries/ask')).toBe(1);
      const call = callsOf(log, 'queries/ask')[0]!;
      expect((call.input as Record<string, unknown>)['sessionRef']).toEqual(w.module);
      expect(await settle(() => textOf(lineComposer(page.root).to) === '已发出，回答在这条线的整页里')).toBe(true);
      expect(textOf(lineComposer(page.root).to)).toBe('已发出，回答在这条线的整页里');
      const link = findElement(page.root, (element) => element.tagName.toLowerCase() === 'a'
        && hasClass(element, 'plink') && textOf(element).includes('整页查看'));
      expect(link).toBeDefined();
      const href = link!.getAttribute('href') ?? '';
      expect(href).toContain('lineProject=' + encodeURIComponent(w.module.projectId));
      expect(href).toContain('lineSession=' + encodeURIComponent(w.module.sessionId));
      expect(href).toMatch(/^(Member|Chain)\.dc\.html\?/);
    } finally {
      await page.restore();
    }
  }, 240_000);
});
