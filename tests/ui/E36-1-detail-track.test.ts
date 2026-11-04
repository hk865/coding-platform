import { describe, expect, it } from 'vitest';
import { adaptTaskMap, adaptTaskMapDetail, adaptTaskMapTime, type TaskMapLineRead, type TaskMapSummaryRead, type TaskMapTrackLineRead, type TaskMapTrackPageRead } from '../../src/ui/adapters/task-map.js';
import { scene } from './helpers/task-map-scene.js';
import { sceneData, sceneView, value, type Row } from './helpers/e35-scene.js';

/** E36-1: the detail's architecture rows, the run bar's reason and the claimable state, from real route shapes. */
const summaryOf = (task: Record<string, unknown>) => ({ section: 'summary', task: { task: { taskId: 't' }, ...task } }) as unknown as TaskMapSummaryRead;
const at = (hm: string): number => Date.parse('2026-10-04T' + hm + ':00+08:00') / 60000;

describe('E36-1 the detail and the track', () => {
  it.each([
    ['the planned module itself', 'src/app/server/a.ts', ['app-server'], '实际改过'],
    ['a child of the planned module', 'src/app/server/sse/b.ts', ['app-server'], '实际改过'],
    ['the planned module’s parent', 'src/app/c.ts', ['app-server'], '实际改过 · 不在计划里'],
    ['an unrelated module', 'src/ui/d.ts', ['app-server'], '实际改过 · 不在计划里'],
    ['a Task with no planned module', 'src/ui/d.ts', [], '实际改过'],
  ])('E36-1 an executed file in %s is judged against the planned modules (prototype:3382)', (_, path, planned, tag) => {
    /* Named mutation: compare the moduleId only, not the planned module's children (the child row reads 不在计划里). */
    const catalog = { modules: [['app', 'src/app'], ['app-server', 'src/app/server'], ['app-server-sse', 'src/app/server/sse'], ['ui-files', 'src/ui']]
      .map(([id, p]) => ({ ref: { moduleId: id }, name: id, paths: [p] })),
    containment: { parentOf: [['app', 'app-server'], ['app-server', 'app-server-sse']].map(([p, c]) => ({ parent: { moduleId: p }, child: { moduleId: c } })) } };
    const summary = summaryOf({ plannedModules: planned.map((moduleId) => ({ moduleId })), actualFiles: { availability: 'available', value: [{ path, certainty: 'definite' }] } });
    expect(adaptTaskMapDetail(summary, [], null, catalog, 'running')!.files.flatMap((g) => g.files).find((f) => f.path === path)!.tag).toBe(tag);
  });

  it.each([
    ['pending', 'request_execution', { eligible: true, reasons: [] }, 'claimable'],
    ['pending', 'request_execution', { eligible: false, reasons: [{ code: 'goal_not_active' }] }, 'pending'],
    ['ready', 'request_execution', { eligible: false, reasons: [{ code: 'goal_not_active' }] }, 'pending'],
    ['pending', 'plan_only', { eligible: false, reasons: [{ code: 'task_planning_only' }] }, 'future'],
  ])('E36-1 a %s %s Task with the platform’s eligibility %j is drawn %s (E3I:142, UIW:96)', (phase, intent, eligibility, st) => {
    /* Named mutation: back to "only ready is claimable" (the first and third rows turn). */
    const graph = { plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: [{ definition: { taskId: 't', title: 't', executionIntent: intent }, effectivePhase: phase, eligibility }] };
    expect(adaptTaskMap(value('goals/read'), graph, value('goals/display')).tasks[0]!.st).toBe(st);
  });

  it('E36-1 an overlap on a file names the file, not its path (prototype:3400)', () => {
    /* Named mutation: the file branch writes shared.path whole. */
    const risks = [{ items: [{ task: { taskId: 'T06' }, title: '检查轮次写入收口', shared: { kind: 'file', path: 'src/a/b.ts' } }], nextCursor: null }];
    expect(adaptTaskMapDetail(summaryOf({}), [], null, null, 'pending', '', null, '', risks)!.overlaps[0]!.text).toBe('检查轮次写入收口 · b.ts（没有连线）');
  });

  it('E36-1 a run bar carries the Host’s reason verbatim; a check bar carries none', () => {
    /* Named mutation: the projection drops the run's reason. */
    const page = value<TaskMapTrackPageRead>('activity/track'); const lines = value<TaskMapLineRead & { rows: TaskMapTrackLineRead[] }>('lines/list');
    page.bars.forEach((bar) => { if ((bar as Row).kind === 'check') (bar as Row).reason = 'check reason'; });
    const bars = adaptTaskMapTime([page], null, null, lines.rows, scene.now, lines.counts).rows.flatMap((row) => row.bars);
    expect([bars.find((bar) => bar.id.includes('/s18/'))!.reason, bars.find((bar) => bar.kind === 'check')!.reason]).toEqual(['检查链测试超时，命令没有返回（系统自动重新入队（1/3））', '']);
  });

  it.each([
    ['run_failed', true, '执行失败：检查链测试超时'],
    ['interrupted', true, '平台中断：检查链测试超时'],
    ['outcome_unknown', true, '执行结果待核对：检查链测试超时'],
    ['run_failed', false, '执行失败'],
  ])('E36-1 in replay a %s segment ended by a run (point: %s) says the prototype’s prefix and that run’s reason (prototype:2934-2936)', (state, point, sum) => {
    /* Named mutations: the prefix is the timeline word (中断，待核对：…); the reason is the Task's last bar's (the later bar's 别的原因). */
    const source = value<{ bars: Row[] }>('activity/track').bars.find((bar) => (bar.runRef as Row | undefined)?.runId === 's25')!.runRef;
    const data = sceneData(null, { tasks: [{ taskId: 'T14', segments: [{ from: '2026-10-04T11:35:00+08:00', to: null, state,
      point: point ? { kind: 'run_end', source } : null }] }] });
    const row = data.time!.rows.find((r) => r.bars.some((bar) => bar.id.includes('/s25/')))!; const ran = row.bars.find((bar) => bar.id.includes('/s25/'))!;
    ran.reason = '检查链测试超时';
    row.bars.push({ ...ran, id: 'run:later', startAt: '2026-10-04T11:40:00+08:00', endAt: '2026-10-04T11:50:00+08:00', startMinute: at('11:40'), endMinute: at('11:50'), reason: '别的原因' });
    const { view, vals } = sceneView([], data);
    view.instance.setState({ t: at('12:00') });
    const now = vals().now as unknown as { items: Row[]; held: Row[] };
    expect([...now.items, ...now.held].find((item) => item.name === '接续说明')!.sum).toBe(sum);
  });

  it('E36-1 a Task with a run in progress says the now column’s sentence in the detail head and the hover card; a satisfied one does not', () => {
    /* Named mutation: the detail head keeps only the reason. */
    const data = sceneData();
    data.time!.rows.flatMap((row) => row.bars).find((bar) => bar.id.includes('/v11/'))!.activity!.changedFiles = { definite: 3, possible: 0, possiblyIncomplete: false };
    const { view, vals } = sceneView([], data);
    const card = (id: string) => { vals().dag.nodes.find((n) => n.id === id)!.hover(); return ((vals().dag as unknown as { card: Row }).card.why as string); };
    view.instance.setState({ sel: 'task:T28' });
    expect([(vals().now.items.find((item) => item.name === 'SSE 推送') as unknown as Row).sum, (vals().det as unknown as Row).why, card('task:T28'),
      card('task:T01').includes('轮正式检查')]).toEqual(['已改 3 个文件', '：已改 3 个文件', '：已改 3 个文件', false]);
  });
});
