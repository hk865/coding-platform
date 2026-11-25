import { afterAll, describe, expect, it } from 'vitest';
import { bootPage, findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import {
  auxPanel, auxTab, bootE3N, descendants, forwardPage, hasClass, newPageLog, quietPage, routeOf, textOf, treeNames,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import { openCapWorld } from './helpers/E3D-world.js';
import {
  bootDecide, callsOf, card, cardButton, count, countPrefix, opened, quiet, sectionRows, settle, worldTarget,
} from './helpers/E3D-page.js';
import type { HostScenario } from '../scenarios/harness.js';

/**
 * E3D-17 (Z3/Z4 of the 7D book): the Decide page's right panel. The task map
 * reads `graph/hover` once per page read (the read that draws it and the
 * stream-open reread), the card head's path opens the task's `graph/detail`
 * without another map read for the same Goal, and the conflict card's
 * 在架构图里看 switches the panel and reads the current architecture once.
 */

let cap: HostScenario | null = null;
let w1: E3GWorld | null = null;

afterAll(async () => {
  await cap?.dispose();
  await w1?.world.close();
}, 240_000);

/** The one card row `sectionRows` shows first (W1's conflict card). */
async function openFirstCard(root: FakeElement): Promise<void> {
  const row = sectionRows(root, '要决定')[0];
  expect(row).toBeDefined();
  click(row!);
  expect(await settle(() => card(root) !== undefined, 2_000)).toBe(true);
}

/** The cap world also queues adviser-creation and Goal-level cards: open the stop card by its row title. */
async function openStopCard(root: FakeElement): Promise<void> {
  const row = sectionRows(root, '要决定').find((element) =>
    textOf(findClass(element, 'row-name')).startsWith('自动返工已达上限'));
  expect(row).toBeDefined();
  click(row!);
  expect(await settle(() => card(root) !== undefined, 2_000)).toBe(true);
}

/** The open card's path: the one `.dc-head button.ellipsis`. */
function cardPath(root: FakeElement): FakeElement | undefined {
  const head = findClass(card(root)!, 'dc-head');
  return head === undefined ? undefined : descendants(head).find((element) =>
    element.tagName.toLowerCase() === 'button' && hasClass(element, 'ellipsis'));
}

/** The architecture scope note (`.pscope .note`); '' when the note is not drawn. */
function scopeNote(root: FakeElement): string {
  const scope = findClass(auxPanel(root) ?? root, 'pscope');
  const note = scope === undefined ? undefined : findClass(scope, 'note');
  return note === undefined ? '' : textOf(note);
}

/** The map search's note (`label.search .note`); '' when the note is not drawn. */
function searchNote(root: FakeElement): string {
  const search = findElement(auxPanel(root) ?? root,
    (element) => element.tagName.toLowerCase() === 'label' && hasClass(element, 'search'));
  const note = search === undefined ? undefined : findClass(search, 'note');
  return note === undefined ? '' : textOf(note);
}

/** The file rows the architecture tree draws (leaf `.nb` rows), sorted; module
 * branches use `.tr-lb`, and a closed group's rest hangs on comb squares. */
function treeFileNames(root: FakeElement): string[] {
  const panel = auxPanel(root);
  if (panel === undefined) return [];
  return descendants(panel)
    .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'nb'))
    .map((element) => textOf(findClass(element, 'tr-name')))
    .sort();
}

