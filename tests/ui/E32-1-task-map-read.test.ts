import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EventBinding, VNode } from '../../src/ui/render.js';
import { BoardView } from '../../src/ui/runtime.js';
import { bootBoardPage, readTaskMap } from '../../src/ui/boot.js';
import { isFinishedGoalDisplayPhase } from '../../src/ui/adapters/task-map.js';
import { createHostClient } from '../../src/ui/host-client.js';
import { loadBoard } from './helpers/board-files.js';
import { serializeTree } from './helpers/render.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { FakeElement, installFakeDom, restoreFakeDom } from './helpers/dom.js';

/**
 * E32-1/2/3 (ruling rows E32-1..3, items 6, 7, 8): the real Host routes are read
 * through `readTaskMap`, adapted to the board's data props, and the outline
 * shows the Goal, the Task names and their status words — never a sample fact.
 * A world with no Goal shows the empty state.
 */
const WORKING_BOARDS = fileURLToPath(new URL('../../src/ui/boards/', import.meta.url));
const stageName = 'E32 阶段';

const BOARD_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BOOT_PAGE_URL = 'http://host/workbench/TaskMap.dc.html';

type BootPage = ReturnType<typeof installFakeDom> & {
  title: string;
  readyState: string;
  head: FakeElement;
  addEventListener(): void;
  querySelector(selector: string): FakeElement | null;
};

/** The board page as the Host serves it: the working copy as page text, the token
 * in the meta, a relative route URL forwarded to the real Host origin. */
async function bootHostPage(world: S6ARequestWorld, search: string): Promise<FakeElement> {
  const source = readFileSync(`${BOARD_ROOT}src/ui/boards/TaskMap.dc.html`, 'utf8');
  const dom = installFakeDom();
  const page = dom as unknown as BootPage;
  const root = new FakeElement('x-dc');
  const meta = new FakeElement('meta');
  meta.setAttribute('content', world.token);
  page.title = '任务图';
  page.readyState = 'loading';
  page.head = new FakeElement('head');
  page.addEventListener = () => {};
  page.querySelector = (selector) => {
    if (selector === 'x-dc') return root;
    if (selector === 'meta[name="platform-token"]') return meta;
    return null;
  };
  const createElement = dom.createElement;
  dom.createElement = (tag) => {
    const element = createElement(tag);
    if (tag === 'template') {
      Object.defineProperty(element, 'content', { get: () => createElement('#fragment') });
    }
    return element;
  };

  const savedFetch = globalThis.fetch;
  const savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const origin = new URL(world.base).origin;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === BOOT_PAGE_URL) return { text: async () => source } as unknown as Response;
    if (url.startsWith('/')) return savedFetch(origin + url, init);
    return savedFetch(url, init);
  }) as typeof fetch;
  Object.defineProperty(globalThis, 'location', {
    value: { href: BOOT_PAGE_URL, search }, configurable: true,
  });
  try {
    await bootBoardPage();
  } finally {
    globalThis.fetch = savedFetch;
    if (savedLocation) Object.defineProperty(globalThis, 'location', savedLocation);
    else delete (globalThis as { location?: unknown }).location;
  }
  return root;
}

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
}, 30_000);

afterAll(async () => {
  await world?.close();
  world = undefined;
});

async function realView(goalId: string = S6A_GOAL_1.goalId): Promise<BoardView> {
  const client = createHostClient(world!.token, new URL(world!.base).origin);
  const data = await readTaskMap(client, goalId);
  expect(data).not.toBeNull();
  const board = loadBoard('TaskMap', WORKING_BOARDS);
  return new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
}

