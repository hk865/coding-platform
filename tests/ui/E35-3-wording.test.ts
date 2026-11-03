import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { adaptTaskMap, adaptTaskMapTime, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead, type TaskMapLineRead, type TaskMapTrackLineRead, type TaskMapTrackPageRead } from '../../src/ui/adapters/task-map.js';
import { BoardView } from '../../src/ui/runtime.js';
import { loadBoard } from './helpers/board-files.js';
import { scene } from './helpers/task-map-scene.js';

/** E35-3: the state reasons in the A.2 words (DESIGN `:606`, E3I:47) and the reason rules of `taskWhyOf`. */

const GOAL = { goal: { ref: { goalId: 'e35-3-g' }, objective: 'E35-3 目标' } } as TaskMapGoalRead;
const RUNNING = { display: { phase: 'RUNNING' } } as TaskMapDisplayRead;
type Row = Record<string, unknown>;
const whyOf = (row: Row): string => adaptTaskMap(GOAL, { plan: { stages: [], executionDag: { dependsOn: [] } },
  tasks: [{ definition: { taskId: 't', title: 'T' }, effectivePhase: 'failed', ...row }] } as TaskMapGraphRead, RUNNING).tasks[0]!.why;
const failure = (verdict: Row, extra: Row = {}): Row => ({ failure: { automation: { cap: 3, requeueAutoCount: 0, verdict }, ...extra } });
const stop = (reason: string, detail: Row = {}, extra: Row = {}): Row => failure({ kind: 'stopped', reason, detail }, extra);
const cause = (code: string): Row => ({ phaseCause: { code } });

