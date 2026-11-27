import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { asRecord } from '../../src/ui/values.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openPLReadingsWorld, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';
import { bootPage, findButton, findClass, findElement } from './helpers/boot-page.js';
import { openStuckRunWorld } from './helpers/E3U-stuck-run-world.js';
import { bootChain, byLabel, groupHeads, stepRows, taskBar } from './helpers/E3C-world.js';
import { memberSearch, press, settle, worldSlot } from './helpers/E3M-world.js';
import { openMemberS7C } from './helpers/E3M-world.js';
import { click, notConnected } from './helpers/E3N-interact.js';
import { bootE3N, callsTo, countRoute, descendants, forwardPage, gateChanges, hasClass, newPageLog, quietPage, routeOf, sleep, textOf, waitFor } from './helpers/E3N-page.js';
import { openW2 } from './helpers/E3N-world.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-20 (8a A1–A9): the Run step projection, the trace summary/filter/body,
 * the archive banner, the per-attempt hosts and the task bar's write
 * failures. Every state is a real Host world; only ⑥'s `network/read` answer
 * is forwarded with the sheet's two hosts, because the proxy world needs bwrap.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

let readings: PLReadingsWorld | undefined;
let readingsLine = '';
let readingsGoal = '';
afterAll(async () => { await readings?.close(); }, 180_000);

async function readingsWorld(): Promise<PLReadingsWorld> {
  if (readings !== undefined) return readings;
  readings = await openPLReadingsWorld();
  const task = readings.tasks[0]!;
  const line = await readings.line('e3c20-steps', [task]);
  await readings.runTask({ line, taskId: task.taskId, flowId: 'e3c20-steps', replies: [
    { kind: 'calls', calls: [{ callId: 'e3c20-read-one', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'calls', calls: [{ callId: 'e3c20-read-two', name: 'read', args: { path: 'tsconfig.json' } }] },
    { kind: 'calls', calls: [{ callId: 'e3c20-edit', name: 'edit', args: { mode: 'create', path: 'e3c20-run-notes.md', newText: 'a\nb' } }] },
    { kind: 'calls', calls: [{ callId: 'e3c20-command', name: 'shell', args: { command: 'echo e3c20-run' } }] },
    { kind: 'text', text: 'E3C-20 steps done' },
  ] });
  readingsLine = line.ref.sessionId;
  readingsGoal = readings.goal.goalId;
  return readings;
}

const chainSearch = (goal: string): string => memberSearch(goal, { projectId: S6A_SCOPE.projectId, sessionId: readingsLine });
const traceRows = (root: FakeElement): FakeElement[] => descendants(findClass(root, 'lg') ?? root)
  .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'lg-row'));
const tab = (root: FakeElement, name: string): FakeElement | undefined =>
  findElement(root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === name);
const stepByVerb = (scope: FakeElement | undefined, verb: string): FakeElement | undefined =>
  stepRows(scope).find((row) => textOf(findClass(row, 'step-verb')) === verb);
const openStep = async (scope: FakeElement | undefined, verb: string): Promise<void> => {
  const row = stepByVerb(scope, verb);
  expect(row, verb).toBeDefined();
  const button = descendants(row!).find((element) => element.tagName.toLowerCase() === 'button');
  press(button, verb);
  await settle(() => row!.getAttribute('aria-expanded') === 'true');
};
const filterButtons = (root: FakeElement): FakeElement[] =>
  byLabel(root, '只看一类记录')!.childNodes.filter((child): child is FakeElement => 'tagName' in child);
const filterButton = (root: FakeElement, name: string): FakeElement | undefined =>
  filterButtons(root).find((button) => textOf(button) === name);

