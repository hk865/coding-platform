/**
 * PL-14 (v3 §9-14, §5.8, C-35/PLT-16): one `plan_notice` when a stage's
 * required work and stage gate are satisfied and the gate round is finalized,
 * with the six readings and the gate round's `since` as `position`; a second
 * read does not append; the next stage is not blocked.
 *
 * The world is the real one: a real work line (`createS6BLine`), the public
 * `plans/propose` + `plans/apply`, the Workflow driving the stage work and then
 * the stage gate through `advanceGate` (an explicit `taskId` never advances a
 * gate), the next stage's real `refine:` round answered on the adviser line,
 * and both public notice entry points (`main/read` and `decisions/queue`).
 *
 * The stage gate and the notice registration are P4/P5/L wiring; where this
 * tree still lacks a symbol the row stops there instead of falling back to a
 * read-only notice or a manual adoption. A failed gate-round read is asserted
 * as `unavailable`, never folded into an empty list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  systemRoundRequestId, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { S2B_ROUND_BY_GOAL_LOOKUP } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { advanceUntil, driveWorkflow, post } from '../helpers/A2-restart-fixture.js';
import { awaitPlanningAnswer } from '../helpers/IV-host-fixture.js';
import {
  createS6BLine, lineBinding, openPLTaskbookWorld, twoStageDraft, type PLTaskbookWorld,
} from '../helpers/PL-taskbook-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { checkConfiguration, sessionOf } from '../helpers/S7A-fixture.js';
import { assignGoalAdviserLine } from '../helpers/S7C-handoff-fixture.js';

// The gate-round read fault sits on the real record-store boundary (A2/A4):
// `S2B_ROUND_BY_GOAL_LOOKUP` is the ordered lookup the notice source uses for
// the stage gate's finalized round.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const ADVISER_ROLE = platformRoleProfile('adviser').template;

afterEach(() => {
  expect(commitBarrier.reset()).toEqual([]);
});

type Adopted = Awaited<ReturnType<PLTaskbookWorld['adopt']>>;

/**
 * The real first segment and its stage gate, up to and including the gate's
 * committed `open_checks` receipt. The caller closes the world.
 */
async function openGatedWorld(reply: { usage?: ReturnType<typeof usageOf> } = { usage: usageOf(100) },
  options: { checks?: TrustedCheckConfiguration; isolation?: boolean;
    beforeWork?: (world: PLTaskbookWorld) => Promise<void>;
    between?: (world: PLTaskbookWorld) => Promise<void> } = {}): Promise<{
  world: PLTaskbookWorld;
  adopted: Adopted;
  gateReceipts: WorkflowStepReceipt[];
  line: Awaited<ReturnType<typeof createS6BLine>>;
}> {
  const world = await openPLTaskbookWorld({ extraBindings: [
    lineBinding('pl14-adviser-binding', ADVISER_ROLE, 'PL-14 trusted adviser guidance'),
  ], ...(options.checks === undefined ? {} : { checks: options.checks }),
  ...(options.isolation === undefined ? {} : { isolation: options.isolation }) });
  try {
    const adopted = await world.adopt({ label: 'pl14', draft: twoStageDraft(world.goal, 'pl-14') });
    // The real line responsible for the stage's work and its stage gate. The two
    // triples are the plan's own task ids, not a copy of the work task.
    const work = world.tasks[0]!;
    const gateTask = { projectId: work.projectId, goalId: work.goalId, taskId: 'stage-gate' };
    const line = await createS6BLine(world.main, {
      label: 'pl14', role: S6A_WORK_ROLE, tasks: [work, gateTask],
    });
    const session = await sessionOf(world.world, line);

    if (options.beforeWork !== undefined) await options.beforeWork(world);
    // The real Workflow performs the stage work, then — with no explicit
    // taskId — its selection reaches `advanceGate`, which finalizes the real
    // stage-gate VerificationRound. One request with input 100 and output 0
    // gives the hand-computed stage reading below.
    await world.world.scripted.script(session, [
      { kind: 'text', text: 'stage one work done', ...reply },
    ]);
    await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
      flowId: 'pl14-work', sessionHint: line.ref, kind: 'select_work', taskId: 'stage-work' });
    if (options.between !== undefined) await options.between(world);
    const gateReceipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
      flowId: 'pl14-gate', sessionHint: line.ref, kind: 'select_work' }, { receipts: gateReceipts });
    return { world, adopted, gateReceipts, line };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

