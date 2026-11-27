/**
 * CU6 (7D2 batch 6, task graph half): the running command and its 停止, the
 * missing coverage and 更多 rows, optional Tasks, and the DST hour's end.
 *
 * Rows ①–⑥ are business flows through the real Host world and page clicks;
 * ⑦ is the scene view because the DST cell has no real data recipe.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findAllClass, findButton, findClass, findElement, type BootedPage,
} from './helpers/boot-page.js';
import { FakeElement } from './helpers/dom.js';
import { click, hover, pressKey } from './helpers/E3N-interact.js';
import { typeInto } from './helpers/E3D-page.js';
import {
  bootE3N, callsTo, countRoute, hasClass, parsedCode, quietPage, routesSince, textOf, waitFor, type PageLog,
} from './helpers/E3N-page.js';
import { openStuckRunWorld } from './helpers/E3U-stuck-run-world.js';
import { DONE_TASK_A, DONE_TASK_B, openDoneDeliveryWorld } from './helpers/E3DN-done-world.js';
import { adoptWithChecks } from '../helpers/G8B-world.js';
import { g8Check, g8PlanDraft } from '../helpers/G8-world.js';
import { adoptPLPlanDraft, openPLWorkflowWorld, plSkeletonDraft } from '../helpers/PL-workflow-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openP1World } from '../helpers/P1-round-fixture.js';
import { write } from '../helpers/P1-reads.js';
import { waitFor as waitForRoute } from '../scenarios/harness.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { relationGroup } from './helpers/E3A-page.js';
import { dayCalendar, hourCalendar, hourCell, sceneData, sceneView, type Row } from './helpers/e35-scene.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

const TASK = 'Independent work pl-task';
const commandOf = (label: string): string =>
  `while [ ! -e ${label}-go ]; do : > ${label}-started; sleep 0.05; done; echo go`;

const dagNode = (root: FakeElement, title: string): FakeElement | undefined => findElement(root,
  (element) => element.tagName.toLowerCase() === 'button'
    && (element.getAttribute('class') ?? '').split(/\s+/).includes('dg-node')
    && element.textContent.includes(title));

const detailOf = (root: FakeElement): FakeElement | undefined => findClass(root, 'detail');

async function openTask(page: BootedPage, title: string): Promise<FakeElement> {
  await waitFor(() => dagNode(page.root, title) !== undefined);
  click(dagNode(page.root, title)!);
  await waitFor(() => textOf(detailOf(page.root)).includes(title));
  return detailOf(page.root)!;
}

/** The hover card's `dt`/`dd` value for `key`. */
function cardValue(root: FakeElement, key: string): string {
  const dl = findClass(findClass(root, 'hcard') ?? root, 'hc-dl');
  let current = '';
  for (const child of dl?.childNodes ?? []) {
    if (!(child instanceof FakeElement)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') current = textOf(child);
    if (tag === 'dd' && current === key) return textOf(child);
  }
  return '';
}

/** The detail's 关系 value for `key`, read through the one relation helper. */
function relationValue(detail: FakeElement, key: string): string {
  return textOf(relationGroup(detail, key)!);
}

/** The 更多 block's `dt`/`dd` pairs, in order. */
function morePairs(detail: FakeElement): string[][] {
  const dl = findAllClass(detail, 'd-dl')[1];
  const pairs: string[][] = [];
  let key = '';
  for (const child of dl?.childNodes ?? []) {
    if (!(child instanceof FakeElement)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') key = textOf(child);
    if (tag === 'dd') pairs.push([key, textOf(child)]);
  }
  return pairs;
}

/** The first status word span (`tx-*`) in a card or detail head. */
function statusWord(root: FakeElement): string {
  const word = findElement(root, (element) =>
    (element.getAttribute('class') ?? '').split(/\s+/).some((name) => name.startsWith('tx-')));
  return textOf(word);
}

type RunningItem = { callId: string; elapsedMs: number; overLine: boolean;
  run: { kind: 'run'; runRef: { runId: string }; taskId: string } | { kind: 'query' } };
type RunningRead = { status: string; value?: { items: RunningItem[] } };

/** The page's own answered `executions/running-commands` read. */
function pageRunning(log: PageLog): RunningRead {
  const call = [...callsTo(log, 'executions/running-commands')].reverse().find((entry) => entry.reply !== undefined);
  expect(call, 'the page read executions/running-commands').toBeDefined();
  return call!.reply as RunningRead;
}

describe('CU6 task graph: running command, 停止, gaps, 更多, optional and the DST hour', () => {
  it('① 11 minutes: the card and detail say the command and minutes, 停止 confirms one cancel, then 停止请求中', async () => {
    const w = await openStuckRunWorld('r1');
    cleanup = w.close;
    await w.started();
    w.fixture.world.clock.advance(11 * 60_000);
    const { page, log } = await bootE3N(w.fixture.world, 'TaskMap',
      { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled' });
    try {
      await waitFor(() => dagNode(page.root, TASK) !== undefined);
      await quietPage(log);
      const item = pageRunning(log).value!.items[0]!;
      const minutes = Math.floor(item.elapsedMs / 60_000);
      expect(minutes, 'eleven minutes is the Host own count').toBeGreaterThanOrEqual(11);
      expect(item.overLine, 'past the ten-minute line').toBe(true);
      const value = commandOf('r1') + '，已 ' + String(minutes) + ' 分钟，超过预计';

      hover(dagNode(page.root, TASK)!);
      await waitFor(() => findClass(page.root, 'hcard') !== undefined);
      expect(cardValue(page.root, '正在跑')).toBe(value);
      const detail = await openTask(page, TASK);
      expect(relationValue(detail, '正在跑')).toBe(value);

      const fromNoWrite = log.calls.length;
      click(findButton(detailOf(page.root)!, '停止')!);
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog') !== undefined);
      const dialog = findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')!;
      expect(textOf(findClass(dialog, 'dc-line')))
        .toBe('它会在下一个安全点停下，然后取消生效：任务记为“已取消”，之后只有你能重新入队；改动和工作记录保留。');
      click(findButton(dialog, '不取消')!);
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog') === undefined);
      expect(routesSince(log, fromNoWrite), '不取消 writes nothing').not.toContain('controls/submit');
      expect(routesSince(log, fromNoWrite), '不取消 reads no line').not.toContain('lines/read');

      const from = log.calls.length;
      click(findButton(detailOf(page.root)!, '停止')!);
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog') !== undefined);
      click(findButton(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')!, '取消执行')!);
      await waitFor(() => textOf(detailOf(page.root)).includes('，停止请求中'));
      const since = routesSince(log, from);
      expect(since.filter((route) => route === 'lines/read'), 'one lines/read').toHaveLength(1);
      expect(since.filter((route) => route === 'controls/submit'), 'one controls/submit').toHaveLength(1);
      const reads = callsTo(log, 'lines/read');
      expect((reads[0]!.input as { key: unknown }).key).toEqual(w.line.ref);
      const writes = callsTo(log, 'controls/submit');
      expect((writes[0]!.input as { kind: string }).kind).toBe('cancel');
      expect((writes[0]!.input as { runRef: { runId: string } }).runRef.runId)
        .toBe(item.run.kind === 'run' ? item.run.runRef.runId : '');
      expect(relationValue(detailOf(page.root)!, '正在跑')).toBe(value + '，停止请求中');
      expect(findButton(detailOf(page.root)!, '停止'), 'no 停止 after the cancel').toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('② five minutes: one read answers no items; the card and detail say no 正在跑', async () => {
    const w = await openStuckRunWorld('r2');
    cleanup = w.close;
    await w.started();
    w.fixture.world.clock.advance(5 * 60_000);
    const { page, log } = await bootE3N(w.fixture.world, 'TaskMap',
      { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled', gate: true });
    try {
      await waitFor(() => dagNode(page.root, TASK) !== undefined);
      await quietPage(log);
      expect(callsTo(log, 'executions/running-commands'), 'one running-commands read').toHaveLength(1);
      const read = pageRunning(log);
      expect(read.status).toBe('ready');
      expect(read.value?.items, 'the Host hides commands under ten minutes').toEqual([]);

      hover(dagNode(page.root, TASK)!);
      await waitFor(() => findClass(page.root, 'hcard') !== undefined);
      expect(textOf(findClass(page.root, 'hcard')), 'no 正在跑 in the card').not.toContain('正在跑');
      const detail = await openTask(page, TASK);
      expect(textOf(detail), 'no 正在跑 in the detail').not.toContain('正在跑');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('③ no running Task: the page reads no running-commands at all', async () => {
    const w = await openDoneDeliveryWorld();
    cleanup = w.close;
    const { page, log } = await bootE3N(w.world, 'TaskMap', { search: '?goal=' + w.goal.goalId, mode: 'controlled' });
    try {
      await waitFor(() => dagNode(page.root, 'PL stage 1 ' + DONE_TASK_A) !== undefined);
      await quietPage(log);
      expect(countRoute(log, 'executions/running-commands')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('④ withdraw the last check: the Task card/detail and the Plan tail say the requirement is uncovered', async () => {
    const w = await openPLWorkflowWorld({ label: 'cu6r4',
      workspaceGrants: { writePrefixes: ['.'], allowCommands: true } });
    cleanup = w.close;
    const goal = w.goal;
    await adoptWithChecks(w.world, S6A_SCOPE, goal, 'cu6r4', [g8Check('cu6r4-only', ['cu6r4-work'])],
      g8PlanDraft(goal, 'cu6r4', S6A_WORK_ROLE.templateId));
    const withdrawn = await w.world.settings('checks/withdraw', { scope: S6A_SCOPE, checkId: 'cu6r4-only' });
    expect(withdrawn.status, JSON.stringify(withdrawn)).toBe('ready');
    const executor = await sessionOf(w.world, await createS6BLine(w.main, { label: 'cu6r4-executor',
      role: S6A_WORK_ROLE, tasks: [{ projectId: S6A_SCOPE.projectId, goalId: goal.goalId, taskId: 'cu6r4-work' }] }));
    await w.world.scripted.script(executor, [{ kind: 'text', text: 'CU6 checked work' }], S6A_SCOPE);
    await w.world.post('workflow/driver-start', plain(S6A_SCOPE, {
      advance: { schemaVersion: 1, goalRef: goal, flowId: 'cu6r4-driver', sessionHint: null,
        kind: 'select_work', taskId: 'cu6r4-work' }, queryProfileIds: [] }));
    await waitForRoute(async () => (await w.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body,
      (body) => {
        const row = (body as { value?: { tasks?: Array<{ ref: { taskId: string };
          failure?: { round?: { gapCodes?: string[] } } }> } }).value?.tasks
          ?.find((task) => task.ref.taskId === 'cu6r4-work');
        return row?.failure?.round?.gapCodes?.includes('uncovered_requirement') === true;
      }, 'the uncovered requirement row');

    const map = await bootE3N(w.world, 'TaskMap', { search: '?goal=' + goal.goalId, mode: 'controlled' });
    try {
      await waitFor(() => dagNode(map.page.root, 'cu6r4-work') !== undefined);
      await quietPage(map.log);
      hover(dagNode(map.page.root, 'cu6r4-work')!);
      await waitFor(() => findClass(map.page.root, 'hcard') !== undefined);
      expect(cardValue(map.page.root, '缺项')).toContain('没有检查覆盖的必需要求');
      const detail = await openTask(map.page, 'cu6r4-work');
      expect(relationValue(detail, '缺项')).toContain('没有检查覆盖的必需要求');
    } finally {
      await map.page.restore();
    }

    const plan = await bootE3N(w.world, 'Plan', { search: '?goal=' + goal.goalId, mode: 'controlled' });
    try {
      await waitFor(() => findAllClass(plan.page.root, 'sys-line').some((line) => textOf(line).startsWith('缺项：')));
      await quietPage(plan.log);
      const last = findAllClass(plan.page.root, 'sys-line').at(-1)!;
      expect(textOf(last).startsWith('缺项：cu6r4-work：没有检查覆盖的必需要求'), textOf(last)).toBe(true);
      expect(textOf(last)).not.toContain('在主对话里说');
      expect(textOf(last)).not.toContain('参谋');
      /* ⑥ 121-171: the row's button prefills the composer and sends nothing. */
      const input = (): FakeElement | undefined => findElement(plan.page.root,
        (element) => element.getAttribute('id') === 'plan-input');
      const submits = countRoute(plan.log, 'requests/submit');
      const asks = countRoute(plan.log, 'requests/ask');
      click(findButton(last, '让秘书补检查')!);
      const prefill = '给任务“cu6r4-work”补一个检查，覆盖它还没有检查的必需要求：';
      await waitFor(() => input()?.value === prefill);
      expect(document.activeElement).toBe(input());
      await quietPage(plan.log);
      /* 具名改坏: 按钮自己发 `requests/submit`；这两句红。 */
      expect(countRoute(plan.log, 'requests/submit')).toBe(submits);
      expect(countRoute(plan.log, 'requests/ask')).toBe(asks);
      /* 具名改坏: 预填覆盖人已经写的话；这一句红。 */
      typeInto(plan.page.root, 'plan-input', '先查登录');
      click(findButton(last, '让秘书补检查')!);
      await waitFor(() => input()?.value === '先查登录');
      /* Start ⑦ from an empty composer: the button never overwrites words. */
      typeInto(plan.page.root, 'plan-input', '');

      /* ⑦ 121-171: the same button on the verification_uncovered stop card. The
         card is inferred from the code path (no other row runs it), so a world
         that never reaches it skips this half instead of inventing one. */
      const stopQueue = async (): Promise<DecisionQueueReadV1> => {
        const body = (await w.world.post('decisions/queue', plain(S6A_SCOPE, {
          workspace: S6A_SCOPE, goalRef: goal, sections: ['waiting_answer'], page: { limit: 100 },
        }))).body as { value?: DecisionQueueReadV1 };
        return body.value as DecisionQueueReadV1;
      };
      const stopRead = await heartbeatUntil(w.world, stopQueue, (queue) => queue.waitingAnswer.some((entry) =>
        entry.source.kind === 'goal_cause' && entry.taskRef?.taskId === 'cu6r4-work'
        && parsedCode(entry) === 'verification_uncovered'), 600);
      /* The world does reach this card (the run above shows it); the row must
         not pass by skipping it. */
      expect(stopRead.waitingAnswer.some((entry) => entry.source.kind === 'goal_cause'
        && entry.taskRef?.taskId === 'cu6r4-work' && parsedCode(entry) === 'verification_uncovered')).toBe(true);
      {
        const stopCardOf = (root: FakeElement): FakeElement | undefined => findElement(root,
          (element) => element.tagName.toLowerCase() === 'section' && hasClass(element, 'decision'));
        const titleOf = (root: FakeElement): string => textOf(findClass(stopCardOf(root)!, 'dc-title'));
        const openStop = async (root: FakeElement): Promise<void> => {
          click(findClass(root, 'gb-decide')!);
          await waitFor(() => stopCardOf(root) !== undefined);
          for (let i = 0; i < 12 && !titleOf(root).includes('没有覆盖验收的检查'); i += 1) {
            const before = titleOf(root);
            click(findElement(stopCardOf(root)!, (element) => element.tagName.toLowerCase() === 'button'
              && element.getAttribute('aria-label') === '下一条')!);
            await waitFor(() => titleOf(root) !== before);
          }
          expect(titleOf(root)).toContain('没有覆盖验收的检查');
        };
        const stopPrefill = '给任务“cu6r4-work”补一个检查，覆盖它还没有检查的必需要求：';
        await openStop(plan.page.root);
        const primary = findButton(stopCardOf(plan.page.root)!, '让秘书补检查');
        expect(primary).toBeDefined();
        expect(primary!.getAttribute('aria-disabled')).not.toBe('true');
        click(findButton(stopCardOf(plan.page.root)!, '详情')!);
        await waitFor(() => textOf(stopCardOf(plan.page.root)!).includes('要补检查，告诉秘书要查什么，秘书会起草带新检查的计划'));
        const planSubmits = countRoute(plan.log, 'requests/submit');
        click(findButton(stopCardOf(plan.page.root)!, '让秘书补检查')!);
        await waitFor(() => input()?.value === stopPrefill);
        expect(document.activeElement).toBe(input());
        await quietPage(plan.log);
        expect(countRoute(plan.log, 'requests/submit')).toBe(planSubmits);
        await plan.page.restore();

        const main = await bootE3N(w.world, 'Main', { search: '?goal=' + goal.goalId, mode: 'controlled' });
        try {
          await waitFor(() => findAllClass(main.page.root, 'sys-line').length > 0 || findClass(main.page.root, 'goalbar') !== undefined);
          await quietPage(main.log);
          await openStop(main.page.root);
          const mainPrimary = findButton(stopCardOf(main.page.root)!, '让秘书补检查');
          expect(mainPrimary).toBeDefined();
          expect(mainPrimary!.getAttribute('aria-disabled')).not.toBe('true');
          const composer = (): FakeElement | undefined => findElement(main.page.root,
            (element) => element.getAttribute('id') === 'composer-input');
          const mainSubmits = countRoute(main.log, 'requests/submit');
          click(mainPrimary!);
          await waitFor(() => composer()?.value === stopPrefill);
          expect(document.activeElement).toBe(composer());
          await quietPage(main.log);
          expect(countRoute(main.log, 'requests/submit')).toBe(mainSubmits);
        } finally {
          await main.page.restore();
        }
      }
    } finally {
      await plan.page.restore();
    }
  }, 180_000);

  it('6-1 the stop write in flight: 停止 is off and a second confirm sends nothing', async () => {
    const w = await openStuckRunWorld('r61');
    cleanup = w.close;
    await w.started();
    w.fixture.world.clock.advance(11 * 60_000);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { page, log } = await bootE3N(w.fixture.world, 'TaskMap',
      { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled',
        before: { 'controls/submit': async () => { await held; } } });
    try {
      await waitFor(() => dagNode(page.root, TASK) !== undefined);
      await quietPage(log);
      await openTask(page, TASK);
      const from = log.calls.length;
      click(findButton(detailOf(page.root)!, '停止')!);
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog') !== undefined);
      click(findButton(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')!, '取消执行')!);
      await waitFor(() => {
        const stop = findButton(detailOf(page.root)!, '停止');
        return stop !== undefined && (stop.getAttribute('class') ?? '').includes('is-off')
          && stop.getAttribute('disabled') !== null;
      });
      click(findButton(detailOf(page.root)!, '停止')!);
      expect(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog'), 'the off 停止 opens no card').toBeUndefined();
      release();
      await waitFor(() => textOf(detailOf(page.root)).includes('，停止请求中'));
      expect(routesSince(log, from).filter((route) => route === 'controls/submit'), 'one controls/submit').toHaveLength(1);
      expect(routesSince(log, from).filter((route) => route === 'lines/read'), 'one lines/read').toHaveLength(1);
    } finally {
      await page.restore();
    }
  });

  it('6-2 Esc, 不取消 and a failed write put focus back on 停止', async () => {
    const w = await openStuckRunWorld('r62');
    cleanup = w.close;
    await w.started();
    w.fixture.world.clock.advance(11 * 60_000);
    const { page } = await bootE3N(w.fixture.world, 'TaskMap',
      { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled',
        rejectOnce: { route: 'controls/submit', code: 'unavailable', reason: 'r62' } });
    try {
      await openTask(page, TASK);
      const stop = (): FakeElement => findButton(detailOf(page.root)!, '停止')!;
      const dialog = (): FakeElement | undefined => findElement(page.root,
        (element) => element.getAttribute('role') === 'alertdialog');
      click(stop());
      await waitFor(() => dialog() !== undefined);
      pressKey(dialog()!, 'Escape');
      await waitFor(() => dialog() === undefined);
      expect(document.activeElement, 'Esc returns focus to 停止').toBe(stop());
      click(stop());
      await waitFor(() => dialog() !== undefined);
      click(findButton(dialog()!, '不取消')!);
      await waitFor(() => dialog() === undefined);
      expect(document.activeElement, '不取消 returns focus to 停止').toBe(stop());
      click(stop());
      await waitFor(() => dialog() !== undefined);
      click(findButton(dialog()!, '取消执行')!);
      await waitFor(() => textOf(detailOf(page.root)).includes('暂时写不了，可以重试。'));
      expect(document.activeElement, 'a failed write returns focus to 停止').toBe(stop());
    } finally {
      await page.restore();
    }
  });

  it('6-3 a stop failure belongs to its Task: B has no failure text, A still does', async () => {
    const w = await openStuckRunWorld('r63', { secondTask: true });
    cleanup = w.close;
    await w.started();
    w.fixture.world.clock.advance(11 * 60_000);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { page, log } = await bootE3N(w.fixture.world, 'TaskMap',
      { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled',
        before: { 'controls/submit': async () => { await held; } },
        rejectOnce: { route: 'controls/submit', code: 'unavailable', reason: 'r63' } });
    const a = 'Independent work r63-work';
    const b = 'Independent work r63-own';
    try {
      await openTask(page, a);
      click(findButton(detailOf(page.root)!, '停止')!);
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog') !== undefined);
      click(findButton(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')!, '取消执行')!);
      await openTask(page, b);
      release();
      await waitFor(() => callsTo(log, 'controls/submit').some((call) => call.reply !== undefined));
      expect(textOf(detailOf(page.root)), 'B does not show A’s failure').not.toContain('暂时写不了');
      await openTask(page, a);
      await waitFor(() => textOf(detailOf(page.root)).includes('暂时写不了，可以重试。'));
      expect(textOf(detailOf(page.root))).toContain('暂时写不了，可以重试。');
    } finally {
      await page.restore();
    }
  });

  it('6-4 a card open in replay does not come back after 回到现在', async () => {
    const w = await openStuckRunWorld('r64');
    cleanup = w.close;
    await w.started();
    w.fixture.world.clock.advance(11 * 60_000);
    const { page } = await bootE3N(w.fixture.world, 'TaskMap',
      { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled' });
    try {
      await openTask(page, TASK);
      const dialog = (): FakeElement | undefined => findElement(page.root,
        (element) => element.getAttribute('role') === 'alertdialog');
      click(findButton(detailOf(page.root)!, '停止')!);
      await waitFor(() => dialog() !== undefined);
      pressKey(findElement(page.root, (element) => element.getAttribute('role') === 'slider')!, 'Home');
      await waitFor(() => dialog() === undefined);
      click(findButton(page.root, '回到现在')!);
      await waitFor(() => findButton(page.root, '回到现在') === undefined);
      expect(dialog(), 'the card does not come back').toBeUndefined();
      expect(findButton(detailOf(page.root)!, '停止'), 'live again gives 停止').toBeDefined();
    } finally {
      await page.restore();
    }
  });

  it('6-6 a line read back not_found says the fixed sentence, not 写入失败', async () => {
    const w = await openStuckRunWorld('r66');
    cleanup = w.close;
    await w.started();
    w.fixture.world.clock.advance(11 * 60_000);
    const { page } = await bootE3N(w.fixture.world, 'TaskMap',
      { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled',
        rejectOnce: { route: 'lines/read',
          input: (input) => (input as { key?: { sessionId?: string } }).key?.sessionId === w.line.ref.sessionId,
          code: 'not_found', reason: 'r66 line gone' } });
    try {
      await openTask(page, TASK);
      click(findButton(detailOf(page.root)!, '停止')!);
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog') !== undefined);
      click(findButton(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')!, '取消执行')!);
      await waitFor(() => textOf(detailOf(page.root)).includes('这次执行已经结束，或现在停不了。'));
      expect(textOf(detailOf(page.root))).not.toContain('写入失败。');
    } finally {
      await page.restore();
    }
  });

  it('N6 撤销暂缓 in flight: the button is off and a second click sends one write', async () => {
    const p1 = await openP1World({ backend: 'memory', running: true, autonomy: 'every_step' });
    cleanup = p1.close;
    const [s] = await p1.holdRounds([p1.lines.S], 'cu6n6');
    const placed = await p1.world.platform.claimHolds.place(s.ctx,
      write({ taskRef: p1.task.tB, reason: 'CU6 N6 hold' }, 'cu6n6-place'));
    expect(placed.status, 'the hold is placed').toBe('committed');
    const graph = ready<{ tasks: Array<{ ref: { taskId: string }; definition: { title: string } }> }>(
      await p1.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: p1.goal })), 'tasks/query');
    const title = graph.tasks.find((row) => row.ref.taskId === 'p1-tb')!.definition.title;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { page, log } = await bootE3N(p1.world, 'TaskMap',
      { search: '?goal=' + p1.goal.goalId, mode: 'controlled',
        before: { 'tasks/hold/release': async () => { await held; } } });
    try {
      await waitFor(() => dagNode(page.root, title) !== undefined);
      click(dagNode(page.root, title)!);
      await waitFor(() => findButton(detailOf(page.root)!, '撤销暂缓') !== undefined);
      const release1 = (): FakeElement => findButton(detailOf(page.root)!, '撤销暂缓')!;
      click(release1());
      await waitFor(() => (release1().getAttribute('class') ?? '').includes('is-off')
        && release1().getAttribute('disabled') !== null);
      click(release1());
      release();
      await waitFor(() => callsTo(log, 'tasks/hold/release').some((call) => call.reply !== undefined));
      expect(callsTo(log, 'tasks/hold/release'), 'one controls write').toHaveLength(1);
    } finally {
      await page.restore();
    }
  });

  it('F3 one Task’s stop in flight: another Task’s 停止 still opens its card and A sends one write', async () => {
    const w = await openStuckRunWorld('r63f3', { secondTask: true });
    cleanup = w.close;
    const bRun = w.fixture.runTask({ line: w.own!, taskId: w.fixture.tasks[0]!.taskId, flowId: 'r63f3-own', replies: [{ kind: 'calls', calls: [{ callId: 'r63f3-shell', name: 'shell', args: { command: 'while [ ! -e r63f3-go ]; do : > r63f3b-started; sleep 0.05; done; echo go' } }] }, { kind: 'text', text: 'r63f3 own released' }] }).catch(() => undefined);
    await w.started(); await waitFor(() => existsSync(join(w.fixture.world.root, 'r63f3b-started')));
    w.fixture.world.clock.advance(11 * 60_000);
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    const { page, log } = await bootE3N(w.fixture.world, 'TaskMap', { search: '?goal=' + w.fixture.goal.goalId, mode: 'controlled', before: { 'controls/submit': () => held } });
    const dialog = () => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog');
    const card = async (title: string) => { await openTask(page, title); click(findButton(detailOf(page.root)!, '停止')!); await waitFor(() => dialog() !== undefined); };
    try {
      await card('Independent work r63f3-work');
      click(findButton(dialog()!, '取消执行')!);
      await waitFor(() => (findButton(detailOf(page.root)!, '停止')?.getAttribute('class') ?? '').includes('is-off'));
      await card('Independent work r63f3-own');
      release();
      await waitFor(() => callsTo(log, 'controls/submit').length === 1);
      expect(callsTo(log, 'controls/submit'), 'A one stop write').toHaveLength(1);
      expect((callsTo(log, 'controls/submit')[0]!.input as { kind: string }).kind).toBe('cancel');
    } finally {
      await page.restore();
    }
  });

  it('⑤ 更多: done-b has 必需 and its second attempt; done-a has 必需 only; a new selection collapses it', async () => {
    const w = await openDoneDeliveryWorld({ completed: false });
    cleanup = w.close;
    const { page, log } = await bootE3N(w.world, 'TaskMap', { search: '?goal=' + w.goal.goalId, mode: 'controlled' });
    try {
      const b = 'PL stage 1 ' + DONE_TASK_B;
      const a = 'PL stage 1 ' + DONE_TASK_A;
      await openTask(page, b);
      const more = (): FakeElement => (findButton(detailOf(page.root)!, '更多')
        ?? findButton(detailOf(page.root)!, '收起'))!;
      expect(more().getAttribute('aria-expanded')).toBe('false');
      click(more());
      await waitFor(() => more().getAttribute('aria-expanded') === 'true');
      expect(morePairs(detailOf(page.root)!)).toEqual([
        ['必需/可选', '必需'],
        ['尝试', '第 2 次尝试 · 系统自动重新入队（1/3）：检查未通过'],
      ]);

      await openTask(page, a);
      expect(findButton(detailOf(page.root)!, '更多')!.getAttribute('aria-expanded'), 'a new selection collapses 更多').toBe('false');
      click(findButton(detailOf(page.root)!, '更多')!);
      await waitFor(() => findButton(detailOf(page.root)!, '收起') !== undefined);
      expect(morePairs(detailOf(page.root)!)).toEqual([['必需/可选', '必需']]);

      await openTask(page, b);
      expect(findButton(detailOf(page.root)!, '更多')!.getAttribute('aria-expanded')).toBe('false');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑥ an optional work Task: the card, the detail head after its read and 更多 say （可选）, no other Task does', async () => {
    const w = await openPLWorkflowWorld({ label: 'cu6r6' });
    cleanup = w.close;
    const goal = w.goal;
    const base = plSkeletonDraft(goal, { label: 'cu6r6', stageOneTaskIds: ['cu6r6-a', 'cu6r6-b'],
      omitStagePlaceholder: true, goalGate: true });
    const optional = {
      taskId: 'cu6r6-optional', stageId: 'pl-stage-1', title: 'CU6 optional work',
      requirementLevel: 'optional' as const, taskKind: 'work' as const, disposition: 'active' as const,
      phase: 'pending' as const, scope: { kind: 'stage' as const, stageId: 'pl-stage-1' },
      executionIntent: 'request_execution' as const, sizeClass: 'small' as const,
    };
    await adoptPLPlanDraft(w.main, goal, { ...base,
      tasks: [...base.tasks, optional],
      assignments: [...(base.assignments ?? []), { taskId: optional.taskId, role: S6A_WORK_ROLE.templateId,
        instruction: 'CU6 optional instruction' }] }, 'cu6r6');

    const { page, log } = await bootE3N(w.world, 'TaskMap', { search: '?goal=' + goal.goalId, mode: 'controlled' });
    try {
      await waitFor(() => dagNode(page.root, optional.title) !== undefined);
      await quietPage(log);
      hover(dagNode(page.root, optional.title)!);
      await waitFor(() => findClass(page.root, 'hcard') !== undefined);
      expect(statusWord(findClass(page.root, 'hcard')!)).toMatch(/（可选）$/);

      await openTask(page, optional.title);
      await waitFor(() => callsTo(log, 'graph/detail').some((call) => call.reply !== undefined));
      expect(statusWord(detailOf(page.root)!)).toMatch(/（可选）$/);
      click(findButton(detailOf(page.root)!, '更多')!);
      await waitFor(() => findButton(detailOf(page.root)!, '收起') !== undefined);
      expect(morePairs(detailOf(page.root)!)).toContainEqual(['必需/可选', '可选']);

      const labelled = findAllClass(page.root, 'dg-node')
        .map((node) => node.getAttribute('aria-label') ?? '').filter((label) => label.includes('（可选）'));
      expect(labelled, 'only the optional Task says （可选）').toHaveLength(1);
      expect(labelled[0]).toContain(optional.title);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑦ the DST hour ends at 03:00 in 只看, the year day card and the breadcrumb', () => {
    const dst = hourCell(1, 3, { endAt: new Date(2026, 9, 4, 3).toISOString() });
    const picked = sceneView([], sceneData(hourCalendar([dst])));
    picked.view.instance.setState({ view: 'lanes' });
    picked.vals().wl.cal.rows[0]!.cells.find((entry) => entry.key.includes('|01|'))!.pick();
    expect(picked.vals().wl.cellLabel).toBe('10-04 01:00–03:00');

    const days = dayCalendar().cells as Row[];
    const year = sceneView([], sceneData(hourCalendar([...days, dst])));
    year.view.instance.setState({ view: 'lanes', wlWin: 'all', wlDay: '2026-10-04' });
    const cell = (): Row & { hover(): void; pick(): void } =>
      year.vals().wl.cal.rows[0]!.cells.find((entry) => entry.key.includes('|01|'))!;
    cell().hover();
    expect(year.vals().wl.ccard.name.endsWith('01:00–03:00')).toBe(true);
    cell().pick();
    const crumbs = year.vals().wl.crumbs;
    expect(crumbs.at(-1)!.label).toBe('01:00–03:00');
  }, 30_000);
});