describe('E3C-20 8a the Chain page’s new reads', () => {
  it('① the process group draws the Run’s steps; a step’s raw record jumps to its trace row (A1/A2)', async () => {
    const fixture = await readingsWorld();
    const { page, log } = await bootChain(fixture.world, chainSearch(readingsGoal));
    try {
      await waitFor(() => groupHeads(page.root, '已读取 2 个文件').length > 0);
      const head = groupHeads(page.root, '已读取 2 个文件')[0]!;
      /* Hand count: two reads, one created file, one command.
         具名改坏: 组头写回 `还没接通`；本句红。 */
      expect(textOf(head)).toContain('已读取 2 个文件、编辑 1 个文件、运行命令 1 次');
      press(head, '过程组');
      await waitFor(() => stepRows(findClass(page.root, 'thread')).length === 4);
      const thread = (): FakeElement | undefined => findClass(page.root, 'thread');
      expect(stepRows(thread()).map((row) => textOf(findClass(row, 'step-verb'))))
        .toEqual(['读取', '读取', '编辑', '运行命令']);
      /* A1: the step read happens once; the chain does not read a Run twice. */
      expect(countRoute(log, 'executions/steps')).toBe(1);
      expect(countRoute(log, 'executions/read')).toBe(1);

      const rawButton = (verb: string): FakeElement | undefined => descendants(stepByVerb(thread(), verb)!)
        .find((element) => element.tagName.toLowerCase() === 'button' && textOf(element) === '在轨迹里看原始记录');
      await openStep(thread(), '读取');
      press(rawButton('读取'), '读取的原始记录');
      await waitFor(() => tab(page.root, '轨迹') !== undefined && hasClass(tab(page.root, '轨迹')!, 'is-on'));
      await waitFor(() => traceRows(page.root).some((row) => hasClass(row, 'is-on')));
      const selected = (): FakeElement | undefined => traceRows(page.root).find((row) => hasClass(row, 'is-on'));
      /* 具名改坏: 位置对不上时摘要写种类词；本句红。 */
      expect(textOf(findClass(selected()!, 'lg-sum'))).toBe('读取 · src/module.ts');
      await quietPage(log);

      press(tab(page.root, '对话'), '对话');
      await quietPage(log);
      await openStep(thread(), '运行命令');
      press(rawButton('运行命令'), '运行命令的原始记录');
      await waitFor(() => hasClass(traceRows(page.root).find((row) => hasClass(row, 'is-on'))!, 'is-on')
        && textOf(findClass(selected()!, 'lg-sum')).startsWith('运行命令'));
      expect(textOf(findClass(selected()!, 'lg-sum'))).toBe('运行命令 · echo e3c20-run');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('② the line-view Run row opens to the same four steps (A3)', async () => {
    const fixture = await readingsWorld();
    const { page } = await bootChain(fixture.world, chainSearch(readingsGoal));
    try {
      const run = (): FakeElement | undefined => descendants(page.root).filter((element) => hasClass(element, 'lv-it'))
        .map((holder) => descendants(holder).find((element) => element.tagName.toLowerCase() === 'button'))
        .find((button) => button !== undefined);
      await waitFor(() => run() !== undefined);
      expect(run()!.getAttribute('aria-disabled')).not.toBe('true');
      expect(run()!.getAttribute('title')).not.toBe('还没接通');
      /* 具名改坏: 运行行留着 is-off / 不能展开；下面两句红。 */
      press(run(), '运行行');
      await waitFor(() => run()!.getAttribute('aria-expanded') === 'true');
      expect(stepRows(findClass(page.root, 'lv-thread'))).toHaveLength(4);
      expect(stepRows(findClass(page.root, 'lv-thread')).map((row) => textOf(findClass(row, 'step-verb'))))
        .toEqual(['读取', '读取', '编辑', '运行命令']);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('④ 工具调用 keeps the four tool rows; 检查 stays unconnected; a non-step row says 过程记录 (A4)', async () => {
    const fixture = await readingsWorld();
    const { page, log } = await bootChain(fixture.world, chainSearch(readingsGoal));
    try {
      press(tab(page.root, '轨迹'), '轨迹');
      await waitFor(() => traceRows(page.root).length > 0);
      const before = log.calls.length;
      press(filterButton(page.root, '工具调用'), '工具调用');
      await settle(() => traceRows(page.root).length === 4);
      /* 具名改坏: 工具调用不再按步骤分类；本行的 4 行红。 */
      expect(traceRows(page.root)).toHaveLength(4);
      expect(filterButton(page.root, '工具调用')!.getAttribute('aria-pressed')).toBe('true');
      const rows = traceRows(page.root).length;
      notConnected(filterButton(page.root, '检查')!);
      await sleep(200);
      expect(traceRows(page.root)).toHaveLength(rows);
      expect(log.calls.length).toBe(before);
      press(filterButton(page.root, '全部'), '全部');
      await settle(() => traceRows(page.root).length > 4);
      const answer = traceRows(page.root).find((row) => textOf(findClass(row, 'lg-sum')) === '过程记录');
      expect(answer, 'the scripted answer row').toBeDefined();
      expect(textOf(findClass(answer!, 'lg-sum'))).toBe('过程记录');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑤ the archived line draws its banner (A6)', async () => {
    const w2 = await slot.use('E3C-20-archive', () => openW2(), (opened) => opened.world.close());
    const archived = asRecord((await w2.world.post('lines/archived', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, page: { limit: 100 },
    }))).body);
    const rows = asRecord(archived['value'])['rows'];
    const row = Array.isArray(rows) ? asRecord(rows[0]) : {};
    /* The W2 archive call writes the plain tag; the literal is the world's. */
    expect(asRecord(row['status'])['archivedTag']).toBe('plain');
    const { page } = await bootChain(w2.world, memberSearch('ag2b-goal', null));
    try {
      const toggle = (): FakeElement | undefined => descendants(findClass(page.root, 'rail') ?? page.root)
        .find((element) => element.tagName.toLowerCase() === 'button' && element.getAttribute('aria-expanded') !== null
          && textOf(element).includes('已归档'));
      await waitFor(() => toggle() !== undefined);
      press(toggle(), '已归档');
      await waitFor(() => descendants(findClass(page.root, 'rail') ?? page.root)
        .some((element) => hasClass(element, 'arch') || hasClass(element, 'is-arch')));
      const archivedRow = descendants(findClass(page.root, 'rail') ?? page.root)
        .find((element) => element.tagName.toLowerCase() === 'button'
          && (hasClass(element, 'is-arch') || hasClass(element, 'arch')));
      press(archivedRow, '归档的线');
      await waitFor(() => findClass(page.root, 'lv-note') !== undefined);
      const note = textOf(findClass(page.root, 'lv-note'));
      expect(note.startsWith('已归档')).toBe(true);
      expect(note).toContain('不会重新打开它');
      /* 具名改坏: 横幅写死 has:false；本句红。 */
      expect(note).toMatch(/^已归档（\d\d-\d\d \d\d:\d\d）/);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑥ an ended Run lists the hosts it reached and is not re-read on a refresh (A7)', async () => {
    const fixture = await readingsWorld();
    const log = newPageLog();
    gateChanges(log);
    const forward = forwardPage(fixture.world, log, 'controlled');
    const snapshot = { hosts: [
      { host: 'pkg.example', port: 80, address: '93.184.216.34', verdict: 'allowed', firstAt: '2026-10-27T10:00:00.000Z' },
      { host: 'inner.example', port: 8080, address: '127.0.0.1', verdict: 'refused', firstAt: '2026-10-27T10:01:00.000Z' },
    ], omitted: 0 };
    const page = await bootPage({ name: 'Chain', search: chainSearch(readingsGoal), token: () => fixture.world.token,
      request: async (url, init, realFetch) => routeOf(url) === 'network/read'
        ? forward(url, init, async () => new Response(JSON.stringify({ status: 'ready', value: snapshot }),
          { status: 200, headers: { 'content-type': 'application/json' } }))
        : forward(url, init, realFetch) });
    try {
      await waitFor(() => textOf(page.root).includes('连过的主机：'));
      /* 具名改坏: 被拦的一项不写地址；本行的整句红。 */
      expect(textOf(page.root)).toContain('连过的主机：pkg.example:80、inner.example:8080（被拦，127.0.0.1）');
      const reads = countRoute(log, 'network/read');
      log.releaseChanges();
      await waitFor(() => countRoute(log, 'lines/list') >= 2);
      await quietPage(log);
      /* A7: an ended Run's hosts are kept for this page; the refresh reads none. */
      expect(countRoute(log, 'network/read')).toBe(reads);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('③ an open live process group continues from runningFrom − 1 (A1)', async () => {
    const stuck = await openStuckRunWorld('e3c20-live');
    try {
      await stuck.started();
      stuck.fixture.world.clock.advance(12 * 60_000);
      const { page, log } = await bootChain(stuck.fixture.world, memberSearch(stuck.fixture.goal.goalId, stuck.line.ref));
      await waitFor(() => groupHeads(page.root).length > 0);
      press(groupHeads(page.root)[0], '在跑的过程组');
      await waitFor(() => callsTo(log, 'executions/steps').some((call) => call.reply !== undefined));
      const first = callsTo(log, 'executions/steps').find((call) => call.reply !== undefined)!;
      expect((first.input as { after?: unknown }).after).toBeNull();
      const initial = (first.reply as { value: { runningFrom: number | null } }).value;
      expect(initial.runningFrom).not.toBeNull();
      const start = log.calls.indexOf(first);
      await sleep(6_000);
      const follow = log.calls.slice(start + 1).filter((call) => call.route === 'executions/steps');
      /* 具名改坏: 续读从 null 重读整页；本句红。 */
      expect(follow.length).toBeGreaterThan(0);
      expect((follow[0]!.input as { after?: unknown }).after).toBe(initial.runningFrom! - 1);
      /* A1: a long command's own minute count, never a made-up 停止. */
      await waitFor(() => textOf(page.root).includes('正在跑，已 12 分钟'));
      await stuck.release();
    } finally {
      await stuck.close();
    }
  }, 180_000);

  it('⑧ a failed pause shows beside the task bar and the next click clears it (A8)', async () => {
    const held = await slot.use('E3C-20-fail', () => openMemberS7C({ firstRun: 'held' }), async (opened) => { await opened.s7c.close(); });
    const { page } = await bootE3N(held.s7c.world, 'Chain', {
      search: memberSearch('s7c-goal', held.module),
      rejectOnce: { route: 'controls/submit', code: 'revision_conflict', reason: 'the Run changed' },
    });
    try {
      await waitFor(() => taskBar(page.root) !== undefined);
      const pause = (): FakeElement | undefined => findButton(taskBar(page.root)!, '暂停');
      await waitFor(() => pause() !== undefined);
      press(pause(), '暂停');
      await waitFor(() => textOf(findClass(taskBar(page.root)!, 'tx-failed') ?? page.root).includes('这条工作线的版本已变化'));
      /* 具名改坏: 失败只进控制台；本句红。 */
      expect(textOf(findClass(taskBar(page.root)!, 'tx-failed'))).toBe('这条工作线的版本已变化，请重读后再试。');
      press(pause(), '暂停');
      await settle(() => findClass(taskBar(page.root)!, 'tx-failed') === undefined);
      expect(findClass(taskBar(page.root)!, 'tx-failed')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 180_000);
});
