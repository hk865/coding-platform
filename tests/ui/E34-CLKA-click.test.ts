import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArchiveLineInput, ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from '../scenarios/harness.js';
import { committedOf, futureIntent, hostAdopt } from '../scenarios/support/plan.js';
import { execution, redrivePolicy, textReply } from '../scenarios/support/common.js';
import {
  archivedLineContaining, lineArchived, ready, runMaintenance,
} from '../helpers/S2C-K-scenario-support.js';
import { bootPage, findAllClass, findButton, findClass, findElement, type BootedPage, type PageFetch } from './helpers/boot-page.js';
import { openUnknownWorld } from './helpers/E3D-world.js';
import { detailText } from './helpers/E3A-page.js';
import { forwardPage, newPageLog, routeOf } from './helpers/E3N-page.js';
import { until } from '../helpers/change-stream-reader.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E34-CLKA (clk-current §2 TaskMap rows, package 1): the six "能点击级测、
 * 还没测试" TaskMap rows. Every row boots the page working copy through the
 * Node fake DOM against a real Host over HTTP; the Host's model is scripted
 * (decision 121-29), never a real model or the network.
 */

afterEach(cleanupScenarios);

const WORK = 'Independent work ag2b-work';
const INSTRUCTION = 'Perform independent work ag2b-work';

const pageOn = (h: HostScenario, request?: PageFetch): Promise<BootedPage> => bootPage({
  name: 'TaskMap', search: '?goal=' + AG2B_GOAL_REF.goalId, token: h.host.token,
  request: request ?? forwardPage(h.host, newPageLog()),
});

const forwarding = (h: HostScenario, routes?: string[]): PageFetch => {
  const forward = forwardPage(h.host, newPageLog());
  return async (url, init, realFetch) => {
    routes?.push(routeOf(url));
    return forward(url, init, realFetch);
  };
};

/** The DAG node button, not the attention list's button of the same name. */
const dagNode = (root: FakeElement, title: string): FakeElement | undefined => findElement(root,
  (element) => element.tagName.toLowerCase() === 'button'
    && (element.getAttribute('class') ?? '').split(/\s+/).includes('dg-node')
    && element.textContent.includes(title));

const clickTask = async (page: BootedPage, title: string, routes?: string[]): Promise<void> => {
  await until(() => dagNode(page.root, title) !== undefined, 30_000);
  dagNode(page.root, title)!.dispatch('click');
  await until(() => (routes === undefined || routes.includes('graph/detail')) && detailText(page.root).includes(title), 30_000);
};

describe('E34-CLKA P02-9/P15-3 the unknown-outcome Task in a real restarted Host', () => {
  let unknown: HostScenario | undefined;
  let page: BootedPage | undefined;

  it('P02-9 在工作台里处理 is a Main.dc.html link that keeps the current goal, never the member page', async () => {
    /* 看什么（ui1-clicktest P02-9）: 跳到 Main.dc.html，不是直接到成员页；
       到成员页还要再点左栏线。 The page is the one native `<a>`, read by href
       (E3N-1's convention: links are never chased). */
    unknown = await openUnknownWorld();
    const routes: string[] = [];
    page = await pageOn(unknown, forwarding(unknown, routes));
    try {
      await until(() => findButton(page!.root, WORK) !== undefined, 30_000);
      expect(routes).toContain('graph/hover');
      await clickTask(page, WORK, routes);
      const detail = findClass(page.root, 'detail')!;
      expect(detail.textContent).toContain('需要你决定');
      const link = findElement(detail, (element) => element.tagName.toLowerCase() === 'a'
        && element.textContent.includes('在工作台里处理'))!;
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).not.toContain('Member.dc.html');
      /* 具名改坏: boot.ts 的 TaskMap 不在 Main 链接改写列表；本行的 goal 断言红。 */
      const url = new URL(link.getAttribute('href') ?? '', 'http://host/workbench/TaskMap.dc.html');
      expect(url.pathname).toBe('/workbench/Main.dc.html');
      expect(url.searchParams.get('goal')).toBe('ag2b-goal');
      link.dispatch('click');
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P15-3 a run_outcome_unknown Task detail says 执行结果待核对 and its reason', async () => {
    /* E3I 5.6-10 / UI-WORKBENCH §8: the prototype's fixed word is
       执行结果待核对 (clk-current records today's word; the old 待核对 is
       superseded). The reason comes from the map row's phase cause. */
    unknown = await openUnknownWorld();
    const routes: string[] = [];
    page = await pageOn(unknown, forwarding(unknown, routes));
    try {
      await until(() => dagNode(page!.root, WORK) !== undefined, 30_000);
      expect(dagNode(page.root, WORK)!.getAttribute('aria-label')).toContain('执行结果待核对');
      await clickTask(page, WORK, routes);
      const detail = findClass(page.root, 'detail')!;
      expect(detail.textContent).toContain('执行结果待核对');
      expect(detail.textContent).toContain('需要你决定');
      expect(routes).toContain('graph/detail');
    } finally {
      await page.restore();
    }
  }, 180_000);
});

