import { afterAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { countRoute, textOf, thread, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  bootMemberAt, bootMemberOnHost, buttonText, callsOf, elementsOf, headFact, memberSearch,
  openMemberControlQueued, openMemberS7C, openMemberW4, press, settle, workLineOf, worldSlot,
} from './helpers/E3M-world.js';
import { bootDecide, callsOf as decideCalls, hostTarget, openCardWith, opened, stepConfirm, typeInto } from './helpers/E3D-page.js';
import { openUnknownWorld } from './helpers/E3D-world.js';
import { AG2B_SCOPE, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { post, readExecution } from '../helpers/A2-restart-fixture.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { asRecord, asText } from '../../src/ui/values.js';
import type { SubmittedControl } from '../../src/contracts/control-intent.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { HostScenario } from '../scenarios/harness.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3M-11 (CLKD package 8, rows P04-4/P05-3/P05-5/P14-6/P15-1/P15-5): the line
 * head's pending-control words, the Run row's terminal word after a cancel is
 * applied at a restart, a queued message that a level switch must not send, a
 * clean reopen that keeps the line and its Run, and the word after a person
 * attests an unknown Run. Expected words are the click table's and the frozen
 * prototype's; the page's own code is only used for selectors.
 */

const slot = worldSlot();
const scenarios: HostScenario[] = [];
afterAll(async () => {
  for (const h of scenarios.splice(0)) await h.dispose();
  await slot.close();
}, 240_000);

const headStatus = (root: FakeElement): FakeElement => findClass(root, 'mh-adv')!;
const acts = (root: FakeElement): FakeElement | undefined => findClass(root, 'mh-acts');
const msgTrack = (root: FakeElement, text: string): FakeElement | undefined => {
  const message = elementsOf(thread(root), 'div', 'msg-user').find((entry) => textOf(findClass(entry, 'bubble')) === text);
  return message === undefined ? undefined : findClass(message, 'deliv');
};

describe('E3M-11 the line head, restart and attestation', () => {
  it('P04-4 the head reads 已请求暂停，等安全点 while the pause is queued; its click writes nothing; 已暂停 after the safe point', async () => {
    const w = await openMemberControlQueued('pause');
    scenarios.push(w.h);
    const first = w.page;
    try {
      const adv = headStatus(first.root);
      expect(adv).toBeDefined();
      /* 具名改坏: `adaptMemberLine` 把 queued pause 的 `advText` 写成 `已暂停`；本句红。 */
      expect(textOf(adv)).toBe('已请求暂停，等安全点');
      expect(countRoute(w.log, 'controls/read')).toBe(1);
      const writes = (): number => ['controls/submit', 'tasks/requeue', 'messages/send', 'messages/apply']
        .reduce((count, route) => count + countRoute(w.log, route), 0);
      const before = writes();
      press(adv, 'line head pending pause');
      await settle(() => false, 300);
      /* 具名改坏: `arrive` 调 `controlLine('pause')`；本行的零写红（页面错：今天它是空操作）。 */
      expect(writes()).toBe(before);
      await w.done;
      await first.restore();
      const after = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
      try {
        expect(headFact(after.page.root, '状态')).toBe('已暂停');
        expect(buttonText(acts(after.page.root), '继续')).toBeDefined();
      } finally {
        await after.page.restore();
      }
    } finally {
      await first.restore().catch(() => undefined);
    }
  }, 180_000);

  it('P05-3 the cancelling line reads 停止中, then 已取消 after the safe point (page error, to fix)', async () => {
    const w = await openMemberControlQueued('cancel');
    scenarios.push(w.h);
    const first = w.page;
    try {
      /* The queued cancel keeps the line's working word and shows its advText.
         The click table's 停止中 is the prototype's 工作中
         (`docs/ui-reference/workbench-2026-10/Member.dc.html:1461`); 停止中
         exists only for `归档中 · 停止中` (`docs/UI-WORKBENCH.md:129`). */
      expect(textOf(headStatus(first.root))).toBe('已请求取消，等安全点');
      expect.soft(headFact(first.root, '状态')).toContain('工作中');
      await w.done;
      const delivered = await post<{ status?: string }>(w.h.host, 'controls/deliver',
        plain(AG2B_SCOPE, { intentRef: w.intent.ref }));
      expect(delivered.status).toBe('ready');
      const ended = await readExecution(w.h.host, w.run);
      expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled' });
      await first.restore();
      const after = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
      try {
        /* 具名改坏: 去掉 `cancelLanded`，applied 的取消仍走 advText；这一句红。 */
        expect.soft(headFact(after.page.root, '状态')).toContain('已取消');
      } finally {
        await after.page.restore();
      }
    } finally {
      await first.restore().catch(() => undefined);
      await w.done.catch(() => undefined);
    }
  }, 180_000);

  it('P05-5 a cancel queued on a paused Run applies at the restart and the Run row reads 已结束 · 已取消', async () => {
    const w = await openMemberW4();
    scenarios.push(w.h);
    const paused = await readExecution(w.h.host, w.run);
    const peer = await w.h.startPeer();
    const submitted = await post<WriteResult<SubmittedControl>>(peer,
      'controls/submit', graphWrite(AG2B_SCOPE, {
        runRef: w.run, kind: 'cancel', reason: 'CLKD P05-5: stop the paused Run',
      }, 'e3m-p05-cancel', [{ ref: w.run, revision: paused.run.revision }]));
    expect(submitted.status).toBe('committed');
    if (submitted.status !== 'committed') throw new Error('P05-5: the cancel was not committed');
    expect(submitted.value.intent.status).toBe('queued');
    const report = await w.h.restart({ crash: true });
    expect(report.report?.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 'W-12', status: 'reconciled', reason: 'paused_stop' }),
    ]));
    const ended = await readExecution(w.h.host, w.run);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled' });
    const booted = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      const run = elementsOf(thread(booted.page.root), 'button', 'run')[0];
      expect(run).toBeDefined();
      /* 具名改坏: Run 行不写 `runWordOf` 的结果（只写任务名）；本句红。 */
      expect(textOf(run)).toContain('已结束 · 已取消');
      expect(callsOf(booted.log, 'executions/read').filter((call) =>
        (call.input as { runId?: string }).runId === w.run.runId)).toHaveLength(1);
    } finally {
      await booted.page.restore();
    }
  }, 240_000);

  it('P14-6 switching the autonomy leaves an old queued message 已排队 and sends nothing', async () => {
    const w = await openMemberS7C({ firstRun: 'held', track: true });
    try {
      const goalRead = asRecord((await w.s7c.world.post('goals/read', plain(S6A_SCOPE, w.s7c.goal))).body);
      const readValue = asRecord(goalRead['value']);
      const revision = asRecord(readValue['goal'])['revision'] as number;
      const current = asText(asRecord(readValue['settings'])['autonomy']);
      const next = current === 'every_step' ? 'after_plan_confirmation' : 'every_step';
      const switched = asRecord((await w.s7c.world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
        goalRef: w.s7c.goal, autonomy: next, waitForGoalRef: null,
      }, 'e3m-p14-settings', [{ ref: w.s7c.goal, revision }]))).body);
      expect(switched['status']).toBe('committed');
      const booted = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
      try {
        const track = msgTrack(booted.page.root, 'E3M track message');
        expect(track).toBeDefined();
        expect(textOf(findClass(track!, 'on'))).toBe('已排队');
        const before = countRoute(booted.log, 'messages/apply') + countRoute(booted.log, 'messages/send');
        press(track, '.deliv');
        await settle(() => countRoute(booted.log, 'messages/apply') + countRoute(booted.log, 'messages/send') > before, 300);
        /* 具名改坏: 切档后的读把旧消息交付出去；本行的零写红。 */
        expect(countRoute(booted.log, 'messages/apply') + countRoute(booted.log, 'messages/send')).toBe(before);
        expect(textOf(findClass(track!, 'on'))).toBe('已排队');
      } finally {
        await booted.page.restore();
      }
    } finally {
      await w.s7c.close();
    }
  }, 180_000);

  it('P15-1 a clean reopen keeps the line and its Run, and the Member page shows the startup report', async () => {
    const w = await openS7C1World({ backend: 'sqlite' });
    try {
      const line = w.lines.module.ref;
      const before = await bootMemberAt(w.world, memberSearch('s7c-goal', line));
      let beforeRun = '';
      try {
        beforeRun = textOf(elementsOf(thread(before.page.root), 'button', 'run')[0]);
        expect(beforeRun).toContain('已结束');
      } finally {
        await before.page.restore();
      }
      await w.reopen();
      const report = asRecord((await w.world.post('host/reconcile-report', plain(S6A_SCOPE, {}))).body);
      expect(report['status']).toBe('ready');
      const startup = asRecord(asRecord(report['value'])['report']);
      for (const key of ['sessions', 'runs', 'queries', 'checks', 'controls', 'reviews', 'interruptedGoals']) {
        expect(Array.isArray(startup[key]), key).toBe(true);
      }
      const after = await bootMemberAt(w.world, memberSearch('s7c-goal', line));
      try {
        const afterRun = textOf(elementsOf(thread(after.page.root), 'button', 'run')[0]);
        expect(afterRun).toBe(beforeRun);
        expect(headFact(after.page.root, '状态')).not.toBe('');
        /* 具名改坏: Member 不读 `host/reconcile-report`、不画启动核对段；冻结的看什么要报告列出每步 ref/row/status/reason，这一句红（页面错，待修）。 */
        expect.soft(textOf(after.page.root)).toContain('启动核对');
      } finally {
        await after.page.restore();
      }
    } finally {
      await w.close();
    }
  }, 240_000);

  it('P15-5 after a person attests an unknown Run, the Run row reads 中断 (crashed) and the Task 失败', async () => {
    const h = await openUnknownWorld();
    scenarios.push(h);
    const line = await workLineOf(h);
    const unknown = await h.taskRow();
    if (unknown.execution === null) throw new Error('P15-5: the unknown Run is not selected');
    const runRef = unknown.execution;
    const decide = await bootDecide(hostTarget(h));
    try {
      await opened(decide.log);
      const card = await openCardWith(decide.page.root, '核对未知结果');
      expect(card).toBeDefined();
      click(card!);
      await waitFor(() => stepConfirm(decide.page.root) !== undefined, 5_000);
      typeInto(decide.page.root, 'dc-reason', '看过改动，按中断处理');
      click(stepConfirm(decide.page.root)!);
      await waitFor(() => decideCalls(decide.log, 'executions/resolve-unknown')
        .some((call) => call.reply !== undefined), 8_000);
      expect(decideCalls(decide.log, 'executions/resolve-unknown').at(-1)?.reply).toMatchObject({ status: 'committed' });
    } finally {
      await decide.page.restore();
    }
    const ended = await readExecution(h.host, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'human_attested' } } });
    expect((await h.taskRow()).effectivePhase).toBe('failed');
    const booted = await bootMemberOnHost(h, memberSearch('ag2b-goal', line));
    try {
      /* 具名改坏: `OUTCOME_WORD.crashed` 写成“失败”；Run 行这一句红。 */
      expect(textOf(elementsOf(thread(booted.page.root), 'button', 'run')[0])).toContain('已结束 · 中断');
      /* 具名改坏: 任务组头不读任务状态词；这一句红。 */
      expect(textOf(findClass(findClass(booted.page.root, 'sgh')!, 'w'))).toBe('失败');
      expect(callsOf(booted.log, 'executions/read').length).toBeGreaterThanOrEqual(1);
    } finally {
      await booted.page.restore();
    }
  }, 240_000);
});
