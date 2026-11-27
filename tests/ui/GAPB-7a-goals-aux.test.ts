import { afterEach, describe, expect, it } from 'vitest';
import { findClass, type BootedPage } from './helpers/boot-page.js';
import { labelled, typeInto } from './helpers/E3D-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  auxFileRows, auxRowName, bootE3N, countRoute, descendants, hasClass, pickTab, textOf, waitFor, type PageLog,
} from './helpers/E3N-page.js';
import { buttonText } from './helpers/E3M-world.js';
import { e3gSettled, openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * G4 (B7a) 目标页右栏接真实文件（`g245-start.md` §G4，卡 B7a）。
 *
 * G4-1 今天红：`readGoals`（`src/ui/boot.ts:4862`）的 `_demand` 没接，点“文件”不发
 * `files/list`；`Goals.dc.html:1217` 的 `axTree()` 仍是原型样例，所以树上没有 W1 的
 * `src/module.ts`，反而有样例 `src/app/server.ts`。Astra 把 `readGoals` 改成按工具页签调
 * `readPageAux`、`GoalsData.aux` 喂给 `axView` 的真实 `fileRows` 后绿。
 *
 * G4-2 今天红：同上，树里没有 `src/module.ts`，点不到文件页，也就没有 `files/read` 和
 * 真实行号引用。Astra 用 `files/list`/`files/read` 画文件页、保留 `sendBoard` 的 `refs`
 * 拼法后绿。
 *
 * G4-3 今天绿（本树实测）：构造器已经把 `axPages` 清成空（`Goals.dc.html:645`），
 * 首屏在架构图，没有开着的样例文件页。Astra 后的绿未证明；数据模式必须继续清掉样例页，
 * 这格守住它。
 */

const worlds: E3GWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.world.close();
});

async function openGoals(opened: E3GWorld): Promise<{ page: BootedPage; log: PageLog }> {
  const booted = await bootE3N(opened.world, 'Goals');
  await e3gSettled(booted.log, true);
  return booted;
}

/** The row of `path`, opening its folders one click each; `undefined` when a level is absent. */
async function fileRow(root: FakeElement, path: string): Promise<FakeElement | undefined> {
  const named = (name: string): FakeElement | undefined =>
    auxFileRows(root).find((element) => auxRowName(element) === name);
  if (auxFileRows(root).length === 0) {
    try { await waitFor(() => auxFileRows(root).length > 0, 2_000); } catch { return undefined; }
  }
  const parts = path.split('/');
  for (const folder of parts.slice(0, -1)) {
    const row = named(folder);
    if (row === undefined) return undefined;
    if (row.getAttribute('aria-expanded') !== 'true') {
      click(row);
      try { await waitFor(() => named(parts.at(-1)!) !== undefined, 1_500); } catch { return undefined; }
    }
  }
  return named(parts.at(-1)!);
}

const callsFrom = (log: PageLog, route: string, from: number): PageLog['calls'] =>
  log.calls.slice(from).filter((call) => call.route === route);

