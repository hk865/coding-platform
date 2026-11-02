/**
 * A-05: the planning round through the real Host. The F0 world adopts a Plan
 * whose next segment is a required `plan_only` placeholder; the target driver
 * reaches that gap and the goal loop's `refine:` round is the first observable
 * (the round to the adviser line, the Host consumption, the scripted
 * `submit_plan_round` call and both model windows are downstream of it).
 *
 * No hand-made ctx, no direct handler and no accepted-call set: the row drives the
 * public `workflow/driver-start` route and the real Host.
 */
import { describe, expect, it } from 'vitest';
import { planningOutputReserveTokens } from '../../src/contracts/runtime-budget.js';
import type { QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import {
  systemRoundMessageRef, systemRoundRequestId, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import {
  awaitPlanningAnswer, awaitProposal, heartbeatUntil, proposalRefOf, readBody, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

const WORK_TASK_ID = 'a05-work';
const INSTRUCTION_BYTES = 102_400;
const INSTRUCTION = `A05-${'i'.repeat(INSTRUCTION_BYTES - 8)}-END`;
const SUMMARY_30K = 's'.repeat(30 * 1024);
const SUMMARY_16K = 'm'.repeat(16 * 1024);
const REASON = { text: 'A-05 refines the next segment', affectedTaskIds: [WORK_TASK_ID] };

type A05Plan = {
  stages: { stageId: string; title: string }[];
  tasks: Record<string, unknown>[];
  assignments: { taskId: string; role: string; instruction: string }[];
  obligations: unknown[];
  taskHierarchy: { parentOf: unknown[] };
  executionDag: { dependsOn: unknown[] };
  taskRelations: unknown[];
  inputRequirements?: unknown[];
};
type A05Form = { summary: string; plan: A05Plan; reason: { text: string; affectedTaskIds: string[] } };

// The test's own complete v2 protocol literal: the saved answer's byte length is
// compared with this text, never with the production builder.
function v2AnswerText(form: A05Form): string {
  const plan = { ...form.plan, schemaVersion: 2,
    tasks: form.plan.tasks.map(task => ({ ...task, phase: 'pending' as const })) };
  return JSON.stringify({ schemaVersion: 2, kind: 'plan', summary: form.summary, plan, reason: form.reason });
}

describe('A-05: the plan round through the adviser Host line', () => {
  it('drives the plan_only gap to a refine round, then accepts the plan and the summary rule', async () => {
    // The two frozen windows: each grid opens the shared F0 world with its own
    // context window and reads the request's real reserved output, usage and answer.
    const windows = [
      { label: 'a05-1m', contextWindowTokens: 1_000_000, perResponseTokens: 131_072 },
      { label: 'a05-128k', contextWindowTokens: 128_000, perResponseTokens: 64_000 },
    ];
    for (const window of windows) {
    const opened = await openPlanOnlyWorld(window.label, { contextWindowTokens: window.contextWindowTokens });
    try {
      await startGoalDriver(opened.world, opened.goal, 'a05-plan-round');
      const snapshot = ready<CollaborationSnapshot>(await driverRead(opened.world, opened.goal),
        'the A-05 driver read');
      expect(snapshot.last).toMatchObject({
        status: 'ready',
        value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
      });

      const round: SystemRoundV1 = {
        kind: 'refine', goalRef: opened.goal,
        target: { kind: 'stage', stageId: opened.stageId }, planRevision: 1,
      };
      const requestId = systemRoundRequestId(round);
      expect(requestId.status).toBe('ready');
      if (requestId.status !== 'ready') throw new Error('A-05: the refine round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      expect(messageRef.status).toBe('ready');
      if (messageRef.status !== 'ready') throw new Error('A-05: the refine round has no message ref');

      // The one form the advisor submits: a 100 KiB instruction, the frozen
      // task metadata, a top-level input requirement and the answer's root reason.
      const plan = {
        stages: [{ stageId: opened.stageId, title: 'A-05 next segment' }],
        tasks: [{
          taskId: WORK_TASK_ID, stageId: opened.stageId, title: 'A-05 refine the next segment',
          requirementLevel: 'required', taskKind: 'work', disposition: 'active',
          scope: { kind: 'stage', stageId: opened.stageId }, executionIntent: 'request_execution',
          estimatedLines: 40, sizeClass: 'medium', replacedByTaskId: opened.taskId,
        }],
        assignments: [{ taskId: WORK_TASK_ID, role: S6A_WORK_ROLE.templateId, instruction: INSTRUCTION }],
        obligations: [{
          obligationId: 'a05-delivery', title: 'A-05 delivery', requirementLevel: 'required',
          taskIds: [WORK_TASK_ID], verificationRequirements: [{
            requirementId: 'a05-check', requirementLevel: 'required', kind: 'test',
            description: 'A-05 checks the refined segment',
          }],
        }],
        taskHierarchy: { parentOf: [] },
        executionDag: { dependsOn: [] },
        taskRelations: [],
        inputRequirements: [{
          requirementId: 'a05-input', consumerTaskId: WORK_TASK_ID, kind: 'artifact',
          artifactRef: { kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 1,
            source: { kind: 'workspace', refId: S6A_SCOPE.workspaceId, revision: '1' } },
        }],
      };
      const answer30 = { answerKind: 'plan', summary: SUMMARY_30K, plan, reason: REASON };
      const answer16 = { answerKind: 'plan', summary: SUMMARY_16K, plan, reason: REASON };
      // The complete protocol text the accepted form produces, built here from
      // this test's own literal; only its exact byte count is compared below.
      const expectedText = v2AnswerText(answer16);

      await opened.world.scripted.script(opened.adviser, [
        { kind: 'calls', calls: [{ callId: 'a05-summary-30k', name: 'submit_plan_round', args: answer30 }],
          usage: usageOf(1024) },
        { kind: 'calls', calls: [{ callId: 'a05-summary-16k', name: 'submit_plan_round', args: answer16 }],
          usage: usageOf(2048) },
      ]);

      const inbox = await heartbeatUntil(opened.world,
        () => listed(opened.world, 'inbox', opened.adviser),
        items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
      expect(inbox.some(message => message.ref.messageId === messageRef.value.messageId),
        'the target driver reaches the plan_only gap but the goal loop sends no '
        + `refine:${opened.goal.goalId}:${opened.stageId}:1 to the adviser line. Stop point: `
        + 'src/business/workflow/workflow.ts:1935 emits the plan_only gap and no code builds '
        + 'refinementRoundOf/sendSystemRound (src/business/workflow/plan-round.ts:52 and '
        + 'src/app/system-round.ts:18 have no production caller). Missing owner: P4 (the goal-loop '
        + 'refine: route); P2 (offerKindOf/handleIntervention) must then offer the round to the Host. '
        + 'The 100 KiB plan, the 30 KiB/16 KiB summaries, the tool table and the candidate are '
        + 'written after this stop and are not proven until P4 closes it.').toBe(true);

      // One real planning Query: the 30 KiB summary is refused by the submit
      // tool, the 16 KiB summary is accepted in the same Turn. Every expected
      // value below is the submitted literal or a hand-computed byte count.
      const planning = await awaitPlanningAnswer(opened.world, messageRef.value);
      expect(planning, 'A-05: the refine round produced no answered planning Query').not.toBeNull();
      if (planning === null) throw new Error('A-05: no planning Query');
      const answerRef = planning.job.job.answerRefs.at(-1);
      if (answerRef === undefined) throw new Error('A-05: the plan round saved no answer');
      const answerSnapshot = ready<QueryJobAnswerSnapshot>((await opened.world.post('queries/answer',
        plain(S6A_SCOPE, answerRef))).body, 'the A-05 plan answer');
      const answerText = answerSnapshot.answer.answer;
      const parsed = JSON.parse(answerText) as {
        schemaVersion: number; kind: string; summary: string;
        plan: { tasks: { taskId: string; estimatedLines?: number; sizeClass?: string; replacedByTaskId?: string }[];
          assignments: { taskId: string; instruction: string }[]; inputRequirements?: unknown[] };
        reason: { text: string; affectedTaskIds?: string[] };
      };
      expect(parsed).toMatchObject({
        schemaVersion: 2, kind: 'plan', summary: SUMMARY_16K, reason: REASON,
      });
      expect(Buffer.byteLength(answerText, 'utf8')).toBe(Buffer.byteLength(expectedText, 'utf8'));
      const writtenAssignment = parsed.plan.assignments.find(entry => entry.taskId === WORK_TASK_ID);
      expect(writtenAssignment?.instruction).toBe(INSTRUCTION);
      expect(Buffer.byteLength(writtenAssignment?.instruction ?? '', 'utf8')).toBe(INSTRUCTION_BYTES);
      expect(parsed.plan.tasks.find(entry => entry.taskId === WORK_TASK_ID)).toMatchObject({
        estimatedLines: 40, sizeClass: 'medium', replacedByTaskId: opened.taskId,
      });
      expect(parsed.plan.inputRequirements).toEqual(plan.inputRequirements);
      expect(answerSnapshot.answer.bodyRef.digest).toBe(sha256Hex(answerText));

      // The frozen answer facts read the same text and digest.
      const readFacts = opened.world.platform.plans.readInitialPlanAnswerFacts;
      if (readFacts === undefined) throw new Error('A-05: the Plan owner publishes no answer-facts read');
      const facts = await readFacts.call(opened.world.platform.plans, opened.world.humanContext(),
        answerRef, { kind: 'intervention', messageRef: messageRef.value });
      expect(facts.status).toBe('ready');
      if (facts.status === 'ready') {
        expect(facts.value.answerText).toBe(answerText);
        expect(facts.value.answer.answer).toBe(answerText);
        expect(facts.value.answer.bodyRef.digest).toBe(sha256Hex(answerText));
      }

      // The model table is the planning one; the 30 KiB call's tool result is
      // the exact refusal the summary rule produces.
      const requests = await opened.world.scripted.requests(opened.adviser);
      const tools = requests[0]?.tools.map(tool => tool.name) ?? [];
      expect(tools).toContain('submit_plan_round');
      expect(tools).not.toContain('submit_plan_review');
      expect(tools).not.toContain('submit_secretary_answer');
      expect(tools).not.toContain('submit_initial_questions');
      // The 128k cell's input budget (128,000 - 64,000) cannot hold the refused
      // 130 KiB call, so the Kernel's context selection drops that pair from the
      // next request; only the 1M cell can show the refusal itself. In both
      // cells the answer read above is the accepted 16 KiB one.
      if (window.contextWindowTokens === 1_000_000) {
        const refused = toolOutputJson(requests[1], 'a05-summary-30k');
        expect(refused, 'A-05: the 30 KiB summary never reached a tool result').toBeDefined();
        expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
      }
      const execution = planning.run.run.executionState;
      expect(execution?.requests.some(request => request.usageStatus === 'reported'
        && request.inputTokens === 1024)).toBe(true);
      expect(execution?.requests.some(request => request.usageStatus === 'reported'
        && request.inputTokens === 2048)).toBe(true);

      // The candidate is the Host's merge of the real answer, and the reply is
      // the accepted summary (not the plan text).
      const candidate = ready<PlanProposal>(await awaitProposal(opened.world,
        proposalRefOf(messageRef.value, opened.goal)), 'the A-05 candidate');
      expect(candidate.status).toBe('candidate');
      expect(candidate.draft.assignments?.find(entry => entry.taskId === WORK_TASK_ID)?.instruction)
        .toBe(INSTRUCTION);
      expect(candidate.draft.tasks.find(entry => entry.taskId === WORK_TASK_ID)).toMatchObject({
        estimatedLines: 40, sizeClass: 'medium', replacedByTaskId: opened.taskId,
      });
      expect(candidate.draft.inputRequirements).toEqual(plan.inputRequirements);
      expect(candidate.reason.text, 'A-05: the candidate keeps the answer root reason').toBe(REASON.text);
      expect(candidate.reason.affectedTaskIds).toEqual(REASON.affectedTaskIds);
      const replied = await waitForResponse(opened.world, messageRef.value);
      expect(replied.response).not.toBeNull();
      expect(await readBody(opened.world, messageRef.value, 'response')).toBe(SUMMARY_16K);

      // The real grid's request budget is the production value for this window;
      // the usage above is the model's own snapshot for the same request.
      const budget = planning.run.run.executionState?.entry?.budget;
      expect(budget?.contextWindowTokens).toBe(window.contextWindowTokens);
      expect(budget?.perResponseTokens).toBe(window.perResponseTokens);
      expect(planningOutputReserveTokens(1_000_000)).toBe(131_072);
      expect(planningOutputReserveTokens(128_000)).toBe(64_000);
    } finally {
      await opened.close();
    }
    }
  }, 120_000);
});

