import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyRows, bootDone, deliveryOf, detailAfter, detailLines, doneReportBody, gateRound, openDoneDeliveryWorld,
  openDoneTwoStageGateWorld, openRow, openSection, rowMain, sectionSum, type DoneDeliveryWorld,
} from './helpers/E3DN-done-world.js';
import type { FakeElement } from './helpers/dom.js';
import { findClass } from './helpers/boot-page.js';
import { dlElement, dlValue } from './helpers/E3C-world.js';
import { press, settle, worldSlot } from './helpers/E3M-world.js';
import { countRoute, descendants, hasClass, textOf } from './helpers/E3N-page.js';

/**
 * E3DN-2 D03–D06 (test sheet §2.1–§2.2): 验收要求与证据 reads the goal gate's
 * `verification/round` delivery only. Since slice 9 G2 (ruling R01 甲) a round
 * belongs to one Task: the goal gate's delivery has only the goal requirement,
 * and the stage-1 obligation stays listed with `appliesToSelectedTask: false`
 * (not counted). So the main world is 1/1 after its second round, the
 * `reverify:false` world 0/1 after its first (FAIL) round, and the pending
 * world's goal requirement is `pending`. A `missing` requirement cannot be
 * reached through a public step (reply §拿不准).
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const ACC = '验收要求与证据';
const GOAL_REQ = 'pl-obligation-goal static check';

type Kind = 'main' | 'fail' | 'pending';
const deliveryWorld = (kind: Kind): Promise<DoneDeliveryWorld> => slot.use(kind, () => openDoneDeliveryWorld(
  kind === 'main' ? {} : kind === 'fail' ? { reverify: false } : { checksStop: 'pending' }), (done) => done.close());

/** The state word a requirement row ends with (`.dv-ev`'s last span). */
function stateWord(row: FakeElement | undefined): string {
  const ev = row === undefined ? undefined : findClass(row, 'dv-ev');
  const spans = ev === undefined ? [] : descendants(ev).filter((element) => element.tagName.toLowerCase() === 'span');
  return textOf(spans.at(-1));
}

async function goalRequirement(root: FakeElement): Promise<{ row: FakeElement | undefined; more: FakeElement | undefined }> {
  const body = await openSection(root, ACC);
  const row = bodyRows(body).find((entry) => rowMain(entry) === GOAL_REQ);
  return { row, more: await openRow(root, row, 'dv-more', GOAL_REQ) };
}