describe('G4 目标页右栏接真实文件', () => {
  it('G4-1 点文件: one files/list, the W1 tree and no sample src/app/server.ts', async () => {
    /* 今天红在 `tests/ui/GAPB-7a-goals-aux.test.ts:73`（一次 `files/list` 断言）：`readGoals`
       的 `_demand` 没接，点“文件”不发读，树仍是 `axTree()` 样例；Astra 落地后读一次、画出 W1 真实树，转绿。 */
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openGoals(opened);
    try {
      const from = await pickTab(page, log, '文件');
      /* 具名改坏: `readGoals` 不调 `readPageAux`（或 `Goals.dc.html` 仍用 `axTree()` 画 `fileRows`）；
         这一句红，树也仍是样例。 */
      expect(callsFrom(log, 'files/list', from), 'one files/list after opening 文件').toHaveLength(1);
      expect(await fileRow(page.root, 'src/module.ts'), 'W1 has the real src/module.ts row').toBeDefined();
      expect(await fileRow(page.root, 'src/app/server.ts'), 'the prototype sample src/app/server.ts is gone').toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('G4-2 打开 src/module.ts 选第 1 行: one files/read and the real reference', async () => {
    /* 今天红在 `tests/ui/GAPB-7a-goals-aux.test.ts:90`（真实 `src/module.ts` 行）：树上没有这个文件，
       也就没有 `files/read` 和引用；Astra 落地后文件页、行号和 `references` 都对上，转绿。 */
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openGoals(opened);
    try {
      await pickTab(page, log, '文件');
      const row = await fileRow(page.root, 'src/module.ts');
      expect(row, 'the real src/module.ts row is clickable').toBeDefined();
      const before = log.calls.length;
      click(row!);
      await waitFor(() => callsFrom(log, 'files/read', before).some((call) => call.reply !== undefined), 3_000);
      const reads = callsFrom(log, 'files/read', before);
      expect(reads, 'one files/read for the clicked file').toHaveLength(1);
      expect((reads[0]!.input as { path?: unknown }).path).toBe('src/module.ts');
      await waitFor(() => {
        const code = findClass(page.root, 'fcode');
        return code !== undefined && descendants(code).some((element) => hasClass(element, 'fl-n'));
      }, 3_000);
      const code = findClass(page.root, 'fcode')!;
      const first = descendants(code).find((element) => hasClass(element, 'fl-n') && textOf(element) === '1');
      expect(first, 'the first line of the real file page').toBeDefined();
      click(first!);
      await waitFor(() => descendants(code).some((element) => hasClass(element, 'is-sel')), 1_000);
      const quote = buttonText(findClass(page.root, 'fp-bar'), '引用到草稿');
      expect(quote, '引用到草稿 with one line selected').toBeDefined();
      click(quote!);
      await waitFor(() => findClass(page.root, 'composer-quote') !== undefined, 1_000);
      expect(textOf(findClass(findClass(page.root, 'composer-quote')!, 'cq-path'))).toBe('src/module.ts');
      expect(textOf(findClass(findClass(page.root, 'composer-quote')!, 'cq-lines'))).toBe('第 1 行');
      /* 具名改坏: `Goals.dc.html` 的 `sendBoard` 把 `refsIn` 写成 `null`（或 `startLine`/`endLine` 写
         `null`）；`references` 这一句红。 */
      typeInto(page.root, 'goals-composer', '看这一行');
      click(labelled(page.root, '发送')!);
      await waitFor(() => log.submits.length > 0, 3_000);
      expect(countRoute(log, 'requests/submit')).toBe(1);
      const submit = log.calls.find((call) => call.route === 'requests/submit')!;
      const input = (submit.body as { input: Record<string, unknown> }).input;
      expect(input['text']).toBe('看这一行');
      expect(input['references']).toEqual([{ path: 'src/module.ts', startLine: 1, endLine: 1, snapshot: null }]);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('G4-3 首屏没有开着的样例文件页', async () => {
    /* 今天绿，作为数据模式守卫：构造器已把 `axPages` 清空，`tests/ui/GAPB-7a-goals-aux.test.ts:137` 的 `.fpage` 断言通过；
       Astra 落地后数据模式必须继续清掉样例页，这格守住它。 */
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openGoals(opened);
    try {
      const samples = ['src/core/work-graph/state/task-machine.ts', 'src/app/server.ts'];
      /* 具名改坏: 构造器把 `axPages` 写回样例两条并把 `ptab` 设成 `f:src/app/server.ts`；
         `.fpage` 和样例路径这两句红。 */
      expect(findClass(page.root, 'fpage'), 'no file page open on the first screen').toBeUndefined();
      const openPaths = descendants(page.root).filter((element) => hasClass(element, 'fp-path'))
        .map((element) => element.getAttribute('title'));
      expect(openPaths.filter((path): path is string => path !== null && samples.includes(path))).toEqual([]);
      /* The sample pages never read: this is not the whole rule, only its silent half. */
      expect(countRoute(log, 'files/read')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
