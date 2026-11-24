/**
 * GL-1 (`gl-frozen.md:5`, `:116`; `design-frozen.md:943`, `:946`): the rework arm of
 * `classifyTaskClaim` reads the same module-overlap gate as the ordinary arm. The gate is a
 * separate step after `requeueHold` and before `continuationHolder`; it is not merged into the
 * claim commit.
 *
 * World: `openS7C1World({ firstRun: 'deferred' })` (the S8C/S7C world the ruling names). Its two
 * work Tasks `s7c-m1` and `s7c-m2` are both module `s6a-core` (`S7C-member-fixture.ts:196-207`).
 * m2 gets its own executor line (the module line carries m1's creator role;
 * `S7C-L1-overlap.test.ts:68-69`) and is interrupted by the scripted model-service failure
 * (`SMK3B-model-service.test.ts:70-88`) BEFORE m1 is started, so its ordinary claim needs no gate;
 * the person continues it through the public `tasks/requeue`, making the next selection carry
 * `requeueRef` and the verdict `claim_requeued` (`task-failure.ts` AV-3). `holdFirst()` then starts
 * m1 and holds it at its real model request, so the two same-module Tasks really overlap.
 * (`firstRun: 'held'` would put m2's first, ordinary Run behind a gate too; starting m1 only after
 * m2's failed Run keeps the setup on public steps and isolates the rework arm this row guards; the lead
 * accepts `deferred` (`.dsh-scratch/ask/a-cglt-firstrun-lead.md`).)
 *
 * Expected literals: the first performed step is `open_overlap_gate` with `status: 'opened'` and no
 * `claim_task`; the gate's `moduleId` is `s6a-core`, its waiting Task is `s7c-m2`, its one running
 * Task is `s7c-m1`; after the public `goals/overlap-release` the next performed step is the
 * `claim_task` whose request carries the requeue ref, and `executions/list` grows by exactly one Run.
 *
 * Named mutation: delete the rework arm's `readOverlapGateDecision` call (or move it after
 * `claimContinuation`). The first receipt then is the `claim_task` and `open_overlap_gate` never
 * appears: the `kind === 'open_overlap_gate'` expect goes red.
 *
 * c3rv GL (`c3rv-rulings.md:13`; Codex c3rv table 1, GL): the same requeued m2, held by the secretary's real
 * `hold_claim` in its request round before m1 starts, is named again. Expected: `waiting` with no next step, reason
 * and wait basis `claim_hold_held`. Named mutation: drop the rework arm's hold read before its gate step; the named
 * advance then names `open_overlap_gate`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { driveWorkflow, readExecution, readGoal } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { runsOf } from '../helpers/DRV-fixture.js';
import { adviserToolResult } from '../helpers/K3L3-adviser-world.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { createS6BLine, holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import {
  claimOf, openS7C1World, S7C1_CREATE_ROLE, type S7C1World,
} from '../helpers/S7C-member-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { advance } from '../scenarios/support/common.js';

let world: S7C1World | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const select = (target: S7C1World, flowId: string, taskId: string,
  line: S6ASession): Parameters<typeof advance>[1] => ({
  schemaVersion: 1, goalRef: target.goal, flowId, sessionHint: line.ref, kind: 'select_work', taskId,
});

describe('GL-1: a requeued Task also waits at the module-overlap gate', () => {
  /** m2 interrupted and requeued by the person; m1 is not started yet. */
  async function requeuedWorld() {
    const target = await openS7C1World({ firstRun: 'deferred' });
    world = target;
    const running = target.tasks[0]!;
    const requeued = target.tasks[1]!;

    // m2's own executor line: the module line carries m1's creator role and cannot serve m2's assignment.
    const line = await sessionOf(target.world, await createS6BLine(target.main, {
      label: 'gl-1-m2', role: S7C1_CREATE_ROLE, tasks: [requeued],
    }));

    // A real model-service failure: five retryable provider failures end the first Run
    // (SMK3B-model-service.test.ts:70-88). The person's `tasks/requeue` is the public continuation.
    await target.world.scripted.script(line, Array.from({ length: 5 }, () =>
      ({ kind: 'fail' as const, message: 'GL-1 provider unavailable' })));
    const interrupted: WorkflowStepReceipt[] = [];
    // Stop before the automatic rework: the failed Run stays the Task's selected Run and the public
    // requeue below writes the covering TaskRequeue itself.
    await driveWorkflow(target.world.ag2b, select(target, 'gl-1-m2-interrupted', requeued.taskId, line),
      { stopBefore: 'requeue_task', receipts: interrupted });
    const failedRun = claimOf(interrupted);

    const goalRead = await readGoal(target.world.ag2b, target.goal);
    const failedExecution = await readExecution(target.world.ag2b, failedRun);
    const requeuedAnswer = await target.world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
      taskRef: requeued, afterRunRef: failedRun, reason: 'GL-1 person continues the interrupted Task',
    }, 'gl-1-m2-requeue', [
      { ref: target.goal, revision: goalRead.revision },
      { ref: failedRun, revision: failedExecution.run.revision },
    ]));
    expect(requeuedAnswer.body, JSON.stringify({ body: requeuedAnswer.body, failedRun }))
      .toMatchObject({ status: 'committed' });
    const requeueValue = (requeuedAnswer.body as {
      value?: { kind?: string; requeue?: { ref?: unknown } };
    }).value;
    if (requeueValue?.kind !== 'requeued' || requeueValue.requeue?.ref === undefined) {
      throw new Error(`GL-1: the public requeue did not commit: ${JSON.stringify(requeuedAnswer.body)}`);
    }
    const requeueRef = requeueValue.requeue.ref;
    return { target, running, requeued, line, requeueRef };
  }

  it('opens the gate for the rework claim, and only the released gate lets the requeued Run start', async () => {
    const { target, running, requeued, line, requeueRef } = await requeuedWorld();

    // Only now does m1 start and stop at its model request, so the sibling is really running when the
    // requeued Task is selected (`S7C-member-fixture.ts:334-357`).
    await target.holdFirst();
    expect((await runsOf(target.world, target.goal, running.taskId)).map(item => item.run.status))
      .toEqual(['running']);

    // One selection, one performed step. Old production performs the rework claim here: the receipt
    // is `claim_task` and this expect is the row's red.
    const proposed = await advance(target.world.ag2b, select(target, 'gl-1-before-release', requeued.taskId, line));
    if (proposed.next === null || proposed.next.kind !== 'perform') {
      throw new Error(`GL-1: the requeued Task named no step: ${JSON.stringify(proposed)}`);
    }
    const opened = await advance(target.world.ag2b, proposed.next);
    const receipt = opened.receipt;
    expect(receipt?.kind).toBe('open_overlap_gate');
    if (receipt === null || receipt.kind !== 'open_overlap_gate' || receipt.result.status !== 'opened') {
      throw new Error(`GL-1: the rework claim did not open the overlap gate: ${JSON.stringify(receipt)}`);
    }
    expect(receipt).toMatchObject({ kind: 'open_overlap_gate', result: { status: 'opened', gate: {
      moduleId: 's6a-core',
      waiting: { taskId: requeued.taskId },
      running: [{ task: { taskId: running.taskId } }],
      release: null,
    } } });

    const released = await target.world.post('goals/overlap-release', plain(S6A_SCOPE, {
      commandId: 'gl-1-release', gate: receipt.result.gate.ref, revision: receipt.result.gate.revision,
      reason: 'GL-1 person releases the module gate',
    }));
    expect(released.body).toMatchObject({ status: 'released' });

    // After the release the same rework arm claims with the covering requeue, and exactly one Run is added.
    const afterRelease = await advance(target.world.ag2b,
      select(target, 'gl-1-after-release', requeued.taskId, line));
    const claimStep = afterRelease.next;
    if (claimStep === null || claimStep.kind !== 'perform' || claimStep.operation.kind !== 'claim_task') {
      throw new Error(`GL-1: the release did not name the requeued claim: ${JSON.stringify(afterRelease)}`);
    }
    expect(claimStep.operation.request.input.requeueRef).toEqual(requeueRef);
    const before = await runsOf(target.world, target.goal, requeued.taskId);
    const claimed = await advance(target.world.ag2b, claimStep);
    expect(claimed.receipt).toMatchObject({ kind: 'claim_task', result: { status: 'committed' } });
    const after = await runsOf(target.world, target.goal, requeued.taskId);
    expect(after).toHaveLength(before.length + 1);
  });

  it('c3rv GL: a named rework claim that is still held waits on the hold before any gate step', async () => {
    const { target, requeued, line } = await requeuedWorld();
    // This world runs a secretary request round by hand (`holdS6BRequestRound`); the round ends after its replies.
    const held = await holdS6BRequestRound(target.world, { label: 'gl-1-hold', goalId: requeued.goalId, replies: () => [
      { kind: 'calls', calls: [{ callId: 'gl-1-hold', name: 'hold_claim',
        args: { taskRef: requeued, reason: 'GL-1 先别领 m2' } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'GL-1 暂缓已放' }) },
    ] }, async round => round.secretary);
    expect((await adviserToolResult({ world: target.world, adviser: held.value }, 'gl-1-hold')).output
      ?.find(entry => entry.kind === 'json')?.value, 'the secretary holds m2').toMatchObject({ status: 'committed' });
    await target.holdFirst();
    expect(await advance(target.world.ag2b, select(target, 'gl-1-held', requeued.taskId, line))).toMatchObject({
      state: 'waiting', next: null, reason: expect.stringContaining('claim_hold_held'),
      waitBasis: { reasons: ['claim_hold_held'] } });
  });
});
