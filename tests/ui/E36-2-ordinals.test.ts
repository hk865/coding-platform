import { describe, expect, it } from 'vitest';
import { adaptTaskMap, adaptTaskMapDetail, type TaskMapGoalRead, type TaskMapSummaryRead } from '../../src/ui/adapters/task-map.js';
import { sceneData, sceneView, value, type Row } from './helpers/e35-scene.js';

/** E36-2: the Goal's number and the attempt ordinal, as the Host gives them (decision 120-13); the page never counts. */
describe('E36-2 ordinals', () => {
  it('E36-2 goals/read’s ordinal names the Goal 目标 n in the top bar and on a Task right under it; a Stage keeps the name', () => {
    /* Named mutation: write the number into data.goal.name (the Stage's 归属 gains it too). */
    const shown = (ordinal: number | null) => {
      const data = adaptTaskMap({ ...value<TaskMapGoalRead>('goals/read'), ordinal }, value('tasks/query'), value('goals/display'), { lines: value('lines/list'), hover: value('graph/hover') });
      const { view, vals } = sceneView([], data);
      vals().dag.nodes.find((n) => n.id === 'task:GATE')!.hover();
      const gate = (vals().dag as unknown as { card: { rows: Row[] } }).card.rows.find((r) => r.k === '归属')?.v;
      view.instance.setState({ view: 'outline', hover: 'stage:S1' });
      return [vals().goalName, gate, (vals().ol as unknown as { card: Row | null }).card?.path];
    };
    expect([shown(3), shown(null)[0]]).toEqual([['目标 3 · 状态机可靠性改造', '目标 3 · 状态机可靠性改造', '状态机可靠性改造'], '状态机可靠性改造']);
  });

  const requeue = (q: Row): Row => ({ actorClass: 'human', automaticCount: null, reason: '', classWord: '', failureClass: 'check_failed', goalResume: false,
    requestedAt: '2026-10-04T10:31:00+08:00', interruption: null, ...q });
  const second = (rail: string, card: string) => ['第 2 次尝试 · ' + rail, '第 2 次尝试 · ' + card, '第 2 次尝试 · ' + card];
  it.each([
    ['a first attempt', { via: 'first', ordinal: 1, requeue: null }, ['', null, null]],
    ['a fourth attempt after a reply', { via: 'wait_continuation', ordinal: 4, requeue: null }, ['第 4 次尝试 · 接续', '第 4 次尝试 · 接续', '第 4 次尝试 · 接续']],
    ['GOAL-29 resume', { via: 'requeue', ordinal: 2, requeue: requeue({ actorClass: 'system', automaticCount: 0, reason: 'goal g1 resumed at epoch 1', failureClass: 'interrupted',
      goalResume: true, interruption: 'paused' }) }, second('接续：你在 10:31 继续，从暂停处接着做', '接续：你在 10:31 继续，从暂停处接着做')],
    ['a Host restart’s re-drive', { via: 'requeue', ordinal: 2, requeue: requeue({ actorClass: 'system', automaticCount: 0, reason: 'auto-rework:interrupted#0',
      failureClass: 'interrupted', interruption: 'executing' }) }, second('接续：带上接续说明，从停下的地方接着做', '接续：带上接续说明，从停下的地方接着做')],
    ['a person’s continue after a pause', { via: 'requeue', ordinal: 2, requeue: requeue({ failureClass: 'interrupted', interruption: 'paused', reason: 'continue' }) },
      second('接续：你在 10:31 继续，从暂停处接着做', '接续：你在 10:31 继续，从暂停处接着做')],
    ['the system’s rework', { via: 'requeue', ordinal: 2, requeue: requeue({ actorClass: 'system', automaticCount: 1, reason: 'auto-rework:check_failed#1', classWord: '检查未通过' }) },
      second('接续，系统自动重新入队（1/3）：检查未通过', '系统自动重新入队（1/3）：检查未通过')],
    ['a person’s requeue', { via: 'requeue', ordinal: 2, requeue: requeue({ reason: '样式检查 4 项' }) }, second('接续，样式检查 4 项', '你重新入队')],
    ['a person’s continue after the model service stopped', { via: 'requeue', ordinal: 2, requeue: requeue({ failureClass: 'interrupted', interruption: 'executing',
      reason: '模型服务恢复后继续' }) }, second('接续，模型服务恢复后继续', '你重新入队')],
  ])('E36-2 %s: the now column, the dock’s and the full track’s bar card say 第 n 次尝试 from the second on and where it came from', (_, attempt, expected) => {
    /* Named mutations: the first attempt is written too; a Goal resume worded as the system's rework (系统自动重新入队（0/3）);
       a person's continue after a pause worded as a requeue; the pause rule not reading interruption (the model-service row
       says 从暂停处接着做). */
    const data = sceneData(); data.tasks.find((t) => t.id === 'T28')!.reworkCap = 3;
    Object.assign(data.time!.rows.flatMap((r) => r.bars).find((b) => b.id.includes('/v11/'))!, { attempt });
    const { view, vals } = sceneView([], data);
    const tried = () => { vals().wl.rows.flatMap((r) => r.bars).find((b) => b.id.includes('/v11/'))!.hover();
      return ((vals().wl as unknown as { card: { rows?: Row[] } | null }).card?.rows ?? []).find((r) => r.k === '尝试')?.v ?? null; };
    const rail = (vals().now.items.find((item) => item.name === 'SSE 推送') as unknown as Row).sum; const dock = tried();
    view.instance.setState({ view: 'lanes' });
    expect([rail, dock, tried()]).toEqual(expected);
  });

  it('E36-2 负责 adds 第 n 次尝试 after a line, never after 未分配; the detail carries the row’s attemptOrdinal', () => {
    /* Named mutation: 未分配 gets the ordinal too. */
    const graph = { plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: [{ definition: { taskId: 't', title: 't' }, effectivePhase: 'running', attemptOrdinal: 4 }] };
    const line = [{ name: { primary: '执行者 · SSE 推送' }, status: { own: 'working' } }];
    const owner = (owners: Row[]) => adaptTaskMap(value('goals/read'), graph, value('goals/display'), { hover: { tasks: [{ task: { taskId: 't' }, owners }] } }).dag.owners.t;
    const detail = (task: Row) => adaptTaskMapDetail({ section: 'summary', task: { task: { taskId: 't' }, ...task } } as TaskMapSummaryRead, [], null, null, 'running', '', null, '', [], 4)!;
    expect([owner(line), owner([]), detail({ responsibleNow: line }).owner, detail({ responsibleNow: line }).attemptOrdinal, detail({ responsibility: 'none' }).owner])
      .toEqual(['执行者 · SSE 推送 · 工作中，第 4 次尝试', '未分配', '执行者 · SSE 推送 · 工作中，第 4 次尝试', 4, '未分配']);
  });
});
