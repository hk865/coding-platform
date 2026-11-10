import { afterAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { descendants, hasClass, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { E3G_OVERLAP, openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import {
  bootDecide, card, cardFacts, count, factOf, hostTarget, openCardWith, opened, rowMeta, rowName, rowSub, sectionRows,
  settle, worldTarget,
} from './helpers/E3D-page.js';
import { openCapWorld } from './helpers/E3D-world.js';
import { cleanupScenarios, type HostScenario } from '../scenarios/harness.js';

/**
 * E3D-3 D14a, D18, D19 (test sheet §2.2): the conflict row's words, the three
 * unselected options, and the 详情 facts of a stopped Task from `tasks/query`.
 * W1 is the E3G conflict world; the W3 world is the C8 cap (four failing Runs,
 * cap 3) through `openHostScenario`. D19b has no row here: the C5 gate stop is
 * not a decision card (see the reply).
 */

let w1: E3GWorld | null = null;
let cap: HostScenario | null = null;

afterAll(async () => {
  await w1?.world.close();
  await cleanupScenarios();
});

async function worldW1(): Promise<E3GWorld> {
  w1 ??= await openE3GW1();
  return w1;
}

describe('E3D-3 the card and its details', () => {
  it('D14a the conflict row names the other Goal, the overlapping files and no time', async () => {
    const world = await worldW1();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const row = sectionRows(page.root, '要决定')[0];
      /* 具名改坏: 适配器解析 `source.key` 取先后；D14a 的 `目标 1` 红。 */
      expect(rowName(row)).toBe('与目标 1 冲突');
      const sub = rowSub(row);
      expect(sub.startsWith('都要改 ')).toBe(true);
      expect(sub.slice('都要改 '.length).split('、').sort()).toEqual([...E3G_OVERLAP].sort());
      expect(rowMeta(row)).toBe('');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D18 the three conflict options start unselected and picking one writes nothing', async () => {
    const world = await worldW1();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const row = sectionRows(page.root, '要决定')[0];
      expect(row).toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 2_000);
      const options = () => descendants(card(page.root) ?? page.root)
        .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'opt-top'));
      expect(options()).toHaveLength(3);
      /* 具名改坏: 第一个默认选中；D18 的“都是 false”红。 */
      expect(options().map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
      click(options()[0]!);
      await settle(() => options()[0]?.getAttribute('aria-checked') === 'true', 800);
      expect(options()[0]?.getAttribute('aria-checked')).toBe('true');
      expect(findClass(card(page.root)!, 'opt-body')).toBeDefined();
      expect(count(log, 'decisions/answer')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D19 详情 of the capped Task shows its class, who, the attempt and no last refusal', async () => {
    cap ??= await openCapWorld();
    const { page, log } = await bootDecide(hostTarget(cap));
    try {
      await opened(log);
      const requeue = await openCardWith(page.root, '重新入队');
      expect(requeue).toBeDefined();
      const more = findClass(card(page.root)!, 'dc-more');
      expect(more).toBeDefined();
      click(more!);
      await settle(() => cardFacts(page.root).length > 0, 3_000);
      /* 具名改坏: 详情把 `failure.automation.verdict.reason` 当失败类别；D19 的 `检查未通过` 红。 */
      expect(cardFacts(page.root).map((fact) => fact.key)).toEqual(expect.arrayContaining(['失败类别', '谁做的', '尝试', '最近拒绝']));
      expect(factOf(page.root, '失败类别')).toBe('检查未通过');
      expect(factOf(page.root, '尝试')).toContain('第 4 次尝试');
      expect(factOf(page.root, '最近拒绝')).toBe('');
      expect(textOf(page.root)).not.toContain('undefined');
      expect(textOf(page.root)).not.toContain('NaN');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
