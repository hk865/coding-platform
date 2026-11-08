import { afterEach, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, countRoute, waitFor } from './helpers/E3N-page.js';
import { click, hover } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { bootArchMissingObservation, archObservationState, seedArchWorld } from './helpers/E3A-world.js';
import {
  currentCrumb, detailText, nodeNamed, pageText,
} from './helpers/E3A-page.js';
import { asRecord } from '../../src/ui/values.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-2 (E3ARCH tests §2.2): the declared top layer and its responsibility,
 * the folder observation, the external layers of one layer, and the ruled
 * no-observation text. Every read is the real Host's except the one controlled
 * observation state that the registration's own L8 capture makes unreachable.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function openWithArch(): Promise<S6ARequestWorld> {
  const opened = await openW1();
  worlds.push(opened.world);
  await seedArchWorld(opened.world);
  return opened.world;
}

describe('E3A-2 the declared tree and the observed tree', () => {
  it('E3A-06 the first layer is the adopted module and its responsibility', async () => {
    const world = await openWithArch();
    const { page } = await bootE3N(world, 'ArchOverview');
    try {
      /* The first screen's top-level node is the module head (`ov-head`), not
         the project's layer title (`ov-top`). */
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      /* 具名改坏: 用 `paths` 推父子/用目录名替模块名；E3A-06 的 `WorkGraph` 红。 */
      expect(top!.textContent).toContain('WorkGraph');
      hover(top!);
      const card = findClass(page.root, 'hcard');
      expect(card).toBeDefined();
      expect(card!.textContent).toContain('目标、任务与执行的正式事实');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-07 the folder view reads the observed capture and nests the two files', async () => {
    const world = await openWithArch();
    /* The capture seed has already settled; read its pointer before the page so
       the row does not add a route while the page is mid-read. */
    const state = await archObservationState(world);
    const persisted = asRecord(asRecord(state['current'])['persistedRef']);
    const { page, log } = await bootE3N(world, 'ArchOverview');
    try {
      /* The prototype's view switch lives inside WorkGraph. */
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      click(top!);
      click(findButton(page.root, '进入这一层')!);
      const switchButton = findButton(page.root, '按文件夹观测');
      expect(switchButton).toBeDefined();
      /* 具名改坏: 把 `query` 的 `selection.capture` 改成 `current.captureRef`；
         E3A-07 的 `capture` 等值断言红。或目录视图只按 catalog 的 paths 分组；
         `src/other/other.ts` 节点断言红。 */
      click(switchButton!);
      await waitFor(() => countRoute(log, 'architecture/query') >= 1, 3_000);
      /* The folder nodes come from `files/list`, read after the query; wait for
         that reply before reading the DOM and the next route. */
      await waitFor(() => findElement(page.root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('ov-node')
        && (findClass(element, 'ov-name')?.textContent ?? '').trim() === 'src/other') !== undefined, 5_000);
      const call = [...log.calls].reverse().find((entry) => entry.route === 'architecture/query');
      expect(call).toBeDefined();
      const selection = asRecord(asRecord(call!.input)['selection']);
      expect(selection['kind']).toBe('observed');
      expect(selection['capture']).toEqual(persisted);
      const src = findElement(page.root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('ov-node')
        && (findClass(element, 'ov-name')?.textContent ?? '').trim() === 'src');
      const other = findElement(page.root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('ov-node')
        && (findClass(element, 'ov-name')?.textContent ?? '').trim() === 'src/other');
      expect(src).toBeDefined();
      expect(other).toBeDefined();
      /* The folder node's cells are the files it holds; the full path is not
         repeated in the folder's own text. */
      const holds = (folder: typeof src, name: string): boolean => folder !== undefined
        && findElement(folder, (element) => (element.getAttribute('aria-label') ?? '').includes(name)) !== undefined;
      expect(holds(src, 'module.ts')).toBe(true);
      expect(holds(other, 'other.ts')).toBe(true);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-08 WorkGraph has one external layer, Other, with one incoming edge', async () => {
    const world = await openWithArch();
    const { page } = await bootE3N(world, 'ArchOverview');
    try {
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      click(top!);
      click(findButton(page.root, '进入这一层')!);
      const inbound = findElement(page.root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('ov-bound')
        && !(element.getAttribute('class') ?? '').split(/\s+/).includes('is-out'));
      expect(inbound).toBeDefined();
      const links = findAllClass(inbound!, 'ov-bi');
      /* 具名改坏: 在页面里按模块声明 `dependencies` 画边；E3A-08 的“外部层只有
         Other/计数 1”红。或把边计数写成 `edges.length`；E3A-08 的 `1` 红。 */
      expect(links).toHaveLength(1);
      expect(links[0]!.textContent).toContain('Other');
      expect(links[0]!.textContent).toContain('1');
      const outbound = findElement(page.root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('ov-bound')
        && (element.getAttribute('class') ?? '').split(/\s+/).includes('is-out'));
      expect(outbound).toBeUndefined();
      click(links[0]!);
      expect(currentCrumb(page.root)).toBe('Other');
      /* A15's per-file aggregate is the ruled not-connected item, not an edge count. */
      expect(detailText(page.root)).toContain('还没接通');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-07e no observation shows the page’s own empty text and keeps the declared modules', async () => {
    const world = await openWithArch();
    const { page } = await bootArchMissingObservation(world);
    try {
      /* lead 11-09 ruling 1: the page's own empty state, not the global not_found text. */
      expect(pageText(page)).toContain('还没有观测结果');
      expect(pageText(page)).toContain('WorkGraph');
      expect(pageText(page)).not.toContain('找不到这个目标。');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
