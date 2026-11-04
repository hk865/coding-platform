import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { EventBinding, VNode } from '../../src/ui/render.js';
import { BoardView } from '../../src/ui/runtime.js';
import { readTaskMap } from '../../src/ui/boot.js';
import { isFinishedGoalDisplayPhase } from '../../src/ui/adapters/task-map.js';
import { createHostClient } from '../../src/ui/host-client.js';
import { loadBoard } from './helpers/board-files.js';
import { serializeTree } from './helpers/render.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE, S6A_WORK_ROLE, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { bootPage, type BootedPage } from './helpers/boot-page.js';

/**
 * E32-1/2/3 (ruling rows E32-1..3, items 6, 7, 8): the real Host routes are read
 * through `readTaskMap`, adapted to the board's data props, and the outline
 * shows the Goal, the Task names and their status words — never a sample fact.
 * A world with no Goal shows the empty state.
 */
const WORKING_BOARDS = fileURLToPath(new URL('../../src/ui/boards/', import.meta.url));
const stageName = 'E32 阶段';

function textOf(node: VNode): string {
  return node.kind === 'text' ? node.text : node.children.map(textOf).join('');
}

function eventOf(node: VNode, name: string): EventBinding | undefined {
  if (node.kind === 'text') return undefined;
  const attr = node.attrs.find((candidate) => candidate.name === name);
  return attr !== undefined && typeof attr.value === 'object' && attr.value.kind === 'event' ? attr.value : undefined;
}

function buttonWith(nodes: VNode[], text: string): (VNode & { kind: 'element' }) | undefined {
  for (const node of nodes) {
    if (node.kind === 'text') continue;
    if (node.tag.toLowerCase() === 'button' && textOf(node).includes(text)) return node;
    const found = buttonWith(node.children, text);
    if (found !== undefined) return found;
  }
  return undefined;
}

function withClassAll(nodes: VNode[], name: string): Array<VNode & { kind: 'element' }> {
  const found: Array<VNode & { kind: 'element' }> = [];
  for (const node of nodes) {
    if (node.kind === 'text') continue;
    const cls = node.attrs.find((attr) => attr.name === 'class');
    if (cls !== undefined && typeof cls.value === 'string' && cls.value.split(/\s+/).includes(name)) found.push(node);
    found.push(...withClassAll(node.children, name));
  }
  return found;
}

function withClass(nodes: VNode[], name: string): (VNode & { kind: 'element' }) | undefined {
  return withClassAll(nodes, name)[0];
}

let world: S6ARequestWorld | undefined;

/** `plans/propose` then `plans/apply` of one draft (the E32-1 path). */
async function adoptE32Plan(goal: typeof S6A_GOAL_1, draft: ReturnType<typeof ag2bPlanDraft>, label: string): Promise<void> {
  const proposed = await world!.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: `E32 ${label} plan`, sources: [] },
  }, `e32-${label}-propose`));
  const proposal = proposed.body as { status?: string; value?: { ref?: unknown; revision?: number } };
  if (proposal.status !== 'committed') throw new Error(`E32: the Plan ${label} proposal did not commit: ${JSON.stringify(proposal)}`);
  const applied = await world!.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.value?.ref, expectedProposalRevision: proposal.value?.revision, decisionRefs: [],
  }, `e32-${label}-apply`));
  const adoption = applied.body as { status?: string };
  if (adoption.status !== 'committed') throw new Error(`E32: the Plan ${label} adoption did not commit: ${JSON.stringify(adoption)}`);
}

beforeAll(async () => {
  const opened = await openS6ARequestWorld({ backend: 'memory' });
  world = opened;
  await governS6B(opened, s6aCardsWorkspace(opened, S6A_SCOPE), opened.goals);
  const draft = ag2bPlanDraft(['e32-work']);
  draft.planId = 'e32-plan';
  draft.goalId = S6A_GOAL_1.goalId;
  draft.stages = [{ stageId: 'e32-stage', title: stageName }];
  draft.tasks = draft.tasks.map((task) => ({
    ...task,
    stageId: 'e32-stage',
    scope: task.taskKind === 'work' ? { kind: 'stage' as const, stageId: 'e32-stage' } : task.scope,
  }));
  await adoptE32Plan(S6A_GOAL_1, draft, 'e32');
  /* One real line responsible for the Task: the hover owner is a real route
     fact, not a sample string. */
  await createS6BLine(s6aCardsWorkspace(opened, S6A_SCOPE), {
    label: 'e32-owner', role: S6A_WORK_ROLE,
    tasks: [{ projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId, taskId: 'e32-work' }],
  });
}, 30_000);

