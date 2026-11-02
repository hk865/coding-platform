/**
 * PL-09: a candidate deletes a required obligation (spec §15 PL-09; v3 §9-9; 5.6).
 *
 * The adopted Plan carries the stage-1 acceptance obligation. A candidate built through the real
 * `plans/propose` removes that obligation; it is stored as `candidate` (with its `issues` diagnosis) and the
 * real `plans/apply` refuses it with the existing coverage rejection. The active Plan revision does not move,
 * the candidate card keeps its ordinary source pins/status and carries no rejection reason, and the same human
 * `plans/apply` input cannot bypass the rule.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import {
  adoptPLPlanDraft, openPLWorkflowWorld, plPlanChangeDraft, plSkeletonDraft, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const DELETED_OBLIGATION = 'pl-obligation-extra';
const MISSING_REASON = `source obligation ${DELETED_OBLIGATION} is missing from the candidate`;

describe('PL-09: a candidate that deletes a required obligation cannot be adopted', () => {
  it('PL-09: the candidate is stored, apply refuses it, the active Plan and the card stay, and a human retry cannot bypass',
    async () => {
      const workflow = opened = await openPLWorkflowWorld({ label: 'pl09' });
      const goal = workflow.goal;
      // The adopted Plan carries one extra required obligation on a single work task, so deleting it keeps
      // every task mapped by the main stage obligation and leaves only the missing source obligation to judge.
      const base = plSkeletonDraft(goal, { label: 'pl09', stageOneTaskIds: ['pl-a', 'pl-b'] });
      const plan = await adoptPLPlanDraft(workflow.main, goal, {
        ...base,
        obligations: [...base.obligations, {
          obligationId: DELETED_OBLIGATION,
          title: 'PL-09 extra required obligation',
          requirementLevel: 'required',
          taskIds: ['pl-a'],
          verificationRequirements: [{
            requirementId: 'pl-09-extra-check', requirementLevel: 'required',
            kind: 'static', description: 'PL-09 extra static check',
          }],
        }],
      }, 'pl09');
      const candidateDraft = plPlanChangeDraft(plan, goal, {
        planId: 'pl-plan-pl09-revision-2',
        tasks: plan.tasks,
        assignments: plan.assignments ?? [],
        obligations: plan.obligations.filter(obligation => obligation.obligationId !== DELETED_OBLIGATION),
      });
      const proposed = await workflow.main.post('plans/propose', graphWrite(workflow.main.scope, {
        goalRef: goal, basedOn: plan.ref, draft: candidateDraft,
        reason: { text: 'PL-09 deletes the required stage obligation', sources: [] },
      }, 'pl09-propose')) as { status: string; value?: { ref: unknown; revision: number } };
      expect(proposed.status, 'the deletion candidate is stored by the real plans/propose').toBe('committed');
      if (proposed.value === undefined) throw new Error('PL-09: the candidate did not commit');
      const candidateRef = proposed.value;

      const candidate = ready<PlanProposal>(await workflow.main.route('plans/proposal', candidateRef.ref),
        'plans/proposal');
      expect(candidate.status, 'the stored candidate waits, it is not rejected at propose').toBe('candidate');
      expect(Array.isArray(candidate.issues), 'the candidate carries the ordinary diagnosis field').toBe(true);

      // The real apply refuses the missing source obligation; it is the existing coverage rejection.
      const refused = await workflow.main.post('plans/apply', graphWrite(workflow.main.scope, {
        proposalRef: candidateRef.ref, expectedProposalRevision: candidateRef.revision, decisionRefs: [],
      }, 'pl09-apply')) as { status: string; code?: string; reason?: string };
      expect(refused.status, 'the real plans/apply rejects the deletion candidate').toBe('rejected');
      expect(refused.code, 'the existing coverage rejection code').toBe('invalid');
      expect(refused.reason, 'the rejection names the missing source obligation').toContain(MISSING_REASON);

      // The active Plan is exactly the one adopted before the candidate was written.
      const after = await workflow.main.activePlan(goal);
      expect(after?.ref, 'the active Plan ref is unchanged').toEqual(plan.ref);
      expect(after?.planRevision, 'the active Plan revision is unchanged').toBe(plan.planRevision);

      // The card is the candidate's ordinary card: source pins, waiting state and candidate status only.
      const card = (await workflow.main.readCards(goal)).find(entry =>
        entry.source.kind === 'candidate'
        && entry.source.pins.some(pin => (pin.ref as { aggregateType?: string }).aggregateType === 'PlanProposal'));
      expect(card, 'the candidate card is readable').toBeDefined();
      expect(card?.state).toBe('waiting_answer');
      expect(card?.candidateStatus, 'the card checks the existing candidate status').toBe('candidate');
      expect(card?.staleReason).toBeNull();
      expect(card?.source.pins.some(pin =>
        (pin.ref as { aggregateType?: string }).aggregateType === 'PlanRevision'
        && (pin.ref as { planId?: string }).planId === plan.planId),
      'the card pins the active Plan it was based on').toBe(true);
      expect(card?.source.pins.find(pin => pin.ref.aggregateType === 'PlanProposal'),
        'the card pins this candidate at its stored revision')
        .toEqual({ ref: candidateRef.ref, revision: candidateRef.revision });
      expect(JSON.stringify(card), 'the card does not carry the apply rejection reason').not.toContain(MISSING_REASON);

      // The same human route repeated: the rejection is a rule, not a one-shot failure.
      const retried = await workflow.main.post('plans/apply', graphWrite(workflow.main.scope, {
        proposalRef: candidateRef.ref, expectedProposalRevision: candidateRef.revision, decisionRefs: [],
      }, 'pl09-apply-retry')) as { status: string; code?: string; reason?: string };
      expect(retried).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(retried.reason).toContain(MISSING_REASON);
      expect((await workflow.main.activePlan(goal))?.ref, 'the retry did not move the active Plan').toEqual(plan.ref);
    }, 120_000);
});