describe('E35-3 reason words', () => {
  it.each([
    ['3.1 run_outcome_unknown', { effectivePhase: 'blocked', ...cause('run_outcome_unknown') }, '执行结果待核对'],
    ['3.1 unknown_outcome', stop('unknown_outcome'), '执行结果待核对'],
    ['3.1 gate_needs_fix', stop('gate_needs_fix'), '验收未通过，需要添加修复任务'],
    ['3.1 no_new_basis', stop('no_new_basis'), '没有新依据，自动返工已停止'],
    ['3.1 task_paused', stop('task_paused'), '已暂停，可继续'],
    ['3.1 budget_exhausted', stop('budget_exhausted'), '预算耗尽'],
    ['3.5 a paused interrupted Task (waiting) says why, not its state word again',
      { effectivePhase: 'blocked', ...cause('paused_interrupted'), ...stop('task_paused') }, '主机重启时已暂停'],
    ['3.2 a missing count drops the brackets', { failure: { automation: { verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: {} } } } }, '自动返工已达上限'],
    ['3.2 the cap of a requeue', { failure: { automation: { cap: 3, requeueAutoCount: 3, verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: {} } } } }, '自动返工已达上限（3/3）'],
    ['3.2 the cap of a reverify', stop('auto_rework_cap_reached', { operation: 'reverify' }, { round: { autoCount: 2 } }), '自动返工已达上限（2/3）'],
    ['3.3 requeue', { ...cause('run_failed'), ...failure({ kind: 'requeue', failureClass: 'run_failed' }) }, '执行失败，系统自动重新入队（1/3），等待推进'],
    ['3.3 an interrupted requeue is not counted', { ...cause('run_failed'), ...failure({ kind: 'requeue', failureClass: 'interrupted' }) }, '执行失败，系统自动重新入队，等待推进'],
    ['3.3 reverify', { ...cause('check_failed'), ...failure({ kind: 'reverify', failureClass: 'check_failed' }) }, '检查未通过，推进时自动重新检查'],
    ['3.3 an automatic requeue', { effectivePhase: 'ready', ...cause('requeued'), rework: { cap: 3, entries: [{ automatic: false }, { automatic: true, autoCount: 2 }] } }, '系统自动重新入队（2/3）'],
    ['3.3 a manual requeue', { effectivePhase: 'ready', ...cause('requeued'), rework: { cap: 3, entries: [{ automatic: false }] }, ...failure({ kind: 'claim_requeued' }) }, '已重新入队'],
    ['3.4 continuation_cancelled', { effectivePhase: 'blocked', ...cause('continuation_cancelled') }, '已取消，可重新入队'],
    ['3.6 round_ambiguous', stop('not_reworkable', { cause: 'round_ambiguous' }), '轮次链无效，需要计划处理'],
    ['3.6 unknown_call_review', stop('unknown_call_review'), '结果未知的调用待核对'],
    ['3.6 interrupted_pending_resume', stop('interrupted_pending_resume'), '被中断，等你继续'],
    ['3.6 an unknown stop falls back to the phase cause', { ...cause('check_failed'), ...stop('not_reworkable', { cause: 'e35_new' }) }, '检查未通过'],
    ['3.7 claimable', { effectivePhase: 'ready' }, '等成员领取'],
    ['3.8 a deferred Task says why it was deferred', { disposition: 'deferred', dispositionChange: { traced: false, reason: { text: '先做别的' } } }, '先做别的'],
    ['3.14 a deferred Task that ran keeps its phase and reason', { disposition: 'deferred', ...cause('check_failed'),
      dispositionChange: { traced: true, reason: { text: '先做别的' } } }, '失败，检查未通过'],
  ])('E35-3 %s', (_name, row, expected) => {
    /* Named mutation: per row, taskWhyOf loses that code's word, its count or its order. */
    expect(whyOf(row as Row)).toBe(expected);
  });

  it('E35-3 3.13 an interruption anchor reads 中断，待核对 and what it waits for', () => {
    /* Named mutation: drop the anchor's next params; every anchor reads 中断，待核对 alone. */
    const whyWith = (params: Row): string => adaptTaskMap(GOAL, { plan: { stages: [], executionDag: { dependsOn: [] } },
      tasks: [{ definition: { taskId: 't', title: 'T' }, effectivePhase: 'blocked', phaseCause: { code: 'check_interrupted' } }] } as TaskMapGraphRead, RUNNING,
    { hover: { tasks: [{ task: { taskId: 't' }, display: { anomaly: { label: '中断，待核对', next: { code: 'anomaly_pending', params } } } }] } }).tasks[0]!.why;
    expect([{ next: 'human_continue' }, { next: 'rework_blocked', code: 'e35_code' }, { next: 'goal_stopped', goal: 'paused' }, {}, { next: 'e35_new' }].map(whyWith))
      .toEqual(['中断，待核对 · 等你点“继续”', '中断，待核对 · 不能自动返工', '中断，待核对 · 目标已暂停', '中断，待核对 · 等待推进', '中断，待核对']);
  });

  it('E35-3 3.9 a line reads the member words; an owner takes the track’s attention word', () => {
    /* Named mutation: print the line's own code (working) instead of the member word. */
    const owner = (attention: string | null) => ({ name: { primary: '线' }, status: { own: 'standby', attention: attention && { code: attention } } });
    const ownersOf = (attention: string | null): string => adaptTaskMap(GOAL, { plan: { stages: [], executionDag: { dependsOn: [] } },
      tasks: [{ definition: { taskId: 't', title: 'T' }, effectivePhase: 'failed' }] } as TaskMapGraphRead, RUNNING,
    { hover: { tasks: [{ task: { taskId: 't' }, owners: [owner(attention)] }] } }).dag.owners.t!;
    expect(['decide', 'failed', 'blocked', 'unknown', null].map(ownersOf))
      .toEqual(['线 · 等你决定', '线 · 停下（失败）', '线 · 停下（受阻）', '线 · 待核对', '线 · 待命']);
    const lines = ['working', 'checking', 'waiting_reply', 'done', 'retired', 'unknown']
      .map((own) => ({ key: { projectId: 'p', sessionId: own }, name: { primary: own }, status: { own } }));
    expect(adaptTaskMapTime([], null, null, lines, '2026-10-04T06:00:00.000Z').rows.map((row) => row.word))
      .toEqual(['工作中', '正式检查中', '等回复', '已做完', '已退役', '待核对']);
  });

  it('E35-3 3.10, 3.11 the now column: 接续 with the automatic class, the running check round (3.12 is E34-14:308)', () => {
    /* Named mutation: drop the bar's attempt (no 接续) and write the round as 第 n 轮正式检查. */
    const value = <T,>(route: string): T => (scene.reply(route, {}) as unknown as { value: T }).value;
    const lines = value<TaskMapLineRead & { rows: TaskMapTrackLineRead[] }>('lines/list');
    /* A running Task carries no phase cause (task-machine.ts:143); the scene's T13 does. */
    const graph = value<TaskMapGraphRead>('tasks/query');
    (graph.tasks as unknown as Row[]).find((task) => (task.definition as Row).taskId === 'T13')!.phaseCause = null;
    const data = adaptTaskMap(value<TaskMapGoalRead>('goals/read'), graph, value<TaskMapDisplayRead>('goals/display'), { lines, hover: value('graph/hover') });
    const page = value<{ bars: Row[] }>('activity/track');
    const live = (task: string): Row => page.bars.find((bar) => bar.taskId === task && bar.endAt === null)!;
    live('T13').attempt = { attemptId: 'a', via: 'requeue', requeue: { actorClass: 'system', automaticCount: 1, reason: 'auto-rework:check_failed#1' } };
    data.time = adaptTaskMapTime([page as unknown as TaskMapTrackPageRead], null, null, lines.rows, scene.now, lines.counts);
    const board = loadBoard('TaskMap', fileURLToPath(new URL('../../src/ui/boards/', import.meta.url)));
    const vals = new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 }).instance.renderVals() as { now: { items: Row[] } };
    expect(['重新入队与失败类别', '接续说明'].map((name) => vals.now.items.find((item) => item.name === name)!.sum))
      .toEqual(['接续，系统自动重新入队（1/3）：检查未通过', '正式检查第 1 轮进行中，已开始 9 项']);
  });
});
