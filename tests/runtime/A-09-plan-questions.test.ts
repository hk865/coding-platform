/**
 * A-09: the planning round's questions branch through the real Host. The same
 * `refine:` planning Query freezes `submit_plan_round` alone; the scripted
 * model calls it with `answerKind:'questions'`, the saved answer is the v2
 * `needs_decision` with its non-empty questions (never `kind:'plan'`), the
 * target loop produces the planning-question card with no candidate/adoption,
 * and the tool table still has no `submit_initial_questions`.
 *
 * PL P3-05 / ruling line 7: no hand-made ctx and no direct handler. The F0
 * world drives to its `plan_only` gap, but the goal loop stops at the missing
 * `planCandidates` wiring (L); P4's `refine:` route is the next stop. The
 * questions form and public card/answer reads after those points are
 * executable and are reported as not proven until the gaps close.
 */
import { describe, expect, it } from 'vitest';
import {
  systemRoundMessageRef, systemRoundRequestId, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import {
  awaitPlanningAnswer, heartbeatUntil, proposalRefOf, questionCards, readQueryAnswer,
} from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';

const SUMMARY = 'A-09 needs a decision';
const QUESTIONS = ['Which module owns the interface?', 'Should the next segment wait?'];

describe('A-09: the questions branch through the adviser Host line', () => {
  it('drives the plan_only gap to a refine round, then accepts questions as needs_decision', async () => {
    const opened = await openPlanOnlyWorld('a09');
    try {
      await startGoalDriver(opened.world, opened.goal, 'a09-plan-questions');
      const snapshot = ready<CollaborationSnapshot>(await driverRead(opened.world, opened.goal),
        'the A-09 driver read');
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
      if (requestId.status !== 'ready') throw new Error('A-09: the refine round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      expect(messageRef.status).toBe('ready');
      if (messageRef.status !== 'ready') throw new Error('A-09: the refine round has no message ref');

      // The one form the advisor submits: it asks the person, never writes a plan.
      await opened.world.scripted.script(opened.adviser, [{ kind: 'calls', calls: [{
        callId: 'a09-questions', name: 'submit_plan_round',
        args: { answerKind: 'questions', summary: SUMMARY, questions: QUESTIONS },
      }] }]);

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
        + 'The questions form, the v2 needs_decision answer, the planning-question card and the '
        + 'submit_initial_questions tool table are written after this stop and are not proven until '
        + 'P4 closes it.').toBe(true);

      const planning = await awaitPlanningAnswer(opened.world, messageRef.value);
      expect(planning, 'A-09: the questions round produced no answered planning Query').not.toBeNull();
      if (planning === null) throw new Error('A-09: no planning Query');
      const answerText = await readQueryAnswer(opened.world, planning.job.ref);
      expect(answerText).not.toBeNull();
      if (answerText === null) throw new Error('A-09: the questions round saved no answer');
      const answer = JSON.parse(answerText) as {
        schemaVersion: number; kind: string; summary: string; questions: string[];
      };
      expect(answer).toEqual({
        schemaVersion: 2, kind: 'needs_decision', summary: SUMMARY, questions: QUESTIONS,
      });
      expect(answer.kind).not.toBe('plan');
      expect(answer.questions.length).toBeGreaterThan(0);

      const requests = await opened.world.scripted.requests(opened.adviser);
      const tools = requests[0]?.tools.map(tool => tool.name) ?? [];
      expect(tools).toContain('submit_plan_round');
      expect(tools).not.toContain('submit_initial_questions');
      expect(tools).not.toContain('submit_plan_review');
      expect(tools).not.toContain('submit_secretary_answer');

      // The goal loop's public card read shows the questions and writes no
      // candidate; the adopted Plan stays revision 1.
      const cards = await heartbeatUntil(opened.world,
        () => questionCards(opened.world, opened.goal), seen => seen.length > 0, 16);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]?.source).toMatchObject({ kind: 'planning_question' });
      const main = s6aCardsWorkspace(opened.world, S6A_SCOPE);
      const all = await main.readCards(opened.goal);
      expect(all.filter(card => card.source.kind === 'candidate' && card.closedReason === null)).toEqual([]);
      expect((await opened.world.post('plans/proposal', plain(S6A_SCOPE,
        proposalRefOf(messageRef.value, opened.goal)))).body, 'A-09: the questions branch writes no candidate')
        .toMatchObject({ status: 'not_found' });
      expect(ready<{ pendingPlan: unknown }>((await opened.world.post('goals/read',
        plain(S6A_SCOPE, opened.goal))).body, 'the A-09 Goal').pendingPlan).toBeNull();
      const active = await main.activePlan(opened.goal);
      expect(active?.planRevision).toBe(1);
    } finally {
      await opened.close();
    }
  }, 120_000);
});
