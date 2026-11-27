import { afterEach, describe, expect, it } from 'vitest';
import { bootE3N, countRoute, quietPage, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { findAllClass, findButton, findElement } from './helpers/boot-page.js';
import { openW1 } from './helpers/E3N-world.js';
import { b2Reads } from './helpers/E3A-fixed.js';
import { bootSem, semLink, semPage, semPanelText, semReady, writeFlow } from './helpers/E3A-semantic.js';
import { openS8ESemanticWorld, S8E_LINKS, s8eWriteLink } from '../helpers/S8E-semantic-world.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3U main right column (batch 9 §9): the architecture tab's semantic switch,
 * the block above the tree, the four read states and the full-page link. The
 * words are the ruled ones; the counts are hand-computed from the one link.
 */

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const archTab = (root: FakeElement): FakeElement | undefined =>
  findElement(root, (element) => element.tagName.toLowerCase() === 'button'
    && (element.textContent ?? '').trim() === '架构图');


describe('E3U main right column semantic layer', () => {
  it('B9-M1 the arch tab switch reads on demand and the row links back with ?goal=&sem=', async () => {
    const world = await openS8ESemanticWorld();
    worlds.push(world);
    const written = await s8eWriteLink(world, S8E_LINKS.K1);
    const { page, log } = await bootE3N(world, 'Main', { search: '?goal=s8e-goal' });
    try {
      await quietPage(log);
      expect(countRoute(log, 'architecture/semantic-links')).toBe(0);
      click(archTab(page.root)!);
      await quietPage(log);
      const button = findButton(page.root, '语义联系')!;
      expect(button).toBeDefined();
      expect(button.getAttribute('aria-pressed')).toBe('false');
      click(button);
      await waitFor(() => countRoute(log, 'architecture/semantic-links') === 1);
      await waitFor(() => semPanelText(page.root).includes('条联系'));
      expect(semPanelText(page.root)).toContain('正在处理的文件上：0 条联系、0 条流程');
      click(findButton(page.root, '全部')!);
      await quietPage(log);
      await waitFor(() => semPanelText(page.root).includes('整个项目：1 条联系、0 条流程'));
      expect(semPanelText(page.root)).toContain('整个项目：1 条联系、0 条流程');
      const href = findElement(page.root, (element) => element.tagName.toLowerCase() === 'a'
        && (element.getAttribute('href') ?? '').includes('sem=' + written.noteId));
      expect(href).toBeDefined();
      expect(href!.getAttribute('href')).toBe('ArchOverview.dc.html?goal=s8e-goal&sem=' + written.noteId);
    } finally {
      await page.restore();
    }
  }, 90_000);

  it('B9-M3 #flow opens the arch tab and marks the steps on the tree', async () => {
    const world = await openS8ESemanticWorld();
    worlds.push(world);
    const k1 = await s8eWriteLink(world, S8E_LINKS.K1);
    const k3 = await s8eWriteLink(world, S8E_LINKS.K3);
    const flow = await writeFlow(world, { topic: '启动时核对没结束的执行', anchor: S8E_LINKS.K1.from,
      extraAnchors: [S8E_LINKS.K1.to] }, [k1, k3]);
    const { page, log } = await bootE3N(world, 'Main', { search: '?goal=s8e-goal', hash: '#flow=' + flow.noteId });
    try {
      await waitFor(() => archTab(page.root)?.getAttribute('aria-selected') === 'true');
      expect(countRoute(log, 'architecture/semantic-links')).toBe(1);
      click(findButton(page.root, '全部')!);
      await quietPage(log);
      await waitFor(() => textOf(page.root).includes('第 1 步'));
      expect(textOf(page.root)).toContain('第 1 步');
      expect(textOf(page.root)).toContain('第 2 步');
      /* item 12: the receipt's moduleId finds the row even when the id is not a path
         (`runtime`, `wg`), so the steps are marks and arcs, not 收在小格子里. */
      expect(textOf(page.root)).not.toContain('收在小格子里');
      expect(findAllClass(page.root, 'sem-arc').length).toBe(2);
    } finally {
      await page.restore();
    }
  }, 90_000);

  it('B9-M4 the current-work row names both modules, never a raw id', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const goalId = opened.world.goals.first.goalId;
    const ref = (moduleId: string) => ({ projectId: opened.world.scope.projectId, moduleId });
    const workScope = { status: 'ready', value: {
      workspace: { ...opened.world.scope }, runs: [],
      files: [{ kind: 'file', nodeRef: { kind: 'file', path: 'src/app/host.ts' }, label: 'host.ts',
        path: 'src/app/host.ts', module: { ref: ref('src/app'), name: 'Host', path: 'src/app', paths: ['src/app'], ancestor: [] }, tasks: [] }],
      modules: [], counts: { runs: 0, files: 1, modules: 1 }, sources: { catalog: 'available' },
    } };
    const link = semLink({ noteId: 'mw1', from: { moduleId: 'src/app', path: 'src/app/host.ts' },
      to: { moduleId: 'src/core/work-graph', path: 'src/core/work-graph/state/task-machine.ts' } });
    const answers = { ...b2Reads(opened.world, goalId), 'architecture/work-scope': workScope,
      'architecture/semantic-links': semReady(semPage([link])),
      'architecture/semantic-flows': semReady(semPage([])) };
    const { page, log } = await bootSem(opened.world, answers, { search: '?goal=' + goalId, name: 'Main' });
    try {
      await quietPage(log);
      click(archTab(page.root)!);
      await quietPage(log);
      click(findButton(page.root, '语义联系')!);
      await waitFor(() => semPanelText(page.root).includes('正在处理的文件上：1 条联系'));
      const panel = semPanelText(page.root);
      expect(panel).toContain('正在处理的文件上：1 条联系、0 条流程');
      expect(panel).toContain('Host → WorkGraph');
      /* item 11: the other end is outside the work-filtered tree; its name must still come
         from the whole catalog, not `src/core/work-graph`. */
      expect(panel).not.toContain('src/core/work-graph');
    } finally {
      await page.restore();
    }
  });

  it('B9-M2 an empty project says so and keeps the tree', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=' + opened.world.goals.first.goalId });
    try {
      await quietPage(log);
      click(archTab(page.root)!);
      await quietPage(log);
      click(findButton(page.root, '语义联系')!);
      await waitFor(() => semPanelText(page.root).includes('这个项目还没有写下的联系和流程'));
      expect(semPanelText(page.root)).toContain('这个项目还没有写下的联系和流程');
    } finally {
      await page.restore();
    }
  }, 90_000);
});