describe('E3DN-2 验收要求与证据', () => {
  it.each([
    { entry: '① 目标级 gate，两轮', kind: 'main' as const, sum: '1/1 通过 · 验收检查 2 轮' },
    { entry: '①′ 目标级 gate，一轮未通过', kind: 'fail' as const, sum: '0/1 通过 · 验收检查 1 轮' },
  ])('D03 $entry: the head is delivery.summary', async ({ kind, sum }) => {
    const done = await deliveryWorld(kind);
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, ACC) !== '', 10_000);
      /* 具名改坏: 分子写死 requirements.length；①′ 的 `0/1` 红。 */
      expect(sectionSum(page.root, ACC)).toBe(sum);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D03 ② two stage gates and no goal gate: 有多个验收关口，还没接通', async () => {
    const done = await slot.use('stages', () => openDoneTwoStageGateWorld(), (world) => world.close());
    const { page, log } = await bootDone(done.world, done.goal!.goalId);
    try {
      await settle(() => textOf(deliveryOf(page.root)).includes('有多个验收关口，还没接通'), 10_000);
      /* 具名改坏: 抓第一个 stage gate；本行的“多个”红。 */
      expect(textOf(deliveryOf(page.root))).toContain('有多个验收关口，还没接通');
      expect(countRoute(log, 'verification/round')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it.each([
    { entry: '① 通过', kind: 'main' as const, word: '通过' },
    { entry: '② 未通过', kind: 'fail' as const, word: '未通过' },
    { entry: '④ 待检查', kind: 'pending' as const, word: '待检查' },
  ])('D04 $entry: the requirement row and its detail', async ({ kind, word }) => {
    const done = await deliveryWorld(kind);
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, ACC) !== '', 10_000);
      const { row, more } = await goalRequirement(page.root);
      /* 具名改坏: 把 `pending` 画成“通过”；④ 红。 */
      expect(stateWord(row)).toBe(word);
      expect(dlValue(more, '验收') ?? '').toBe('pl-obligation-goal acceptance');
      /* 具名改坏: 检查人写 `executor.id`（`s6a-operator`）；本行的 `人` 红。 */
      expect(dlValue(more, '检查人') ?? '').toBe('人');
      if (kind !== 'pending') expect(dlValue(more, '检查') ?? '').toContain('node -e "process.exit(0)"');
      if (kind === 'pending') {
        /* 具名改坏: 没有报告时 `parts: []`（丢适配器的“—”）；本行红。
           具名改坏: outcome 为 null 的轮次染成 `tx-failed`；本行的“没有 tx-failed”红。 */
        expect(dlValue(more, '报告') ?? '').toBe('—');
        expect(dlValue(more, '轮次') ?? '').toContain('第 1 轮');
        expect(descendants(more ?? page.root).filter((element) => hasClass(element, 'tx-failed'))).toHaveLength(0);
      }
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D05 each check of the read round says 第 <roundOrdinal> 轮', async () => {
    const done = await deliveryWorld('main');
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, ACC) !== '', 10_000);
      const { more } = await goalRequirement(page.root);
      const rounds = detailLines(more);
      expect(rounds.length).toBeGreaterThan(0);
      /* 具名改坏: 轮次写死“第 1 轮”；本行红（这一轮是第 2 轮）。 */
      for (const round of rounds) expect(round.startsWith('第 2 轮')).toBe(true);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D06 (a) the report opens once with materials/open and shows the body as stored', async () => {
    const done = await deliveryWorld('main');
    const read = await gateRound(done.world, done.gate);
    const reportRefs = (read!.delivery.requirements.find((entry) => entry.description === GOAL_REQ)?.checks ?? [])
      .map((check) => check.reportRef).filter((ref) => ref !== null);
    expect(reportRefs.length).toBeGreaterThan(0);
    /* A public read taken before the page opens: it must not count in the page's log. */
    const body = await doneReportBody(done.world, reportRefs[0]!);
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, ACC) !== '', 10_000);
      const { row, more } = await goalRequirement(page.root);
      expect(countRoute(log, 'materials/open')).toBe(0);
      press(findClass(dlElement(more, '报告') ?? page.root, 'd-file'), '报告');
      await settle(() => countRoute(log, 'materials/open') === 1, 10_000);
      const call = log.calls.find((entry) => entry.route === 'materials/open')!;
      const input = call.input as { ref: unknown; usage: unknown };
      /* 具名改坏: `usage` 写成 `'current'`；本行红。 */
      expect(input.usage).toBe('historical_explanation');
      expect(reportRefs).toContainEqual(input.ref);
      const shown = () => textOf(findClass(dlElement(detailAfter(page.root, row, 'dv-more'), '报告') ?? page.root, 'prose'));
      await settle(() => shown() !== '', 5_000);
      expect(shown()).toBe(String(body).trim());
      /* 具名改坏: 点一次读两次 / 再点同一份又读；本行的“只多 1 次”红。 */
      const report = () => findClass(dlElement(detailAfter(page.root, row, 'dv-more'), '报告') ?? page.root, 'd-file');
      press(report(), '报告（收起）');
      await settle(() => countRoute(log, 'materials/open') > 1, 300);
      press(report(), '报告（再开）');
      await settle(() => countRoute(log, 'materials/open') > 1, 500);
      expect(countRoute(log, 'materials/open')).toBe(1);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
