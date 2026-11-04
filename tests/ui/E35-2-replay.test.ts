import { describe, expect, it } from 'vitest';
import { adaptTaskMapDetail, type TaskMapSummaryRead } from '../../src/ui/adapters/task-map.js';
import { scene } from './helpers/task-map-scene.js';
import { sceneData, sceneView, value, type Pick, type Row } from './helpers/e35-scene.js';

/** E35-2: replay says what was so at the cursor, and marks what is only known for now （现在） (DESIGN `:1073-1093`). */

const at = (iso: string): number => Date.parse(iso) / 60000;
const before = Date.parse(scene.now) / 60000 - 60;

describe('E35-2 replay', () => {
  it('E35-2 2.1 in replay the goal bar counts the lines at the cursor and says when; with no timeline read, no number', () => {
    /* Named mutations: in replay the bar keeps today's lines/list count (3 条工作线工作中); it counts only lines not
       archived now (the line at work at 08:45 is archived here: 没有工作线在工作). */
    const bar = (timeline: boolean) => {
      const data = sceneData(null, timeline ? value('tasks/timeline') : null);
      data.time!.rows.find((row) => row.bars.some((b) => b.taskId === 'T21'))!.archived = true;
      const { view, vals } = sceneView([], data);
      view.instance.setState({ t: at('2026-10-04T08:45:00+08:00') }); return vals().barWhy;
    };
    expect([bar(true), bar(false)]).toEqual(['1 条工作线工作中 · 3 条在等（10-04 08:45）', '']);
  });

  it('E35-2 2.2 in replay 负责 on the card and in the detail is marked as now’s', () => {
    /* Named mutation: drop （现在） from 负责 in replay. */
    const { view, vals } = sceneView([]);
    view.instance.setState({ sel: 'task:T13', t: before });
    vals().dag.nodes.find((n) => n.id === 'task:T13')!.hover();
    const card = (vals().dag as unknown as { card: { rows: Row[] } }).card.rows.find((row) => row.k === '负责')!;
    expect([card.v, (vals().det as unknown as Row).agent]).toEqual(['执行者 · 重新入队与失败类别 · 工作中，第 2 次尝试（现在）', '执行者 · 重新入队与失败类别 · 工作中，第 2 次尝试（现在）']);
  });

  it('E35-2 2.3 in replay a complete participant list says it runs to now, not only to the cursor', () => {
    /* Named mutation: the complete participant note stays hidden in replay. */
    const data = sceneData(); const line = data.time!.rows[0]!;
    Object.assign(data, { detailFor: 'T13', detail: adaptTaskMapDetail({ section: 'summary', task: { task: { taskId: 'T13' } } } as TaskMapSummaryRead, [{ items: [{
      key: { projectId: line.projectId, sessionId: line.sessionId }, name: { primary: '线' }, via: 'participates', status: { bucket: 'working' } }], nextCursor: null }], null, null, 'running') });
    const { view, vals } = sceneView([], data);
    const note = (t: number | null) => { view.instance.setState({ sel: 'task:T13', t }); const det = vals().det as unknown as Row; return [det.hasLinesNote, det.linesNote]; };
    expect([note(null)[0], note(before)]).toEqual([false, [true, '到现在为止的参与，不只到 10-04 13:15']]);
  });

  it('E35-2 2.4 in replay the 标出 note says its count is now’s', () => {
    /* Named mutation: the 标出 note drops （现在） in replay. */
    const { view, vals } = sceneView([]);
    view.instance.setState({ att: 'failed', t: before });
    expect(vals().qNote).toBe('标出：失败 1（现在）');
  });

  it('E35-2 2.5 in replay a Task reads its state word at t and the timeline’s own word as the reason', () => {
    /* Named mutation: statesAt writes the timeline word as the state word, with no reason. */
    const timeline = { tasks: [['T13', 'outcome_unknown'], ['T14', 'run_failed'], ['T15', 'unknown']].map(([taskId, state]) => ({ taskId: taskId!, segments: [{ from: null, to: null, state: state! }] })) };
    const { view, vals } = sceneView([], sceneData(null, timeline));
    view.instance.setState({ t: before });
    expect(['task:T13', 'task:T14', 'task:T15'].map((id) => vals().dag.nodes.find((n) => n.id === id)!.tip)).toEqual(['重新入队与失败类别，需要你决定：执行结果待核对',
      '接续说明，失败：执行失败', '启动核对，未知']);
  });

  it('E35-2 2.6, 2.7 in replay a bar across the cursor says how long so far, without today’s counts; a handed-over run waits for its check', () => {
    /* Named mutation: a bar across the cursor keeps today's counts, and awaiting_check reads as a run. */
    const seg = (state: string, from: string, to: string | null) => ({ state, from: '2026-10-04T' + from + ':00+08:00', to: to && '2026-10-04T' + to + ':00+08:00' });
    const { view, vals } = sceneView([], sceneData(null, { tasks: [{ taskId: 'T14', segments: [seg('running', '10:25', '11:35'), seg('awaiting_check', '11:35', '14:05')] },
      { taskId: 'T21', segments: [seg('verifying', '09:02', '09:08')] }] }));
    const sum = (iso: string, id: string) => { view.instance.setState({ t: at(iso) }); const name = vals().dag.nodes.find((n) => n.id === id)!.name;
      return name + '｜' + (vals().now.items.find((item) => item.name === name) as unknown as Row | undefined)?.sum; };
    expect([sum('2026-10-04T11:15:00+08:00', 'task:T14'), sum('2026-10-04T09:05:00+08:00', 'task:T21'), sum('2026-10-04T12:00:00+08:00', 'task:T14')]).toEqual(['接续说明｜已 50 分',
      '检查不完整判定｜正式检查第 1 轮，已 3 分', '接续说明｜已交给正式检查，等检查开始，已 25 分']);
  });

  it('E35-2 2.8 before a Task joined the plan it reads its plan word and when it joined', () => {
    /* Named mutation: not_in_plan reads 待执行 with no reason. */
    const { view, vals } = sceneView([], sceneData(null, { tasks: [{ taskId: 'T13', segments: [{ from: null, to: '2026-10-04T13:00:00+08:00', state: 'not_in_plan' },
      { from: '2026-10-04T13:00:00+08:00', to: null, state: 'pending' }] }] }));
    view.instance.setState({ t: at('2026-10-04T12:00:00+08:00') });
    expect(vals().dag.nodes.find((n) => n.id === 'task:T13')!.tip).toBe('重新入队与失败类别，待执行：这时还不在计划里（10-04 13:00 加入）');
  });

  it('E35-2 2.9 待执行 at t with a later real execution says when it first ran; with none, no reason', () => {
    /* Named mutation: a 待执行 Task at t has no first-run reason. */
    const pending = (taskId: string) => ({ taskId, segments: [{ from: null, to: null, state: 'pending' }] });
    const { view, vals } = sceneView([], sceneData(null, { tasks: [pending('T13'), pending('T17')] }));
    view.instance.setState({ t: at('2026-10-04T12:00:00+08:00') });
    expect(['task:T13', 'task:T17'].map((id) => vals().dag.nodes.find((n) => n.id === id)!.tip)).toEqual([
      '重新入队与失败类别，待执行：这时还没开始，10-04 13:31 第一次执行', '失败类别展示，待执行']);
  });

  it('E35-2 2.10 the cursor stays in its window: a new window clamps it, Home goes to the start, aria says the range', () => {
    /* Named mutation: a window change keeps t outside the new window. */
    const { view, vals, state } = sceneView([]);
    view.instance.setState({ view: 'lanes', wlWin: 'week', t: at('2026-10-03T10:00:00+08:00') });
    (vals().wl as unknown as { wins: Array<Pick & { label: string }> }).wins.find((w) => w.label === '今天')!.go();
    const clamped = state().t; vals().wl.cur.key({ key: 'Home' });
    const cur = vals().wl.cur as unknown as Row;
    expect([clamped, state().t, cur.min, cur.max]).toEqual([at('2026-10-04T08:00:00+08:00'), at('2026-10-04T08:00:00+08:00'),
      at('2026-10-04T08:00:00+08:00'), at('2026-10-04T14:15:00+08:00')]);
  });
});
