/**
 * A-03: the review round's text fallback through the real Host. The model does
 * not call `submit_plan_review` although the Query froze it; its final assistant
 * text is the review answer. (a) a legal `pass` shape is saved verbatim, parses
 * and still gets its associated reply; (b) `pass` with findings is accepted;
 * (c) a bad terminal text turns the candidate into the `review_invalid` card,
 * with no resend, no re-review and no adoption.
 *
 * No hand-made ctx, direct handler or accepted-call set.
 */
import { describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';
import {
  candidateCards, heartbeat, heartbeatUntil, readBody, readPlanningQuery, readProposal, sessionQueries,
  waitForResponse,
} from '../helpers/IV-host-fixture.js';
import { openPLReviewCandidateWorld } from '../helpers/PL-forms-fixture.js';
import { runPLAutomaticChain } from '../helpers/PL-workflow-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { parsePlanReviewAnswer } from '../../src/contracts/plan-review.js';
import { systemRoundRequestId, type SystemRoundV1 } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';

const PASS_EMPTY = '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}';
const PASS_FINDING = '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":'
  + '[{"taskId":null,"text":"可选意见"}]}';
const FIX_TEXT = '{"schemaVersion":1,"kind":"plan_review","verdict":"fix","findings":'
  + '[{"taskId":"pl-review-work","text":"把先看什么写进 instruction"}]}';

describe('A-03: the review text fallback through the reviewer Host line', () => {
  it.each([
    { label: 'legal pass text', text: PASS_EMPTY, reply: '审阅通过',
      parsed: { status: 'parsed' as const, verdict: 'pass' as const, findings: [] } },
    { label: 'pass with findings', text: PASS_FINDING, reply: '审阅通过',
      parsed: { status: 'parsed' as const, verdict: 'pass' as const,
        findings: [{ taskId: null, text: '可选意见' }] } },
    { label: 'bad terminal text', text: 'not a review answer', reply: null, parsed: null },
  ])('$label: the saved text, its reply and the card', async ({ label, text, reply, parsed }) => {
    const opened = await openPLReviewCandidateWorld();
    try {
      await opened.script([{ kind: 'text', text }]);
      await startGoalDriver(opened.world, opened.goal, `pl-review-text-${label.replaceAll(' ', '-')}-flow`);

      const round: SystemRoundV1 = { kind: 'planreview', goalRef: opened.goal,
        proposalId: opened.candidate.ref.proposalId, proposalRevision: opened.candidate.revision };
      const requestId = systemRoundRequestId(round);
      expect(requestId.status).toBe('ready');
      if (requestId.status !== 'ready') throw new Error('A-03: the review round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      expect(messageRef.status).toBe('ready');
      if (messageRef.status !== 'ready') throw new Error('A-03: the review round has no message ref');

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
      if (reviewed === null) throw new Error('A-03: no review Query');

      const requests = await opened.world.scripted.requests(opened.reviewer);
      const tools = requests[0]?.tools.map(tool => tool.name) ?? [];
      expect(tools, 'A-03: the review Query must still freeze the review submit tool')
        .toContain('submit_plan_review');
      expect(tools).not.toContain('submit_plan_round');
      expect(tools).not.toContain('submit_secretary_answer');

      expect(await opened.readQueryAnswer(opened.world, reviewed.job.ref)).toBe(text);
      if (parsed !== null) expect(parsePlanReviewAnswer(text)).toEqual(parsed);

      if (reply !== null) {
        const replied = await heartbeatUntil(opened.world,
          () => readS7BMessage(opened.world, messageRef.value),
          message => message.response !== null, 16);
        expect(replied.response, 'A-03: a text-only review still gets its associated reply').not.toBeNull();
        expect(await readBody(opened.world, messageRef.value, 'response')).toBe(reply);
      } else {
        // A terminal bad answer gets one more heartbeat: no resend, no re-review
        // of the same candidate and no adoption.
        await waitDriver(opened.world, opened.goal, undefined,
          snapshot => snapshot.reason?.includes('plan_candidate_waiting') === true,
          'A-03: the goal loop read the bad conclusion and parked on the card');
        await heartbeat(opened.world);
        const afterHeartbeat = await readPlanningQuery(opened.world, messageRef.value);
        expect(afterHeartbeat?.job.job.answerRefs).toEqual(reviewed.job.job.answerRefs);
        const cards = await candidateCards(opened.world, opened.goal);
        expect(cards.some(card => card.closedReason === null), 'A-03: the candidate stays on an open card').toBe(true);
        const candidateCard = (await opened.world.post('decisions/candidate-card', plain(S6A_SCOPE, {
          goalRef: opened.goal, proposalRef: opened.candidate.ref,
        }))).body;
        expect(candidateCard, 'A-03: the card carries the terminal review reason').toMatchObject({
          status: 'ready', value: { exactReview: { status: 'ready', value: { status: 'terminal_invalid' } } },
        });
        const inbox = await listed(opened.world, 'inbox', opened.reviewer);
        expect(inbox.filter(message => message.ref.messageId === messageRef.value.messageId)).toHaveLength(1);
        const proposal = ready<{ status: string; basedOn: unknown }>((await opened.world.post('plans/proposal',
          plain(S6A_SCOPE, opened.candidate.ref))).body, 'the review candidate read');
        expect(proposal.status).toBe('candidate');
        expect((await readS7BMessage(opened.world, messageRef.value)).response,
          'A-03: a text that does not parse makes no reply').toBeNull();
        expect(await opened.world.scripted.requests(opened.reviewer), 'A-03: no second review model request')
          .toHaveLength(1);
        expect(await sessionQueries(opened.world, opened.reviewer), 'A-03: no second review Query').toHaveLength(1);
        expect(inbox.filter(message => message.intent === 'action_request'), 'A-03: no second review request')
          .toHaveLength(1);
        expect((await opened.main.activePlan(opened.goal))?.ref, 'A-03: nothing was adopted').toEqual(proposal.basedOn);
      }
    } finally {
      await opened.close();
    }
  });

  it.each([
    { label: 'pass', text: PASS_EMPTY },
    { label: 'pass with findings', text: PASS_FINDING },
  ])('$label as text: the goal loop adopts automatically', async ({ label, text }) => {
    const chain = await runPLAutomaticChain(`a03-${label.replaceAll(' ', '-')}`, {
      reviewReply: { kind: 'text', text },
    });
    try {
      await chain.release();
      const accepted = await readProposal(chain.workflow.world, chain.candidate.ref);
      expect(accepted.status, 'A-03: a legal text pass follows the same adoption table').toBe('accepted');
      expect((await chain.workflow.main.activePlan(chain.workflow.goal))?.planRevision)
        .toBe(accepted.draft.planRevision);
    } finally {
      await chain.workflow.close();
    }
  }, 120_000);

  it('fix as text: the goal loop sends planfix and the candidate is not adopted', async () => {
    const opened = await openPLReviewCandidateWorld({ adviser: true });
    try {
      await opened.script([{ kind: 'text', text: FIX_TEXT }]);
      await opened.world.scripted.script(opened.adviser!, [{ kind: 'text', text: 'A-03 fix round reply' }]);
      await startGoalDriver(opened.world, opened.goal, 'pl-review-text-fix-flow');
      const refOf = (kind: 'planreview' | 'planfix') => {
        const requestId = systemRoundRequestId({ kind, goalRef: opened.goal,
          proposalId: opened.candidate.ref.proposalId, proposalRevision: opened.candidate.revision });
        if (requestId.status !== 'ready') throw new Error('A-03: the round has no request id');
        const ref = systemRoundMessageRef(S6A_SCOPE, requestId.value);
        if (ref.status !== 'ready') throw new Error('A-03: the round has no message ref');
        return ref.value;
      };
      const review = await heartbeatUntil(opened.world, () => readPlanningQuery(opened.world, refOf('planreview')),
        record => record?.job.job.status === 'answered', 24);
      if (review === null) throw new Error('A-03: no review Query');
      expect(await opened.readQueryAnswer(opened.world, review.job.ref)).toBe(FIX_TEXT);
      await waitForResponse(opened.world, refOf('planreview'), 24);
      expect(await readBody(opened.world, refOf('planreview'), 'response'))
        .toBe(`审阅要求返修：1 条意见，见 Query ${review.job.ref.queryJobId}`);
      const inbox = await heartbeatUntil(opened.world, () => listed(opened.world, 'inbox', opened.adviser!),
        items => items.some(message => message.ref.messageId === refOf('planfix').messageId), 24);
      expect(inbox.some(message => message.ref.messageId === refOf('planfix').messageId),
        'A-03: a text fix drives the same planfix round').toBe(true);
      expect((await readProposal(opened.world, opened.candidate.ref)).status).toBe('candidate');
    } finally {
      await opened.close();
    }
  }, 120_000);
});
