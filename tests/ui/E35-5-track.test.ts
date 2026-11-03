import { describe, expect, it, vi } from 'vitest';
import { readTaskMap } from '../../src/ui/boot.js';
import { scene } from './helpers/task-map-scene.js';
import { dayCalendar, hourCalendar, hourCell, sceneData, sceneView, type Row } from './helpers/e35-scene.js';

/** E35-5: the track and its calendar (DESIGN `:1073-1093`). */

const at = (iso: string): number => Date.parse(iso) / 60000;

describe('E35-5 the track', () => {
  it('E35-5 5.12 a cursor in the past reads the archived lines; the row lights and names the one at work', () => {
    /* Named mutations: a past cursor reads the replay without the archived lines; closing 已归档 or going to the DAG
       in replay withdraws them (archive from wlArch alone). */
    const calls: Row[] = [];
    const data = sceneData();
    data.time!.rows.find((row) => row.bars.some((bar) => bar.taskId === 'T21'))!.archived = true;
    const { view, vals } = sceneView(calls, data);
    view.instance.setState({ view: 'lanes' });
    vals().wl.cur.key({ key: 'Home' });
    view.instance.setState({ t: at('2026-10-04T08:45:00+08:00') });
    const arch = vals().wl.rows.find((row) => row.isArch)!;
    expect([calls.some((call) => call.replay === true && call.archive === true), arch.title]).toEqual([true, '点一下显示已归档的工作线']);
    expect(arch.name).toContain('竖条处有 1 条在做：检查不完整判定');
    arch.toggle(); arch.toggle(); (vals().showDag as () => void)();
    expect(calls.slice(-3).map((call) => call.archive)).toEqual([true, true, true]);
  });

  it('E35-5 5.13 leaving the track keeps 已归档 open; the DAG keeps its read, the outline withdraws it', () => {
    /* Named mutation: leaving the track resets wlArch. */
    const calls: Row[] = [];
    const { view, vals, state } = sceneView(calls);
    view.instance.setState({ view: 'lanes', wlArch: true });
    const go = (name: string) => { (vals()[name] as () => void)(); return [state().wlArch, calls.at(-1)]; };
    expect([go('showDag'), go('showOutline'), go('showLanes')]).toEqual([[true, { lineKey: null, archive: true }],
      [true, { lineKey: null, archive: false }], [true, { track: true, win: 'today', executions: true, archive: true }]]);
  });

  it('E35-5 5.1 with no bar in the window, 任务 still lists each line’s task under its stage, quiet', () => {
    /* Named mutation: the 任务 grouping drops a stage with no bar in the window. */
    const data = sceneData();
    data.time!.rows.forEach((row) => { row.bars = []; });
    const { view, vals } = sceneView([], data);
    view.instance.setState({ view: 'lanes', wlBy: 'task' });
    expect(vals().wl.rows.filter((row) => row.isGrp).map((row) => [row.name, row.sub])).toEqual([['失败与重新入队', '这段时间没有活动（3 个任务）'],
      ['检查与返工', '这段时间没有活动（3 个任务）'], ['服务拆分', '这段时间没有活动（2 个任务）'], ['对话（不属于任务）', '这段时间没有活动（3 条工作线）']]);
  });

  it('E35-5 5.2 已归档 in 任务 counts the Host’s lines until they are read, then the Tasks all on archived lines', () => {
    /* Named mutation: once read, 已归档 keeps counting lines (已归档 1 条). */
    const archRow = (read: boolean) => {
      const data = sceneData();
      if (read) data.time!.rows.find((row) => row.bars.some((bar) => bar.taskId === 'T21'))!.archived = true;
      const { view, vals } = sceneView([], data);
      view.instance.setState({ view: 'lanes', wlBy: 'task' });
      return vals().wl.rows.find((row) => row.isArch)!.name;
    };
    expect([archRow(false), archRow(true)]).toEqual(['已归档 8 条', '已归档 1 个任务 · 竖条处有 1 个在做：检查不完整判定']);
  });

  it('E35-5 5.3 模块 puts an executor under its module’s name (else 其它), every other duty under 对话', () => {
    /* Named mutations: group by `(L.task || L.area)` again (the adviser goes under 调度, the secretary and reviewer
       under 其它); key the group by the module's name, so m1 and m3, both 调度, become one group. */
    const data = sceneData();
    data.moduleNames = { m1: '调度', m3: '调度' };
    data.time!.rows.forEach((row, i) => { row.groups = { task: null, module: i < 5 ? { moduleId: i === 4 ? 'm3' : i % 2 ? 'm1' : 'm2' } : null }; });
    const { view, vals } = sceneView([], data);
    view.instance.setState({ view: 'lanes', wlBy: 'module' });
    expect(vals().wl.rows.filter((row) => row.isGrp).map((row) => [row.name, row.sub])).toEqual([['其它', '本段 6 条工作线，最多同时 6 条，在做的最多 4 条'],
      ['调度', '这段时间没有活动（1 条工作线）'], ['调度', '这段时间没有活动（1 条工作线）'], ['对话、咨询与验收', '这段时间没有活动（3 条工作线）']]);
  });

  it('E35-5 5.7–5.9 an hour card reads 10-04 周日 08:00–09:00; an empty hour has no hint and no click; 只看 has no year', () => {
    /* Named mutation: the hour card and the 只看 label keep the year (2026-10-04 08:00). */
    const { view, vals, state } = sceneView([], sceneData(hourCalendar([hourCell(8, 3), hourCell(9, 0)])));
    view.instance.setState({ view: 'lanes' });
    const cell = (h: string) => vals().wl.cal.rows[0]!.cells.find((c) => c.key.includes('|' + h + '|'))!;
    cell('08').hover(); const card = vals().wl.ccard;
    cell('09').hover(); const empty = vals().wl.ccard;
    cell('09').pick(); const unpicked = state().wlCell;
    cell('08').pick();
    expect([card.name, card.hint, empty.hint, unpicked, vals().wl.cellLabel]).toEqual(['10-04 周日 08:00–09:00', '点一下只看这一小时', '', null, '10-04 08:00–09:00']);
  });

  it('E35-5 5.8, 5.9 a picked day’s empty hour has no hint and no click; a picked hour’s sum has no year', () => {
    /* Named mutations: drop `|| !n` from the picked day's hour (the empty 09:00 offers 点一下只看这一小时 and picks);
       name the hour by its localDate (2026-10-04 08:00). */
    /* the picked day's hour read, beside the 20 day cells that keep 全部 the year view */
    const days = (dayCalendar() as unknown as { cells: Row[] }).cells;
    const { view, vals, state } = sceneView([], sceneData(hourCalendar([...days, hourCell(8, 3), hourCell(9, 0)])));
    view.instance.setState({ view: 'lanes', wlWin: 'all', wlDay: '2026-10-04' });
    const cell = (h: string) => vals().wl.cal.rows[0]!.cells.find((c) => c.key.includes('|' + h + '|'))!;
    cell('09').hover(); const hint = vals().wl.ccard.hint; cell('09').pick(); const empty = state().wlCell;
    cell('08').pick();
    expect([hint, empty, vals().wl.sum.split('：')[0]]).toEqual(['', null, '10-04 08:00 这一小时']);
  });

  it('E35-5 5.5 a picked year day runs from min(08:00, first activity) to max(20:00, last)', () => {
    /* Named mutation: a picked day runs 00:00–24:00. */
    const W = (sceneView([]).view.instance as unknown as { wlWindow(w: string, c: null, d: string): Row }).wlWindow('all', null, '2026-10-01');
    expect([W.w0, W.w1]).toEqual([new Date(2026, 9, 1, 8).getTime() / 60000, new Date(2026, 9, 1, 20).getTime() / 60000]);
  });

  it('E35-5 5.6 a year day card offers its 24 hours; a complete day with no activity has no hint and no click', () => {
    /* Named mutation: a complete day with no activity keeps its hint and its click. */
    const { view, vals, state } = sceneView([], sceneData(dayCalendar({ '2026-10-02': 0 })));
    view.instance.setState({ view: 'lanes', wlWin: 'all' });
    const day = (key: string) => vals().wl.yr.weeks.flatMap((week) => week.days).find((d) => d.key === key)!;
    day('2026-10-03').hover(); const hint = vals().wl.yr.card.hint;
    day('2026-10-02').hover(); const none = vals().wl.yr.card.hint;
    day('2026-10-02').pick();
    expect([hint, none, state().wlDay]).toEqual(['点一下看这一天：它的 24 小时和那天的轨道', '', null]);
  });

  it('E35-5 5.14 the row’s pin says the line goes first', () => {
    /* Named mutation: the pin label drops （排在最前）. */
    const { view, vals } = sceneView([]);
    view.instance.setState({ view: 'lanes' });
    const row = vals().wl.rows.find((r) => r.isLine && (r as unknown as Row).canPin === true && (r as unknown as Row).pinned === false)!;
    expect((row as unknown as Row).pinLabel).toBe('固定这条工作线（排在最前）');
  });

  it('E35-5 5.15 a refused pin is said on the selection bar until a write succeeds', async () => {
    /* Named mutation: selSub ignores pinError. */
    let refuse = true;
    const { view, vals } = sceneView([], sceneData(), { pinLine: async () => { if (refuse) throw new Error('写入失败。'); } });
    view.instance.setState({ view: 'lanes' });
    vals().wl.rows.find((row) => row.isLine && row.bars.length > 0)!.bars[0]!.pick();
    await (vals().wl as unknown as { selPin(): Promise<void> }).selPin(); const refused = vals().wl.selSub;
    refuse = false; await (vals().wl as unknown as { selPin(): Promise<void> }).selPin();
    expect([refused, vals().wl.selSub.includes('写入失败。')]).toEqual(['写入失败。', false]);
  });

  it('E35-5 5.16 a run bar’s card says how its attempt came and which segment of the line it is', () => {
    /* Named mutation: count the segment from the line's first Session (第 1 段 for the latest). */
    const data = sceneData();
    const bar = (id: string) => data.time!.rows.flatMap((row) => row.bars).find((b) => b.id.endsWith('/' + id + '//'))!;
    bar('v08').attempt!.requeue!.actorClass = 'system'; bar('v06').attempt = { via: 'wait_continuation', requeue: null };
    const { view, vals } = sceneView([], data);
    view.instance.setState({ view: 'lanes', wlWin: 'week' });
    const card = (id: string) => { (vals().wl.rows.flatMap((row) => row.bars).find((b) => b.id.endsWith('/' + id + '//')) as unknown as { hover(): void }).hover();
      return (vals().wl as unknown as { card: { rows: Row[] } }).card.rows.filter((row) => row.k === '记录' || row.k === '尝试' || row.k === '类型').map((row) => row.v); };
    expect([card('v04'), card('v06'), card('v08')]).toEqual([['工作记录第 2 段，共 2 段'],
      ['工作记录第 1 段，共 2 段', '接续'], ['工作记录第 1 段，共 2 段', '系统自动重新入队']]);
  });

  it('E35-5 5.10 the open track reads the execution index on 今天: 未排期 is written and the track stays today', async () => {
    /* Named mutation: boot reads the execution index only for 全部, so 今天 has no 未排期. */
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(scene.now));
    try {
      const calls: Row[] = [];
      const client = { bootstrap: async () => scene.reply('bootstrap', {}),
        post: async (route: string, _scope: unknown, input: Row) => { calls.push({ route, ...input }); return scene.reply(route, input); } };
      const read = await readTaskMap(client as never, sceneData().goal.id, { track: true, win: 'today', executions: true });
      const track = calls.find((call) => call.route === 'activity/track')!;
      const { view, vals } = sceneView([], read.data!);
      view.instance.setState({ view: 'lanes' });
      expect([track.from, track.to, vals().wl.sum]).toEqual(['2026-10-03T16:00:00.000Z', '2026-10-04T16:00:00.000Z', '今天：步骤 213 · 编辑 34 · 检查 8 次 · 未排期 26']);
    } finally { vi.useRealTimers(); }
  });

  it('E35-5 5.11 an incomplete hour, day and sum say 未知 and why; a past incomplete day is not drawn as future', () => {
    /* Named mutations: an incomplete cell says 活动未记全 without its reason; the sum adds the counts across cells
       (a Run is counted in every cell it touches), 今天：未知：3 次执行还在进行… */
    const { view, vals } = sceneView([], sceneData(hourCalendar([hourCell(8, 3, { complete: false, inProgressRuns: 2, uncountedQueries: 1 }),
      hourCell(9, 0, { complete: false, inProgressRuns: 1 })])));
    view.instance.setState({ view: 'lanes' });
    const cell = (h: string) => vals().wl.cal.rows[0]!.cells.find((c) => c.key.includes('|' + h + '|'))!;
    cell('08').hover(); const word = vals().wl.ccard.word;
    const year = sceneView([], sceneData(dayCalendar({}, { '2026-10-02': { complete: false, uncountedRuns: 1 } })));
    year.view.instance.setState({ view: 'lanes', wlWin: 'all' });
    const day = year.vals().wl.yr.weeks.flatMap((week) => week.days).find((d) => d.key === '2026-10-02')!;
    expect([word, cell('09').tip, vals().wl.sum, day.cls, day.tip]).toEqual(['未知：2 次执行还在进行；1 个查询没有统计', '10-04 周日 09:00–10:00，未知：1 次执行还在进行',
      '今天：未知', 'cal-c cal-l1', '10-02 周五，未知：1 次执行没有统计']);
  });
});
