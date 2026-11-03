import { describe, expect, it } from 'vitest';
import { adaptTaskMap, adaptTaskMapDetail, type TaskMapSummaryRead } from '../../src/ui/adapters/task-map.js';
import { scene } from './helpers/task-map-scene.js';
import { sceneData, sceneView, value, type Pick, type Row } from './helpers/e35-scene.js';

/** E35-4: the detail rows (DESIGN `:492-507`) and which Task's detail is read. */

describe('E35-4 the detail', () => {
  it('E35-4 4.1 a deselect or a closed pin reads the node shown next: the last pin left, or none', () => {
    /* Named mutation: a deselect or a closed pin reads detailTaskId null with a pin left. */
    const calls: Row[] = [];
    const { view, vals } = sceneView(calls);
    const node = (id: string) => vals().dag.nodes.find((n) => n.id === id)!;
    node('task:T13').pin(); node('task:T28').pin(); node('task:T14').pick(); node('task:T14').pick();
    vals().det!.close(); vals().det!.close();
    const row = () => vals().now.items.find((item) => item.name === '接续说明')!;
    row().go(); row().go();
    node('task:T13').pin(); view.instance.setState({ view: 'outline' });
    const orow = () => (vals().ol as unknown as { rows: Pick[] }).rows.find((r) => r.id === 'task:T14')!; orow().pick(); orow().pick();
    expect(calls.filter((call) => 'detailTaskId' in call)).toEqual([{ detailTaskId: 'T13' }, { detailTaskId: 'T28' }, { detailTaskId: 'T14' },
      { detailTaskId: 'T28' }, { detailTaskId: 'T13', lineKey: null }, { detailTaskId: null, lineKey: null }, { detailTaskId: 'T14' }, { detailTaskId: null },
      { detailTaskId: 'T13' }, { detailTaskId: 'T14' }, { detailTaskId: 'T13' }]);
  });

  it('E35-4 4.1 deselecting a line on the track keeps the Task’s detail', () => {
    /* Named mutation: selClear withdraws the Task's detail too. */
    const calls: Row[] = [];
    const { view, vals } = sceneView(calls);
    view.instance.setState({ view: 'lanes' });
    const bar = () => vals().wl.rows.find((row) => row.isLine && row.bars.length > 0)!.bars[0]!;
    bar().pick(); vals().wl.selClear();
    expect([calls.at(-1), vals().det === null]).toEqual([{ lineKey: null }, false]);
  });

  it('E35-4 4.2 the detail’s 语义 is the Task’s instruction; no 指派说明 row', () => {
    /* Named mutation: 语义 reads the plan assignment's instruction, not the Task's. */
    const data = sceneData();
    data.tasks.find((task) => task.id === 'T13')!.instruction = 'E35 语义';
    const { view, vals } = sceneView([], data);
    view.instance.setState({ sel: 'task:T13' });
    expect(vals().det).toMatchObject({ sem: 'E35 语义', hasSem: true });
  });

  it('E35-4 4.4 a Task with dependencies says what a line means', () => {
    /* Named mutation: drop the line sentence from 关系. */
    const { view, vals } = sceneView([]);
    view.instance.setState({ sel: 'task:T13' });
    expect((vals().det as unknown as { rel: Row[] }).rel.at(-1)).toMatchObject({ k: '', text: '依赖是需要它的产出，不必等它整个结束' });
  });

  it('E35-4 4.5 a planned module without files is one 计划要改 group named by the module', () => {
    /* Named mutations: a planned module without files is skipped; a catalog module with paths: [] is dropped. */
    const summary = { section: 'summary', task: { task: { taskId: 't' }, plannedModules: [{ projectId: 'p', moduleId: 'm1' }] } } as TaskMapSummaryRead;
    const catalog = { modules: [{ ref: { moduleId: 'm1' }, name: '调度', paths: [] }] };
    expect(adaptTaskMapDetail(summary, [], null, catalog, 'pending')!.files)
      .toEqual([{ crumb: '调度', files: [{ path: '', name: '调度', certainty: 'planned', tag: '计划要改' }] }]);
  });

  it('E35-4 4.6 the disposition row says who changed it, in which plan, to what and why', () => {
    /* Named mutation: the disposition row writes its word only. */
    const detail = (by: string, at: string, text: string) => adaptTaskMapDetail({ section: 'summary', task: { task: { taskId: 't' }, disposition: 'deferred' } } as TaskMapSummaryRead,
      [], null, null, 'deferred', '', { to: 'deferred', actor: { kind: by }, reason: { text } }, at)!.disposition;
    expect([detail('human', '10-03 10:00', '先做别的'), detail('agent', '', '')]).toEqual([
      { word: '已延后', text: '由 人工 于计划 10-03 10:00 改为 已延后：先做别的' }, { word: '已延后', text: '由 Agent 改为 已延后' }]);
  });

  it('E35-4 4.7 a rework line reads 第 n 次 · who · class · reason', () => {
    /* Named mutation: print the rework code reason (auto-rework:check_failed#1); this row is also 1.3's. */
    const rework = { entries: [{ automatic: true, autoCount: 1, failureClass: 'check_failed', reason: 'auto-rework:check_failed#1', requestedAt: '' },
      { automatic: false, requestedBy: { kind: 'human' }, failureClass: 'interrupted', reason: '重跑', requestedAt: '' },
      { automatic: false, requestedBy: { kind: 'agent' }, failureClass: 'run_failed', reason: '换做法', requestedAt: '' }] };
    const graph = { plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: [{ definition: { taskId: 't', title: 'T' }, effectivePhase: 'failed', rework }] };
    expect(adaptTaskMap(value('goals/read'), graph, value('goals/display')).tasks[0]!.rework)
      .toEqual(['第 1 次 · 系统自动 · 检查未通过', '第 2 次 · 人工 · 平台中断 · 重跑', '第 3 次 · Agent · 执行失败 · 换做法']);
  });

  it('E35-4 4.8 the Goal’s 阶段 lists stages only, live and in replay', () => {
    /* Named mutation: the Goal's 阶段 lists the gate as a stage. */
    const { view, vals } = sceneView([]);
    const stages = (t: number | null) => {
      view.instance.setState({ sel: 'goal:' + sceneData().goal.id, t });
      return ((vals().det as unknown as { rel: Array<{ items: Pick[] }> }).rel[0]!.items).map((item) => item.name);
    };
    const names = ['规格与验收', '写入收口', '失败与重新入队', '检查与返工', '服务拆分', '以后再做'];
    expect([stages(null), stages(Date.parse(scene.now) / 60000 - 60)]).toEqual([names, names]);
  });

  it('E35-4 4.9 a participant line opens on the track by role: its group open, 全部 when older than today, archived when it is', () => {
    /* Named mutations: a participant line opens on the track without opening its group; an archived line not read
       yet leaves its group closed (no duty passed on); the jump reads no execution index (no 未排期, 5.10);
       an old line's last day is picked only when the calendar already read is longer than 14 days. */
    const open = (archived: boolean) => {
      const calls: Row[] = [];
      const data = sceneData();
      const line = data.time!.rows[0]!;
      line.lastActivityAt = '2026-10-03T12:00:00+08:00';
      const key = archived ? { projectId: 'p', sessionId: 'gone' } : { projectId: line.projectId, sessionId: line.sessionId };
      Object.assign(data, { detailFor: 'T13', detail: adaptTaskMapDetail({ section: 'summary', task: { task: { taskId: 'T13' } } } as TaskMapSummaryRead,
        [{ items: [{ key, name: { primary: '线' }, duty: line.role, via: 'participates', status: { bucket: archived ? 'archived' : 'working' } }] }], null, null, 'running') });
      const { view, vals } = sceneView(calls, data);
      view.instance.setState({ sel: 'task:T13', wlBy: 'module', wlClosed: { [line.role]: true } });
      (vals().det as unknown as { lines: Pick[] }).lines[0]!.go();
      const st = view.instance.state as Row;
      return [st.wlBy, st.wlWin, (st.wlClosed as Row)[line.role], st.wlArch, calls.at(-1)];
    };
    const line = sceneData().time!.rows[0]!;
    expect([open(false), open(true)]).toEqual([['role', 'all', false, false, { track: true, win: 'all', executions: true, lineKey: { projectId: line.projectId, sessionId: line.sessionId }, hourDay: '2026-10-03' }],
      ['role', 'all', false, true, { track: true, win: 'all', executions: true, lineKey: null, archive: true }]]);
  });

  it('E35-4 4.10 the relations list 重叠 from the risks pages, at most 6, and the line sentence says so', () => {
    /* Named mutation: list every risk: no cap at 6 and no 另有 n 个. */
    const risk = (i: number) => ({ task: { taskId: 'T0' + i }, title: 'R' + i, shared: i === 1 ? { kind: 'module', module: { moduleId: 'm1' } } : { kind: 'file', path: 'src/f' + i + '.ts' } });
    const data = sceneData();
    Object.assign(data, { detailFor: 'T13', detail: adaptTaskMapDetail({ section: 'summary', task: { task: { taskId: 'T13' } } } as TaskMapSummaryRead, [], null,
      { modules: [{ ref: { moduleId: 'm1' }, name: '调度', paths: ['src/x'] }] }, 'running', '', null, '', [{ items: [1, 2, 3, 4, 5, 6, 7].map(risk), nextCursor: null }]) });
    const { view, vals } = sceneView([], data);
    view.instance.setState({ sel: 'task:T13' });
    const rel = (vals().det as unknown as { rel: Array<{ k: string; items: Pick[]; text: string }> }).rel.filter((g) => g.k === '重叠' || g.k === '');
    expect(rel.map((g) => [g.items.map((item) => item.name).slice(0, 2), g.items.length, g.text])).toEqual([
      [['R1 · 调度（没有连线）', 'R2 · src/f2.ts（没有连线）'], 6, '另有 1 个任务也改这些文件'], [[], 0, '依赖是需要它的产出，不必等它整个结束；没有连线的也会改同一个文件']]);
  });

  it('E35-4 4.11 the Goal’s owner adds the working, else the paused lines', () => {
    /* Named mutation: the Goal's owner leaves out the other lines. */
    const goalOwner = (working: number, paused: number) => adaptTaskMap(value('goals/read'), { plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: [] },
      value('goals/display'), { hover: { groups: [{ node: { kind: 'goal' }, owners: [{ name: { primary: '秘书' }, status: { own: 'standby' } }],
        workingLines: { status: 'exact', value: working }, pausedLines: { status: 'exact', value: paused } }] } }).dag.goalOwner;
    expect([goalOwner(2, 1), goalOwner(0, 1), goalOwner(0, 0)]).toEqual(['秘书 · 待命，另有 2 条工作线工作中', '秘书 · 待命，另有 1 条工作线已暂停', '秘书 · 待命']);
  });

  it('E35-4 4.3 an unfinished Task nobody is responsible for says 未分配; a satisfied or superseded one hides the row', () => {
    /* Named mutations: the adapter leaves 负责 empty again; the board draws 负责 for every Task. */
    const phases = ['ready', 'pending', 'failed', 'satisfied'];
    const graph = { plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: phases.map((phase) => ({ definition: { taskId: phase, title: phase }, effectivePhase: phase })) };
    const owners = adaptTaskMap(value('goals/read'), graph, value('goals/display'), { hover: { tasks: phases.map((phase) => ({ task: { taskId: phase }, owners: [] })) } }).dag.owners;
    const detail = (state: string) => adaptTaskMapDetail({ section: 'summary', task: { task: { taskId: 't' }, responsibility: 'none' } } as TaskMapSummaryRead, [], null, null, state)!.owner;
    const data = sceneData(); delete data.dag.owners.T01;
    const { vals } = sceneView([], data);
    vals().dag.nodes.find((n) => n.id === 'task:T01')!.hover();
    expect([...phases.map((phase) => owners[phase]), detail('claimable'), detail('superseded'), (vals().dag as unknown as { card: { rows: Row[] } }).card.rows.some((row) => row.k === '负责')])
      .toEqual(['未分配，等成员领取；开工时开一条工作线', '未分配；开工时开一条工作线', '未分配', undefined, '未分配，等成员领取；开工时开一条工作线', '', false]);
  });
});
