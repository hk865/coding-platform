import { afterEach, describe, expect, it } from 'vitest';
import { bootPage, findAllClass, findClass, findElement } from './helpers/boot-page.js';
import {
  bootE3N, callsTo, countRoute, descendants, forwardPage, lineHeadTitle, newPageLog, quietPage, routeOf,
  sentWrite, settingsRouteOf, textOf, thread, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { inboxRow } from './helpers/E3D-page.js';
import { openWA, answerRequest } from './helpers/E3N-world.js';
import { openS6ANoticesWorld } from '../helpers/S6A-cards-fixture.js';
import { seePlanAdoptions } from './helpers/E3D-world.js';
import { g8Check } from '../helpers/G8-world.js';
import { secretaryChange } from '../helpers/G8B-world.js';
import { openOldAnswerWorld } from './helpers/E3D-world.js';
import { openE3GW1 } from './helpers/E3G-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { mainRequestFeedbackOf } from '../../src/ui/adapters/main.js';
import type { BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

function planLines(root: FakeElement): FakeElement[] {
  return descendants(root).filter((element) => {
    const cls = (element.getAttribute('class') ?? '').split(/\s+/);
    return cls.includes('plan-line');
  });
}

function planLine(root: FakeElement, text: string): FakeElement | undefined {
  return planLines(root).find((row) => textOf(row).includes(text));
}

function userRowWith(root: FakeElement, text: string): FakeElement | undefined {
  const holder = thread(root);
  if (holder === undefined) return undefined;
  return findAllClass(holder, 'msg-user').find((row) => textOf(findClass(row, 'bubble')).includes(text));
}


/** The page's fact rows, each dd paired with the dt just before it. */
function factRows(root: FakeElement): Array<{ k: string; v: string }> {
  const out: Array<{ k: string; v: string }> = [];
  for (const list of descendants(root).filter((element) => {
    const cls = (element.getAttribute('class') ?? '').split(/\s+/);
    return cls.includes('dc-facts');
  })) {
    for (const child of descendants(list)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'dt') out.push({ k: textOf(child), v: '' });
      else if (tag === 'dd' && out.length > 0) out[out.length - 1]!.v = textOf(child);
    }
  }
  return out;
}

function openCard(page: BootedPage): void {
  const decide = findAllClass(findClass(page.root, 'goalbar') ?? page.root, 'gb-decide')[0];
  click(decide ?? inboxRow(page.root, '需要你决定')!);
}


/** Main on the real Host with named routes answered by the row's own value (the
 * page still reads everything else). */
async function bootMainWith(world: { base: string; token: string }, search: string,
  overrides: Record<string, (input?: Record<string, unknown>) => unknown>): Promise<{ page: ReturnType<typeof bootPage> extends Promise<infer P> ? P : never;
    log: ReturnType<typeof newPageLog>; hits: Record<string, number> }> {
  const log = newPageLog();
  const hits: Record<string, number> = {};
  const forward = forwardPage(world, log, 'controlled');
  const page = await bootPage({
    name: 'Main', token: () => world.token, search,
    request: async (url, init, realFetch) => {
      const route = routeOf(url);
      const settings = settingsRouteOf(url);
      const hit = overrides[route] ?? overrides[settings];
      if (hit !== undefined) {
        const key = settings !== '' ? settings : route;
        hits[key] = (hits[key] ?? 0) + 1;
        const request = init && typeof init.body === 'string' ? JSON.parse(init.body) as { request?: { input?: Record<string, unknown> } } : null;
        return new Response(JSON.stringify({ status: 'ready', value: hit(request?.request?.input) }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return forward(url, init, realFetch);
    },
  });
  return { page, log, hits };
}

describe('CU4A Main body', () => {
  it('M1 the request’s first user row carries 交给 秘书 1 and opens that line', async () => {
    const opened = await openWA();
    closers.push(() => opened.world.close());
    const asked = await answerRequest(opened, { commandId: 'cu4a-m1', text: '请秘书看一下状态', answer: '好的' });
    const { page, log } = await bootE3N(opened.world, 'Main', { mode: 'controlled',
      search: '?goal=' + opened.world.goals.first.goalId });
    try {
      await quietPage(log);
      const row = userRowWith(page.root, '请秘书看一下状态');
      void asked;
      expect(row).toBeDefined();
      const label = descendants(row!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '交给 秘书 1');
      expect(label).toBeDefined();
      click(label!);
      await waitFor(() => countRoute(log, 'lines/read') === 1);
      expect((callsTo(log, 'lines/read')[0]!.input as { key?: unknown }).key).toEqual(opened.secretary.ref);
      await waitFor(() => lineHeadTitle(page.root) === '秘书 1');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('M1 an archived owner says 原来的秘书已归档，等平台另派', async () => {
    const opened = await openWA();
    closers.push(() => opened.world.close());
    await answerRequest(opened, { commandId: 'cu4a-m1-arch', text: '先排着', answer: '好' });
    await opened.world.archive(opened.secretary);
    const { page, log } = await bootE3N(opened.world, 'Main', { mode: 'controlled',
      search: '?goal=' + opened.world.goals.first.goalId });
    try {
      await quietPage(log);
      const row = userRowWith(page.root, '先排着');
      expect(row).toBeDefined();
      expect(textOf(row)).toContain('原来的秘书已归档，等平台另派');
      expect(descendants(row!).some((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element).startsWith('交给 '))).toBe(false);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('M2 an unanswered card under its request opens the centre card', async () => {
    const opened = await openOldAnswerWorld();
    closers.push(() => opened.world.close());
    const { page, log } = await bootE3N(opened.world, 'Main', { mode: 'controlled',
      search: '?goal=' + opened.world.goals.first.goalId });
    try {
      await quietPage(log);
      const queued = countRoute(log, 'decisions/queue');
      const line = planLine(page.root, '等你决定：S6A goal one · 计划候选');
      expect(line).toBeDefined();
      const toggle = descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '打开');
      expect(toggle).toBeDefined();
      click(toggle!);
      await waitFor(() => textOf(findClass(page.root, 'dc-title')) === 'S6A goal one · 计划候选');
      expect(countRoute(log, 'decisions/queue')).toBe(queued);
    } finally {
      await page.restore();
    }
  }, 180_000);
  it('M9 a conflict card takes its words and no annotation fields', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const { page, log } = await bootE3N(opened.world, 'Main', { mode: 'controlled',
      search: '?goal=' + opened.world.goals.first.goalId });
    try {
      await quietPage(log);
      openCard(page);
      await waitFor(() => findClass(page.root, 'dc-title') !== undefined);
      for (let index = 0; index < 12; index += 1) {
        const open = findClass(page.root, 'decision');
        const options = open === undefined ? [] : descendants(open).filter((element) =>
          element.tagName.toLowerCase() === 'button' && element.getAttribute('class')?.includes('opt-top'));
        if (options.length > 0) break;
        const next = open === undefined ? undefined : descendants(open).find((element) =>
          element.tagName.toLowerCase() === 'button' && element.getAttribute('aria-label') === '下一条');
        if (next === undefined) break;
        const title = textOf(findClass(open!, 'dc-title'));
        click(next);
        await waitFor(() => textOf(findClass(page.root, 'dc-title')) !== title);
      }
      const open = findClass(page.root, 'decision');
      const option = descendants(open!).find((element) =>
        element.tagName.toLowerCase() === 'button' && element.getAttribute('class')?.includes('opt-top')
        && textOf(element) === '调整顺序');
      expect(option).toBeDefined();
      click(option!);
      const answerField = findElement(page.root, (element) => element.getAttribute('id') === 'dc-answer');
      expect(answerField).toBeDefined();
      const annotationFields = descendants(findClass(page.root, 'decision')!).filter((element) =>
        element.tagName.toLowerCase() === 'textarea' && element.getAttribute('id') !== 'dc-answer');
      expect(annotationFields).toHaveLength(0);
      answerField!.value = '先等目标 2';
      answerField!.dispatch('input', { target: answerField, currentTarget: answerField });
      const confirm = descendants(findClass(page.root, 'decision')!).filter((element) =>
        element.tagName.toLowerCase() === 'button' && textOf(element) === '确定').at(-1)!;
      click(confirm);
      await waitFor(() => countRoute(log, 'decisions/answer') === 1);
      const sent = sentWrite(callsTo(log, 'decisions/answer')[0]);
      expect(sent.input['text']).toBe('先等目标 2');
      const annotations = sent.input['annotations'] as unknown[];
      expect(annotations).toEqual([]);
      await waitFor(() => findClass(page.root, 'dc-title') === undefined);
      expect(page.root.textContent).not.toContain('user_decision_response');
    } finally {
      await page.restore();
    }
  }, 180_000);


  it('M4 an automatic-rework fold opens one reason row per member', async () => {
    const opened = await openS6ANoticesWorld({ backend: 'memory' });
    closers.push(() => opened.close());
    await opened.seedReworkNotices();
    await seePlanAdoptions(opened.main, 'cu4a-notices');
    const { page, log } = await bootE3N(opened.world, 'Main', { mode: 'controlled',
      search: '?goal=' + opened.world.goals.first.goalId });
    try {
      await quietPage(log);
      const line = planLine(page.root, '请知悉：2 条自动返工');
      expect(line).toBeDefined();
      const toggle = descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '展开');
      expect(toggle).toBeDefined();
      click(toggle!);
      const reads = countRoute(log, 'materials/open') + countRoute(log, 'settings/snapshot');
      const values = descendants(page.root).filter((element) => element.tagName.toLowerCase() === 'dd')
        .map((element) => textOf(element));
      expect(values.filter((value) => /^自动返工 · .+：执行失败$/.test(value))).toHaveLength(2);
      expect(countRoute(log, 'materials/open') + countRoute(log, 'settings/snapshot')).toBe(reads);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('M4/M8 a check notice opens its snapshot and withdraws once', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const proposalId = 'cu4a-check-proposal';
    const snapshot = {
      workspaces: [{
        scope: S6A_SCOPE, name: 'cu4a', root: '/tmp/cu4a', modelId: null,
        writeAllowed: true, commandsAllowed: true, accessFixed: null, knowledgeLocalOnly: false,
        checks: [{ checkId: 'g8b-d1-check', command: 'test -f g8b-d1.txt', taskIds: 'all' }],
        checkApprovals: [{
          checkId: 'g8b-d1-check',
          plan: { proposalRef: { aggregateType: 'PlanProposal', projectId: S6A_SCOPE.projectId,
            workspaceId: S6A_SCOPE.workspaceId, proposalId } },
          approvedBy: { kind: 'agent', duty: 'adviser' },
          author: { duty: 'secretary' },
          baseline: { checkId: 'g8b-d1-check', outcome: 'failed', exitCode: 1 },
          approvedAt: '2026-11-25T09:30:00+08:00',
        }],
        withdrawnChecks: [],
      }],
      structuralApproval: { saved: {}, defaults: { proposals: 'auto', repairs: 'auto' } },
      commandReviewLine: { saved: null, effective: 60, default: 60 },
    } as unknown as {
      workspaces: Array<Record<string, unknown> & { scope: { projectId: string; workspaceId: string } }>;
    };
    const workspace = snapshot.workspaces.find((row) => row.scope.projectId === S6A_SCOPE.projectId
      && row.scope.workspaceId === S6A_SCOPE.workspaceId)!;
    workspace.checks = [{ checkId: 'g8b-d1-check', command: 'test -f g8b-d1.txt', taskIds: 'all' }];
    workspace.checkApprovals = [{
      checkId: 'g8b-d1-check',
      plan: { proposalRef: { aggregateType: 'PlanProposal', projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId, proposalId } },
      approvedBy: { kind: 'agent', duty: 'adviser' },
      author: { duty: 'secretary' },
      baseline: { checkId: 'g8b-d1-check', outcome: 'failed', exitCode: 1 },
      approvedAt: '2026-11-25T09:30:00+08:00',
    }];
    workspace.withdrawnChecks = [];
    const notice = {
      itemKey: 'project_notice:cu4a-check', category: 'project_notice',
      subject: { kind: 'goal', goalRef: goal }, position: { kind: 'commit', cursor: 'c1', itemKey: 'project_notice:cu4a-check' },
      summary: '来自 秘书 · 目标 S6A goal one：加了检查「g8b-d1-check」，改动前跑会失败（已核实），参谋已批，已生效',
      objects: [{ kind: 'aggregate', pin: { ref: { aggregateType: 'PlanProposal', projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId, proposalId }, revision: 1 }, label: 'candidate' }],
      rework: null, noticeKind: 'check_approved',
    };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [], notices: [notice],
      seenThrough: {}, displayToken: null, next: null };
    const { page, log, hits } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
      'settings/snapshot': () => snapshot,
      'settings/checks/withdraw': () => {
        const workspace = snapshot.workspaces.find((row) => row.scope.projectId === S6A_SCOPE.projectId
          && row.scope.workspaceId === S6A_SCOPE.workspaceId)!;
        workspace.checks = [];
        workspace.checkApprovals = [];
        workspace.withdrawnChecks = [{ checkId: 'g8b-d1-check', withdrawnAt: '2026-11-25T10:00:00+08:00',
          plan: { proposalRef: { aggregateType: 'PlanProposal', projectId: S6A_SCOPE.projectId,
            workspaceId: S6A_SCOPE.workspaceId, proposalId } } }];
        return snapshot;
      },
    });
    try {
      await quietPage(log);
      const line = planLine(page.root, '请知悉：来自 秘书 · 目标 S6A goal one');
      expect(line).toBeDefined();
      const toggle = descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '展开');
      expect(toggle).toBeDefined();
      click(toggle!);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await waitFor(() => hits['settings/snapshot'] === 1);
      const facts = factRows(page.root);
      expect(facts.find((fact) => fact.k === '检查')?.v).toBe('g8b-d1-check');
      expect(facts.find((fact) => fact.k === '命令')?.v).toBe('test -f g8b-d1.txt');
      expect(facts.find((fact) => fact.k === '查哪些任务')?.v).toBe('全部任务');
      expect(facts.find((fact) => fact.k === '谁写的')?.v).toBe('秘书');
      expect(facts.find((fact) => fact.k === '谁批的')?.v).toBe('参谋');
      expect(facts.find((fact) => fact.k === '改动前跑')?.v).toBe('会失败（退出码 1）');
      const withdraw = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '撤回');
      expect(withdraw).toBeDefined();
      click(withdraw!);
      click(withdraw!);
      await waitFor(() => hits['settings/checks/withdraw'] === 1);
      expect(hits['settings/checks/withdraw']).toBe(1);
      await waitFor(() => page.root.textContent.includes('已撤回'));
      const after = descendants(page.root).filter((element) => element.tagName.toLowerCase() === 'dt')
        .map((term) => textOf(term));
      expect(after).toContain('检查');
      expect(after).toContain('已撤回');
      expect(after).not.toContain('命令');
      expect(findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '撤回')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('M5 the request block says what entered the plan', () => {
    const read = { feedback: { affectedTasks: [{ taskId: 't1' }], actions: [], planRevision: { planId: 'plan-2' } } };
    const nav = { goals: [{ goalId: 'g', ordinal: 1, objective: '目标' }],
      tasks: { plan: { planId: 'plan-2', planRevision: 2 },
        tasks: [{ ref: { taskId: 't1' }, definition: { title: '补 README' } }] } };
    const feedback = mainRequestFeedbackOf(read, nav as never, 'root');
    expect(feedback?.arranged).toBe('已安排：补 README，进了计划第 2 版');
  });

  it('M6/M7 the unreadable source line and the rail click go to Decide', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const queue = {
      waitingAnswer: [], answeredPendingApplication: [], history: [], notices: [],
      counts: { waitingAnswer: 0, answeredPendingApplication: 0, notices: {} }, countsComplete: false,
      nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null,
      capabilities: [{ source: 'candidate', availability: 'read_failed', reason: 'injected source failure' }],
    };
    const { page, log } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'decisions/queue': () => queue,
    });
    try {
      await quietPage(log);
      expect(page.root.textContent).toContain('暂时读不到：计划候选。其余照常显示。');
      const row = inboxRow(page.root, '需要你决定');
      expect(row).toBeDefined();
      click(row!);
      expect(page.assigned()).toContain('Decide.dc.html?goal=' + goal.goalId);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('M4 a handoff notice prints one fixed sentence and no Session id', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const notice = {
      itemKey: 'project_notice:cu4a-handoff', category: 'handoff', subject: { kind: 'goal', goalRef: goal },
      position: { kind: 'commit', cursor: 'c1', itemKey: 'project_notice:cu4a-handoff' },
      summary: '继任 session-aaa · 旧线 session-bbb', objects: [], rework: null,
    };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [], notices: [notice],
      seenThrough: {}, displayToken: null, next: null };
    const { page, log, hits } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
    });
    try {
      await quietPage(log);
      const line = planLine(page.root, '请知悉：秘书换了一次手');
      expect(line).toBeDefined();
      expect(textOf(line!)).toBe('请知悉：秘书换了一次手');
      expect(line!.textContent).not.toContain('session-aaa');
      expect(line!.textContent).not.toContain('session-bbb');
      expect(line!.textContent).not.toContain('继任');
      expect(line!.textContent).not.toContain('旧线');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('M4 an automatic-rework member’s raise_cap opens Settings on 运行上限', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const member = {
      itemKey: 'project_notice:cu4a-cap-1', category: 'automatic_rework', subject: { kind: 'goal', goalRef: goal },
      position: { kind: 'commit', cursor: 'c1', itemKey: 'project_notice:cu4a-cap-1' },
      summary: '自动返工 · t1 · 第 1 次（2/3）',
      objects: [{ kind: 'aggregate', pin: { ref: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId,
        goalId: goal.goalId }, revision: 0 }, label: 'goal' }],
      rework: { operation: 'requeue', reason: 'auto-rework:cap_hit#1', requestedAt: '2026-11-25T09:00:00+08:00',
        sourceRef: { aggregateType: 'TaskRequeue', projectId: S6A_SCOPE.projectId, goalId: goal.goalId,
          taskId: 't1', afterRunId: 'run-1' } },
      actions: [{ kind: 'raise_memory_cap' }],
    };
    const notice = {
      itemKey: 'project_notice:cu4a-cap', category: 'automatic_rework', subject: { kind: 'goal', goalRef: goal },
      position: { kind: 'commit', cursor: 'c2', itemKey: 'project_notice:cu4a-cap' },
      summary: '1 条自动返工', objects: [], rework: null, memberViews: [member],
    };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [], notices: [notice],
      seenThrough: {}, displayToken: null, next: null };
    const { page, log } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
    });
    try {
      await quietPage(log);
      const line = planLine(page.root, '请知悉：1 条自动返工');
      expect(line).toBeDefined();
      click(descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '展开')!);
      const cap = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '调高上限');
      expect(cap).toBeDefined();
      click(cap!);
      expect(page.assigned()).toContain('Settings.dc.html?goal=' + goal.goalId + '&from=Main#g-lim');
    } finally {
      await page.restore();
    }
  }, 120_000);


  /* 4a rework (shots s4 A1–A3/A5/A7): a card the page's first read does not
     carry still answers from its queue row, with the decide.ts object words. */
  it('A1/A2/A3 a queue-only card answers “重新提” with the box above it', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const card = {
      cardKey: 'cu4a-queue-card', state: 'waiting_answer', requestRef: null, readOnly: false, actions: ['answer'],
      source: { kind: 'planning_question', key: 'cu4a-queue-card', subject: { kind: 'goal', goalRef: goal }, pins: [] },
      subject: { kind: 'goal', goalRef: goal }, senderSessionRef: null,
      objects: [{ kind: 'aggregate', label: '{"digest":"scene-batch-digest","ops":[],"responsibilityMoves":[]}',
        pin: { ref: { aggregateType: 'Unknown', projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId }, revision: 1 } }],
      options: [{ id: 'accept', label: '照建议' }, { id: 'repropose', label: '不对，重新提' }],
      answer: null, application: null, openedAt: '2026-11-25T09:00:00+08:00', taskRef: null, runRef: null,
    };
    const queue = { waitingAnswer: [card], answeredPendingApplication: [], history: [], notices: [],
      counts: { waitingAnswer: 1, answeredPendingApplication: 0, notices: {} }, countsComplete: true,
      nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null, capabilities: [] };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [], notices: [],
      seenThrough: {}, displayToken: null, next: null };
    let sent: Record<string, unknown> | null = null;
    const { page, log, hits } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
      'decisions/queue': () => queue,
      'decisions/answer': (input) => { sent = input ?? null; return { answer: { status: 'committed' } }; },
    });
    try {
      await quietPage(log);
      openCard(page);
      await waitFor(() => findClass(page.root, 'dc-title') !== undefined);
      const decision = findClass(page.root, 'decision')!;
      const option = descendants(decision).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '不对，重新提');
      expect(option).toBeDefined();
      click(option!);
      const answerField = findElement(page.root, (element) => element.getAttribute('id') === 'dc-answer');
      expect(answerField).toBeDefined();
      expect(descendants(decision).find((element) => element.tagName.toLowerCase() === 'label'
        && element.getAttribute('for') === 'dc-answer')!.textContent).toBe('你的话（写一句才能确定）');
      expect(textOf(decision)).toContain('一个对象');
      expect(textOf(decision)).not.toContain('scene-batch-digest');
      const guide = '要写一句哪里不对：在上面的框里写原因，写完再点确定。';
      expect(descendants(decision).filter((element) => element.tagName.toLowerCase() === 'p'
        && textOf(element) === guide)).toHaveLength(1);
      expect(page.root.textContent).not.toContain('在本卡下面写原因');
      answerField!.value = '把 digest 换成一句说明';
      answerField!.dispatch('input', { target: answerField, currentTarget: answerField });
      click(descendants(findClass(page.root, 'decision')!).filter((element) =>
        element.tagName.toLowerCase() === 'button' && textOf(element) === '确定').at(-1)!);
      await waitFor(() => hits['decisions/answer'] === 1);
      expect(sent!['selection']).toEqual({ kind: 'option', optionId: 'repropose' });
      expect(sent!['text']).toBe('把 digest 换成一句说明');
      expect(sent!['annotations']).toEqual([]);
    } finally {
      await page.restore();
    }
  });

  /* 3a item 7, the main-card half: a planning question that carries options
     is outside needsOption, so words alone answer it as 其他, once. */
  it('Y7 a planning question with options answers with words alone as 其他', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const card = {
      cardKey: 'cu4a-words-card', state: 'waiting_answer', requestRef: null, readOnly: false, actions: ['answer'],
      source: { kind: 'planning_question', key: 'cu4a-words-card', subject: { kind: 'goal', goalRef: goal }, pins: [] },
      subject: { kind: 'goal', goalRef: goal }, senderSessionRef: null, objects: [],
      options: [{ id: 'idea-a', label: '先做登录' }, { id: 'idea-b', label: '先做导出' }],
      answer: null, application: null, openedAt: '2026-11-25T09:00:00+08:00', taskRef: null, runRef: null,
    };
    const queue = { waitingAnswer: [card], answeredPendingApplication: [], history: [], notices: [],
      counts: { waitingAnswer: 1, answeredPendingApplication: 0, notices: {} }, countsComplete: true,
      nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null, capabilities: [] };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [], notices: [],
      seenThrough: {}, displayToken: null, next: null };
    let sent: Record<string, unknown> | null = null;
    const { page, log, hits } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
      'decisions/queue': () => queue,
      'decisions/answer': (input) => { sent = input ?? null; return { answer: { status: 'committed' } }; },
    });
    try {
      await quietPage(log);
      openCard(page);
      await waitFor(() => findClass(page.root, 'dc-title') !== undefined);
      const answerField = findElement(page.root, (element) => element.getAttribute('id') === 'dc-answer')!;
      answerField.value = '两个都先放着，等目标 2 定了再说';
      answerField.dispatch('input', { target: answerField, currentTarget: answerField });
      click(descendants(findClass(page.root, 'decision')!).filter((element) =>
        element.tagName.toLowerCase() === 'button' && textOf(element) === '确定').at(-1)!);
      await waitFor(() => hits['decisions/answer'] === 1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(hits['decisions/answer']).toBe(1);
      expect(sent!['selection']).toEqual({ kind: 'other' });
      expect(sent!['text']).toBe('两个都先放着，等目标 2 定了再说');
    } finally {
      await page.restore();
    }
  });

  /* Lead 11-25 (fix 2/3/4, item 7): the slot's pick is kept by cardKey, as
     Decide's. The picked card leaves the queue, the reread puts the next card
     at the same index, and that card has no pick: 确定 is off and sends nothing. */
  it('Z1 a reread that puts another card in the slot does not carry the pick over', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const cardOf = (cardKey: string, labels: [string, string]) => ({
      cardKey, state: 'waiting_answer', requestRef: null, readOnly: false, actions: ['answer'],
      source: { kind: 'planning_question', key: cardKey, subject: { kind: 'goal', goalRef: goal }, pins: [] },
      subject: { kind: 'goal', goalRef: goal }, senderSessionRef: null, objects: [],
      options: [{ id: 'idea-a', label: labels[0] }, { id: 'idea-b', label: labels[1] }],
      answer: null, application: null, openedAt: '2026-11-25T09:00:00+08:00', taskRef: null, runRef: null,
    });
    let waiting = [cardOf('cu4a-slot-1', ['先做登录', '先做导出']), cardOf('cu4a-slot-2', ['先做搜索', '先做设置'])];
    const queue = () => ({ waitingAnswer: waiting, answeredPendingApplication: [], history: [], notices: [],
      counts: { waitingAnswer: waiting.length, answeredPendingApplication: 0, notices: {} }, countsComplete: true,
      nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null, capabilities: [] });
    const pageRead = { goalId: goal.goalId, requests: [], cards: [], notices: [],
      seenThrough: {}, displayToken: null, next: null };
    const { page, log, hits } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
      'decisions/queue': () => queue(),
      'decisions/answer': () => ({ answer: { status: 'committed' } }),
    });
    const option = (label: string) => descendants(findClass(page.root, 'decision')!).find((element) =>
      element.tagName.toLowerCase() === 'button' && element.getAttribute('class')?.includes('opt-top')
      && textOf(element) === label);
    const checked = () => descendants(findClass(page.root, 'decision')!).filter((element) =>
      element.tagName.toLowerCase() === 'button' && element.getAttribute('aria-checked') === 'true');
    const confirm = () => descendants(findClass(page.root, 'decision')!).filter((element) =>
      element.tagName.toLowerCase() === 'button' && textOf(element) === '确定').at(-1)!;
    try {
      await quietPage(log);
      openCard(page);
      await waitFor(() => option('先做登录') !== undefined);
      click(option('先做登录')!);
      await waitFor(() => checked().length === 1);
      expect(confirm().getAttribute('aria-disabled')).toBe('false');

      waiting = [cardOf('cu4a-slot-2', ['先做搜索', '先做设置'])];
      const reads = hits['decisions/queue'] ?? 0;
      await waitFor(() => log.openings.length > 0);
      log.openings.at(-1)!.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      await waitFor(() => (hits['decisions/queue'] ?? 0) > reads && option('先做搜索') !== undefined);
      await quietPage(log);
      /* 具名改坏: 卡位的选中项仍是一个 `s.picked`；“先做搜索”（同一个 id）亮着、确定可点，下面三行红。 */
      expect(checked()).toEqual([]);
      expect(confirm().getAttribute('aria-disabled')).toBe('true');
      click(confirm());
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(hits['decisions/answer'] ?? 0).toBe(0);
    } finally {
      await page.restore();
    }
  });

  it('A4 an automatic-rework fold reads no settings snapshot', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const member = (n: number) => ({ itemKey: 'automatic_rework:cu4a-' + String(n), category: 'automatic_rework',
      subject: { kind: 'goal', goalRef: goal }, summary: '自动返工 · t1 · 第 ' + String(n) + ' 次（1/3）',
      objects: [], rework: { operation: 'reverify', reason: 'auto-rework:check_failed#2', requestedAt: '2026-11-25T09:00:00+08:00' } });
    const notice = { itemKey: 'automatic_rework:cu4a-fold', category: 'automatic_rework',
      subject: { kind: 'goal', goalRef: goal }, summary: '2 条自动返工', objects: [], rework: null,
      memberViews: [member(1), member(2)] };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [], notices: [notice],
      seenThrough: {}, displayToken: null, next: null };
    const { page, log, hits } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
      'settings/snapshot': () => ({ workspaces: [] }),
    });
    try {
      await quietPage(log);
      const line = planLine(page.root, '请知悉：2 条自动返工');
      expect(line).toBeDefined();
      const before = hits['settings/snapshot'] ?? 0;
      const reads = hits['main/read'] ?? 0;
      click(descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '展开')!);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(hits['main/read'] ?? 0).toBe(reads);
      expect(hits['settings/snapshot'] ?? 0).toBe(before);
    } finally {
      await page.restore();
    }
  });

  it('A4 an answered card keeps its words when a check notice opens', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const body = JSON.stringify({ schemaVersion: 1, kind: 'user_decision_response',
      selection: { kind: 'option', optionId: 'idea-a' }, text: '先等目标 2', annotations: [] });
    const bodyRef = { kind: 'artifact', contentType: 'application/vnd.coding-platform.session-message+json',
      digest: 'cu4a-answer-body', sizeBytes: 200, source: { kind: 'workspace', refId: S6A_SCOPE.workspaceId, revision: '1' } };
    const card = { cardKey: 'cu4a-answered-card', state: 'answered_no_application', requestRef: null, readOnly: true,
      actions: [], source: { kind: 'planning_question', key: 'cu4a-answered-card', subject: { kind: 'goal', goalRef: goal }, pins: [] },
      subject: { kind: 'goal', goalRef: goal }, senderSessionRef: null, objects: [],
      options: [{ id: 'idea-a', label: '照建议' }],
      answer: { respondedAt: '2026-11-25T09:10:00+08:00', bodyRef,
        decision: { selection: { kind: 'option', optionId: 'idea-a' } } },
      application: null, openedAt: '2026-11-25T09:00:00+08:00', taskRef: null, runRef: null };
    const notice = { itemKey: 'project_notice:cu4a-check-2', category: 'project_notice',
      subject: { kind: 'goal', goalRef: goal }, summary: '来自 秘书 · 目标 1「S6A goal one」：加了检查',
      objects: [{ kind: 'aggregate', pin: { ref: { aggregateType: 'PlanProposal', projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId, proposalId: 'cu4a-check-2' }, revision: 1 }, label: 'candidate' }],
      rework: null, noticeKind: 'check_approved' };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [card], notices: [notice],
      seenThrough: {}, displayToken: null, next: null };
    const snapshot = { workspaces: [{ scope: S6A_SCOPE, checks: [], checkApprovals: [], withdrawnChecks: [] }] };
    const { page, log } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
      'materials/open': () => ({ body }),
      'settings/snapshot': () => snapshot,
    });
    try {
      await quietPage(log);
      const line = planLine(page.root, '你答了：照建议');
      expect(line).toBeDefined();
      click(descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '展开')!);
      await waitFor(() => page.root.textContent.includes('你的话：先等目标 2'));
      const noticeLine = planLine(page.root, '请知悉：来自 秘书');
      click(descendants(noticeLine!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '展开')!);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(page.root.textContent).toContain('你的话：先等目标 2');
    } finally {
      await page.restore();
    }
  });

  it('A5 a text-only answer names the person’s words', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const card = { cardKey: 'cu4a-other-card', state: 'answered_no_application', requestRef: null, readOnly: true,
      actions: [], source: { kind: 'planning_question', key: 'cu4a-other-card', subject: { kind: 'goal', goalRef: goal }, pins: [] },
      subject: { kind: 'goal', goalRef: goal }, senderSessionRef: null, objects: [], options: [],
      answer: { respondedAt: '2026-11-25T09:20:00+08:00', bodyRef: null, decision: { selection: { kind: 'other' } } },
      application: null, openedAt: '2026-11-25T09:00:00+08:00', taskRef: null, runRef: null };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [card], notices: [],
      seenThrough: {}, displayToken: null, next: null };
    const { page, log } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
    });
    try {
      await quietPage(log);
      expect(planLine(page.root, '你答了：其他（你写的话） · 已答复')).toBeDefined();
    } finally {
      await page.restore();
    }
  });

  it('A7 a waiting card outside the centre keeps a disabled 打开', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const goal = opened.world.goals.first;
    const card = { cardKey: 'cu4a-gone-card', state: 'waiting_answer', requestRef: null, readOnly: false, actions: ['answer'],
      source: { kind: 'goal_cause', key: 'cu4a-gone-card', subject: { kind: 'goal', goalRef: goal }, pins: [] },
      subject: { kind: 'goal', goalRef: goal }, senderSessionRef: null, objects: [], options: [],
      answer: null, application: null, openedAt: '2026-11-25T09:00:00+08:00', taskRef: null, runRef: null };
    const queue = { waitingAnswer: [], answeredPendingApplication: [], history: [], notices: [],
      counts: { waitingAnswer: 0, answeredPendingApplication: 0, notices: {} }, countsComplete: true,
      nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null, capabilities: [] };
    const pageRead = { goalId: goal.goalId, requests: [], cards: [card], notices: [],
      seenThrough: {}, displayToken: null, next: null };
    const { page, log } = await bootMainWith(opened.world, '?goal=' + goal.goalId, {
      'main/read': () => pageRead,
      'decisions/queue': () => queue,
    });
    try {
      await quietPage(log);
      const line = planLine(page.root, '等你决定：');
      expect(line).toBeDefined();
      const toggle = descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '打开');
      expect(toggle).toBeDefined();
      expect(toggle!.getAttribute('class')).toContain('is-off');
      expect(toggle!.getAttribute('aria-disabled')).toBe('true');
      expect(toggle!.getAttribute('title')).toBe('这张卡现在不在卡位里，去“需要你决定”页看');
      click(toggle!);
      expect(findClass(page.root, 'dc-title')).toBeUndefined();
    } finally {
      await page.restore();
    }
  });

});
