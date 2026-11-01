/**
 * BW-basis (SR8 §4; book-7b.md:1213; P-15): a Goal whose Run yielded on a real reply returns its wait basis with
 * the next `select_work`; the parked driver keeps the same wait across a wake; and the answered wait advances the
 * same handle exactly one step (its claim), never a second one.
 *
 * The goal, the yielded wait and the driver come from `S7B2-wake-basis.ts` (steps 6–8): the second advance goes
 * through the public `workflow/advance` route, the handle through the driver's public `start`/`wake`/`read`, and the
 * reply through W-F1's real `answerS7BWait`. No store, record or `CoreCallContext` is built.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready, sameRun } from '../helpers/S7A-fixture.js';
import { answerS7BWait } from '../helpers/S7B-fixture.js';
import { openS7B2BasisGoal, startS7B2BasisDriver, wakeS7B2BasisGoal } from '../helpers/S7B2-wake-basis.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

describe('BW-basis (memory)', () => {
  it('the yielded wait returns its basis; a wake keeps it; the answered continuation claims exactly one successor Run',
    async () => {
      const basis = await openS7B2BasisGoal({ backend: 'memory' });
      worlds.push(basis.world);
      const waitBasis = {
        projectId: basis.goal.projectId,
        goalId: basis.goal.goalId,
        recordKinds: ['SessionMessage', 'Run', 'TaskLease'],
        reasons: ['wait_reply'],
      };

      // The second advance on the yielded Goal: the continuation wait is still unanswered, so it returns the
      // basis of the facts a wake must re-read (the closed kinds, in that order), never a step.
      const second = await basis.world.post('workflow/advance', plain(S6A_SCOPE, {
        schemaVersion: 1, goalRef: basis.goal, flowId: 's7b2-bw-basis',
        sessionHint: basis.sender.ref, kind: 'select_work', taskId: basis.task.taskId,
      }));
      expect(second.body).toEqual({ status: 'ready', value: {
        state: 'waiting', receipt: null, next: null, pick: null,
        reason: 'the continuation wait has not been answered yet', waitBasis,
      } });

      const started = startS7B2BasisDriver(basis);
      const parked = await started.start();
      expect(parked.state).toBe('waiting_for_reply');

      // Before the reply a wake is only the re-check: the same parked wait, the same request to resume.
      const woken = await wakeS7B2BasisGoal(basis, started);
      expect(woken.state).toBe('waiting_for_reply');
      expect(JSON.stringify(woken.current)).toBe(JSON.stringify(parked.current));
      expect(woken.last).toMatchObject({ status: 'ready', value: { state: 'waiting', waitBasis } });

      // The recipient's real reply, then the same handle's one bounded advance: the successor claim, and the
      // successor input still parked (`current`), because the entry never follows it.
      const graph = ready<TaskGraph>(await basis.world.post('tasks/query',
        plain(S6A_SCOPE, { goalRef: basis.goal })), 'the BW basis TaskGraph');
      const replyTask = graph.tasks.find(row => row.ref.taskId !== basis.task.taskId)?.ref;
      if (replyTask === undefined) throw new Error('S7B2: the goal graph has no reply Task');
      await answerS7BWait(basis.world, { goal: basis.goal, recipient: basis.recipient,
        message: basis.message, task: replyTask, label: 's7b2-bw' });

      // The wake is only a re-check: the task's watch continues the chain and
      // starts the successor Run itself, so the reply is consumed by a NEW Run
      // on the same Task/Session rather than parked as a successor input.
      await started.driver.wake(basis.world.humanContext(), basis.goal);
      let saved: SessionMessage | undefined;
      await expect.poll(async () => {
        const read = ready<SessionMessage>(
          await basis.world.post('messages/read', plain(S6A_SCOPE, basis.message)), 'the answer read');
        saved = read;
        return (read.acceptedInputs ?? []).filter(entry => entry.part === 'response').length;
      }, { interval: 50 }).toBe(1);
      if (saved === undefined) throw new Error('S7B2: the answered wait was not read back');
      const accepted = (saved.acceptedInputs ?? []).find(entry => entry.part === 'response')!;
      if (accepted.executionRef.aggregateType !== 'Run') throw new Error('S7B2: the accepted input is not a Work Run');
      expect(sameRun(accepted.executionRef, basis.run)).toBe(false);
      const successor = ready<TaskExecutionRecord>(
        await basis.world.post('executions/read', plain(S6A_SCOPE, accepted.executionRef)),
        'the successor Run');
      expect(successor.run.task).toEqual(basis.task);
      expect(sameRun(successor.run.previousRun!, basis.run)).toBe(true);
      await started.driver.stop(basis.world.humanContext(), { goalRef: basis.goal, taskId: basis.task.taskId });
    }, 120_000);
});
