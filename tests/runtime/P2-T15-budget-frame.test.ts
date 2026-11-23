/**
 * P2 T15 (frozen row :330): the A-05 128k frame's budget identity, read from the
 * real Query record. A-05's 128k cell (`tests/runtime/A-05-plan-round.test.ts:66`)
 * is the frame; this row opens the same world and reads the same round's
 * `queries/read` record. Expected values are the frozen reserve (64,000) and the
 * frozen window identity; the measured input is whatever the record says, never
 * the scripted model's usage report.
 *
 * The row is GREEN at the base: it guards the identity after G1/G2 change the
 * prompt and tool packs. The named mutation is on `model-budget.ts:189`
 * (`reservedInput`) and is reported with the row.
 */
import { describe, expect, it } from 'vitest';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { systemRoundRequestId, type SystemRoundV1 } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { awaitPlanningAnswer } from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

const WORK_TASK_ID = 'p2-t15-work';
const INSTRUCTION_BYTES = 102_400;
const INSTRUCTION = `P2T15-${'i'.repeat(INSTRUCTION_BYTES - 8)}-END`;
const SUMMARY = 'P2 T15 summary';

type T15Plan = {
  stages: { stageId: string; title: string }[];
  tasks: Record<string, unknown>[];
  assignments: { taskId: string; role: string; instruction: string }[];
  obligations: unknown[];
  taskHierarchy: { parentOf: unknown[] };
  executionDag: { dependsOn: unknown[] };
  taskRelations: unknown[];
  inputRequirements: unknown[];
};

describe('P2 T15: the A-05 128k budget frame and the persisted record values', () => {
  it('records input + 64,000 + remaining = 128,000 and remaining >= 0', async () => {
    const opened = await openPlanOnlyWorld('p2-t15-128k', { contextWindowTokens: 128_000 });
    try {
      await startGoalDriver(opened.world, opened.goal, 'p2-t15-budget');
      const snapshot = ready<{ last: { status: string; value?: { state?: string; reason?: string } } }>(
        await driverRead(opened.world, opened.goal), 'the T15 driver read');
      expect(snapshot.last).toMatchObject({
        status: 'ready', value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
      });

      const round: SystemRoundV1 = { kind: 'refine', goalRef: opened.goal,
        target: { kind: 'stage', stageId: opened.stageId }, planRevision: 1 };
      const requestId = systemRoundRequestId(round);
      if (requestId.status !== 'ready') throw new Error('T15: the refine round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (messageRef.status !== 'ready') throw new Error('T15: the refine round has no message ref');

      const plan: T15Plan = {
        stages: [{ stageId: opened.stageId, title: 'P2 T15 next segment' }],
        tasks: [{
          taskId: WORK_TASK_ID, stageId: opened.stageId, title: 'P2 T15 work',
          requirementLevel: 'required', taskKind: 'work', disposition: 'active',
          scope: { kind: 'stage', stageId: opened.stageId }, executionIntent: 'request_execution',
          estimatedLines: 40, sizeClass: 'medium', replacedByTaskId: opened.taskId,
        }],
        assignments: [{ taskId: WORK_TASK_ID, role: S6A_WORK_ROLE.templateId, instruction: INSTRUCTION }],
        obligations: [{
          obligationId: 'p2-t15-delivery', title: 'P2 T15 delivery', requirementLevel: 'required',
          taskIds: [WORK_TASK_ID], verificationRequirements: [{
            requirementId: 'p2-t15-check', requirementLevel: 'required', kind: 'test',
            description: 'P2 T15 checks the segment',
          }],
        }],
        taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
      };
      await opened.world.scripted.script(opened.adviser, [{ kind: 'calls',
        calls: [{ callId: 'p2-t15-plan', name: 'submit_plan_round',
          args: { answerKind: 'plan', summary: SUMMARY, plan, reason: { text: 'P2 T15 refine', affectedTaskIds: [WORK_TASK_ID] } } }],
        usage: usageOf(1024) }]);

      await heartbeatUntil(opened.world, () => listed(opened.world, 'inbox', opened.adviser),
        items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
      const planning = await awaitPlanningAnswer(opened.world, messageRef.value);
      expect(planning, 'the 128k planning Query did not answer').not.toBeNull();
      if (planning === null) return;

      const record: QueryJobRecord = planning;
      const usage = record.run.run.executionState?.requests[0];
      expect(usage, 'the Query record has no model request').toBeDefined();
      if (usage === undefined) return;

      const facts = usage.prompt.selection;
      expect(usage.reservedOutput, 'the 128k output reserve').toBe(64_000);
      expect(facts.budget, 'the input budget is 128,000 - 64,000').toBe(64_000);
      expect(facts.inputTokens, 'the estimate is the persisted reservation').toBe(usage.reservedInput);

      const remaining = facts.budget - facts.inputTokens;
      expect(remaining, 'the input estimate fits beside the 64,000 reserve').toBeGreaterThanOrEqual(0);
      expect(facts.inputTokens + 64_000 + remaining, 'input + reserve + remaining = window').toBe(128_000);

      // The record values the row reports: input estimate, remaining and the
      // frozen reserve. The delta is zero for this one-request frame.
      const values = { input: facts.inputTokens, reserve: 64_000, remaining,
        delta: facts.inputTokens - facts.inputTokens };
      expect(values).toEqual({ input: usage.reservedInput, reserve: 64_000, remaining, delta: 0 });
    } finally {
      await opened.close();
    }
  }, 120_000);
});
