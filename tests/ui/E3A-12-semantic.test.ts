import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, countRoute, quietPage, textOf, waitFor, type PageLog } from './helpers/E3N-page.js';
import { click, hover } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { b2Reads, enterWorkGraph, graphNode, nodeHead } from './helpers/E3A-fixed.js';
import { contactCount, bootSem, semReady, semFlow, semLabelTexts, semLabels, semLines, semLink,
  semPage, semPanelText, semRows } from './helpers/E3A-semantic.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-12 (batch 9): the semantic layer on the full architecture page. The
 * fixed semantic answers are the page's input; the expectations are the ruled
 * words. The switch is page state only (4-2 甲), so every request count is the
 * page's own.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const WG = 'src/core/work-graph';
const AR = 'src/core/agent-runtime';

async function b2World(): Promise<S6ARequestWorld> {
  const opened = await openW1();
  worlds.push(opened.world);
  return opened.world;
}

function answersFor(world: S6ARequestWorld, links: ReturnType<typeof semLink>[], flows: ReturnType<typeof semFlow>[]): Record<string, unknown> {
  const goalId = world.goals.first.goalId;
  return {
    ...b2Reads(world, goalId),
    'architecture/semantic-links': semReady(semPage(links)),
    'architecture/semantic-flows': semReady(semPage(flows)),
  };
}

const goalSearch = (world: S6ARequestWorld): string => '?goal=' + world.goals.first.goalId;

function switchButton(root: Parameters<typeof findButton>[0]): NonNullable<ReturnType<typeof findButton>> {
  const button = findButton(root, '语义联系');
  expect(button).toBeDefined();
  return button!;
}

async function openLayer(world: S6ARequestWorld, links: ReturnType<typeof semLink>[], flows: ReturnType<typeof semFlow>[] = [],
  extra: { before?: Record<string, (log: PageLog) => Promise<void>>; answers?: Record<string, unknown> } = {}) {
  const { page, log } = await bootSem(world, { ...answersFor(world, links, flows), ...(extra.answers ?? {}) },
    { search: goalSearch(world), ...(extra.before === undefined ? {} : { before: extra.before }) });
  click(switchButton(page.root));
  await waitFor(() => countRoute(log, 'architecture/semantic-links') >= 1);
  await quietPage(log);
  return { page, log };
}