describe('E3D-17 the Decide right panel', () => {
  it('⑤ Z1/Z3 the task map draws the Goal and the card path reads its detail', async () => {
    cap ??= await openCapWorld();
    const { page, log } = await bootDecide(worldTarget(cap.host));
    try {
      await opened(log);
      expect(auxTab(page.root, '任务图')?.getAttribute('aria-selected')).toBe('true');
      expect(treeNames(page.root)).toContain('Independent work ag2b-work');
      /* 具名改坏: 右栏不读 graph/hover；本行的每读一次红。 */
      const reads = count(log, 'decisions/queue') / 2;
      expect(count(log, 'graph/hover')).toBe(reads);
      expect(count(log, 'graph/hover')).toBeGreaterThan(0);
      /* Each page read issues two `decisions/queue` calls (the nav and Decide) and one `graph/hover`;
         `opened` waits the first read and the stream-open reread. */
      expect(count(log, 'decisions/queue') % 2).toBe(0);
      /* 具名改坏: 底部页签的 title 被当作正文画进右栏；本行红。 */
      expect(textOf(auxPanel(page.root))).not.toContain('还没接通');

      const hover = count(log, 'graph/hover');
      const queue = count(log, 'decisions/queue');
      await openStopCard(page.root);
      await quiet(log);
      /* Same Goal, same tab: opening the card is local selection only. */
      expect(count(log, 'graph/hover')).toBe(hover);
      expect(count(log, 'decisions/queue')).toBe(queue);

      const path = cardPath(page.root);
      expect(path).toBeDefined();
      expect(path!.getAttribute('title')?.startsWith('在任务图里看')).toBe(true);
      const before = count(log, 'graph/detail');
      /* 具名改坏: 卡头路径照旧走 `A.notConnected`；本行红。 */
      click(path!);
      await quiet(log);
      const details = callsOf(log, 'graph/detail').slice(before);
      /* One detail open reads its summary, one participants page and one risks page. */
      expect(details.map((call) => (call.input as { section?: string }).section))
        .toEqual(['summary', 'participants', 'risks']);
      const summary = details[0]!;
      expect((summary.input as { node: { kind?: string; ref: { taskId?: string } } }).node)
        .toMatchObject({ kind: 'task', ref: { taskId: 'ag2b-work' } });
      expect(textOf(findClass(page.root, 'd-title'))).toBe('Independent work ag2b-work');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('N12 Z1 a failed graph/detail read leaves the task tree and the tab', async () => {
    cap ??= await openCapWorld();
    const { page, log } = await bootE3N(cap.host, 'Decide', { unavailableOnce: 'graph/detail' });
    try {
      await opened(log);
      await openStopCard(page.root);
      await quiet(log);
      const path = cardPath(page.root);
      expect(path).toBeDefined();
      click(path!);
      await quiet(log);
      /* 具名改坏: readAuxPanel 让 graph/detail 的失败走外层 catch；树没了，这一行红。 */
      expect(treeNames(page.root)).toContain('Independent work ag2b-work');
      expect(textOf(auxPanel(page.root) ?? page.root)).not.toContain('读取失败。');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('⑥ Z4 在架构图里看 switches to the architecture and lights the overlap files', async () => {
    w1 ??= await openE3GW1();
    const { page, log } = await bootDecide(worldTarget(w1.world));
    try {
      await opened(log);
      await openFirstCard(page.root);
      await quiet(log);
      /* Z2's conflict branch already switched the tab and read the current architecture. */
      expect(auxTab(page.root, '架构图')?.getAttribute('aria-selected')).toBe('true');
      const locate = cardButton(page.root, '在架构图里看');
      expect(locate).toBeDefined();
      expect(hasClass(locate!, 'is-off')).toBe(false);
      expect(locate!.getAttribute('title')?.startsWith('在架构图里点亮 ')).toBe(true);

      const before = countPrefix(log, 'architecture/');
      /* 具名改坏: `actGo` 的 locate 只切页签（no `readMore`）；本行的 +1 红。 */
      click(locate!);
      await quiet(log);
      expect(countPrefix(log, 'architecture/')).toBe(before + 1);
      const last = callsOf(log, 'architecture/read').at(-1);
      expect(last).toBeDefined();
      expect((last!.input as { selection?: unknown }).selection).toEqual({ kind: 'current' });
      if ((last!.reply as { status?: string } | null)?.status === 'not_found') {
        const search = findElement(auxPanel(page.root) ?? page.root,
          (element) => element.tagName.toLowerCase() === 'label' && hasClass(element, 'search'));
        expect(search).toBeDefined();
        expect(textOf(findClass(search!, 'note'))).toBe('还没有采纳的架构');
      } else {
        expect(treeNames(page.root)).toContain('core-routes.ts');
        expect(treeNames(page.root)).toContain('views.ts');
      }
      expect(treeFileNames(page.root)).toEqual(['core-routes.ts', 'views.ts']);
      /* 具名改坏: 范围栏不看 `v.conf`；点亮时写“正在处理 2 个文件，在 2 个模块”，本行红。
         Lit, the tree holds the conflict files, not the work in hand: the bar says nothing (prototype). */
      expect(scopeNote(page.root)).toBe('');
      expect(searchNote(page.root)).toContain('两个目标都要改');

      /* Lead 11-25 (fix 2/3/4, item 5): a tab change changes the card, so the lit
         conflict goes with it and 当前工作 is read again, as closeCard does. */
      const lit = countPrefix(log, 'architecture/');
      click(findElement(page.root, (element) => element.getAttribute('role') === 'tab'
        && textOf(element).startsWith('已处理'))!);
      await quiet(log);
      /* 具名改坏: `showDone` 不清 `conf`、不并 `workAgain`；右栏仍写“两个目标都要改”，本行红。 */
      expect(searchNote(page.root)).not.toContain('两个目标都要改');
      expect(countPrefix(log, 'architecture/')).toBeGreaterThan(lit);

      /* Review 2: answering the lit conflict card makes it leave the queue; the
         card the page falls to does not keep the lit files. */
      click(findElement(page.root, (element) => element.getAttribute('role') === 'tab'
        && textOf(element).startsWith('待处理'))!);
      await quiet(log);
      await openFirstCard(page.root);
      await quiet(log);
      click(cardButton(page.root, '在架构图里看')!);
      await quiet(log);
      expect(searchNote(page.root)).toContain('两个目标都要改');
      click(cardButton(page.root, '等前一个目标')!);
      await settle(() => cardButton(page.root, '等前一个目标')?.getAttribute('aria-checked') === 'true', 2_000);
      click(cardButton(page.root, '确定')!);
      await settle(() => callsOf(log, 'decisions/answer').some((call) => call.reply !== undefined), 8_000);
      await quiet(log);
      expect(count(log, 'decisions/answer')).toBe(1);
      /* 具名改坏: 答复成功后不清 `conf`；右栏仍写“两个目标都要改”，本行红。 */
      expect(searchNote(page.root)).not.toContain('两个目标都要改');
    } finally {
      await page.restore();
    }
  }, 120_000);

  /* 234f 表三 1 (lead 11-25): the conflict a card lit belongs to that card. Another
     card's answer that lands while the conflict card is lit leaves it lit. The
     extra planning question rides on W1's real queue; its answer is held and
     answered committed by the row, so W1's conflict card stays in the queue. */
  it('⑦ another card’s answer landing while the conflict card is lit keeps it lit', async () => {
    const opened = await openE3GW1();
    const goal = opened.world.goals.first;
    const key = 'e3d17-pq';
    const extra = { cardKey: key, state: 'waiting_answer', requestRef: null, readOnly: false, actions: ['answer'],
      source: { kind: 'planning_question', key, subject: { kind: 'goal', goalRef: goal }, pins: [] },
      subject: { kind: 'goal', goalRef: goal }, senderSessionRef: null, objects: [],
      options: [{ id: 'idea-a', label: '先做登录' }, { id: 'idea-b', label: '先做导出' }],
      answer: null, application: null, openedAt: '2026-11-25T09:00:00+08:00', taskRef: null, runRef: null };
    let answered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const log = newPageLog();
    const forward = forwardPage(opened.world, log);
    const page = await bootPage({ name: 'Decide', token: () => opened.world.token,
      request: async (url, init, realFetch) => {
        const route = routeOf(url);
        const sent = typeof init?.body === 'string' ? init.body : '';
        if (route === 'decisions/answer' && sent.includes(key)) {
          await gate;
          answered = true;
          return new Response(JSON.stringify({ status: 'ready', value: { answer: { status: 'committed' } } }),
            { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const reply = await forward(url, init, realFetch);
        if (route !== 'decisions/queue' || answered || !sent.includes('waiting_answer')) return reply;
        const read = await reply.json() as { status?: string; value?: { waitingAnswer?: unknown[] } };
        if (read.status === 'ready' && read.value?.waitingAnswer) read.value.waitingAnswer.push(extra);
        return new Response(JSON.stringify(read), { status: 200, headers: { 'content-type': 'application/json' } });
      } });
    try {
      await quietPage(log);
      const question = sectionRows(page.root, '要决定').find((row) => textOf(row).includes('规划问题'));
      expect(question, 'the extra planning question').toBeDefined();
      click(question!);
      await settle(() => cardButton(page.root, '先做登录') !== undefined, 3_000);
      click(cardButton(page.root, '先做登录')!);
      await settle(() => cardButton(page.root, '确定')?.getAttribute('aria-disabled') === 'false', 2_000);
      click(cardButton(page.root, '确定')!);
      await quietPage(log);
      const conflict = sectionRows(page.root, '要决定').find((row) => textOf(row).includes('冲突'));
      expect(conflict, 'the conflict row').toBeDefined();
      click(conflict!);
      await settle(() => cardButton(page.root, '在架构图里看') !== undefined, 3_000);
      click(cardButton(page.root, '在架构图里看')!);
      await quietPage(log);
      expect(searchNote(page.root)).toContain('两个目标都要改');
      release();
      await settle(() => answered, 3_000);
      await quietPage(log);
      expect(sectionRows(page.root, '要决定').some((row) => textOf(row).includes('规划问题'))).toBe(false);
      /* 具名改坏: `cardRun` 成功时不看 `confFor`；别的卡的答复落地把点亮清掉，本行红。 */
      expect(searchNote(page.root)).toContain('两个目标都要改');
      expect(cardButton(page.root, '在架构图里看')).toBeDefined();
    } finally {
      release();
      await page.restore();
      await opened.world.close();
    }
  }, 120_000);
});