afterAll(async () => {
  await world?.close();
  world = undefined;
});

async function realView(goalId: string = S6A_GOAL_1.goalId): Promise<BoardView> {
  const client = createHostClient(world!.token, new URL(world!.base).origin);
  const { data } = await readTaskMap(client, goalId);
  expect(data).not.toBeNull();
  const board = loadBoard('TaskMap', WORKING_BOARDS);
  return new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
}

describe('E32-1 the real goal and tasks reach the DAG and the outline', () => {
  it('starts on the real DAG and keeps the same names and states in the outline', async () => {
    const view = await realView();
    view.render();
    /* Ruling 3: the default page is the DAG, never the outline. */
    expect(view.instance.state.view).toBe('dag');
    const dagHtml = serializeTree(view.tree);
    expect(dagHtml).toContain('S6A goal one');
    expect(dagHtml).toContain('Independent work e32-work');
    expect(dagHtml).toContain('Goal gate');
    expect(dagHtml).not.toContain('状态机可靠性改造');
    expect(dagHtml).not.toContain('状态机规格对齐');
    const node = buttonWith(view.tree, 'Independent work e32-work');
    expect(node).toBeDefined();
    expect(withClass([node!], 'dg-node')).toBe(node);
    const aria = node!.attrs.find((attr) => attr.name === 'aria-label');
    expect(typeof aria?.value === 'string' ? aria.value : '').toContain('可领取');

    /* The outline is a click, not the starting view; it shows the same real
       rows and no sample fact. */
    eventOf(buttonWith(view.tree, '大纲')!, 'onClick')!.handler({});
    /* The prototype opens only a stage with attention or activity; a pending
       stage is opened by the person. */
    eventOf(buttonWith(view.tree, 'E32 阶段')!, 'onClick')!.handler({});
    const outlineHtml = serializeTree(view.tree);
    expect(outlineHtml).toContain('S6A goal one');
    expect(outlineHtml).toContain('Independent work e32-work');
    expect(outlineHtml).toContain('待执行');
    expect(outlineHtml).not.toContain('状态机可靠性改造');
    expect(outlineHtml).not.toContain('状态机规格对齐');
  });
});

describe('E32-2 selection and the hover card carry the real Task', () => {
  it('opens the detail with the Task name and the hover card with its stage path', async () => {
    const view = await realView();
    view.render();
    const row = buttonWith(view.tree, 'Independent work e32-work');
    expect(row).toBeDefined();
    const click = eventOf(row!, 'onClick');
    expect(click).toBeDefined();
    click!.handler({ preventDefault() {}, stopPropagation() {} });
    const title = withClass(view.tree, 'd-title');
    expect(title).toBeDefined();
    expect(textOf(title!)).toBe('Independent work e32-work');

    const hover = eventOf(buttonWith(view.tree, 'Independent work e32-work')!, 'onMouseEnter');
    expect(hover).toBeDefined();
    hover!.handler({});
    const card = withClass(view.tree, 'hcard');
    expect(card).toBeDefined();
    expect(textOf(card!)).toContain('Independent work e32-work');
    expect(textOf(card!)).toContain('E32 阶段');
  });
});

describe('E32-3 an empty world shows the empty state', () => {
  it('returns null and shows no sample facts', async () => {
    const empty = await openS6ARequestWorld({ backend: 'memory', defaultGoals: false });
    try {
      const client = createHostClient(empty.token, new URL(empty.base).origin);
      expect((await readTaskMap(client, null)).data).toBeNull();
      const board = loadBoard('TaskMap', WORKING_BOARDS);
      const view = new BoardView(board, { ...board.defaults, readState: { status: 'empty' } });
      const html = serializeTree(view.render());
      expect(html).toContain('这个项目还没有目标');
      expect(html).not.toContain('状态机可靠性改造');
      expect(html).not.toContain('状态机规格对齐');
      expect(html).not.toContain('Independent work e32-work');
    } finally {
      await empty.close();
    }
  }, 30_000);
});