describe('PL-14: stage end notice', () => {
  it('one stage-end item per entry point with the gate round position, no duplicate on re-read', async () => {
    const { world, adopted, gateReceipts, line } = await openGatedWorld();
    try {
      expect(adopted.plan.stages.map(stage => stage.stageId)).toEqual(['stage-one', 'stage-two']);
      expect(adopted.plan.tasks.map(task => task.taskId)).toEqual(
        expect.arrayContaining(['stage-work', 'stage-gate', 'stage-next']));
      const gate = adopted.plan.tasks.find(task => task.taskId === 'stage-gate');
      expect(gate?.taskKind).toBe('gate');
      expect(gate?.scope).toEqual({ kind: 'stage', stageId: 'stage-one' });
      const next = adopted.plan.tasks.find(task => task.taskId === 'stage-next');
      expect(next?.executionIntent).toBe('plan_only');
      expect(next?.sizeClass).toBe('medium');

      // P6R-04: the real gate advance's returned steps carry the committed
      // `open_checks` receipt for `stage-gate`; its creation-commit cursor is
      // exactly the round's `since` and therefore the notice position.
      const opened = gateReceipts.find(receipt => receipt.kind === 'open_checks'
        && receipt.result.status === 'committed'
        && receipt.result.value.subject.taskId === 'stage-gate');
      if (opened === undefined || opened.kind !== 'open_checks' || opened.result.status !== 'committed') {
        throw new Error('UNPROVEN PL-14 position: the real gate advance returned no committed `open_checks` '
          + 'receipt for `stage-gate`; the gate step / round creation is missing '
          + '(owner: P4, src/business/workflow/workflow.ts:2507).');
      }

      // P6-07: each of the two public entry points returns exactly one item, and
      // the two items are the same notification (same `itemKey`), never one
      // merged list of the two reads.
      const itemKey = `stage-end:${adopted.plan.planId}:1:stage-one`;
      const first = await world.readNotices();
      const mainItems = first.main.filter(item => item['category'] === 'plan_notice');
      const queueItems = first.queue.filter(item => item['category'] === 'plan_notice');
      expect(mainItems).toHaveLength(1);
      expect(queueItems).toHaveLength(1);
      expect(mainItems[0]?.['itemKey']).toBe(queueItems[0]?.['itemKey']);
      expect(mainItems[0]?.['itemKey']).toBe(itemKey);
      // Six hand-computed readings: one Run with input 100/output 0, no edits,
      // one completed work task, no replacement, no rework, next class medium.
      expect(String(mainItems[0]?.['summary'])).toBe(
        '阶段 stage-one 结束 · token 100 · 增长 0 · 行数 0 行 · 已完成 stage-work · 已替代 无'
        + ' · 返工 0 次 · 下一阶段档位 medium');
      const position = mainItems[0]?.['position'] as Record<string, unknown>;
      expect(position['kind']).toBe('commit');
      expect(position['cursor']).toBe(opened.result.cursor);

      // P6R-05: the notice does not block the next stage. The Goal selection
      // sends the real `refine:` round for `stage-two`, the Host planning
      // consumption answers it on the adviser line, and the round's public
      // Query is the observed progress (not merely "the advance returned").
      // L33: the gate advance already allocated the Goal an adviser (a platform line); the round goes to that line.
      const linked = (await world.world.post('sessions/find', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
        target: { kind: 'goal', ref: world.goal }, includeArchived: false, page: { limit: 100 } })))
        .body as { status: string; value: { items: SessionCard[] } };
      const advisers = linked.value.items.filter(card => card.links.some(link => link.until === null
        && link.ref.relation === 'responsible' && link.ref.target.kind === 'goal'
        && link.ref.target.ref.goalId === world.goal.goalId));
      expect(advisers).toHaveLength(1);
      const allocated = advisers[0]!.record;
      const adviser: S6ASession = { label: 'pl14-adviser',
        ref: { projectId: allocated.ref.projectId, sessionId: allocated.ref.sessionId }, aggregateRef: allocated.ref,
        role: structuredClone(allocated.role), createdAt: allocated.createdAt };
      await world.world.scripted.script(adviser, [
        { kind: 'text', text: 'PL-14 stage two refine acknowledged' },
      ]);
      const nextSteps = await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
        flowId: 'pl14-next', sessionHint: line.ref, kind: 'select_work' });
      let refineRound: SystemRoundV1 | undefined;
      for (const step of nextSteps) {
        const candidate = step.next;
        if (candidate?.kind !== 'perform' || candidate.operation.kind !== 'send_system_round') continue;
        if (candidate.operation.request.round.kind !== 'refine') continue;
        refineRound = candidate.operation.request.round;
        break;
      }
      if (refineRound === undefined) {
        throw new Error('UNPROVEN PL-14 next stage: the Goal selection sent no `refine:` round for the '
          + 'second stage; the plan loop / `send_system_round` arm is missing '
          + '(owner: P4, src/business/workflow/workflow.ts:1932–:1940).');
      }
      expect(refineRound).toMatchObject({
        kind: 'refine', target: { kind: 'stage', stageId: 'stage-two' }, planRevision: 1,
      });
      const requestId = systemRoundRequestId(refineRound);
      if (requestId.status !== 'ready') throw new Error(`PL-14: the refine request id is invalid: ${requestId.reason}`);
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (messageRef.status !== 'ready') throw new Error(`PL-14: the refine message ref is invalid: ${messageRef.reason}`);
      const answer = await awaitPlanningAnswer(world.world, messageRef.value);
      if (answer === null) {
        throw new Error('UNPROVEN PL-14 next stage: the adviser line never answered the refine round; '
          + 'the Host planning consumption is missing (owner: P2/L, src/app/host.ts; src/app/system-round.ts).');
      }
      expect(answer.job.job.status).toBe('answered');

      const second = await world.readNotices();
      expect(second.main.filter(item => item['category'] === 'plan_notice').map(item => item['itemKey']))
        .toEqual([itemKey]);
      expect(second.queue.filter(item => item['category'] === 'plan_notice').map(item => item['itemKey']))
        .toEqual([itemKey]);

      // The next stage is not blocked by the notice: no extra card, no stop.
      expect((await world.main.readCards(world.goal)).filter(card => card.closedReason === null)).toHaveLength(0);
    } finally {
      await world.close();
    }
  });

  it('a Run with no reported usage reaches the notice marked, never as a complete zero', async () => {
    const { world } = await openGatedWorld({});
    try {
      const notices = (await world.readNotices()).main.filter(item => item['category'] === 'plan_notice');
      expect(notices).toHaveLength(1);
      // Spec 13.2.3: the tokens are "at least" and the growth is not written as a complete zero.
      const summary = String(notices[0]?.['summary']);
      expect(summary.startsWith('阶段 stage-one 结束 · token 至少 0，不全 · 增长 '), summary).toBe(true);
      expect(summary).toContain('增长 不全');
      expect(summary).not.toContain('增长 0 ·');
      expect(summary.endsWith(' · 行数 0 行 · 已完成 stage-work · 已替代 无 · 返工 0 次 · 下一阶段档位 medium'), summary)
        .toBe(true);
    } finally {
      await world.close();
    }
  });

  it('a failed gate-round read is unavailable, never an empty notice list', async () => {
    const { world } = await openGatedWorld();
    try {
      const fault = commitBarrier.failReads(S2B_ROUND_BY_GOAL_LOOKUP, 'throw-always');
      try {
        const main = await world.main.route('main/read', { goalId: world.goal.goalId, cursor: null });
        expect(main).toMatchObject({ status: 'rejected', code: 'unavailable' });
        const queue = await world.main.route('decisions/queue', {
          workspace: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
          goalRef: world.goal, sections: ['notices'], page: { limit: 100 },
        });
        expect(queue).toMatchObject({ status: 'rejected', code: 'unavailable' });
        // The fault really hit the gate-round ordered lookup, not an unrelated read.
        expect(fault.calls()).toBeGreaterThan(0);
      } finally {
        fault.release();
      }
    } finally {
      await world.close();
    }
  });

  it('a gate stopped at the reverify cap still makes the adviser text answer a plan_notice', async () => {
    const marker = 'pl14-gate-break';
    const base = checkConfiguration({ ...OPERATOR, kind: 'human' });
    const checks: TrustedCheckConfiguration = { ...base, checks: [
      { ...base.checks[0]!, checkId: 'pl14-gate-check', taskIds: 'all',
        command: `sh -c 'test -f ${marker} || { echo x >> check-runs.txt; false; }'` },
    ] };
    const { world, adopted } = await openGatedWorld({ usage: usageOf(100) }, {
      checks, isolation: true,
      // The work's check passes while the marker exists; it is removed before
      // the gate, so each gate check fails and changes the source, which lets
      // the real automatic re-verification run until the cap.
      beforeWork: async current => {
        await writeFile(join(current.settingsDirectory, 'taskbooks', marker), 'break\n');
      },
      between: async current => {
        await rm(join(current.settingsDirectory, 'taskbooks', marker), { force: true });
      },
    });
    try {
      const rows = (await world.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: world.goal }))).body as
        { value?: { tasks?: Array<Record<string, unknown>> } };
      const gateRow = rows.value?.tasks?.find(row => (row['ref'] as { taskId: string }).taskId === 'stage-gate');
      expect(gateRow?.['failure']).toMatchObject({ automation: { verdict: {
        kind: 'stopped', reason: 'auto_rework_cap_reached' } } });

      // 7D2 O4b-2 (o4b2 ruling 2 (a)): the deviation goes to the Goal's responsible adviser (book 7D2 §3.8 item 2).
      // T4a: the line opens through `role-lines/open` and the platform's queue assignment writes the Goal link.
      const adviser = await assignGoalAdviserLine(world.world, {
        goal: world.goal, label: 'pl14-gate-adviser', requestId: 'pl14-gate-adviser',
      });
      const send = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
        flowId: 'pl14-gate-cap-send', sessionHint: null, kind: 'select_work' }, 'send_system_round');
      if (send.kind !== 'perform' || send.operation.kind !== 'send_system_round') {
        throw new Error(`PL-14: no deviation send was selected: ${JSON.stringify(send)}`);
      }
      expect(send.operation.request.round).toMatchObject({
        kind: 'deviation', taskId: 'stage-gate', cause: 'stop', planRevision: adopted.plan.planRevision,
      });
      await world.world.post('workflow/advance', plain(S6A_SCOPE, send));
      const requestId = `deviation:${world.goal.goalId}:stage-gate:stop:${String(adopted.plan.planRevision)}`;
      const ref = systemRoundMessageRef(S6A_SCOPE, requestId);
      if (ref.status !== 'ready') throw new Error('PL-14: the gate deviation ref is invalid');
      await world.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-14 gate cap: no plan change' }]);
      await awaitPlanningAnswer(world.world, ref.value);
      const notices = await world.readNotices();
      const items = notices.main.filter(item =>
        item['itemKey'] === `deviation-notice:${world.goal.goalId}:${requestId}`);
      expect(items).toHaveLength(1);
      expect(String(items[0]?.['summary'])).toContain('PL-14 gate cap: no plan change');
    } finally {
      await world.close();
    }
  });
});
