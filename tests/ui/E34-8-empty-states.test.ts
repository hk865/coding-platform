import { afterAll, describe, expect, it } from 'vitest';
import { createHostClient } from '../../src/ui/host-client.js';
import { readTaskMap } from '../../src/ui/boot.js';
import { adaptTaskMapTime, type TaskMapCalendarRead } from '../../src/ui/adapters/task-map.js';
import { BoardView } from '../../src/ui/runtime.js';
import { fileURLToPath } from 'node:url';
import { loadBoard } from './helpers/board-files.js';
import { ag2bPlanDraft } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { until } from '../helpers/change-stream-reader.js';
import { adoptE34Plan } from './helpers/E34-plan.js';
import { bootPage, findButton, findClass, type BootedPage } from './helpers/boot-page.js';

/** E34-8 (design §6): the three empty worlds show an empty state in every
 * view, never a sample fact, `NaN`, or a zero the read did not record. */
const SAMPLE = ['状态机可靠性改造', '状态机规格对齐', '目标验收', '执行者 · SSE 推送'];
let world: S6ARequestWorld | undefined;

afterAll(async () => { await world?.close(); world = undefined; });

function pageOf(w: S6ARequestWorld, search: string): Promise<BootedPage> {
  return bootPage({ name: 'TaskMap', search, token: w.token,
    request: async (url, init, realFetch) => realFetch(new URL(url, w.base).href, init) });
}

/** Every tab keeps the one empty answer; no view falls back to sample facts. */
function expectEveryViewEmpty(page: BootedPage, text: string): void {
  for (const tab of ['DAG', '大纲', '轨道']) {
    findButton(page.root, tab)!.dispatch('click');
    expect(page.root.textContent).toContain(text);
    for (const sample of SAMPLE) expect(page.root.textContent).not.toContain(sample);
    expect(page.root.textContent).not.toContain('NaN');
    expect(page.root.textContent).not.toContain('undefined');
  }
}

describe('E34-8 empty states', () => {
  it('E34-8 an empty Goal and a Goal without an adopted Plan stay empty in every view', async () => {
    const empty = await openS6ARequestWorld({ backend: 'memory', defaultGoals: false });
    world = empty;
    const noGoal = await pageOf(empty, '');
    try {
      await until(() => noGoal.root.textContent.includes('这个项目还没有目标'), 20_000);
      /* Default DAG plus its dock and now column, even when everything is empty. */
      expect(findClass(noGoal.root, 'dg-now')).toBeDefined();
      expect((await readTaskMap(createHostClient(empty.token, new URL(empty.base).origin), null)).data).toBeNull();
      expectEveryViewEmpty(noGoal, '这个项目还没有目标');
      expect(noGoal.root.textContent).not.toContain('步骤 0');
    } finally { await noGoal.restore(); }

    const planned = await openS6ARequestWorld({ backend: 'memory' });
    world = planned;
    await governS6B(planned, s6aCardsWorkspace(planned, S6A_SCOPE), planned.goals);
    const noPlan = await pageOf(planned, `?goal=${S6A_GOAL_1.goalId}`);
    try {
      await until(() => noPlan.root.textContent.includes('这个目标还没有采用的计划'), 20_000);
      expect(findClass(noPlan.root, 'dg-now')).toBeDefined();
      expectEveryViewEmpty(noPlan, '这个目标还没有采用的计划');
      expect(noPlan.root.textContent).not.toContain('步骤 0');
    } finally { await noPlan.restore(); }
  }, 60_000);

  it('E34-8 a Plan with no activity shows each view empty without an invented 0', async () => {
    const opened = await openS6ARequestWorld({ backend: 'memory' });
    world = opened;
    await governS6B(opened, s6aCardsWorkspace(opened, S6A_SCOPE), opened.goals);
    const draft = ag2bPlanDraft(['e34-8-work']);
    draft.planId = 'e34-8-plan'; draft.goalId = S6A_GOAL_1.goalId;
    await adoptE34Plan(opened, S6A_SCOPE, S6A_GOAL_1, draft, 'empty');
    const page = await pageOf(opened, `?goal=${S6A_GOAL_1.goalId}`);
    try {
      await until(() => page.root.textContent.includes('Independent work e34-8-work'), 20_000);
      /* Default DAG frame: the dock and the now column exist even with no activity. */
      expect(findClass(page.root, 'dg-now')).toBeDefined();
      expect(findClass(page.root, 'is-dock')).toBeDefined();
      /* outline and DAG carry the real Task, the detail column its empty prompt */
      findButton(page.root, '大纲')!.dispatch('click');
      expect(page.root.textContent).toContain('Independent work e34-8-work');
      expect(page.root.textContent).toContain('点一个任务');
      findButton(page.root, 'DAG')!.dispatch('click');
      expect(page.root.textContent).toContain('Independent work e34-8-work');

      findButton(page.root, '轨道')!.dispatch('click');
      await until(() => page.root.textContent.includes('今天'), 20_000);
      /* The complete calendar read really recorded zero: 步骤 0 is a fact here,
         not an incomplete-read placeholder. The track is present and empty. */
      expect(page.root.textContent).toContain('步骤 0');
      expect(page.root.textContent).not.toContain('覆盖不完整');
      expect(page.root.textContent).not.toContain('未记全');
      expect(findClass(page.root, 'is-full')).toBeDefined();
      expect(findClass(page.root, 'tl-b')).toBeUndefined();
      for (const sample of SAMPLE) expect(page.root.textContent).not.toContain(sample);
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
    } finally { await page.restore(); }
  }, 60_000);

  it('E34-8 a complete zero is not an incomplete read', async () => {
    const base: TaskMapCalendarRead = {
      goalRef: { goalId: 'g1' }, from: '2026-10-04T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC', scope: 'goal', cells: [],
      totals: { steps: 0, edits: 0, checks: 0, complete: true },
    };
    const complete = adaptTaskMapTime([], base, null, []).calendar!;
    expect(complete.complete).toBe(true);
    expect(complete.summary).toContain('这段时间没有活动');
    expect(complete.summary).not.toContain('覆盖不完整');
    expect(complete.summary).not.toContain('未记全');

    const incomplete = adaptTaskMapTime([], {
      ...base, totals: { steps: 0, edits: 0, checks: 0, complete: false },
    }, null, []).calendar!;
    expect(incomplete.complete).toBe(false);
    expect(incomplete.summary).toContain('覆盖不完整');
    expect(incomplete.summary).toContain('未记全');

    /* The board's own summary must not turn that read into a complete zero. */
    const client = createHostClient(world!.token, new URL(world!.base).origin);
    const { data } = await readTaskMap(client, S6A_GOAL_1.goalId, {});
    expect(data).not.toBeNull();
    data!.time = adaptTaskMapTime([], { ...base, totals: { steps: 0, edits: 0, checks: 0, complete: false } }, null, []);
    const board = loadBoard('TaskMap', fileURLToPath(new URL('../../src/ui/boards/', import.meta.url)));
    const view = new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
    view.instance.setState({ view: 'lanes' });
    const sum = (view.instance.renderVals() as { wl: { sum: string } }).wl.sum;
    expect(sum).toContain('活动未记全');
    expect(sum).not.toContain('步骤 0');
  });


});
