import { afterEach, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import { countRoute, descendants, hasClass, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { detailText, nodeNamed, relationGroup } from './helpers/E3A-page.js';
import {
  B2, boxes, bootB2, countLabels, detailState, enterWorkGraph, graphNode, insideBox, placed,
} from './helpers/E3A-fixed.js';
import type { FakeElement } from './helpers/dom.js';
import { openS6ARequestWorld, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-5 (DARR B2 tests §2.1–§2.3): the reference counts on the first screen and
 * inside WorkGraph, WorkGraph's interface groups layered by their references,
 * and the "改动" words of a possible-only, an incomplete-listed, an unlisted and
 * a no-Goal node. Every row boots B2-F (`tests/ui/helpers/E3A-fixed.ts`): the
 * real Host answers the page itself, the fixed reads are the page's input and
 * every expectation is hand-computed from them.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function openB2(): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({ backend: 'memory' });
  worlds.push(world);
  return world;
}

function nodeAt(root: FakeElement, name: string): { name: string; y: number } {
  const node = graphNode(root, name);
  expect(node).toBeDefined();
  return { name, y: placed(node!).y };
}

describe('E3A-5 reference counts and the interface layers', () => {
  it('B2-01 the first screen labels Host → WorkGraph with its 3 references, not 1', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      /* 具名改坏: 把 `levelEdges` 的 `e.n += count` 改回 `e.n += 1`；B2-01 的 `3` 变成 `1`，红。
         59 和 114 是 WorkGraph 里面的边，首屏不出现。 */
      expect(countLabels(page.root)).toEqual(['3']);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-02 inside WorkGraph the groups sit in one box and the two interface edges carry 59 and 114', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      enterWorkGraph(page.root);
      /* 具名改坏: 恢复数据模式 `:1259` 的 4 个一行网格（`box:null, grid:true`）；
         B2-02 的 `ov-box`/`ov-edge`/`ov-count` 红。 */
      expect(boxes(page.root).map((box) => box.name)).toContain('WorkGraph');
      const edges = descendants(page.root).filter((element) => element.tagName.toLowerCase() === 'svg' && hasClass(element, 'ov-edge'));
      expect(edges.length).toBeGreaterThanOrEqual(2);
      const labels = countLabels(page.root);
      expect(labels.length).toBeGreaterThanOrEqual(2);
      expect(labels).toEqual(expect.arrayContaining(['59', '114']));
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-03a the 59 edge detail names both groups and says 59 处引用', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      enterWorkGraph(page.root);
      const label = findElement(page.root, (element) => hasClass(element, 'ov-count') && textOf(element) === '59');
      expect(label).toBeDefined();
      click(label!);
      const text = detailText(page.root);
      expect(text).toContain('architecture');
      expect(text).toContain('model');
      const occurrences = relationGroup(page.root, '引用处数');
      expect(occurrences).toBeDefined();
      /* 具名改坏: 把边详情的 `引用处数` 留在 `this.nt()`（不改成 `this.fmt(e.n) + ' 处引用'`）；
         B2-03a 的 `59 处引用` 红。 */
      expect(textOf(occurrences!)).toBe('59 处引用');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-03b the same edge detail keeps 来源文件 as 还没接通', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      enterWorkGraph(page.root);
      const label = findElement(page.root, (element) => hasClass(element, 'ov-count') && textOf(element) === '59');
      expect(label).toBeDefined();
      click(label!);
      const sources = relationGroup(page.root, '来源文件');
      expect(sources).toBeDefined();
      /* 具名改坏: 把 `来源文件` 也写成 `this.fmt(e.n)`（或写来源清单）；B2-03b 的 `还没接通` 红。 */
      expect(textOf(sources!)).toBe('还没接通');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-04 the outer layer Host counts its 3 references into WorkGraph, not 1 edge', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      enterWorkGraph(page.root);
      const inbound = findElement(page.root, (element) => hasClass(element, 'ov-bound') && !hasClass(element, 'is-out'));
      expect(inbound).toBeDefined();
      const host = descendants(inbound!).find((element) => hasClass(element, 'ov-bi') && textOf(element).includes('Host'));
      expect(host).toBeDefined();
      /* 具名改坏: 把 `bout/bin` 的计数从 `sum(count)` 改回 `length`；B2-04 的 `3` 变 `1`，红。 */
      expect(textOf(findClass(host!, 'num'))).toBe('3');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-05a WorkGraph is layered by its references: tasks over architecture over model, in the WorkGraph box', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      enterWorkGraph(page.root);
      const tasks = nodeAt(page.root, 'tasks');
      const architecture = nodeAt(page.root, 'architecture');
      const model = nodeAt(page.root, 'model');
      /* 具名改坏: 把 `lpLayers` 的方向反过来（按 `to` 排）；B2-05a 的上下关系红。 */
      expect(tasks.y).toBeLessThan(architecture.y);
      expect(architecture.y).toBeLessThan(model.y);
      expect(boxes(page.root).map((box) => box.name)).toContain('WorkGraph');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-05b the bottom layer holds the five groups below architecture and wraps after four', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      enterWorkGraph(page.root);
      const five = ['model', 'persistence', 'views', 'runtime', 'notes'].map((name) => nodeAt(page.root, name));
      const architecture = nodeAt(page.root, 'architecture');
      const top = Math.min(...five.map((node) => node.y));
      /* The five share one layer of their own, under architecture (model's
         only edge is the incoming architecture → model). */
      expect(architecture.y).toBeLessThan(top);
      const all = descendants(page.root).filter((element) => hasClass(element, 'ov-node'))
        .map((element) => ({ name: textOf(findClass(element, 'ov-name')), y: placed(element).y }));
      const bottom = all.filter((node) => node.y >= top);
      expect(bottom.map((node) => node.name)).toEqual(expect.arrayContaining(five.map((node) => node.name)));
      expect(bottom.map((node) => node.name)).not.toContain('tasks');
      const rows = [...new Set(bottom.map((node) => node.y))].sort((a, b) => a - b)
        .map((y) => bottom.filter((node) => node.y === y).length);
      /* 具名改坏: 把 `layerRows` 的每行 4 个改成 2 个；这一层从 2 行变 3 行，B2-05b 红。 */
      expect(rows).toHaveLength(2);
      expect(rows[0]).toBe(4);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it.each([
    ['① persistence.ts has code: it stays in the layers', false, false],
    ['② persistence.md has no code: it goes to 不参与引用', true, true],
  ])('B2-06 %s', async (_name, persistenceMd, inBand) => {
    const world = await openB2();
    const { page } = await bootB2(world, { variant: { persistenceMd } });
    try {
      enterWorkGraph(page.root);
      const persistence = graphNode(page.root, 'persistence');
      expect(persistence).toBeDefined();
      const band = boxes(page.root).filter((box) => box.name === '不参与引用');
      /* 具名改坏: 把 `main` 的条件从 `linked[id] || code > 0` 改成只看 `linked[id]`；① 红。
         或把条件改成恒 `true`；② 的 `.md` 留在 main，红。 */
      expect(band.some((box) => insideBox(persistence!, box.element))).toBe(inBand);
    } finally {
      await page.restore();
    }
  }, 60_000);
});

describe('E3A-5 the 改动 words', () => {
  it('B2-09 a possible-only file says 可能改过', async () => {
    const world = await openB2();
    const { page } = await bootB2(world);
    try {
      const host = nodeNamed(page.root, B2.host);
      expect(host).toBeDefined();
      click(host!);
      const state = detailState(page.root);
      /* 具名改坏: 把 possible 当 definite（`touched:1`）；B2-09 的 `可能改过` 变 `改动 1`，红。 */
      expect(state).toContain('可能改过');
      expect(state).not.toContain('改动 0');
      expect(state).not.toContain('改动 1');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-10a an incomplete change scope words a listed definite file 改动至少 1', async () => {
    const world = await openB2();
    const { page } = await bootB2(world, { variant: { complete: false } });
    try {
      enterWorkGraph(page.root);
      const machine = nodeNamed(page.root, B2.machine);
      expect(machine).toBeDefined();
      click(machine!);
      const state = detailState(page.root);
      /* 具名改坏: 把 `complete` 当 true（漏“至少”）；B2-10a 的 `改动至少 1` 红。 */
      expect(state).toContain('改动至少 1');
      expect(state).not.toContain('改动 1');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-10b an incomplete change scope leaves an unlisted file 还没接通', async () => {
    const world = await openB2();
    const { page } = await bootB2(world, { variant: { complete: false } });
    try {
      const boot = nodeNamed(page.root, B2.boot);
      expect(boot).toBeDefined();
      click(boot!);
      const state = detailState(page.root);
      /* 具名改坏: 没列的文件无条件写 `改动 0`；B2-10b 的 `还没接通` 红。 */
      expect(state).toContain('还没接通');
      expect(state).not.toContain('改动 0');
      expect(state).not.toContain('未改动');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-11 without a Goal the page reads no change scope and says 还没接通', async () => {
    const world = await openB2();
    const { page, log } = await bootB2(world, { goal: false });
    try {
      const workGraph = graphNode(page.root, 'WorkGraph');
      expect(workGraph).toBeDefined();
      const count = textOf(findClass(workGraph!, 'ov-cnt'));
      expect(count).toContain('还没接通');
      expect(count).not.toContain('改动 0');
      /* 具名改坏: 没有目标也读 change-scope；B2-11 的 0 次/`还没接通` 红。 */
      expect(countRoute(log, 'architecture/change-scope')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
