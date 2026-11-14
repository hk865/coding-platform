import { afterEach, describe, expect, it } from 'vitest';
import { runRevisionOf } from '../helpers/PL-deviation-fixture.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { findClass, findElement } from './helpers/boot-page.js';
import { barItem, bootChain, goalRevisionOf, seedChainChecks, taskBar, taskRowOf, type ChainPage } from './helpers/E3C-world.js';
import {
  UUID_V4, buttonText, callsOf, controlPins, memberSearch, metaOf, openMemberW4, press, settle, worldSlot,
} from './helpers/E3M-world.js';
import { countRoute, textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-5 (test sheet §2.2, E3C-10..13; wiring D1, D3–D8, X3/X8): the dock's
 * task bar — the task's word and its automatic-rework count, 重新入队 shown
 * from the public answer only, and the Run controls through
 * `controls/submit` with the pins `lines/read` gives.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);
const world = (key: string, firstRun: 'ended' | 'held') =>
  slot.use(key, () => openS7C1World({ backend: 'memory', firstRun }), (opened) => opened.close());

/** The five failure-class labels the platform derives; none belongs on a running task's bar. */
const FAILURE_WORDS = ['平台中断', '已取消', '检查未通过', '执行失败', '检查不完整'];

const inBar = (root: FakeElement, className: string): string => barItem(root, className);
const headTitle = (root: FakeElement): string => textOf(findClass(findClass(root, 'main') ?? root, 'head-title'));
const confirmDialog = (root: FakeElement) => findElement(root, (element) => element.getAttribute('role') === 'alertdialog');
const bootModule = (s7c: S7C1World): Promise<ChainPage> => bootChain(s7c.world, memberSearch('s7c-goal', s7c.lines.module.ref));

