/**
 * P-race (7a:730; R2-A-16+B-14): the apply's commit is held, the recipient line's own Runtime refuses the message
 * while it waits and commits, the apply is released and loses the message CAS. The refusal is the full command
 * port's refusal arm, because a plain reply does not consult the first-wins slot. The order is the book's; `hold`
 * is the commit's gate before the store, and `Promise.race([hold.reached, applying])` ends on the deferred named
 * error until L publishes the owner. Every prior state comes from the frozen fixture's public steps; the store is
 * never read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { EffectWriteResultV1 } from '../../src/contracts/core/session-message.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { ag2bChecksConfiguration, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { callS7A2PublishedOwner, claimRequestS7A2, sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { assertTaskCompleted, holdS7ACommitter, ready, S7A_REPLY_TOOLS } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
});

describe.each(['memory', 'sqlite'] as const)('P-race: the apply and the refusal interleave (%s)', backend => {
  it('the refusal commits while the apply waits; the apply loses the message CAS with revision_conflict', async () => {
    const exercise = async () => {
      const world = await openS6AHostWorld({ backend, extraBindings: [S7A_REPLY_TOOLS],
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR,
          command: 'echo S7A2_CHECKS_OK' }) } });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await world.setResumeOnStartup(false);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-race-goal', 'S7A2 race goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-race',
        taskIds: ['s7a2-race-1', 's7a2-race-2'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-race-line', role: S6A_WORK_ROLE, tasks });
      const card = await world.readSession(created.ref);
      const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
        role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      await world.scripted.script(line, [{ kind: 'text', text: 'S7A2 race first Task' }]);
      const first = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-race-first', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: tasks[0]!.taskId }, 'claim_task');
      await driveWorkflow(world.ag2b, first, { stopBefore: 'claim_task' });
      await assertTaskCompleted(world, goal, tasks[0]!.taskId);
      const message = await sendS7A2PersonMessage(world, { label: 'race', recipient: line.ref });
      const before = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
        'the race message');
      const request = await claimRequestS7A2(world, { goal, line, label: 'race' });
      const claimed = await callS7A2PublishedOwner(world,
        { owner: 'claims.claimTask', wave: '7a2e-p', scope: S6A_SCOPE },
        { ...request, input: { ...request.input, acknowledgement: message.ref } }) as
        EffectWriteResultV1<TaskClaim>;
      if (claimed.status !== 'committed' || claimed.proofReceipt === undefined) {
        throw new Error(`S7A2: the claim is ${claimed.status}`);
      }
      const receipt = claimed.proofReceipt;
      const hold = holdS7ACommitter(world, byIdentityPrefix('message.apply:'));
      const applyRequest = graphWrite(S6A_SCOPE, { messageRef: message.ref, proof: { receipt, effect: {
        kind: 'claim_created', ref: claimed.value.runRef } } }, 's7a2-race-apply').request;
      const applying = callS7A2PublishedOwner(world,
        { owner: 'messages.applyMessage', wave: '7a2-l', scope: S6A_SCOPE },
        applyRequest) as Promise<WriteResult<SessionMessage>>;
      await Promise.race([hold.reached, applying]);
      try {
        const refusal = { messageRef: message.ref, expectedRevision: before.revision, reject: true,
          reason: 'S7A2 P-race' };
        await world.scripted.script(line, [
          { kind: 'calls', calls: [{ callId: 's7a2-race-reject', name: 'respond_session_message',
            args: refusal }] },
          { kind: 'text', text: 'the refusal is saved' },
        ]);
        await driveWorkflow(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
          flowId: 's7a2-race-reject', sessionHint: line.ref, kind: 'select_work' as const,
          taskId: claimed.value.task.taskId }, { stopBefore: 'open_checks' });
        const refused = (await world.scripted.requests(line)).flatMap(request => request.messages
          .flatMap(entry => entry.role === 'tool' ? [{ callId: entry.callId, result: entry.result }] : []))
          .find(entry => entry.callId === 's7a2-race-reject')?.result;
        expect(refused).toMatchObject({ status: 'success',
          output: [{ kind: 'json', value: { status: 'committed', replayed: false } }] });
      } finally {
        hold.release();
      }
      const applied = await applying;
      expect(applied).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      const read = await world.post('messages/read', plain(S6A_SCOPE, message.ref));
      expect(read.body).toMatchObject({ status: 'ready', value: { rejectedAt: expect.any(String), appliedAt: null } });
    };
    await exercise();
  });
});
