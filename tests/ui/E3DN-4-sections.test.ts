import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyRows, bootDone, detailLines, openDoneDeliveryWorld, openDonePlaceholderWorld, openRow, openSection, rowEv, rowMain,
  sectionSum,
} from './helpers/E3DN-done-world.js';
import { findClass } from './helpers/boot-page.js';
import { dlElement } from './helpers/E3C-world.js';
import { settle, worldSlot } from './helpers/E3M-world.js';
import { descendants, hasClass, textOf } from './helpers/E3N-page.js';

/**
 * E3DN-4 D09–D12 (test sheet §2.4): 没有做的 (the placeholders `tasks/query`
 * shows as deferred and future), 返工与接续 (`TaskRow.rework.entries` and the
 * continuation brief of a Run with a `requeueRef`), 用量 (`readings.usage`
 * of the counted Runs, one row per role template). The continuation's rows
 * are `briefRowsOf`'s three (Member's adapter): its `上次停在` is the brief's
 * `previous.error.text` when there is one, which the paused-then-crashed Run
 * has (`host_interrupted_while_paused`).
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const TASK_A = 'PL stage 1 done-a';
const TASK_B = 'PL stage 1 done-b';

describe('E3DN-4 没有做的、返工与接续、用量', () => {
  it('D09 没有做的 lists the deferred and the future placeholders, and 与任务书不同 is 还没接通', async () => {
    const done = await slot.use('placeholders', () => openDonePlaceholderWorld(), (world) => world.close());
    const { page } = await bootDone(done.world, done.goal!.goalId);
    try {
      await settle(() => sectionSum(page.root, '没有做的') !== '', 10_000);
      const body = await openSection(page.root, '没有做的');
      const later = descendants(dlElement(body, '以后再做') ?? page.root)
        .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'd-item')).map((item) => textOf(item));
      /* 具名改坏: 不列 `deferred`；本行的“（已延后）”那一项红。 */
      expect(later.sort()).toEqual(['PL goal-level placeholder pl-goal-placeholder', 'PL pl-stage-2 placeholder（已延后）']);
      expect(sectionSum(page.root, '没有做的')).toContain('以后再做 2 项');
      /* 具名改坏: 用 plannedFiles 和 actualFiles 的差算“与任务书不同”；本行红。 */
      expect(textOf(dlElement(body, '与任务书不同')).startsWith('还没接通')).toBe(true);
      expect(textOf(body)).not.toContain('推送接口放在 server.ts');
      /* 具名改坏: 按钮文字仍是样例任务名；本行红。 */
      expect(textOf(body)).toContain('在任务图里看');
      expect(textOf(body)).not.toContain('在任务图里看 SSE 推送');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D10 one task reworked twice: one automatic, one by the person', async () => {
    const done = await slot.use('human-rework', () => openDoneDeliveryWorld({ reverify: false, humanRework: true }),
      (world) => world.close());
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, '返工与接续') !== '', 10_000);
      /* 具名改坏: 次数取 `rework.requeueAutoCount`（2 变 1）；本行的 `2 次` 红。 */
      expect(sectionSum(page.root, '返工与接续')).toBe('返工 1 个任务，共 2 次 · 接续 0 次');
      const body = await openSection(page.root, '返工与接续');
      const rows = bodyRows(body).filter((entry) => rowMain(entry) === TASK_B);
      expect(rows).toHaveLength(2);
      expect(rowEv(rows[0])).not.toMatch(/(?<!未)通过/);
      /* 具名改坏: `automatic === true` 判反；第一行的“系统自动”红。 */
      const first = detailLines(await openRow(page.root, rows[0], 'dv-more', TASK_B));
      expect(first).toHaveLength(1);
      expect(first[0]).toContain('第 1 次 · 系统自动 · 检查未通过');
      const second = detailLines(await openRow(page.root, rows[1], 'dv-more', TASK_B));
      expect(second).toHaveLength(1);
      expect(second[0]).toContain('第 2 次 · 人工');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D11 the continuation after an interruption is one row with the brief’s three rows', async () => {
    const done = await slot.use('interrupted', () => openDoneDeliveryWorld({ interrupted: true }), (world) => world.close());
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, '返工与接续') !== '', 10_000);
      const body = await openSection(page.root, '返工与接续');
      const continued = bodyRows(body).filter((entry) => rowEv(entry).includes('接续'));
      /* 具名改坏: `mode === 'rework'` 的 Run 也画成接续行；本行变成 2 行，红。 */
      expect(continued.map((entry) => rowMain(entry))).toEqual([TASK_A]);
      expect(rowEv(continued[0])).toContain('接续 1 次');
      const text = textOf(await openRow(page.root, continued[0], 'dv-more', TASK_A));
      /* 具名改坏: 读上一个 Run（`requeueRef.afterRunId`）的 brief；本行在 :86 的“只有 done-a 一行”处红。 */
      for (const part of ['接续方式', '中断后接着做', '停下原因', '平台中断', '上次停在', 'host_interrupted_while_paused']) {
        expect(text).toContain(part);
      }
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D12 用量: one row for the one role template, its tokens summed, requests and time 还没接通', async () => {
    const done = await slot.use('main', () => openDoneDeliveryWorld(), (world) => world.close());
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, '用量') !== '', 10_000);
      const body = await openSection(page.root, '用量');
      const rows = descendants(body ?? page.root).filter((element) => hasClass(element, 'dv-ur') && !hasClass(element, 'tot')
        && findClass(element, 'h') === undefined);
      /* 具名改坏: 一个 Run 一行、不按 templateId 合并；本行的“1 行”红。 */
      expect(rows).toHaveLength(1);
      const cells = descendants(rows[0]!).filter((element) => element.getAttribute('role') === 'cell').map((cell) => textOf(cell));
      /* 625 + 1250 + 3750（sheet §1.2）。具名改坏: 把 `usage.totals` 当 token；本行红。 */
      expect(cells[2]!.replace(/[,\s]/g, '')).toBe('5625');
      /* 具名改坏: 从 `run.startedAt`/`endedAt` 算工作时长；本行的 `—` 红。 */
      expect([cells[1], cells[3]]).toEqual(['—', '—']);
      expect(textOf(body)).toContain('请求数和工作时长没有读口，还没接通');
    } finally {
      await page.restore();
    }
  }, 180_000);
});
