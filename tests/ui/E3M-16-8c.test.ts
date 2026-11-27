import { afterAll, describe, expect, it } from 'vitest';
import { bootPage, findClass, findElement } from './helpers/boot-page.js';
import { hover } from './helpers/E3N-interact.js';
import { callsOf, forwardPage, gateChanges, hasClass, lineRows, newPageLog, routeOf, textOf } from './helpers/E3N-page.js';
import {
  bootMemberAt, bootMemberOnHost, buttonText, elementsOf, headFact, memberSearch, metaOf, press, railRowOf, settle,
} from './helpers/E3M-world.js';
import { openUnknownWorld } from './helpers/E3D-world.js';
import { openMemberS7C, openMemberW3, openMemberW4, openMemberW6, workLineOf } from './helpers/E3M-world.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  AG2B_SCOPE, claimBusyQuery, createAG2bSession, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost,
  startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  deferred, moveKernelAside, post, publicDirectory, readQuery, tempDir, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import { S6A_GOAL_1 } from '../helpers/S6A-request-fixture.js';
import {
  controlIntentWordOf, queryUnknownTextOf, startupViewOf, type MemberStartupReport,
} from '../../src/ui/adapters/member.js';
import { controlWriteTextOf } from '../../src/ui/boot.js';
import { RouteReadError } from '../../src/ui/host-client.js';
import { lineStatusView } from '../../src/ui/adapters/task-map.js';
import { asRecord } from '../../src/ui/values.js';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { WorkLineListV1 } from '../../src/contracts/work-line.js';
import type { NavData } from '../../src/ui/adapters/nav.js';
import type { HostScenario } from '../scenarios/harness.js';
import type { FakeElement } from './helpers/dom.js';
import type { PageFetch } from './helpers/boot-page.js';

/**
 * E3M-16 (8c): the control intent words, the line reason words and two-segment
 * rail, the paused-interrupted Task's 继续, the archive/stop marker, the start-up
 * rows, the 认定结果 entry and the waiting head's card. Expected words are the
 * frozen ruling's; the page supplies only selectors. Every variant table entry
 * fails alone and names one rule.
 */

const scenarios: HostScenario[] = [];
afterAll(async () => { for (const h of scenarios.splice(0)) await h.dispose(); }, 240_000);

const acts = (root: FakeElement): FakeElement | undefined => findClass(root, 'mh-acts');

/** One page boot whose named route answer is rewritten by `mutate` (the ruling's
 * page forwarding); every other call goes through the world. */