describe('E3C-5 the task bar and its controls', () => {
  it('E3C-10 the held Run’s bar: 执行中, 自动返工 —, no failure class (D1)', async () => {
    const s7c = await world('E3C-10', 'held');
    const { page } = await bootModule(s7c);
    try {
      expect(headTitle(page.root)).toContain('Independent work s7c-m1');
      expect(inBar(page.root, 'gb-state')).toContain('执行中');
      /* A person's claim, no automatic rework yet (`rework` null on the row).
         具名改坏: 拿 attemptOrdinal 当自动返工计数（把 — 写成 1）；本行的 `—` 红。 */
      expect(inBar(page.root, 'gb-item')).toBe('自动返工 —');
      for (const word of FAILURE_WORDS) expect(textOf(taskBar(page.root))).not.toContain(word);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-11 a failed Task a person may requeue shows 重新入队 (X3/D8)', async () => {
    const s7c = await world('E3C-11', 'ended');
    await seedChainChecks(s7c, 1);
    const row = await taskRowOf(s7c.world, s7c.goal, 's7c-m1');
    expect(row.effectivePhase).toBe('failed');
    expect(row.failure?.requeueActors ?? []).toContain('human');
    const { page } = await bootModule(s7c);
    try {
      const requeue = buttonText(taskBar(page.root), '重新入队');
      /* 具名改坏: 可见性改成 effectivePhase === 'cancelled'（旧 DC6）；这个世界没有 cancelled，按钮消失，本行红。 */
      expect(requeue, '重新入队').toBeDefined();
      expect(requeue!.getAttribute('aria-disabled')).not.toBe('true');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it.each([
    { entry: '① 暂停', kind: 'pause' as const },
    { entry: '② 取消只开确认框', kind: null },
    { entry: '③ 取消这次执行', kind: 'cancel' as const },
    { entry: '④ 继续', kind: 'resume' as const },
  ])('E3C-12 $entry (D3–D7, X8)', async ({ entry, kind }) => {
    if (kind === 'resume') {
      /* The nearest public path to a line paused at its safe point (reply §1): Member's W4 (A7's pause). */
      const w4 = await slot.use(entry, () => openMemberW4(), (opened) => opened.h.dispose());
      const { page, log } = await bootChain({ get base() { return w4.h.host.base; }, get token() { return w4.h.host.token; } },
        memberSearch('ag2b-goal', w4.line));
      try {
        press(buttonText(taskBar(page.root), '继续'), '继续');
        await settle(() => countRoute(log, 'controls/submit') > 0);
        const calls = callsOf(log, 'controls/submit');
        expect(calls).toHaveLength(1);
        /* 具名改坏: 继续发 `pause`；本条目的 kind 红。 */
        expect(calls[0]!.input).toMatchObject({ runRef: w4.run, kind: 'resume' });
        expect(metaOf(calls[0]).requestId).toMatch(UUID_V4);
      } finally {
        await page.restore();
      }
      return;
    }
    const s7c = await world(entry, 'held');
    const pins = await controlPins(s7c.world, s7c.lines.module.ref, kind ?? 'cancel');
    const { page, log } = await bootModule(s7c);
    try {
      if (kind === 'pause') {
        press(buttonText(taskBar(page.root), '暂停'), '暂停');
        await settle(() => countRoute(log, 'controls/submit') > 0);
        const calls = callsOf(log, 'controls/submit');
        expect(calls).toHaveLength(1);
        /* 具名改坏: 发 `kind:'resume'`；本条目的 kind 红。 */
        expect(calls[0]!.input).toMatchObject({ runRef: s7c.run.runRef, kind: 'pause' });
        expect(metaOf(calls[0]).expected).toEqual(pins);
        /* Codex #13: a fresh UUID per click, not a fixed counter. */
        expect(metaOf(calls[0]).requestId).toMatch(UUID_V4);
        return;
      }
      press(buttonText(taskBar(page.root), '取消'), '取消');
      await settle(() => confirmDialog(page.root) !== undefined);
      expect(confirmDialog(page.root), 'the cancel confirm').toBeDefined();
      if (kind === null) {
        /* The page read the selected line it would cancel (§1.4), then wrote nothing.
           具名改坏: 确认框一开就发 `cancel`；本条目的零请求红。 */
        expect(countRoute(log, 'lines/read')).toBeGreaterThanOrEqual(1);
        expect(countRoute(log, 'controls/submit')).toBe(0);
        return;
      }
      press(buttonText(confirmDialog(page.root), '取消这次执行'), '取消这次执行');
      await settle(() => countRoute(log, 'controls/submit') > 0);
      const calls = callsOf(log, 'controls/submit');
      /* 具名改坏: “取消这次执行”不发；本条目的一次 `cancel` 红。 */
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toMatchObject({ runRef: s7c.run.runRef, kind: 'cancel' });
      expect(metaOf(calls[0]).expected).toEqual(pins);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('E3C-13 重新入队 sends one tasks/requeue after the ended Run with the Goal and Run pins (D8)', async () => {
    const s7c = await world('E3C-13', 'ended');
    await seedChainChecks(s7c, 1);
    const run = s7c.run.runRef;
    const goalRevision = await goalRevisionOf(s7c.world, s7c.goal);
    const runRevision = await runRevisionOf(s7c.world, run);
    const { page, log } = await bootModule(s7c);
    try {
      press(buttonText(taskBar(page.root), '重新入队'), '重新入队');
      await settle(() => countRoute(log, 'tasks/requeue') > 0);
      const calls = callsOf(log, 'tasks/requeue');
      expect(calls).toHaveLength(1);
      /* 具名改坏: 把 afterRunRef 省略/写成未结束的 Run；本行的 input 断言红。 */
      expect(calls[0]!.input).toEqual({ taskRef: s7c.tasks[0], afterRunRef: run, reason: '人工重新入队' });
      expect(metaOf(calls[0]).expected).toEqual(expect.arrayContaining([
        { ref: s7c.goal, revision: goalRevision }, { ref: run, revision: runRevision }]));
    } finally {
      await page.restore();
    }
  }, 180_000);
});
