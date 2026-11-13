/**
 * A-01: the review round through the real Host. The goal loop reads the
 * `candidate`, sends `planreview:` to the reviewer line, the Host consumes it
 * and the scripted model calls `submit_plan_review` once with
 * `verdict:'pass'`/`findings:[]`. The Query's model tool table carries the
 * review submit alone, its answer is the exact review JSON, the message's
 * reply is the fixed pass text (never the JSON), and the candidate stays
 * `candidate` (adoption is the next goal-loop round, not this one).
 *
 * No hand-made ctx, direct handler or accepted-call set.
 */
import { describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import { heartbeatUntil, readBody, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import {
  openPLReviewCandidateWorld, PL_REVIEW_CHANGED_INSTRUCTION, PL_REVIEW_CHANGED_TASK_ID,
  PL_REVIEW_DEPENDS_ON, PL_REVIEW_INPUT_REQUIREMENT, PL_REVIEW_NEW_CHECK_ID, PL_REVIEW_NEW_CHECK_TEXT,
  PL_REVIEW_NEW_INSTRUCTION_A, PL_REVIEW_NEW_INSTRUCTION_B, PL_REVIEW_NEW_OBLIGATION_ID,
  PL_REVIEW_NEW_TASK_A, PL_REVIEW_NEW_TASK_B, PL_REVIEW_OLD_INSTRUCTION, PL_REVIEW_OLD_TASK_ID,
  PL_REVIEW_TASK_RELATION,
} from '../helpers/PL-forms-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  systemRoundRequestId, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';

describe('A-01: one pass review through the reviewer Host line', () => {
  it('freezes submit_plan_review, saves the exact pass answer, replies 审阅通过 and leaves the candidate', async () => {
    const opened = await openPLReviewCandidateWorld();
    try {
      await opened.script([{ kind: 'calls', calls: [{
        callId: 'pl-review-pass', name: 'submit_plan_review', args: { verdict: 'pass', findings: [] },
      }] }]);
      await startGoalDriver(opened.world, opened.goal, 'pl-review-pass-flow');

      const round: SystemRoundV1 = {
        kind: 'planreview', goalRef: opened.goal,
        proposalId: opened.candidate.ref.proposalId, proposalRevision: opened.candidate.revision,
      };
      const requestId = systemRoundRequestId(round);
      expect(requestId.status).toBe('ready');
      if (requestId.status !== 'ready') throw new Error('A-01: the review round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      expect(messageRef.status).toBe('ready');
      if (messageRef.status !== 'ready') throw new Error('A-01: the review round has no message ref');

      const inbox = await heartbeatUntil(opened.world,
        () => listed(opened.world, 'inbox', opened.reviewer),
        items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
      expect(inbox.some(message => message.ref.messageId === messageRef.value.messageId),
        'after workflow/driver-start the goal loop emits no '
        + `planreview:${opened.candidate.ref.proposalId}:${opened.candidate.revision} and the reviewer `
        + 'line has no such message. Stop point: the reviewer inbox is empty. Missing owner: P2 '
        + '(the planreview: route). L reviewer-profile injection is present in the fixture.').toBe(true);
      const reviewed = await heartbeatUntil(opened.world,
        () => readPlanningQuery(opened.world, messageRef.value),
        record => record?.job.job.status === 'answered', 16);
      expect(reviewed, 'the review message exists but the Host offers/consumes no '
        + 'review Query. Stop point: offerKindOf in src/core/work-graph/views/consumable-sessions.ts '
        + 'offers no host-system action_request. Missing owner: P2 (offerKindOf/handleIntervention).')
        .not.toBeNull();
      if (reviewed === null) throw new Error('A-01: no review Query');

      const requests = await opened.world.scripted.requests(opened.reviewer);
      const tools = requests[0]?.tools.map(tool => tool.name) ?? [];
      expect(tools).toContain('submit_plan_review');
      expect(tools).not.toContain('submit_plan_round');
      expect(tools).not.toContain('submit_secretary_answer');
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
      // The old cancelled task stays a cancelled id, never a re-copied taskbook.
      expect(input).toContain(`cancelled taskIds: ${PL_REVIEW_OLD_TASK_ID}`);
      expect(input).not.toContain(PL_REVIEW_OLD_INSTRUCTION);
      expect(input).not.toContain(`## task ${PL_REVIEW_OLD_TASK_ID}`);

      expect(await opened.readQueryAnswer(opened.world, reviewed.job.ref))
        .toBe('{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}');

      const replied = await heartbeatUntil(opened.world,
        () => readS7BMessage(opened.world, messageRef.value),
        message => message.response !== null, 16);
      expect(replied.response).not.toBeNull();
      expect(await readBody(opened.world, messageRef.value, 'response')).toBe('审阅通过');

      const proposal = ready<{ status: string }>((await opened.world.post('plans/proposal',
        plain(S6A_SCOPE, opened.candidate.ref))).body, 'the review candidate read');
      expect(proposal.status).toBe('candidate');
    } finally {
      await opened.close();
    }
  });
});
