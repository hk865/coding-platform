/**
 * A-02: the review round's `fix` verdict through the real Host. In ONE Turn the
 * scripted model first calls `submit_plan_review({verdict:'fix',findings:[]})`
 * and the tool result is `rejected`/`invalid`; the same Query then calls again
 * with the candidate's taskId and one finding, and the saved answer comes from
 * that second call. The `planfix:<proposalId>:<revision>` message reaches the
 * adviser line and the `planreview:` reply names the finding count and the
 * Query. A `pass` that carries findings is accepted in its own round.
 *
 * No hand-made ctx, direct handler or accepted-call set. The tool results are read
 * from the scripted model's own request transcript.
 */
import { describe, expect, it } from 'vitest';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import {
  awaitPlanningAnswer, heartbeatUntil, readBody, readProposal, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import { runPLAutomaticChain } from '../helpers/PL-workflow-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';
import {
  openPLReviewCandidateWorld, PL_REVIEW_CHANGED_INSTRUCTION, PL_REVIEW_CHANGED_TASK_ID,
  PL_REVIEW_DEPENDS_ON, PL_REVIEW_INPUT_REQUIREMENT, PL_REVIEW_NEW_CHECK_ID, PL_REVIEW_NEW_CHECK_TEXT,
  PL_REVIEW_NEW_INSTRUCTION_A, PL_REVIEW_NEW_INSTRUCTION_B, PL_REVIEW_NEW_OBLIGATION_ID,
  PL_REVIEW_NEW_TASK_A, PL_REVIEW_NEW_TASK_B, PL_REVIEW_OLD_INSTRUCTION, PL_REVIEW_OLD_TASK_ID,
  PL_REVIEW_TASK_RELATION,
} from '../helpers/PL-forms-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { systemRoundRequestId, type SystemRoundV1 } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

const TASK_ID = 'pl-review-work';
const FIX_ANSWER = '{"schemaVersion":1,"kind":"plan_review","verdict":"fix","findings":'
  + `[{"taskId":"${TASK_ID}","text":"把先看什么写进 instruction"}]}`;
const PASS_FINDING_ANSWER = '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":'
  + '[{"taskId":null,"text":"可选意见"}]}';

type KernelEvent = { type: string; payload: { callId?: string; result?: { status: string } } };

/** The Kernel events of one Query's own Run, in order, through the public `sessions/history` range. */
async function kernelEventsOf(world: S6AHostWorld, history: RunExecutionHistoryV1): Promise<KernelEvent[]> {
  const events: KernelEvent[] = [];
  let afterCursor: string | null = null;
  do {
    const page: { items: { body: { encoding?: string; text?: string } }[]; nextCursor: string | null } = ready(
      (await world.post('sessions/history', plain(S6A_SCOPE, {
        sessionRef: history.sessionRef, afterCursor, throughCursor: null, limit: 200,
        range: { adapterId: history.kernel.adapterId, kernelSessionId: history.kernel.kernelSessionId,
          startPosition: history.startPosition, throughPosition: history.endPosition },
      }))).body, 'the A-02 Kernel history');
    for (const item of page.items) {
      if (item.body.encoding !== 'kernel_session_record_json') continue;
      const record = JSON.parse(item.body.text ?? '{}') as { recordType: string; payload: { event: KernelEvent } };
      if (record.recordType === 'agent.event') events.push(record.payload.event);
    }
    afterCursor = page.nextCursor;
  } while (afterCursor !== null);
  return events;
}

describe('A-02: fix and pass-with-findings through the reviewer Host line', () => {
  it.each([
    { label: 'fix', answer: FIX_ANSWER, reply: (id: string) => `审阅要求返修：1 条意见，见 Query ${id}` },
    { label: 'pass-with-findings', answer: PASS_FINDING_ANSWER, reply: () => '审阅通过' },
  ])('$label: the review answer and its reply', async ({ label, answer, reply }) => {
    const opened = await openPLReviewCandidateWorld({ adviser: label === 'fix' });
    try {
      if (label === 'fix') {
        await opened.script([
          { kind: 'calls', calls: [{
            callId: 'pl-review-empty-fix', name: 'submit_plan_review', args: { verdict: 'fix', findings: [] },
          }] },
          { kind: 'calls', calls: [{
            callId: 'pl-review-fix', name: 'submit_plan_review', args: {
              verdict: 'fix', findings: [{ taskId: TASK_ID, text: '把先看什么写进 instruction' }],
            },
          }] },
          { kind: 'text', text: 'A-02 spare reply: a Turn past the barrier would take this' },
        ]);
      } else {
        await opened.script([{ kind: 'calls', calls: [{
          callId: 'pl-review-pass-findings', name: 'submit_plan_review',
          args: { verdict: 'pass', findings: [{ taskId: null, text: '可选意见' }] },
        }] }]);
      }
      if (label === 'fix') {
        const candidate = await readProposal(opened.world, opened.candidate.ref);
        const { stages, tasks, assignments, obligations, taskHierarchy, executionDag, taskRelations,
          inputRequirements } = candidate.draft;
        await opened.world.scripted.script(opened.adviser!, [{ kind: 'calls', calls: [{
          callId: 'pl-fix-plan-round', name: 'submit_plan_round', args: {
            answerKind: 'plan', summary: 'A-02 fixed plan',
            plan: { stages, tasks, assignments, obligations, taskHierarchy, executionDag, taskRelations,
              inputRequirements },
            reason: { text: 'A-02 fixes the reviewed candidate', affectedTaskIds: [] },
          },
        }] }]);
      }
      await startGoalDriver(opened.world, opened.goal, `pl-review-${label}-flow`);

      const round: SystemRoundV1 = { kind: 'planreview', goalRef: opened.goal,
        proposalId: opened.candidate.ref.proposalId, proposalRevision: opened.candidate.revision };
      const requestId = systemRoundRequestId(round);
      expect(requestId.status).toBe('ready');
      if (requestId.status !== 'ready') throw new Error('A-02: the review round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      expect(messageRef.status).toBe('ready');
      if (messageRef.status !== 'ready') throw new Error('A-02: the review round has no message ref');

      const inbox = await heartbeatUntil(opened.world,
        () => listed(opened.world, 'inbox', opened.reviewer),
        items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
      expect(inbox.some(message => message.ref.messageId === messageRef.value.messageId),
        'after workflow/driver-start the goal loop emits no '
        + `planreview:${opened.candidate.ref.proposalId}:${opened.candidate.revision} and the reviewer `
        + 'line has no such message. Stop point: the reviewer inbox is empty. Missing owner: P2 '
        + '(the planreview: route). L reviewer-profile injection is present in the fixture.').toBe(true);
      const reviewed = await awaitPlanningAnswer(opened.world, messageRef.value, 16);
      expect(reviewed, 'the review message exists but the Host offers/consumes no '
        + 'review Query. Stop point: offerKindOf in src/core/work-graph/views/consumable-sessions.ts '
        + 'offers no host-system action_request. Missing owner: P2 (offerKindOf/handleIntervention).')
        .not.toBeNull();
      if (reviewed === null) throw new Error('A-02: no review Query');

      const requests = await opened.world.scripted.requests(opened.reviewer);
      const input = requests.map(request => request.messages.map(message =>
        'content' in message && typeof message.content === 'string' ? message.content : '').join('\n'))
        .find(text => text.includes('## 计划候选审阅')) ?? '';
      expect(input, 'the review input is not the frozen candidate text').toContain(
        '**审阅范围：只审这一版新写或改动的任务书、义务和依赖差异。已采用的目标、阶段骨架和已采用的段是依据，'
        + '不是被审对象；不要重审它们。发现上层缺陷时按第 7 节另走。**');
      expect(input, 'the candidate has no real task difference').toContain(
        `added taskIds: ${PL_REVIEW_NEW_TASK_A}, ${PL_REVIEW_NEW_TASK_B}`);
      expect(input).toContain(`changed taskIds: ${PL_REVIEW_CHANGED_TASK_ID}`);
      expect(input).toContain(`instruction:\n${PL_REVIEW_NEW_INSTRUCTION_A}`);
      expect(input).toContain(`instruction:\n${PL_REVIEW_NEW_INSTRUCTION_B}`);
      expect(input).toContain(`instruction:\n${PL_REVIEW_CHANGED_INSTRUCTION}`);
      expect(input).toContain(`obligation: ${canonicalJson({
        obligationId: PL_REVIEW_NEW_OBLIGATION_ID, title: 'PL review new obligation',
        requirementLevel: 'required', taskIds: [PL_REVIEW_NEW_TASK_A, PL_REVIEW_NEW_TASK_B],
        verificationRequirements: [{
          requirementId: PL_REVIEW_NEW_CHECK_ID, requirementLevel: 'required', kind: 'test',
          description: PL_REVIEW_NEW_CHECK_TEXT,
        }],
      })}`);
      expect(input).toContain(`dependsOn added: ${canonicalJson(PL_REVIEW_DEPENDS_ON)}`);
      expect(input).toContain(`taskRelations added: ${canonicalJson(PL_REVIEW_TASK_RELATION)}`);
      expect(input).toContain(`inputRequirements added: ${canonicalJson(PL_REVIEW_INPUT_REQUIREMENT)}`);
      // The adopted Plan is the review's basis, not its object: its stage
      // skeleton, each task's title/scope/disposition, its obligations (with
      // verification requirements), its dependency edges and its input
      // requirements are all frozen in the plan slot. These literals are the
      // fixture's own public submissions.
      expect(input, 'the review input has no adopted-plan baseline slots').toContain(
        canonicalJson({
          stages: [],
          tasks: [
            { taskId: PL_REVIEW_CHANGED_TASK_ID, title: 'Independent work pl-review-work',
              scope: { kind: 'goal' }, disposition: 'active' },
            { taskId: 'ag2b-gate', title: 'Goal gate', scope: { kind: 'goal' }, disposition: 'active' },
            { taskId: PL_REVIEW_OLD_TASK_ID, title: 'PL review old cancelled task',
              scope: { kind: 'goal' }, disposition: 'cancelled' },
          ],
          obligations: [{
            obligationId: 'ag2b-obligation', title: 'Deliver the AG2b work', requirementLevel: 'required',
            taskIds: [PL_REVIEW_CHANGED_TASK_ID, 'ag2b-gate'],
            verificationRequirements: [{
              requirementId: 'ag2b-static', requirementLevel: 'required', kind: 'static',
              description: 'Registered static command check',
            }],
          }],
          executionDag: { dependsOn: [] },
          inputRequirements: [],
        }));
      expect(input).toContain(`cancelled taskIds: ${PL_REVIEW_OLD_TASK_ID}`);
      expect(input).not.toContain(PL_REVIEW_OLD_INSTRUCTION);
      expect(input).not.toContain(`## task ${PL_REVIEW_OLD_TASK_ID}`);
      if (label === 'fix') {
        const refused = toolOutputJson(requests[1], 'pl-review-empty-fix');
        expect(refused, 'A-02: the empty fix did not reach a tool result in the same Query')
          .toBeDefined();
        expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });

        // The accepted second call's result is committed, then the barrier yields: the
        // Turn ends there, so the spare reply is never asked for.
        expect(await opened.world.scripted.pending(opened.reviewer), 'A-02: the Turn went on after the accepted call')
          .toBe(1);
        const history = reviewed.run.run.executionState?.history;
        if (history === null || history === undefined) throw new Error('A-02: the review Query has no history');
        const events = await kernelEventsOf(opened.world, history);
        const accepted = events.findIndex(event => event.type === 'tool.completed'
          && event.payload.callId === 'pl-review-fix');
        expect(events[accepted]?.payload.result?.status, 'A-02: the second call succeeds').toBe('success');
        expect(events.findIndex(event => event.type === 'run.yielded'), 'A-02: the yield follows the result')
          .toBeGreaterThan(accepted);
      }

      expect(await opened.readQueryAnswer(opened.world, reviewed.job.ref)).toBe(answer);

      const replied = await waitForResponse(opened.world, messageRef.value, 16);
      expect(replied.response).not.toBeNull();
      expect(await readBody(opened.world, messageRef.value, 'response'))
        .toBe(reply(reviewed.job.ref.queryJobId));

      if (label === 'fix') {
        const fixRound: SystemRoundV1 = { kind: 'planfix', goalRef: opened.goal,
          proposalId: opened.candidate.ref.proposalId, proposalRevision: opened.candidate.revision };
        const fixRequestId = systemRoundRequestId(fixRound);
        expect(fixRequestId.status).toBe('ready');
        if (fixRequestId.status !== 'ready') throw new Error('A-02: the planfix round has no request id');
        const fixRef = systemRoundMessageRef(S6A_SCOPE, fixRequestId.value);
        expect(fixRef.status).toBe('ready');
        if (fixRef.status !== 'ready') throw new Error('A-02: the planfix round has no message ref');
        const adviserInbox = await heartbeatUntil(opened.world,
          () => listed(opened.world, 'inbox', opened.adviser!),
          items => items.some(message => message.ref.messageId === fixRef.value.messageId), 24);
        expect(adviserInbox.some(message => message.ref.messageId === fixRef.value.messageId)).toBe(true);
        const fixQuery = await awaitPlanningAnswer(opened.world, fixRef.value, 24);
        expect(fixQuery, 'A-02: the planfix message produced no answered adviser Query').not.toBeNull();
        if (fixQuery === null) throw new Error('A-02: no planfix Query');
        const fixPrepared = fixQuery.run.run.executionState?.prepared;
        if (fixPrepared === undefined || fixPrepared === null) throw new Error('A-02: the planfix Query froze no manifest');
        const fixManifest = (await opened.world.post('materials/open', plain(S6A_SCOPE, {
          ref: fixPrepared.bundleRef, usage: 'historical_explanation',
        }))).body as { value: { body: string } };
        const fixTools = (JSON.parse(fixManifest.value.body) as PreparedQueryManifestV1).promptSet.toolNames;
        expect(fixTools, 'A-02: the planfix Query must freeze the round tool, not the review tool')
          .toContain('submit_plan_round');
        expect(fixTools).not.toContain('submit_plan_review');
      }
    } finally {
      await opened.close();
    }
  });

  it('pass-with-findings does not stop the automatic adoption', async () => {
    const chain = await runPLAutomaticChain('a02-findings', { reviewReply: { kind: 'calls', calls: [{
      callId: 'a02-pass-findings', name: 'submit_plan_review',
      args: { verdict: 'pass', findings: [{ taskId: null, text: '可选意见' }] },
    }] } });
    try {
      await chain.release();
      const accepted = await readProposal(chain.workflow.world, chain.candidate.ref);
      expect(accepted.status, 'A-02: findings on a pass must not hold the candidate back').toBe('accepted');
      expect((await chain.workflow.main.activePlan(chain.workflow.goal))?.planRevision)
        .toBe(accepted.draft.planRevision);
    } finally {
      await chain.workflow.close();
    }
  }, 120_000);
});