async function bootEdited(
  world: { readonly base: string; readonly token: string }, search: string, route: string,
  mutate: (body: Record<string, unknown>) => void,
): Promise<{ page: Awaited<ReturnType<typeof bootPage>>; log: ReturnType<typeof newPageLog> }> {
  const log = newPageLog();
  gateChanges(log);
  const forward: PageFetch = forwardPage(world as never, log, 'controlled');
  const page = await bootPage({ name: 'Member', search, token: () => world.token,
    request: async (url, init, realFetch) => {
      const answer = await forward(url, init, realFetch);
      if (routeOf(url) !== route) return answer;
      const body = asRecord(await answer.clone().json().catch(() => null));
      mutate(body);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  return { page, log };
}

function platformIntent(run: Record<string, unknown>, kind: 'paused' | 'cancelled',
  status: 'applied' | 'superseded'): ControlIntentSnapshotV1 {
  const origin = status === 'superseded' ? 'platform_superseded' : 'platform_not_entered';
  return {
    schemaVersion: 1,
    ref: { aggregateType: 'ControlIntent', projectId: 'ag2b-collab-project',
      workspaceId: 'ag2b-collab-workspace', intentId: 'e3m-16-intent' },
    runRef: run as never,
    kind: kind === 'cancelled' ? 'cancel' : 'pause',
    desiredState: kind === 'cancelled' ? 'cancelled' : 'paused',
    reason: null, requestedAt: '2026-10-04T06:00:00.000Z',
    requestedBy: { kind: 'human', id: 'e3m-operator' },
    revision: 2, status,
    observation: status === 'superseded'
      ? { schemaVersion: 1, origin, kind: 'superseded_by_newer', runRevision: 4,
        detail: { supersededBy: { aggregateType: 'ControlIntent', projectId: 'ag2b-collab-project',
          workspaceId: 'ag2b-collab-workspace', intentId: 'e3m-16-newer' } },
        observedAt: '2026-10-04T06:00:01.000Z' }
      : { schemaVersion: 1, origin, kind, runRevision: 4, detail: { entryPhase: 'none' },
        observedAt: '2026-10-04T06:00:01.000Z' },
  } as ControlIntentSnapshotV1;
}

type WordCase = { name: string; intent: ControlIntentSnapshotV1 | null;
  expected: { word: string; settled: boolean } | null };

/** ①/②: one intent to one word (S1 5.1-1/2/4/6/9). */
function intentWordCases(): WordCase[] {
  const run = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' };
  const paused = platformIntent(run, 'paused', 'applied');
  const cancelled = platformIntent(run, 'cancelled', 'applied');
  const superseded = platformIntent(run, 'cancelled', 'superseded');
  const queuedPause = { ...paused, revision: 1, status: 'queued' as const,
    kind: 'pause' as const, desiredState: 'paused' as const, observation: undefined };
  return [
    { name: 'an applied pause the platform never entered', intent: paused,
      expected: { word: '已暂停（还没进入执行）', settled: true } },
    { name: 'an applied cancel the platform never entered', intent: cancelled,
      expected: { word: '已取消（未进入执行）', settled: true } },
    { name: 'a superseded intent with a newer control', intent: superseded,
      expected: { word: '已被较新的控制取代', settled: true } },
    { name: 'a superseded intent whose Run ended first',
      intent: { ...superseded, observation: { ...asRecord(superseded.observation),
        kind: 'terminal_without_cancel' } } as never,
      expected: { word: '未生效（执行先结束）', settled: true } },
    { name: 'an outcome-unknown intent', intent: { ...superseded, status: 'outcome_unknown' } as never,
      expected: { word: '待核对', settled: true } },
    { name: 'a queued pause', intent: queuedPause as never,
      expected: { word: '已请求暂停，等安全点', settled: false } },
    { name: 'an applied pause whose observation is an entered pause',
      intent: { ...paused, observation: { schemaVersion: 1, kind: 'paused', detail: { entryPhase: 'none' },
        runRevision: 4, observedAt: '2026-10-04T06:00:01.000Z' } } as never,
      expected: null },
  ];
}

const startupNav = {
  goals: [{ goalId: 'e3m-goal', ordinal: 1, objective: '第一个目标' }],
  tasks: { plan: { goalRef: { goalId: 'e3m-goal' } },
    tasks: [{ ref: { goalId: 'e3m-goal', taskId: 'e3m-task' }, definition: { title: '做一件事' } }] },
} as unknown as NavData;
const startupReport = {
  sessions: [], runs: [], queries: [], checks: [], controls: [], reviews: [],
  fanOut: [], interruptedGoals: [], problems: [],
  redriveGoals: [{ goalId: 'e3m-goal', taskIds: ['e3m-task'] }],
  lease: 'held_by_other', leaseRow: 'HL-04', resumeOnStartup: 'ask',
} as MemberStartupReport;

describe('E3M-16 8c the pure words', () => {
  it.each(intentWordCases())('S1 5.1-1/2/4/6/9 $name', ({ intent, expected }) => {
    expect(controlIntentWordOf(intent)).toEqual(expected);
  });

  it.each([
    ['cancelled', 'applied', '已取消（未进入执行）'],
    ['cancelled', 'superseded', '已被较新的控制取代'],
  ] as const)('S1 5.1-2/4 the head takes the settled control word (%s/%s)', async (kind, status, word) => {
    const w = await openMemberW4();
    scenarios.push(w.h);
    const intent = platformIntent(w.run as unknown as Record<string, unknown>, kind, status);
    const booted = await bootEdited(w.h.host, memberSearch('ag2b-goal', w.line), 'controls/read',
      (body) => { body.value = intent; });
    try {
      expect(headFact(booted.page.root, '状态')).toBe(word);
      expect(findClass(booted.page.root, 'mh-adv')).toBeUndefined();
    } finally {
      await booted.page.restore();
    }
  }, 240_000);

  it.each([
    ['the paused Run ended at the Host restart; continue the Task',
      '主机重启时已暂停，这次执行已经结束；点“继续”接着做这个任务。'],
    ['Run already ended', '这次执行已经结束，不能再暂停或取消。'],
    ['the yielded wait continuation was consumed the yielded wait continuation',
      '让出等待的接续已经被后面的执行用掉了，不能再控制它。'],
    ['the Run is not resumed while its Goal is not active', '目标没在进行，先在主对话的目标栏点继续。'],
    ['the Run is already fenced by a queued cancel', '已经请求取消，等它停下。'],
    ['the Run is already fenced by a queued pause', '已经请求暂停，等它停下。'],
    ['resume requires an applied pause', '它没有停在暂停上，不能继续。'],
    ['not fenced by a pause', '它没有停在暂停上，不能继续。'],
    ['something else entirely', '写入失败。'],
  ] as const)('S2 5.1-8 the control owner’s refusal %s', (reason, word) => {
    expect(controlWriteTextOf(new RouteReadError('controls/submit', 'busy', reason))).toBe(word);
  });

  it.each([
    ['a paused line with a decide attention', { own: 'paused', attention: { code: 'decide',
      reason: { code: 'card', params: {}, refs: [] } }, ownReason: { code: 'paused_by_you', params: {}, refs: [] },
    markers: [] }, { word: '等你决定', railWord: '已暂停 · 等你决定' }],
    ['a retired line with an unknown attention', { own: 'retired', attention: { code: 'unknown',
      reason: { code: 'retired_turn_open', params: {}, refs: [] } },
    ownReason: { code: 'retired_turn_open', params: {}, refs: [] }, markers: [] },
    { word: '待核对', railWord: '已退役 · 待核对' }],
    ['a paused line interrupted by a Host restart', { own: 'paused', attention: null,
      ownReason: { code: 'paused_interrupted', params: { by: 'you', goal: 'active' }, refs: [] }, markers: [] },
    { word: '已暂停', railWord: '已暂停 · 主机重启时已暂停，可继续' }],
    ['a working line with a queued stop', { own: 'working', attention: null,
      ownReason: { code: 'running_task', params: { task: 't' }, refs: [] },
      markers: [{ kind: 'stop_pending', intentRef: {} }] },
    { word: '工作中', railWord: '工作中 · 停止中' }],
    ['a working line archiving while it waits for its Run to stop', { own: 'working', attention: null,
      ownReason: { code: 'running_task', params: { task: 't' }, refs: [] },
      markers: [{ kind: 'archiving', archiveRequestId: 'a', waitingForStop: true }] },
    { word: '归档中', railWord: '归档中 · 停止中' }],
    ['an unknown line with no attention', { own: 'unknown', attention: { code: 'unknown',
      reason: { code: 'run_outcome_unknown', params: {}, refs: [] } },
    ownReason: { code: 'unknown_run', params: {}, refs: [] }, markers: [] },
    { word: '待核对', railWord: '待核对' }],
  ] as const)('S4 two segments and stops: %s', (_name, status, expected) => {
    expect(lineStatusView(status)).toMatchObject(expected);
  });

  it.each([
    ['the broken lock file names no other Host', startupReport, (view: ReturnType<typeof startupViewOf>) => {
      expect(view.groups.find((group) => group.label === '这台主机')?.rows.map((row) => row.text))
        .toEqual(['锁文件损坏：确认没有别的进程后删除项目库目录里的 host-instance.lock']);
    }],
    ['ask says the person continues it', startupReport, (view: ReturnType<typeof startupViewOf>) => {
      expect(view.groups.find((group) => group.label === '重新驱动')?.rows.map((row) => row.text))
        .toEqual(['不自动继续（问我：等你点继续）', '目标 1 · 第一个目标']);
    }],
    ['no row carries the Goal id', startupReport, (view: ReturnType<typeof startupViewOf>) => {
      expect(JSON.stringify(view)).not.toContain('e3m-goal');
    }],
    ['auto says the Host continues the selected task',
      { ...startupReport, lease: 'owned', resumeOnStartup: 'auto' },
      (view: ReturnType<typeof startupViewOf>) => {
        expect(view.groups.find((group) => group.label === '重新驱动')?.rows.map((row) => row.text))
          .toEqual(['启动后自动继续：目标 1 · 第一个目标（做一件事）']);
      }],
    ['the interrupted Goals say their codes in words',
      { ...startupReport, interruptedGoals: [
        { goalId: 'e3m-goal', taskIds: ['e3m-task'], runRefs: 1, close: 'clean', status: 'recorded' },
        { goalId: 'e3m-goal', taskIds: ['e3m-task'], runRefs: 1, close: 'unclean', status: 'kept' },
        { goalId: 'e3m-goal', taskIds: ['e3m-task'], runRefs: 1, close: 'clean', status: 'driven' },
      ] },
      (view: ReturnType<typeof startupViewOf>) => {
        expect(view.groups.find((group) => group.label === '被中断的目标')?.rows.map((row) => row.text))
          .toEqual([
            '目标 1 · 第一个目标 · 已记下，等你继续 · 上次正常关闭 · 任务 做一件事 · 执行 1',
            '目标 1 · 第一个目标 · 沿用已记下的 · 上次没有正常关闭 · 任务 做一件事 · 执行 1',
            '目标 1 · 第一个目标 · 已自动继续 · 上次正常关闭 · 任务 做一件事 · 执行 1',
          ]);
      }],
    ['an unknown interrupted code says it is unchecked',
      { ...startupReport, interruptedGoals: [
        { goalId: 'e3m-goal', taskIds: ['e3m-task'], runRefs: 1, close: 'clean', status: 'mystery' },
      ] },
      (view: ReturnType<typeof startupViewOf>) => {
        expect(view.groups.find((group) => group.label === '被中断的目标')?.rows.map((row) => row.text))
          .toEqual(['目标 1 · 第一个目标 · 待核对 · 上次正常关闭 · 任务 做一件事 · 执行 1']);
        expect(JSON.stringify(view)).not.toContain('mystery');
      }],
  ] as const)('S5 the start-up rows: %s', (_name, report, check) => {
    check(startupViewOf(report as MemberStartupReport, null, startupNav));
  });

  it('S5 the missing-result words the Query attestation uses', () => {
    expect(queryUnknownTextOf({ kind: 'unresolved_tools', toolCallIds: ['a', 'b'] })).toBe('还有 2 个工具调用没有结果');
    expect(queryUnknownTextOf({ kind: 'kernel_unreadable', verdict: 'damaged' })).toBe('执行记录损坏');
  });
});

describe('E3M-16 8c the page', () => {
  it('S3 5.6-4/5 a paused-interrupted Task offers only 继续, which sends one tasks/requeue', async () => {
    const w = await openMemberW4();
    scenarios.push(w.h);
    await w.h.restart({ crash: true });
    const booted = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      const bar = acts(booted.page.root);
      expect(buttonText(bar, '继续')).toBeDefined();
      expect(buttonText(bar, '暂停')).toBeUndefined();
      expect(buttonText(bar, '取消')).toBeUndefined();
      expect(buttonText(bar, '重新入队')).toBeUndefined();
      const row = asRecord(asRecord(callsOf(booted.log, 'lines/read')[0]?.reply).value).row;
      const control = (Array.isArray(asRecord(row).controls) ? asRecord(row).controls as unknown[] : [])
        .map(asRecord).find((entry) => entry.kind === 'continue' && entry.availability === 'available');
      expect(control, 'the 继续 control').toBeDefined();
      press(buttonText(bar, '继续'), '继续');
      await settle(() => callsOf(booted.log, 'tasks/requeue').length > 0, 5_000);
      const calls = callsOf(booted.log, 'tasks/requeue');
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.input).toEqual({ taskRef: asRecord(control!.target).task,
        afterRunRef: asRecord(control!.target).runRef, reason: '在工作线页面点继续' });
      expect(metaOf(call).expected).toEqual(control!.pins);
      expect(callsOf(booted.log, 'controls/submit')).toHaveLength(0);
    } finally {
      await booted.page.restore();
    }
  }, 240_000);

  it('S4 the unknown line’s rail word is one half and its card says why', async () => {
    const h = await openUnknownWorld();
    scenarios.push(h);
    const line = await workLineOf(h);
    const booted = await bootMemberOnHost(h, memberSearch('ag2b-goal', line));
    try {
      const row = lineRows(booted.page.root).find((entry) =>
        textOf(findClass(entry, 'row-sub')).includes('待核对'));
      expect(row, 'the unknown line row').toBeDefined();
      /* This world's line is retired (its Session cannot be read) with an unknown
         attention: two segments, not the sheet's guessed `待核对`. */
      expect(textOf(findClass(row!, 'row-sub'))).toBe('已退役 · 待核对');
      const button = elementsOf(row, 'button')[0];
      expect(button, 'the line row button').toBeDefined();
      hover(button!);
      await settle(() => elementsOf(booted.page.root, 'div', 'hcard').some((card) =>
        textOf(card).includes('执行结果待核对')), 2_000);
      const card = elementsOf(booted.page.root, 'div', 'hcard').find((entry) =>
        textOf(entry).includes('执行结果待核对'));
      expect(card, 'the line card').toBeDefined();
      expect(textOf(card)).toContain('原因');
    } finally {
      await booted.page.restore();
    }
  }, 240_000);

  it('S4 P12-5 an archiving line waits on its Run as 归档中 · 停止中', async () => {
    const w = await openMemberS7C({ firstRun: 'held' });
    try {
      const booted = await bootEdited(w.s7c.world, memberSearch('s7c-goal', w.module), 'lines/list', (body) => {
        const rows = Array.isArray(asRecord(body.value).rows) ? asRecord(body.value).rows as unknown[] : [];
        const row = rows.map(asRecord).find((entry) => asRecord(entry.key).sessionId === w.module.sessionId);
        if (row !== undefined) asRecord(row.status).markers = [
          { kind: 'archiving', archiveRequestId: 'e3m-16-arch', waitingForStop: true }];
      });
      try {
        const row = await railRowOf(booted.page.root, w.s7c.world, w.module);
        expect(textOf(findClass(row!, 'row-sub'))).toBe('归档中 · 停止中');
      } finally {
        await booted.page.restore();
      }
    } finally {
      await w.s7c.close();
    }
  }, 240_000);

  it.each([
    ['a failed line', async () => {
      const w3 = await openMemberW3();
      /* The notices world's line carries a decide attention (the automatic
         rework cards), so forward its row's attention to the failed one the
         row names; the rail word and its class still come from the source. */
      const booted = await bootEdited(w3.world, memberSearch('ag2b-goal', w3.worker.ref), 'lines/list', (body) => {
        const rows = Array.isArray(asRecord(body.value).rows) ? asRecord(body.value).rows as unknown[] : [];
        const row = rows.map(asRecord).find((entry) =>
          asRecord(entry.key).sessionId === w3.worker.ref.sessionId);
        if (row !== undefined) asRecord(row.status).attention = {
          code: 'failed', reason: { code: 'run_failed', params: {}, refs: [] } };
      });
      try {
        const row = lineRows(booted.page.root).find((entry) =>
          textOf(findClass(entry, 'row-sub')) === '待命 · 停下（失败）');
        expect(row, 'the failed line row').toBeDefined();
        const sub = findClass(row!, 'row-sub');
        expect(textOf(sub)).toBe('待命 · 停下（失败）');
        const button = elementsOf(row, 'button')[0];
        expect(button, 'the line row button').toBeDefined();
        hover(button!);
        await settle(() => findClass(row!, 'hcard') !== undefined);
        const card = findClass(row!, 'hcard');
        expect(card, 'the line card').toBeDefined();
        const state = findClass(card!, 'hc-state');
        expect(state, 'the card’s state line').toBeDefined();
        const word = elementsOf(state, 'span')[0];
        expect(textOf(word)).toBe('停下（失败）');
        expect(hasClass(word!, 'tx-failed')).toBe(true);
      } finally {
        await booted.page.restore();
        await w3.close();
      }
    }],
    ['a paused-interrupted line', async () => {
      const w = await openMemberW4();
      scenarios.push(w.h);
      await w.h.restart({ crash: true });
      const booted = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
      try {
        const row = lineRows(booted.page.root).find((entry) =>
          textOf(findClass(entry, 'row-sub')) === '已暂停 · 主机重启时已暂停，可继续');
        expect(row, 'the paused line row').toBeDefined();
        const button = elementsOf(row, 'button')[0];
        expect(button, 'the line row button').toBeDefined();
        hover(button!);
        await settle(() => findClass(row!, 'hcard') !== undefined, 2_000);
        const card = findClass(row!, 'hcard');
        expect(card, 'the line card').toBeDefined();
        const state = findClass(card!, 'hc-state');
        expect(state, 'the card’s state line').toBeDefined();
        expect(textOf(elementsOf(state, 'span')[0])).toBe('已暂停');
      } finally {
        await booted.page.restore();
      }
    }],
  ] as const)('S4 the rail’s two-segment word and its card: %s', (_name, run) => run(), 240_000);

  it('S6 5.6-11 the head’s 认定结果 sends one resolve-unknown with the reason', async () => {
    const h = await openUnknownWorld();
    scenarios.push(h);
    const line = await workLineOf(h);
    const booted = await bootMemberOnHost(h, memberSearch('ag2b-goal', line));
    try {
      const row = asRecord(asRecord(callsOf(booted.log, 'lines/read')[0]?.reply).value).row;
      const control = (Array.isArray(asRecord(row).controls) ? asRecord(row).controls as unknown[] : [])
        .map(asRecord).find((entry) => entry.kind === 'attest_unknown');
      expect(control, 'the 认定结果 control').toBeDefined();
      press(buttonText(acts(booted.page.root), '认定结果'), '认定结果');
      await settle(() => findClass(booted.page.root, 'decision') !== undefined, 2_000);
      const card = findClass(booted.page.root, 'decision')!;
      const box = findElement(card, (element) => element.getAttribute('id') === 'member-attest')!;
      const go = buttonText(card, '认定执行已中断');
      expect(box, 'the required reason box').toBeDefined();
      expect(go, 'the confirm button').toBeDefined();
      expect(go!.getAttribute('aria-disabled')).toBe('true');
      box.value = '看过改动，按中断处理';
      box.dispatch('input', { target: box, currentTarget: box });
      expect(go!.getAttribute('aria-disabled')).toBe('false');
      press(go, '认定执行已中断');
      await settle(() => callsOf(booted.log, 'executions/resolve-unknown').length > 0, 8_000);
      const calls = callsOf(booted.log, 'executions/resolve-unknown');
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.input).toEqual({ runRef: asRecord(control!.target).runRef, reason: '看过改动，按中断处理' });
      expect(metaOf(call).expected).toEqual(control!.pins);
    } finally {
      await booted.page.restore();
    }
  }, 240_000);

  it.each([
    ['committed', false],
    ['a rejected write', true],
  ] as const)('S6 5.6-11 a QueryRun’s unknown result is attested through queries/resolve-unknown: %s', async (_case, rejected) => {
    const root = await tempDir('e3m16-ws-');
    const database = await tempDir('e3m16-db-');
    const publicDir = await publicDirectory();
    const reached = deferred();
    const hold = deferred();
    const first = await startAG2bHost(publicDir, { root, database,
      queryReplies: [{ kind: 'text', text: 'E3M-16: never answered' }],
      queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
    let inFlight: Promise<unknown> = Promise.resolve();
    let session: Awaited<ReturnType<typeof createAG2bSession>> | undefined;
    let refs: Awaited<ReturnType<typeof claimBusyQuery>> | undefined;
    try {
      await seedAG2bWorkGraph(first);
      session = await createAG2bSession(first, 'e3m16-session');
      refs = await claimBusyQuery(first, session, 'e3m16');
      inFlight = startBusyQuery(first, refs, 'e3m16').catch(() => undefined);
      await reached.promise;
      await writeStaleLock(database);
      await moveKernelAside(database);
    } catch (error) {
      hold.reject(new Error('E3M-16 Query setup failed'));
      await inFlight;
      await first.host.close();
      throw error;
    }
    const second = await startAG2bHost(publicDir, { root, database });
    try {
      if (session === undefined || refs === undefined) throw new Error('the Query setup must have run');
      const list = await post<ReadResult<WorkLineListV1>>(second, 'lines/list',
        plain(AG2B_SCOPE, { workspace: AG2B_SCOPE }));
      if (list.status !== 'ready') throw new Error('the Query line list must be readable');
      const row = list.value.rows.find((entry) => entry.key.sessionId === session!.sessionRef.sessionId);
      const control = row?.controls.find((entry) => entry.kind === 'attest_unknown');
      expect(control, 'the Query attest_unknown control').toMatchObject({
        availability: 'available', route: 'queries/resolve-unknown', target: { queryRunRef: refs.queryRunRef } });
      const search = memberSearch('ag2b-goal', session.sessionRef);
      const booted = rejected
        ? await bootEdited(second, search, 'queries/resolve-unknown', (body) => {
          Object.assign(body, { status: 'rejected', code: 'unavailable', reason: 'E3M-16: the attest write failed' });
        })
        : await bootMemberAt(second, search);
      try {
        expect(textOf(booted.page.root)).toContain('认定结果');
        press(buttonText(findClass(booted.page.root, 'mh-acts'), '认定结果'), '认定结果');
        await settle(() => findClass(booted.page.root, 'decision') !== undefined, 2_000);
        const card = findClass(booted.page.root, 'decision')!;
        expect(textOf(card)).toContain('执行记录缺失');
        const box = findElement(card, (element) => element.getAttribute('id') === 'member-attest')!;
        const go = buttonText(card, '认定这一轮已中断');
        expect(box, 'the required reason box').toBeDefined();
        expect(go, 'the confirm button').toBeDefined();
        expect(go!.getAttribute('aria-disabled')).toBe('true');
        box.value = '看过执行记录，按中断处理';
        box.dispatch('input', { target: box, currentTarget: box });
        expect(go!.getAttribute('aria-disabled')).toBe('false');
        press(go, '认定这一轮已中断');
        /* The page log holds the call from the moment it is sent; wait for its answer, not only its start. */
        await settle(() => callsOf(booted.log, 'queries/resolve-unknown').some((call) => call.reply !== undefined), 8_000);
        const calls = callsOf(booted.log, 'queries/resolve-unknown');
        expect(calls).toHaveLength(1);
        const call = calls[0]!;
        expect(call.input).toEqual({ queryRunRef: refs.queryRunRef, reason: '看过执行记录，按中断处理' });
        expect(metaOf(call).expected).toEqual(control!.pins);
        if (rejected) {
          await settle(() => textOf(findClass(booted.page.root, 'decision')).includes('暂时读不到执行记录，稍后重试。'));
          const kept = findClass(booted.page.root, 'decision');
          expect(kept, 'the card stays open').toBeDefined();
          expect(textOf(kept!)).toContain('暂时读不到执行记录，稍后重试。');
        } else {
          expect(asRecord(call.reply).status).toBe('committed');
          expect((await readQuery(second, refs.queryJobRef)).run.run.executionState?.phase).toBe('settled');
        }
      } finally {
        await booted.page.restore();
      }
    } finally {
      hold.reject(new Error('E3M-16 Query cleanup'));
      await inFlight;
      await second.host.close();
      await first.host.close().catch(() => undefined);
    }
  }, 300_000);

  it('S7 a waiting head’s card names the recipient line; every page read asks sessions/facts once', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', secretaryWork: true });
    try {
      const { session } = await world.makeWorkWaitingSecretary('e3m16');
      const booted = await bootMemberAt(world, memberSearch(S6A_GOAL_1.goalId, session.ref));
      try {
        const button = findClass(booted.page.root, 'mh-adv')!;
        expect(textOf(button)).toBe('等回复');
        hover(button);
        await settle(() => findClass(booted.page.root, 'hcard') !== undefined, 2_000);
        const card = findClass(booted.page.root, 'hcard')!;
        expect(textOf(card)).toContain('在等');
        expect(textOf(card)).toContain('回复');
        const facts = callsOf(booted.log, 'sessions/facts');
        expect(facts).toHaveLength(1);
        for (const call of facts) expect(call.input).toEqual(session.ref);
      } finally {
        await booted.page.restore();
      }
    } finally {
      await world.close();
    }
  }, 240_000);
});