describe('E32-1 the real goal and tasks reach the outline', () => {
  it('shows the real Goal, Task and status words and no sample facts', async () => {
    const view = await realView();
    const html = serializeTree(view.render());
    expect(html).toContain('S6A goal one');
    expect(html).toContain('Independent work e32-work');
    expect(html).toContain('待执行');
    expect(html).not.toContain('状态机可靠性改造');
    expect(html).not.toContain('状态机规格对齐');

    /* ruling item 6: the other views show their empty state, not the sample DAG */
    const dag = buttonWith(view.tree, 'DAG');
    expect(dag).toBeDefined();
    eventOf(dag!, 'onClick')!.handler({});
    const dagHtml = serializeTree(view.tree);
    expect(dagHtml).toContain('这个视图还没有接上真实数据');
    expect(dagHtml).toContain('S6A goal one');
    expect(dagHtml).not.toContain('状态机可靠性改造');
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
      expect(await readTaskMap(client, null)).toBeNull();
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

      let root: FakeElement | undefined;
      try {
        root = await bootHostPage(opened, '?goal=no-such-goal');
        const text = root.textContent;
        expect(text).toContain('找不到这个目标。');
        expect(text).toContain('重试');
        expect(text).not.toContain('not_found');
        expect(text).not.toContain('goals/read');
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('运行中');
      } finally {
        restoreFakeDom();
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
      const data = await readTaskMap(client, S6A_GOAL_1.goalId);
      expect(data?.planMissing).toBe(true);
      expect(data?.goal.name).toBe('S6A goal one');
      expect(data?.goal.word).toBe('规划中');

      let root: FakeElement | undefined;
      try {
        root = await bootHostPage(opened, `?goal=${S6A_GOAL_1.goalId}`);
        const text = root.textContent;
        expect(text).toContain('S6A goal one');
        expect(text).toContain('规划中');
        expect(text).toContain('这个目标还没有采用的计划。');
        expect(text).not.toContain('运行中');
        expect(text).not.toContain('读取失败');
        expect(text).not.toContain('重试');
      } finally {
        restoreFakeDom();
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
    const html = serializeTree(view.render());
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
    const html = serializeTree(view.render());
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
      expect(textOf(row!)).toContain('还没有任务');

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
  it('R5 starts real mode in the outline and the sample mode in the DAG', async () => {
    const view = await realView();
    view.render();
    expect(view.instance.state.view).toBe('outline');
    expect(withClass([buttonWith(view.tree, '大纲')!], 'is-on')).toBe(buttonWith(view.tree, '大纲'));

    eventOf(buttonWith(view.tree, 'DAG')!, 'onClick')!.handler({});
    expect(view.instance.state.view).toBe('dag');
    expect(withClass([buttonWith(view.tree, '大纲')!], 'is-on')).toBeUndefined();

    eventOf(buttonWith(view.tree, '大纲')!, 'onClick')!.handler({});
    expect(view.instance.state.view).toBe('outline');
    expect(withClass([buttonWith(view.tree, 'DAG')!], 'is-on')).toBeUndefined();
    expect(withClass([buttonWith(view.tree, '大纲')!], 'is-on')).toBe(buttonWith(view.tree, '大纲'));

    const sample = new BoardView(loadBoard('TaskMap', WORKING_BOARDS));
    sample.render();
    expect(sample.instance.state.view).toBe('dag');
    const dag = buttonWith(sample.tree, 'DAG');
    expect(dag).toBeDefined();
    expect(withClass([dag!], 'is-on')).toBe(dag);
  }, 15_000);

  it('R5b selects the outline tab on the loading first render', () => {
    const board = loadBoard('TaskMap', WORKING_BOARDS);
    const view = new BoardView(board, { ...board.defaults, readState: { status: 'loading' } });
    view.render();
    expect(view.instance.state.view).toBe('outline');
    const outline = buttonWith(view.tree, '大纲');
    expect(outline).toBeDefined();
    expect(withClass([outline!], 'is-on')).toBe(outline);
    const dag = buttonWith(view.tree, 'DAG');
    expect(dag).toBeDefined();
    expect(withClass([dag!], 'is-on')).toBeUndefined();
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

describe('R9 empty fields hide their row in real mode', () => {
  it('R9 hides the empty 负责 and 语义 rows, while the sample rows stay', async () => {
    const view = await realView();
    view.render();
    const hover = eventOf(buttonWith(view.tree, 'Independent work e32-work')!, 'onMouseEnter');
    expect(hover).toBeDefined();
    hover!.handler({});
    const card = withClass(view.tree, 'hcard');
    expect(card).toBeDefined();
    expect(textOf(card!)).not.toContain('负责');

    eventOf(buttonWith(view.tree, 'Independent work e32-work')!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const detail = withClass(view.tree, 'detail');
    expect(detail).toBeDefined();
    expect(textOf(detail!)).not.toContain('负责的 Agent');
    expect(textOf(detail!)).not.toContain('语义');

    const sample = new BoardView(loadBoard('TaskMap', WORKING_BOARDS));
    sample.render();
    eventOf(buttonWith(sample.tree, '大纲')!, 'onClick')!.handler({});
    const sampleHover = eventOf(buttonWith(sample.tree, '规格与验收')!, 'onMouseEnter');
    expect(sampleHover).toBeDefined();
    sampleHover!.handler({});
    expect(textOf(withClass(sample.tree, 'hcard')!)).toContain('负责');

    eventOf(buttonWith(sample.tree, '规格与验收')!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const sampleDetail = withClass(sample.tree, 'detail');
    expect(sampleDetail).toBeDefined();
    expect(textOf(sampleDetail!)).toContain('负责的 Agent');
    expect(textOf(sampleDetail!)).toContain('语义');

    const gateSample = new BoardView(loadBoard('TaskMap', WORKING_BOARDS));
    gateSample.render();
    const gate = buttonWith(gateSample.tree, '目标验收');
    expect(gate).toBeDefined();
    eventOf(gate!, 'onClick')!.handler({ preventDefault() {}, stopPropagation() {} });
    const gateDetail = withClass(gateSample.tree, 'detail');
    expect(gateDetail).toBeDefined();
    expect(textOf(gateDetail!)).toContain('负责的 Agent');
    expect(textOf(gateDetail!)).toContain('审阅者 · 规格');
    expect(textOf(gateDetail!)).toContain('语义');
    expect(textOf(gateDetail!)).toContain('目标 1 的整体验收');
  }, 15_000);
});