describe('R1 a nonexistent goal is a read error with retry', () => {
  it('R1 shows the missing-goal page text without the raw route or code', async () => {
    const opened = await openS6ARequestWorld({ backend: 'memory' });
    try {
      const client = createHostClient(opened.token, new URL(opened.base).origin);
      const error = await readTaskMap(client, 'no-such-goal').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('goals/read');
      expect((error as Error).message).toContain('not_found');
      expect((error as Error).message).not.toContain('undefined');

      let page: BootedPage | undefined;
      try {
        page = await bootPage({
          name: 'TaskMap', search: '?goal=no-such-goal', token: opened.token,
          request: async (url, init, realFetch) => realFetch(new URL(url, opened.base).href, init),
        });
        const text = page.root.textContent;
        expect(text).toContain('找不到这个目标。');
        expect(text).toContain('重试');
        expect(text).not.toContain('not_found');
        expect(text).not.toContain('goals/read');
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('运行中');
      } finally {
        await page?.restore();
      }
    } finally {
      await opened.close();
    }
  }, 30_000);
});

describe('R2 a goal without an adopted Plan is an empty outline, not an error', () => {
  it('R2 shows the goal name and display word with the no-plan text and no retry', async () => {
    const opened = await openS6ARequestWorld({ backend: 'memory' });
    try {
      const client = createHostClient(opened.token, new URL(opened.base).origin);
      const { data } = await readTaskMap(client, S6A_GOAL_1.goalId);
      expect(data?.planMissing).toBe(true);
      expect(data?.goal.name).toBe('S6A goal one');
      expect(data?.goal.word).toBe('规划中');

      let page: BootedPage | undefined;
      try {
        page = await bootPage({
          name: 'TaskMap', search: `?goal=${S6A_GOAL_1.goalId}`, token: opened.token,
          request: async (url, init, realFetch) => realFetch(new URL(url, opened.base).href, init),
        });
        const text = page.root.textContent;
        expect(text).toContain('S6A goal one');
        expect(text).toContain('规划中');
        expect(text).toContain('这个目标还没有采用的计划。');
        expect(text).not.toContain('运行中');
        expect(text).not.toContain('读取失败');
        expect(text).not.toContain('重试');
      } finally {
        await page?.restore();
      }
    } finally {
      await opened.close();
    }
  }, 30_000);
});

describe('R2 the first unfinished goal follows the display state', () => {
  it.each([
    ['COMPLETED', true],
    ['CANCELLED', true],
    ['RUNNING', false],
    ['PLANNING', false],
    ['PAUSED', false],
    ['NEEDS_DECISION', false],
  ] as const)('R2 %s is finished: %s', (phase, finished) => {
    expect(isFinishedGoalDisplayPhase(phase)).toBe(finished);
  });
});

/* R3 and R4 share the second Goal's plan: one Task id is the Stage's id, one is
   `G1`, two Stages carry no Tasks, and `G1` depends on the colliding Task. */
