/** E3A-10 (7D2 batch 10 X4): the ArchOverview caption's commit bar and confirmation box. World:
 * `KLS2C-knowledge-host.ts` (memory, real git) with the adoption's two untracked `.workbench` files.
 * The prefilled message goes as `null` (ruling 5); the answer is `ready` and git itself is not read. */
import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { pageText } from './helpers/E3A-page.js';
import { typeInto } from './helpers/E3D-page.js';
import type { FakeElement } from './helpers/dom.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, KLS2C_NEVER_IDLE_MS, openKLS2CHost, type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';
const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});
const exactButton = (root: FakeElement, text: string) =>
  findElement(root, (element) => element.tagName.toLowerCase() === 'button' && element.textContent.trim() === text);
describe('E3A-10 the commit bar and confirmation box', () => {
  it('E3A-10 commits the two adopted knowledge paths from the caption, sending null for the prefilled message',
    async () => {
      const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
      worlds.push(world);
      world.git(['config', 'user.name', 'E3A10 Person']);
      world.git(['config', 'user.email', 'e3a10-person@example.invalid']);
      await kls2cAdopt(world, ['core']);
      const branch = world.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      const { url } = await world.host.listen();
      const { page, log } = await bootE3N({ base: url, token: await readPageToken(url) }, 'ArchOverview');
      try {
        /* FIRST STEP: this world must read as an ArchOverview page; the two extra
           per-workspace reads must not turn a published page into an error page. */
        await waitFor(() => countRoute(log, 'lines/list') >= 1, 30_000);
        expect(findClass(page.root, 'ov-cap-l')).toBeDefined();
        expect(pageText(page)).not.toContain('找不到这个目标。');
        expect(pageText(page)).not.toContain('暂时读不到');

        await waitFor(() => pageText(page).includes('架构图和注记有 2 处改动还没提交'), 30_000);
        click(findButton(page.root, '提交架构图和注记')!);

        const side = findClass(page.root, 'ov-side')!;
        const box = findElement(side, (element) => element.getAttribute('role') === 'alertdialog');
        expect(box).toBeDefined();
        expect(box!.textContent).toContain('提交架构图和注记');
        expect(box!.textContent)
          .toContain(`只提交 .workbench/ 里的 2 个文件，提交到当前分支 ${branch}，不碰代码。`);
        const message = findElement(box!, (element) => element.tagName.toLowerCase() === 'textarea')!;
        expect(message.value).toBe('更新架构图和注记（2 个文件）');
        expect(box!.textContent).toContain('提交说明');

        click(exactButton(box!, '提交')!);
        await waitFor(() => countRoute(log, 'knowledge/commit') === 1, 10_000);
        const call = callsTo(log, 'knowledge/commit')[0]!;
        await waitFor(() => call.reply !== undefined, 30_000);
        expect((call.input as Record<string, unknown>)['message']).toBeNull();
        expect((call.reply as Record<string, unknown>)['status']).toBe('ready');
        await waitFor(() => !pageText(page).includes('架构图和注记有 2 处改动还没提交'), 30_000);
        expect(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')).toBeUndefined();
        expect(countRoute(log, 'knowledge/commit')).toBe(1);
      } finally {
        await page.restore();
      }
    }, 300_000);

  it('E3A-10b a second click on the bar while the commit is in flight neither reopens the box nor sends twice',
    async () => {
      const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
      worlds.push(world);
      world.git(['config', 'user.name', 'E3A10 Person']);
      world.git(['config', 'user.email', 'e3a10-person@example.invalid']);
      await kls2cAdopt(world, ['core']);
      const { url } = await world.host.listen();
      let release = () => {};
      let heldNow = false;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const { page, log } = await bootE3N({ base: url, token: await readPageToken(url) }, 'ArchOverview',
        { before: { 'knowledge/commit': async () => { heldNow = true; await held; } } });
      try {
        await waitFor(() => pageText(page).includes('架构图和注记有 2 处改动还没提交'));
        click(findButton(page.root, '提交架构图和注记')!);
        typeInto(page.root, 'ov-commit-msg', '整理 WorkGraph 的注记');
        click(exactButton(page.root, '提交')!);
        await waitFor(() => heldNow);
        /* 具名改坏: 在途时提示条按钮把 busy 改回 false 并换回预填；本行的第二下和预填红。 */
        click(findButton(page.root, '提交架构图和注记')!);
        expect(findElement(page.root, (element) => element.getAttribute('id') === 'ov-commit-msg')!.value)
          .toBe('整理 WorkGraph 的注记');
        click(exactButton(page.root, '提交')!);
        release();
        await waitFor(() => callsTo(log, 'knowledge/commit')[0]?.reply !== undefined);
        await waitFor(() => !pageText(page).includes('架构图和注记有 2 处改动还没提交'));
        expect(countRoute(log, 'knowledge/commit')).toBe(1);
        /* 人动过的字原样送出，不被“没动过”吞成 null。 */
        expect((callsTo(log, 'knowledge/commit')[0]!.input as Record<string, unknown>)['message'])
          .toBe('整理 WorkGraph 的注记');
      } finally {
        release();
        await page.restore();
      }
    }, 300_000);

  it('E3A-10c a reread that adds a file keeps an untouched message null and moves the prefill',
    async () => {
      const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
      worlds.push(world);
      world.git(['config', 'user.name', 'E3A10 Person']);
      world.git(['config', 'user.email', 'e3a10-person@example.invalid']);
      await kls2cAdopt(world, ['core']);
      const { url } = await world.host.listen();
      const { page, log } = await bootE3N({ base: url, token: await readPageToken(url) }, 'ArchOverview',
        { mode: 'controlled' });
      try {
        await waitFor(() => pageText(page).includes('架构图和注记有 2 处改动还没提交'));
        click(findButton(page.root, '提交架构图和注记')!);
        const draft = () => findElement(page.root, (element) => element.getAttribute('id') === 'ov-commit-msg')!;
        expect(draft().value).toBe('更新架构图和注记（2 个文件）');
        world.edit('.workbench/extra.txt', 'x\n');
        await waitFor(() => log.openings.length > 0);
        log.openings.at(-1)!.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
        await waitFor(() => pageText(page).includes('只提交 .workbench/ 里的 3 个文件'));
        /* 具名改坏: 用当前文件数重算预填再和打开时存下的字比；本行的 3 个文件/下面的 null 红。 */
        expect(draft().value).toBe('更新架构图和注记（3 个文件）');
        click(exactButton(page.root, '提交')!);
        await waitFor(() => countRoute(log, 'knowledge/commit') === 1);
        const call = callsTo(log, 'knowledge/commit')[0]!;
        await waitFor(() => call.reply !== undefined);
        expect((call.input as Record<string, unknown>)['message']).toBeNull();
      } finally {
        await page.restore();
      }
    }, 300_000);
});