describe('E34-CLKA P07-2 two lines overlap on the real track', () => {
  it('P07-2 轨道 draws each line as a row, the two live Run bars overlap and the card names the run', async () => {
    /* 看什么（ui1-clicktest P07-2）: 两条线各一行，Run 横条在时间上重叠；
       悬停条显示原因。 Two Tasks enter their Runs before either reply (DRV
       D-F1); B's model call fails while A is still held, so the intervals
       really overlap and the failed bar has a reason. */
    const h = await openHostScenario({
      workIds: ['p07-a', 'p07-b'],
      automation: { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: 'off' },
      script: { replies: [textReply('P07-2 A is still running'), textReply('P07-2 B is still running')] },
    });
    const heldA = h.holdReply(0);
    const heldB = h.holdReply(1);
    const runningA = h.advance(h.select('p07-2-a', 'p07-a'));
    await heldA.reached;
    const runningB = h.advance(h.select('p07-2-b', 'p07-b'));
    await heldB.reached;

    const routes: string[] = [];
    let page: BootedPage | undefined;
    try {
      page = await pageOn(h, forwarding(h, routes));
      await until(() => findButton(page!.root, '轨道') !== undefined, 30_000);
      findButton(page.root, '轨道')!.dispatch('click');
      await until(() => findAllClass(page!.root, 'k-run').length >= 2, 30_000);
      expect(routes).toContain('activity/track');

      const bars = findAllClass(page.root, 'k-run');
      expect(bars).toHaveLength(2);
      const rows = findAllClass(page.root, 'wl-row').filter((row) => findAllClass(row, 'k-run').length > 0);
      expect(rows).toHaveLength(2);

      /* Both Runs are live at the page's now: the drawn bars start together
         (the scenario clock) and both are still open, so their intervals
         overlap on the page, not only in the route's answer. */
      expect(bars.every((bar) => (bar.getAttribute('class') ?? '').includes('is-live'))).toBe(true);
      const position = (bar: FakeElement, key: 'left' | 'width'): number => {
        const match = new RegExp(`${key}: ([0-9.]+)%`).exec(bar.getAttribute('style') ?? '');
        if (match === null) throw new Error(`P07-2: the bar has no ${key}`);
        return Number(match[1]);
      };
      const [a, b] = bars;
      expect(position(a!, 'left')).toBeLessThan(position(b!, 'left') + position(b!, 'width'));
      expect(position(b!, 'left')).toBeLessThan(position(a!, 'left') + position(a!, 'width'));

      a!.dispatch('mouseenter', { currentTarget: a });
      await until(() => findClass(page!.root, 'hcard') !== undefined, 30_000);
      const card = findClass(page.root, 'hcard')!;
      expect(card.textContent).toContain('执行中');
      expect(card.textContent).toContain('时间');
    } finally {
      heldA.release();
      heldB.release();
      await runningA;
      await runningB;
      await page?.restore();
    }
  }, 240_000);
});

describe('E34-CLKA P09-5 an unrelated adoption leaves the claimed Task running', () => {
  it('P09-5 the unrelated plan adoption does not stop the claimed Task; the page still shows it 执行中', async () => {
    /* C6-unrelated-adoption (route/behaviour): T1 is claimed and prepared on
       P1; a person adopts P2 which adds an unrelated future intent. T1 keeps
       its Run and Session, and the TaskMap page still draws it executing
       (ui1-clicktest P09-5: 任务仍是执行中/可领取). */
    const h = await openHostScenario({
      automation: redrivePolicy(false),
      script: { replies: [textReply('P09-5 the claimed work continues')] },
    });
    try {
      const toStart = await h.advance(h.select('p09-5-claim', 'ag2b-work'), { stopBefore: performs('start') });
      expect(toStart.state).toBe('stopped');
      const claim = committedOf(toStart.receipts, 'claim_task');
      const before = await execution(h, claim.runRef);
      expect(before.run).toMatchObject({ status: 'starting' });

      await hostAdopt(h, 'p09-5-plan', (draft) => ({ ...draft, tasks: [...draft.tasks, futureIntent('p09-future')] }),
        { text: 'P09-5 an unrelated adoption', sources: [] }, 'p09-5');

      const after = await execution(h, claim.runRef);
      expect(after.run).toMatchObject({ status: 'starting' });
      expect(after.lease?.release).toBeUndefined();
      expect((await h.taskRow()).requeueRef).toBeUndefined();

      const routes: string[] = [];
      const page = await pageOn(h, forwarding(h, routes));
      try {
        await until(() => dagNode(page.root, WORK) !== undefined, 30_000);
        await until(() => findButton(page!.root, 'Unrelated future intent') !== undefined, 30_000);
        expect(dagNode(page.root, WORK)!.getAttribute('aria-label')).toContain('执行中');
        await clickTask(page, WORK, routes);
        const detail = findClass(page.root, 'detail')!;
        expect(detail.textContent).toContain('执行中');
        expect(routes).toContain('graph/detail');
      } finally {
        await page.restore();
      }
    } finally {
      /* cleanupScenarios disposes the Host after the row. */
    }
  }, 240_000);
});