describe('R3 kind-scoped identities keep collisions apart', () => {
  beforeAll(async () => {
    const draft = ag2bPlanDraft(['dup', 'G1']);
    draft.planId = 'e32-id-plan';
    draft.goalId = S6A_GOAL_2.goalId;
    draft.stages = [
      { stageId: 'dup', title: 'E32 撞名阶段' },
      { stageId: 'e32-empty', title: 'E32 空阶段' },
      { stageId: 'e32-empty-2', title: 'E32 空阶段二' },
    ];
    draft.tasks = draft.tasks.map((task) => ({
      ...task,
      stageId: 'dup',
      scope: task.taskKind === 'work' ? { kind: 'stage' as const, stageId: 'dup' } : task.scope,
    }));
    draft.executionDag = { dependsOn: [
      { taskId: 'G1', dependsOnId: 'dup', requires: { kind: 'output-contract', label: 'E32 dependency' } },
    ] };
    await adoptE32Plan(S6A_GOAL_2, draft, 'e32-ids');
  }, 30_000);

  it('R3 shows every row and both selection and hover terminate', async () => {
    const view = await realView(S6A_GOAL_2.goalId);
    view.render();
    /* Empty Stage rows are outline rows: switch explicitly first. */
    eventOf(buttonWith(view.tree, '大纲')!, 'onClick')!.handler({});
    eventOf(buttonWith(view.tree, 'E32 撞名阶段')!, 'onClick')!.handler({});
    const html = serializeTree(view.tree);
    for (const text of ['E32 撞名阶段', 'E32 空阶段', 'Independent work dup', 'Independent work G1', 'Goal gate']) {
      expect(html).toContain(text);
    }

    const row = buttonWith(view.tree, 'Independent work G1');
    expect(row).toBeDefined();
    eventOf(row!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const detail = withClass(view.tree, 'detail');
    expect(detail).toBeDefined();
    expect(textOf(withClass(view.tree, 'd-title')!)).toBe('Independent work G1');
    expect(textOf(detail!)).toContain('E32 撞名阶段');
    expect(textOf(detail!)).toContain('S6A goal two');
    expect(textOf(detail!)).toContain('Independent work dup');

    const target = buttonWith(view.tree, 'Independent work dup');
    expect(target).toBeDefined();
    eventOf(target!, 'onMouseEnter')!.handler({});
    const card = withClass(view.tree, 'hcard');
    expect(card).toBeDefined();
    expect(textOf(card!)).toContain('Independent work dup');
    expect(textOf(card!)).not.toContain('undefined');
  }, 15_000);

  it('R4 keeps both empty Stage rows and does not count them', async () => {
    const view = await realView(S6A_GOAL_2.goalId);
    view.render();
    eventOf(buttonWith(view.tree, '大纲')!, 'onClick')!.handler({});
    const html = serializeTree(view.tree);
    expect(html).not.toContain('未改动');
    expect(html).not.toContain('全部已满足');
    const goalRow = withClass(view.tree, 'root');
    expect(goalRow).toBeDefined();
    expect(textOf(goalRow!)).toContain('S6A goal two');
    expect(textOf(goalRow!)).toContain('0/3 已满足');

    for (const name of ['E32 空阶段', 'E32 空阶段二']) {
      const row = withClassAll(view.tree, 'tr').find((candidate) => textOf(candidate).includes(name));
      expect(row).toBeDefined();
      expect(textOf(row!)).toContain(name);
      /* An empty Stage counts nothing; its open row carries no satisfied count. */
      expect(textOf(row!)).not.toContain('全部已满足');

      const empty = buttonWith(view.tree, name);
      expect(empty).toBeDefined();
      eventOf(empty!, 'onMouseEnter')!.handler({});
      const card = withClass(view.tree, 'hcard');
      expect(card).toBeDefined();
      expect(textOf(card!)).toContain(name);
      expect(textOf(card!)).toContain('还没有任务');
      expect(textOf(card!)).not.toContain('undefined');

      eventOf(empty!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
      const detail = withClass(view.tree, 'detail');
      expect(detail).toBeDefined();
      expect(textOf(detail!)).toContain(name);
      expect(textOf(detail!)).toContain('还没有任务');
      expect(textOf(detail!)).toContain('没有进行中或需要处理的任务');
      expect(textOf(detail!)).not.toContain('全部已满足');
    }
  });

  it('R4 a Goal whose Stages are all empty reads 还没有任务, not 全部已满足', () => {
    const board = loadBoard('TaskMap', WORKING_BOARDS);
    const data = { goal: { id: 'skeleton', name: 'Only a skeleton', st: 'running', word: '运行中' },
      stages: [{ id: 'later', name: 'Later' }], tasks: [] };
    const view = new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
    view.render();
    eventOf(buttonWith(view.tree, '大纲')!, 'onClick')!.handler({});
    const goal = buttonWith(view.tree, 'Only a skeleton');
    expect(goal).toBeDefined();
    eventOf(goal!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const detail = withClass(view.tree, 'detail');
    expect(detail).toBeDefined();
    expect(textOf(detail!)).toContain('还没有任务');
    expect(textOf(detail!)).not.toContain('全部已满足');
  });
});

describe('R5 one view state', () => {
  it('R5 starts real and loading views on the DAG and switches to the outline on the tab', async () => {
    const view = await realView();
    view.render();
    expect(view.instance.state.view).toBe('dag');
    expect(withClass([buttonWith(view.tree, 'DAG')!], 'is-on')).toBe(buttonWith(view.tree, 'DAG'));
    expect(withClass([buttonWith(view.tree, '大纲')!], 'is-on')).toBeUndefined();

    eventOf(buttonWith(view.tree, '大纲')!, 'onClick')!.handler({});
    expect(view.instance.state.view).toBe('outline');
    expect(withClass([buttonWith(view.tree, '大纲')!], 'is-on')).toBe(buttonWith(view.tree, '大纲'));
    expect(withClass([buttonWith(view.tree, 'DAG')!], 'is-on')).toBeUndefined();

    eventOf(buttonWith(view.tree, 'DAG')!, 'onClick')!.handler({});
    expect(view.instance.state.view).toBe('dag');
    expect(withClass([buttonWith(view.tree, 'DAG')!], 'is-on')).toBe(buttonWith(view.tree, 'DAG'));
  }, 15_000);

  it('R5b keeps the DAG view on the loading first render; the shell draws no tab pressed', () => {
    const board = loadBoard('TaskMap', WORKING_BOARDS);
    const view = new BoardView(board, { ...board.defaults, readState: { status: 'loading' } });
    view.render();
    expect(view.instance.state.view).toBe('dag');
    const dag = buttonWith(view.tree, 'DAG');
    expect(dag).toBeDefined();
    expect(withClass([dag!], 'is-on')).toBeUndefined();
    const outline = buttonWith(view.tree, '大纲');
    expect(outline).toBeDefined();
    expect(withClass([outline!], 'is-on')).toBeUndefined();
    expect(serializeTree(view.tree)).not.toContain('状态机可靠性改造');
  });
});

describe('R6 the gate Task carries the acceptance mark', () => {
  it('R6 shows （验收） in the gate Task card and detail', async () => {
    const view = await realView();
    view.render();
    const hover = eventOf(buttonWith(view.tree, 'Goal gate')!, 'onMouseEnter');
    expect(hover).toBeDefined();
    hover!.handler({});
    const card = withClass(view.tree, 'hcard');
    expect(card).toBeDefined();
    expect(textOf(card!)).toContain('（验收）');

    eventOf(buttonWith(view.tree, 'Goal gate')!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const detail = withClass(view.tree, 'detail');
    expect(detail).toBeDefined();
    expect(textOf(detail!)).toContain('（验收）');
  }, 15_000);
});

describe('R9 real fields show or hide their row', () => {
  it('R9 shows the real owner and stage meaning, and hides rows with no real value', async () => {
    const view = await realView();
    view.render();
    /* Present: the Task has a real responsible line from graph/hover. */
    eventOf(buttonWith(view.tree, 'Independent work e32-work')!, 'onMouseEnter')!.handler({});
    const card = withClass(view.tree, 'hcard');
    expect(card).toBeDefined();
    expect(textOf(card!)).toContain('负责');
    expect(textOf(card!)).toContain('Independent work e32-work');
    /* The exact owner value, not merely the 负责 label and the task title. */
    expect(textOf(card!)).toContain('Independent work e32-work · 待命');
    expect(textOf(card!)).not.toContain('undefined');

    /* Present: the adopted assignment's instruction is the detail's 语义 row. */
    eventOf(buttonWith(view.tree, 'Independent work e32-work')!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const taskDetail = withClass(view.tree, 'detail');
    expect(taskDetail).toBeDefined();
    expect(textOf(taskDetail!)).toContain('语义');
    expect(textOf(taskDetail!)).toContain('Perform independent work e32-work');

    /* The gate Task is 待执行 and nobody is responsible: 负责 says 未分配 (decision 49·01, prototype:2272); it has no semantic body, so 语义 vanishes. */
    eventOf(buttonWith(view.tree, 'DAG')!, 'onClick')!.handler({});
    eventOf(buttonWith(view.tree, 'Goal gate')!, 'onMouseEnter')!.handler({});
    const gateCard = withClass(view.tree, 'hcard');
    expect(gateCard).toBeDefined();
    expect(textOf(gateCard!)).toContain('负责未分配；开工时开一条工作线');
    expect(textOf(gateCard!)).not.toContain('语义');

    eventOf(buttonWith(view.tree, 'Goal gate')!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const detail = withClass(view.tree, 'detail');
    expect(detail).toBeDefined();
    expect(textOf(detail!)).toMatch(/负责的 Agent\s*未分配；开工时开一条工作线/);
    expect(textOf(detail!)).not.toContain('语义');
    expect(textOf(detail!)).toContain('（验收）');
  }, 15_000);
});