describe('E3A-12 semantic layer', () => {
  it('B9-17 the semantic line layer is positioned inside the stage', () => {
    /* A fake DOM has no layout: the one thing that can be asserted here is the rule
       that makes the svg's inline left/top take effect. */
    const kit = readFileSync(new URL('../../src/ui/boards/kit.css', import.meta.url), 'utf8');
    expect(kit).toContain('.ov-stage > svg.ov-sem { position: absolute; overflow: visible; pointer-events: none; }');
  });

  it('B9-01 the switch is the only reader; off reads neither route', async () => {
    const world = await b2World();
    const links = [semLink({ noteId: 'n1', from: { moduleId: 'src/ui', path: 'src/ui/boot.ts' },
      to: { moduleId: WG, path: `${WG}/state/task-machine.ts` } })];
    const { page, log } = await bootSem(world, answersFor(world, links, []), { search: goalSearch(world) });
    try {
      expect(countRoute(log, 'architecture/semantic-links')).toBe(0);
      expect(countRoute(log, 'architecture/semantic-flows')).toBe(0);
      const button = switchButton(page.root);
      expect(button.getAttribute('aria-pressed')).toBe('false');
      click(button);
      await waitFor(() => countRoute(log, 'architecture/semantic-links') === 1);
      await waitFor(() => countRoute(log, 'architecture/semantic-flows') === 1);
      await quietPage(log);
      click(button);
      await quietPage(log);
      const after = countRoute(log, 'architecture/semantic-links');
      await new Promise((resolve) => setTimeout(resolve, 400));
      /* off withdraws: no new read on the way out */
      expect(countRoute(log, 'architecture/semantic-links')).toBe(after);
      expect(findButton(page.root, '语义联系')!.getAttribute('aria-pressed')).toBe('false');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-02 the switch is not written to the URL, storage or the next visit', async () => {
    const world = await b2World();
    const links = [semLink({ noteId: 'n1' })];
    const first = await bootSem(world, answersFor(world, links, []), { search: goalSearch(world) });
    const url = globalThis.location.search;
    try {
      click(switchButton(first.page.root));
      await waitFor(() => countRoute(first.log, 'architecture/semantic-links') === 1);
      expect(globalThis.location.search).toBe(url);
      expect(globalThis.location.search).not.toContain('sem=');
    } finally {
      await first.page.restore();
    }
    const again = await bootSem(world, answersFor(world, links, []), { search: url });
    try {
      await quietPage(again.log);
      expect(switchButton(again.page.root).getAttribute('aria-pressed')).toBe('false');
      expect(countRoute(again.log, 'architecture/semantic-links')).toBe(0);
      expect(globalThis.location.search).not.toContain('sem=');
    } finally {
      await again.page.restore();
    }
  }, 60_000);

  it('B9-03 over 20 module pairs fall back to the hovered node and count 联系 n', async () => {
    const world = await b2World();
    const modules = ['src/ui', 'src/app', 'src/composition', 'src/business/workflow', AR, WG,
      'src/core/workspace', 'src/core/record-store', 'src/contracts', 'vendor/coding-agent'];
    const rest = modules.filter((id) => id !== 'src/ui');
    /* 21 distinct unordered pairs; UI sits in exactly one, so hovering it draws one line. */
    const pairs: Array<[string, string]> = [['src/ui', rest[0]!]];
    for (let i = 0; i < rest.length && pairs.length < 21; i += 1) {
      for (let j = i + 1; j < rest.length && pairs.length < 21; j += 1) pairs.push([rest[i]!, rest[j]!]);
    }
    expect(pairs).toHaveLength(21);
    const links = pairs.map(([from, to], index) => semLink({ noteId: 'p' + index,
      from: { moduleId: from, path: from + '/a.ts' }, to: { moduleId: to, path: to + '/b.ts' } }));
    expect(links.length).toBe(21);
    const { page, log } = await openLayer(world, links);
    try {
      expect(semLines(page.root)).toHaveLength(0);
      expect(contactCount(page.root, 'UI')).toContain('联系 1');
      hover(nodeHead(graphNode(page.root, 'UI')!)!);
      await waitFor(() => semLines(page.root).length > 0);
      expect(semLines(page.root)).toHaveLength(1);
      expect(countRoute(log, 'architecture/semantic-links')).toBeGreaterThan(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-03b eleven bidirectional pairs still draw all', async () => {
    const world = await b2World();
    const modules = ['src/ui', 'src/app', 'src/composition', 'src/business/workflow', AR, WG,
      'src/core/workspace', 'src/core/record-store', 'src/contracts', 'vendor/coding-agent'];
    /* 11 unordered pairs; each carries both directions, so a directed count is 22. */
    const pairs: Array<[string, string]> = [
      ['src/ui', 'src/app'], ['src/ui', 'src/composition'], ['src/ui', 'src/business/workflow'],
      ['src/ui', AR], ['src/ui', WG], ['src/ui', 'src/core/workspace'], ['src/ui', 'src/core/record-store'],
      ['src/ui', 'src/contracts'], ['src/ui', 'vendor/coding-agent'], ['src/app', 'src/composition'],
      ['src/app', 'src/business/workflow'],
    ];
    expect(new Set(pairs.map(([a, b]) => [a, b].sort().join('|'))).size).toBe(11);
    const links: ReturnType<typeof semLink>[] = [];
    pairs.forEach(([a, b], index) => {
      links.push(semLink({ noteId: 'ba' + index, from: { moduleId: a, path: a + '/a.ts' }, to: { moduleId: b, path: b + '/b.ts' } }));
      links.push(semLink({ noteId: 'bb' + index, from: { moduleId: b, path: b + '/b.ts' }, to: { moduleId: a, path: a + '/a.ts' } }));
    });
    const { page } = await openLayer(world, links);
    try {
      /* Both directions stay separate (4-1 甲); the 11 unordered pairs keep the layer above the threshold. */
      expect(semLines(page.root)).toHaveLength(22);
    } finally {
      await page.restore();
    }
  });

  it('B9-03c 联系 n counts unordered pairs, not directed ones', async () => {
    const world = await b2World();
    const others = ['src/app', 'src/composition', 'src/business/workflow', AR, WG,
      'src/core/workspace', 'src/core/record-store', 'src/contracts', 'vendor/coding-agent'];
    const pairs: Array<[string, string]> = others.map((id) => ['src/ui', id] as [string, string]);
    const rest: Array<[string, string]> = [
      ['src/app', 'src/composition'], ['src/app', 'src/business/workflow'], ['src/app', AR], ['src/app', WG],
      ['src/app', 'src/core/workspace'], ['src/app', 'src/core/record-store'], ['src/app', 'src/contracts'],
      ['src/app', 'vendor/coding-agent'], ['src/composition', 'src/business/workflow'], ['src/composition', AR],
      ['src/composition', WG], ['src/composition', 'src/core/workspace'],
    ];
    pairs.push(...rest);
    expect(pairs).toHaveLength(21);
    expect(pairs.filter(([a, b]) => a === 'src/ui' || b === 'src/ui')).toHaveLength(9);
    const links: ReturnType<typeof semLink>[] = [];
    pairs.forEach(([a, b], index) => {
      links.push(semLink({ noteId: 'ca' + index, from: { moduleId: a, path: a + '/a.ts' }, to: { moduleId: b, path: b + '/b.ts' } }));
      links.push(semLink({ noteId: 'cb' + index, from: { moduleId: b, path: b + '/b.ts' }, to: { moduleId: a, path: a + '/a.ts' } }));
    });
    const { page } = await openLayer(world, links);
    try {
      expect(semLines(page.root)).toHaveLength(0);
      /* UI is in 9 unordered pairs; counting the 18 directed rows would say 18. */
      expect(contactCount(page.root, 'UI')).toContain('联系 9');
    } finally {
      await page.restore();
    }
  });

  it('B9-04 six pairs draw six lines, dim the references and hide their counts; a pair keeps both links', async () => {
    const world = await b2World();
    const pairs = [
      ['src/ui', 'src/app'], ['src/app', 'src/composition'], ['src/composition', 'src/business/workflow'],
      ['src/business/workflow', AR], [AR, WG], ['src/core/workspace', 'src/core/record-store'],
    ] as const;
    const links = pairs.map(([from, to], index) => semLink({ noteId: 'q' + index,
      from: { moduleId: from, path: from + '/a.ts' }, to: { moduleId: to, path: to + '/b.ts' } }));
    /* item 5: a submodule end (WG/state) is WG at the top level, so it joins AR → WG. */
    links.push(semLink({ noteId: 'q6', from: { moduleId: AR, path: AR + '/run.ts' },
      to: { moduleId: `${WG}/state`, path: WG + '/state/task-machine.ts' },
      verification: { status: 'broken', missing: [0] } }));
    const { page } = await openLayer(world, links);
    try {
      expect(semLines(page.root)).toHaveLength(6);
      const references = findAllClass(page.root, 'ov-edge');
      expect(references.length).toBeGreaterThan(0);
      expect(references.some((edge) => (edge.getAttribute('class') ?? '').includes('dim'))).toBe(true);
      expect(findAllClass(page.root, 'ov-count').filter((element) => textOf(element).includes('处引用'))).toHaveLength(0);
      /* item 10: the ordinary layer explanation stays under the semantic block. */
      const intro = findClass(page.root, 'ov-intro');
      expect(intro).toBeDefined();
      expect(textOf(intro!)).toContain('个文件');
      const label = semLabels(page.root).find((element) => textOf(element).includes('调用 2'));
      expect(label).toBeDefined();
      /* item 9: the merged label carries the worst row's dot (broken). */
      const dot = findElement(label!, (element) => (element.getAttribute('class') ?? '').includes('sem-dot'));
      expect(dot).toBeDefined();
      expect(dot!.getAttribute('class')).toContain('broken');
      /* item 8: the hover card sits beside the label, never on its own text. */
      hover(label!);
      const card = findClass(page.root, 'hcard');
      expect(card).toBeDefined();
      const leftOf = (element: { getAttribute(name: string): string | null }): number =>
        Number(/left:\s*(-?\d+)px/.exec(element.getAttribute('style') ?? '')?.[1] ?? 'NaN');
      expect(leftOf(card!)).not.toBe(leftOf(label!));
      click(label!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('2 条联系'));
      expect(textOf(findClass(page.root, 'detail'))).toContain('2 条联系');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-05 a flow draws its steps in order and both gaps', async () => {
    const world = await b2World();
    const step1 = semLink({ noteId: 'f1', relation: 'injects', topic: '启动时核对没结束的执行',
      from: { moduleId: AR, path: 'src/runtime/run.ts' }, to: { moduleId: WG, path: 'src/wg/permit.ts' } });
    const step2 = semLink({ noteId: 'f2', relation: 'calls', topic: '启动时核对没结束的执行',
      from: { moduleId: AR, path: 'src/runtime/run.ts' }, to: { moduleId: WG, path: 'src/wg/permit.ts' } });
    const step3 = semLink({ noteId: 'f3', relation: 'callback', topic: '启动时核对没结束的执行',
      from: { moduleId: AR, path: 'src/runtime/kernel.ts' }, to: { moduleId: WG, path: 'src/wg/permit.ts' } });
    const flow = semFlow({ noteId: 'fl1', topic: '启动时核对没结束的执行', gapsAfter: [1, 2],
      steps: [{ link: 'f1', item: step1 }, { link: 'f2', item: step2 }, { link: 'f3', item: step3 }] });
    const { page } = await bootSem(world, answersFor(world, [step1, step2, step3], [flow]), { search: goalSearch(world) });
    try {
      click(switchButton(page.root));
      await waitFor(() => semRows(page.root).length > 0);
      const row = semRows(page.root).find((element) => textOf(element).includes('启动时核对没结束的执行'));
      expect(row).toBeDefined();
      click(row!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('第 1、2 步接不上'));
      const labels = semLabelTexts(page.root);
      expect(labels).toContain('1 注入');
      expect(labels).toContain('2 调用');
      expect(labels).toContain('3 回调');
      /* item 7: the two gaps on one node pair are one line and one label. */
      expect(labels.some((text) => text.includes('第 1、2 步接不上') && text.includes('第 2、3 步接不上'))).toBe(true);
      const gapLines = semLines(page.root).filter((element) => (element.getAttribute('class') ?? '').includes('is-gap'));
      expect(gapLines).toHaveLength(1);
      expect(contactCount(page.root, 'AgentRuntime')).toContain('第 1、2、3 步');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-06 a not_current step says 不在了, one gap line joins it, and the in-module step is short', async () => {
    const world = await b2World();
    /* 施工说明测试表第 6 行的世界: UI → Host, then a missing step, then two ends in WorkGraph. */
    const step1 = semLink({ noteId: 'g1', relation: 'injects', from: { moduleId: 'src/ui', path: 'src/ui/boot.ts' },
      to: { moduleId: 'src/app', path: 'src/app/host.ts' } });
    const step3 = semLink({ noteId: 'g3', relation: 'calls', from: { moduleId: WG, path: `${WG}/state/task-machine.ts` },
      to: { moduleId: WG, path: `${WG}/model/model.ts` } });
    const flow = semFlow({ noteId: 'fl2', topic: '检查进程被打断时',
      steps: [{ link: 'g1', item: step1 }, { link: 'g2', item: null, problem: 'not_current' }, { link: 'g3', item: step3 }] });
    const answers = answersFor(world, [step1, step3], [flow]);
    answers['architecture/semantic-links/check'] = { status: 'rejected', code: 'not_found', reason: 'gone' };
    const { page } = await bootSem(world, answers, { search: goalSearch(world) });
    try {
      click(switchButton(page.root));
      await waitFor(() => semRows(page.root).length > 0);
      const row = semRows(page.root).find((element) => textOf(element).includes('检查进程被打断时'));
      click(row!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('第 2 步不在了'));
      const flowText = textOf(findClass(page.root, 'detail'));
      expect(flowText).toContain('第 2 步不在了');
      expect(flowText).toContain('第 3 步（在模块内部）');
      /* item 6: the node line is only the short sentence, no truncated count. */
      expect(contactCount(page.root, 'WorkGraph')).toContain('第 3 步在模块内部');
      expect(contactCount(page.root, 'WorkGraph')).not.toContain('（在模块内部）');
      expect(contactCount(page.root, 'WorkGraph')).not.toContain('第 3、3 步');
      expect(contactCount(page.root, 'WorkGraph')).not.toContain('第 3 步 · 第 3 步');
      /* the original world draws the 第 1 步 → 第 3 步 gap (表二第 14 条). */
      const gaps = semLines(page.root).filter((element) => (element.getAttribute('class') ?? '').includes('is-gap'));
      expect(gaps).toHaveLength(1);
      expect(semLabelTexts(page.root)).toContain('第 2 步不在了');
      /* the in-module step draws no cross-module line; only step 1 remains. */
      const lines = semLines(page.root).filter((element) => !(element.getAttribute('class') ?? '').includes('is-gap'));
      expect(lines).toHaveLength(1);
      /* item 3: a flow detail's group check is hidden after not_found too. */
      click(findButton(page.root, '重新核对这 2 条联系')!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('没核成：平台找不到这条联系'));
      expect(findButton(page.root, '重新核对这 2 条联系')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-07 one check sends the one item and the reread turns 存疑 into 对得上 · 需复查', async () => {
    const world = await b2World();
    const link = semLink({ noteId: 'k1', version: 2, verification: { status: 'unchecked', reason: 'refs_pending' },
      currentEligible: false, freshness: 'stale' });
    const answers = answersFor(world, [link], []);
    answers['architecture/semantic-links/check'] = semReady({ items: [{ noteId: 'k1', version: 2, verification: { status: 'verified' } }] });
    const { page, log } = await bootSem(world, answers, { search: goalSearch(world), before: {
      /* Only the Host's next read changes: without the action's reread the page keeps
         the object it already drew and stays 存疑. */
      'architecture/semantic-links/check': async () => {
        answers['architecture/semantic-links'] = semReady(semPage([{ ...link,
          verification: { status: 'verified' }, currentEligible: false, freshness: 'stale' }]));
      },
    } });
    try {
      click(switchButton(page.root));
      await waitFor(() => semRows(page.root).length > 0);
      click(semRows(page.root).find((element) => textOf(element).includes('调用'))!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('存疑'));
      expect(textOf(findClass(page.root, 'detail'))).toContain('存疑');
      click(findButton(page.root, '重新核对')!);
      await waitFor(() => countRoute(log, 'architecture/semantic-links/check') === 1);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('对得上'));
      const check = log.calls.filter((call) => call.route === 'architecture/semantic-links/check');
      expect(check).toHaveLength(1);
      expect((check[0]!.input as { items: unknown[] }).items).toEqual([{ noteId: 'k1', version: 2 }]);
      const checked = textOf(findClass(page.root, 'detail'));
      expect(checked).toContain('对得上');
      expect(checked).toContain('需复查');
      expect(checked).toContain('暂不作数');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-08 not_found says the contact may be gone and still shows the last result', async () => {
    const world = await b2World();
    const link = semLink({ noteId: 'k2', version: 3 });
    const answers = answersFor(world, [link], []);
    answers['architecture/semantic-links/check'] = { status: 'rejected', code: 'not_found', reason: 'gone' };
    const { page } = await bootSem(world, answers, { search: goalSearch(world) });
    try {
      click(switchButton(page.root));
      await waitFor(() => semRows(page.root).length > 0);
      click(semRows(page.root)[0]!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('对得上'));
      click(findButton(page.root, '重新核对')!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('没核成：平台找不到这条联系，可能刚被撤下或换了新版本'));
      const failed = textOf(findClass(page.root, 'detail'));
      expect(failed).toContain('没核成：平台找不到这条联系，可能刚被撤下或换了新版本');
      expect(failed).toContain('对得上');
      expect(findButton(page.root, '重新读这一层')).toBeDefined();
      /* item 3: a not_found check is stale — no 重新核对 until the layer is read again. */
      expect(findButton(page.root, '重新核对')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-09 an empty layer keeps the graph and the reference lines untouched', async () => {
    const world = await b2World();
    const { page } = await openLayer(world, [], []);
    try {
      expect(semPanelText(page.root)).toContain('这个项目还没有写下的联系和流程');
      expect(semLines(page.root)).toHaveLength(0);
      const references = findAllClass(page.root, 'ov-edge');
      expect(references.some((edge) => (edge.getAttribute('class') ?? '').includes('dim'))).toBe(false);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-10 the first read says 正在读联系和流程…, then draws the link', async () => {
    const world = await b2World();
    const link = semLink({ noteId: 'l1', from: { moduleId: AR, path: 'src/runtime/run.ts' },
      to: { moduleId: WG, path: 'src/wg/permit.ts' } });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { page } = await bootSem(world, answersFor(world, [link], []), { search: goalSearch(world),
      before: { 'architecture/semantic-links': async () => { await gate; } } });
    try {
      click(switchButton(page.root));
      await waitFor(() => semPanelText(page.root).includes('正在读联系和流程…'));
      expect(semPanelText(page.root)).toContain('正在读联系和流程…');
      release();
      await waitFor(() => semLines(page.root).length > 0, 6_000);
      expect(semLines(page.root).length).toBeGreaterThan(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-11 unavailable is not a network failure; one failed block leaves the other one drawn', async () => {
    const world = await b2World();
    const goalId = world.goals.first.goalId;
    const answers = {
      ...b2Reads(world, goalId),
      'architecture/semantic-links': { status: 'rejected', code: 'unavailable', reason: 'held' },
      'architecture/semantic-flows': { status: 'rejected', code: 'unavailable', reason: 'held' },
    };
    const first = await bootSem(world, answers, { search: goalSearch(world) });
    try {
      click(switchButton(first.page.root));
      await waitFor(() => semPanelText(first.page.root).includes('没读出来'));
      expect(semPanelText(first.page.root)).toContain('没读出来：暂时读不到，可以重试。');
      expect(findButton(first.page.root, '再读一次')).toBeDefined();
    } finally {
      await first.page.restore();
    }
    const flow = semFlow({ noteId: 'fl3', topic: '一条流程', steps: [{ link: 'z1', item: semLink({ noteId: 'z1' }) }] });
    const second = await bootSem(world, { ...answersFor(world, [], [flow]),
      'architecture/semantic-links': { status: 'rejected', code: 'unavailable', reason: 'held' } },
    { search: goalSearch(world), before: { 'architecture/semantic-links': async () => { throw new TypeError('network down'); } } });
    try {
      click(switchButton(second.page.root));
      await waitFor(() => semPanelText(second.page.root).includes('连不上平台（网络断了，或平台没在运行）'));
      expect(semPanelText(second.page.root)).toContain('连不上平台（网络断了，或平台没在运行）');
      expect(countRoute(second.log, 'architecture/semantic-flows')).toBe(1);
      expect(semRows(second.page.root).some((row) => textOf(row).includes('一条流程'))).toBe(true);
      click(semRows(second.page.root).find((row) => textOf(row).includes('一条流程'))!);
      await waitFor(() => semLabels(second.page.root).length > 0);
      /* item 9: a flow step carries its own row, so its dot survives a failed links page. */
      const stepLabel = semLabels(second.page.root).find((element) => textOf(element).includes('1 调用'));
      expect(stepLabel).toBeDefined();
      expect(findElement(stepLabel!, (element) => (element.getAttribute('class') ?? '').includes('sem-dot ok'))).toBeDefined();
    } finally {
      await second.page.restore();
    }
  }, 60_000);

  it('B9-12 over 100 link pages stop that block and leave the flows drawn', async () => {
    const world = await b2World();
    const goalId = world.goals.first.goalId;
    const link = semLink({ noteId: 'cap1' });
    const flow = semFlow({ noteId: 'capf', topic: '仍然读到的流程', steps: [{ link: 'cap1', item: link }] });
    const answers = { ...b2Reads(world, goalId),
      'architecture/semantic-links': semReady(semPage([link], 'more')),
      'architecture/semantic-flows': semReady(semPage([flow])) };
    const { page, log } = await bootSem(world, answers, { search: goalSearch(world) });
    try {
      click(switchButton(page.root));
      await waitFor(() => semPanelText(page.root).includes('还没到头'), 15_000);
      expect(semPanelText(page.root)).toContain('读了 100 页（1 万条）还没到头');
      expect(countRoute(log, 'architecture/semantic-flows')).toBe(1);
      expect(semRows(page.root).some((row) => textOf(row).includes('仍然读到的流程'))).toBe(true);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-13 a module entry lists the cross-module links and keeps the null moduleId row', async () => {
    const world = await b2World();
    const cross = [0, 1, 2].map((index) => semLink({ noteId: 'c' + index,
      from: { moduleId: `${WG}/state`, path: `${WG}/state/task-machine.ts` }, to: { moduleId: 'src/app', path: 'src/app/host.ts' } }));
    const back = semLink({ noteId: 'c3', from: { moduleId: 'src/app', path: 'src/app/host.ts' },
      to: { moduleId: `${WG}/state`, path: `${WG}/state/task-machine.ts` } });
    const orphan = semLink({ noteId: 'c4', from: { moduleId: null, path: 'src/elsewhere/x.ts' },
      to: { moduleId: null, path: 'src/elsewhere/y.ts' } });
    /* item 4: moduleId is the entered module itself; the path picks its child (state/model). */
    const inside = semLink({ noteId: 'c5', from: { moduleId: WG, path: `${WG}/state/task-machine.ts` },
      to: { moduleId: WG, path: `${WG}/model/model.ts` } });
    const { page } = await bootSem(world, answersFor(world, [...cross, back, orphan, inside], []), { search: goalSearch(world) });
    try {
      enterWorkGraph(page.root);
      click(switchButton(page.root));
      await waitFor(() => semPanelText(page.root).includes('另有 4 条连到这个模块外面'));
      expect(semPanelText(page.root)).toContain('另有 4 条连到这个模块外面');
      /* the path fallback draws state → model, so the whole link does not vanish */
      expect(semLines(page.root)).toHaveLength(1);
      expect(semPanelText(page.root)).toContain('不属于任何模块');
      expect(semPanelText(page.root)).toContain('归不到图上的模块');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-15 a null verification says the note is no longer a link', async () => {
    const world = await b2World();
    const link = semLink({ noteId: 'gone', version: 1 });
    const answers = answersFor(world, [link], []);
    answers['architecture/semantic-links/check'] = semReady({ items: [{ noteId: 'gone', version: 1, verification: null }] });
    const { page } = await bootSem(world, answers, { search: goalSearch(world) });
    try {
      click(switchButton(page.root));
      await waitFor(() => semRows(page.root).length > 0);
      click(semRows(page.root)[0]!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('重新核对'));
      click(findButton(page.root, '重新核对')!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('这一条在注记文件里已经不是联系了'));
      expect(textOf(findClass(page.root, 'detail'))).toContain('这一条在注记文件里已经不是联系了，重新读这一层');
      expect(findButton(page.root, '重新读这一层')).toBeDefined();
      /* item 3: a null verification removes the check button as well. */
      expect(findButton(page.root, '重新核对')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B9-18 a pair not_found hides its group check', async () => {
    const world = await b2World();
    const links = [1, 2].map((version) => semLink({ noteId: 'pv' + version, version,
      from: { moduleId: AR, path: 'src/runtime/run.ts' }, to: { moduleId: WG, path: 'src/wg/permit.ts' } }));
    const answers = answersFor(world, links, []);
    answers['architecture/semantic-links/check'] = { status: 'rejected', code: 'not_found', reason: 'gone' };
    const { page } = await bootSem(world, answers, { search: goalSearch(world) });
    try {
      click(switchButton(page.root));
      await waitFor(() => semLines(page.root).length > 0);
      click(semLabels(page.root).find((element) => textOf(element).includes('调用 2'))!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('2 条联系'));
      click(findButton(page.root, '重新核对这 2 条')!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('没核成：平台找不到这条联系'));
      expect(findButton(page.root, '重新核对这 2 条')).toBeUndefined();
      expect(findButton(page.root, '重新读这一层')).toBeDefined();
    } finally {
      await page.restore();
    }
  });

  it('B9-14 four links of one pair open as four rows and one check sends all four', async () => {
    const world = await b2World();
    const links = [1, 2, 3, 4].map((version) => semLink({ noteId: 'v' + version, version,
      from: { moduleId: AR, path: 'src/runtime/run.ts' }, to: { moduleId: WG, path: 'src/wg/permit.ts' } }));
    const answers = answersFor(world, links, []);
    answers['architecture/semantic-links/check'] = semReady({ items: links.map((row) => ({ noteId: row.noteId, version: row.version, verification: { status: 'verified' } })) });
    const { page, log } = await bootSem(world, answers, { search: goalSearch(world) });
    try {
      click(switchButton(page.root));
      await waitFor(() => semLines(page.root).length > 0);
      const label = semLabels(page.root).find((element) => textOf(element).includes('调用 4'));
      expect(label).toBeDefined();
      click(label!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('4 条联系'));
      expect(textOf(findClass(page.root, 'detail'))).toContain('4 条联系');
      const button = findButton(page.root, '重新核对这 4 条');
      expect(button).toBeDefined();
      click(button!);
      await waitFor(() => countRoute(log, 'architecture/semantic-links/check') === 1);
      const check = log.calls.filter((call) => call.route === 'architecture/semantic-links/check');
      expect(check).toHaveLength(1);
      expect((check[0]!.input as { items: unknown[] }).items).toHaveLength(4);
      expect((check[0]!.input as { items: unknown[] }).items).toEqual(links.map((row) => ({ noteId: row.noteId, version: row.version })));
    } finally {
      await page.restore();
    }
  }, 60_000);
});