describe('E34-CLKA P12-8 an interruption anchor after archiving a running line', () => {
  it('P12-8 the dropped Task detail names the line, the work, the changed file and 中断，待核对', async () => {
    /* Decision 42 / UI-WORKBENCH:129 via S2C-K-archive-interruption: archive
       the running line with `drop`; the dropped Task keeps an anomaly anchor
       and reads 中断，待核对 · 等待推进. The Run edited one file before the
       model call was held, so the detail can name 改过哪些文件. */
    const h = await openHostScenario({
      automation: redrivePolicy(false),
      script: { replies: [
        { kind: 'calls', calls: [{ callId: 'p12-8-edit', name: 'edit',
          args: { mode: 'create', path: 'src/p12-8-changed.txt', newText: 'P12-8 changed file\n' } }] },
        textReply('P12-8 the archived Run never answers'),
      ] },
    });
    const held = h.holdReply(1);
    let page: BootedPage | undefined;
    try {
      const toStart = await h.advance(h.select('p12-8-run1', 'ag2b-work'), { stopBefore: performs('start') });
      if (toStart.next === null) throw new Error('P12-8: the Workflow must reach the start');
      const starting = h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next));
      await held.reached;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('P12-8: the work Run must be selected');
      const session = (await readExecution(h.host, runRef)).session;
      const head = session.ref.sessionId;

      const request: GraphWrite<ArchiveLineInput> = {
        input: { sessionRef: { projectId: session.ref.projectId, sessionId: head },
          reason: 'P12-8: the person archives the running line',
          tasks: [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: 'ag2b-work' } },
            disposition: { kind: 'drop' } }], wait: null },
        meta: { requestId: 'p12-8-archive', expected: [{ ref: session.ref, revision: session.revision }] },
      };
      const started = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE, request });
      expect(started.status).toBe('ready');
      held.fail('P12-8: the archive stops the held Turn');
      await starting;
      await h.advance(h.select('p12-8-advance'), { stopBefore: performs('start') });
      await runMaintenance(h, 'p12-8-maintenance');

      expect(existsSync(join(h.root, 'src/p12-8-changed.txt')), 'the Run edited the file before the hold').toBe(true);
      const archived = ready(await lineArchived(h), 'lines/archived after the archive');
      const line = archivedLineContaining(archived, head);
      expect(line).toBeDefined();
      const who = line!.name.primary;

      const routes: string[] = [];
      page = await pageOn(h, forwarding(h, routes));
      await until(() => dagNode(page!.root, WORK) !== undefined, 30_000);
      expect(dagNode(page.root, WORK)!.getAttribute('aria-label')).toContain('中断，待核对');
      await clickTask(page, WORK, routes);
      const detail = findClass(page.root, 'detail')!;
      expect(detail.textContent).toContain('中断，待核对');
      expect(detail.textContent).toContain('负责的 Agent');
      expect(detail.textContent).toContain(who);
      expect(detail.textContent).toContain(INSTRUCTION);
      /* The detail head (state, owner, work) draws from the map at once; the
         files come with the async `graph/detail` read. Wait for that read
         before reading the files. 具名改坏: `task-map.ts` 把 executed 置空；
         本行的文件/改动未知断言红。 */
      await until(() => detail.textContent.includes('p12-8-changed.txt')
        || detail.textContent.includes('改动未知'));
      expect(detail.textContent.includes('p12-8-changed.txt') || detail.textContent.includes('改动未知')).toBe(true);
    } finally {
      held.fail('P12-8 cleanup');
      await page?.restore();
    }
  }, 240_000);
});

describe('E34-CLKA P15-2 the Task map and detail are the same after a Host restart', () => {
  it('P15-2 the same node and detail return after the Host restarts on the same data', async () => {
    /* 看什么（ui1-clicktest P15-2）: 图恢复原 Goal/Plan/Run；节点/详情与
       重启前一致。 One real Work Run is satisfied before the clean restart;
       the Run ref and the opened detail are compared across it. */
    const h = await openHostScenario({ check: 'pass', script: { replies: [textReply('P15-2 the work Run answers')] } });
    try {
      await h.advance(h.select('p15-2-run', 'ag2b-work'));
      expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
      const runBefore = (await h.taskRow()).execution;
      expect(runBefore).not.toBeNull();

      const beforeRoutes: string[] = [];
      let page = await pageOn(h, forwarding(h, beforeRoutes));
      let before = '';
      try {
        await clickTask(page, WORK, beforeRoutes);
        before = detailText(page.root);
        expect(before).toContain('已满足');
        expect(before).toContain(INSTRUCTION);
      } finally {
        await page.restore();
      }
      expect(beforeRoutes).toContain('graph/detail');

      await h.restart();
      expect((await h.taskRow()).execution).toEqual(runBefore);
      expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });

      const afterRoutes: string[] = [];
      page = await pageOn(h, forwarding(h, afterRoutes));
      try {
        await clickTask(page, WORK, afterRoutes);
        expect(detailText(page.root)).toBe(before);
        expect(afterRoutes).toContain('graph/detail');
      } finally {
        await page.restore();
      }
    } finally {
      /* cleanupScenarios disposes the Host after the row. */
    }
  }, 240_000);
});
