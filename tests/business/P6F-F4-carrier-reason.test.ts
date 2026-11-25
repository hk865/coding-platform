/**
 * P6F F4 (p6f-rulings.md F4; P6 E08): a plan change that cancels the only active required carrier of an
 * obligation is refused, and the refusal says how to get out (121-111: every refusal names its reason and a way
 * out). The rule itself does not change: still `invalid`, still about the carrier, the active Plan stays.
 * Refusal reason: a product rule (a required obligation keeps an active required work or gate carrier,
 * `plan-validation.ts` `validateFutureObligationCoverage`).
 *
 * World: PL-50(c)'s single-stage Plan through public `plans/propose` + `plans/apply`; `pl-a` is the obligation's
 * only carrier (the E08 shape: `t-sub` was the only task in `o-sub.taskIds`). Hand-computed: the base reason is
 * the bare fact ("... no longer has a valid active required carrier") with no instruction in it; the ruled reason
 * adds what to change, e.g. "add an active required task to its taskIds" or "cancel the obligation with it".
 * The builder writes the words, so the row checks for a remedy verb, not one exact sentence.
 * Named mutation: the refusal keeps only the fact sentence (today's text) -> red at the remedy assertion.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, ready } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLPlanDraft, openPLWorkflowWorld, plPlanChangeDraft, plSingleStageDraft, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close().catch(() => undefined); opened = null; });

/** An imperative remedy: what to add, keep, cancel or replace. None of these words is in today's reason. */
const REMEDY = /\b(add|adds|put|keep|include|list|cancel|drop|remove|replace|move|carry|carried)\b/i;

describe('rejects: cancelling the only required carrier says how to fix the plan (product rule)', () => {
  it('F4: the refusal names the obligation and a way out; the active Plan stays', async () => {
    const world = opened = await openPLWorkflowWorld({ label: 'p6f-f4',
      extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
    const adopted = await adoptPLPlanDraft(world.main, world.goal, plSingleStageDraft(world.goal, {
      label: 'p6f-f4', taskIds: ['pl-a', 'pl-b'], carrierTaskIds: ['pl-a'] }), 'p6f-f4');
    const obligationId = 'pl-obligation-stage-1';
    expect(adopted.obligations.find(entry => entry.obligationId === obligationId)?.taskIds).toEqual(['pl-a']);

    const cancelled = plPlanChangeDraft(adopted, world.goal, { planId: 'pl-plan-p6f-f4-cancel',
      tasks: adopted.tasks.map(task => task.taskId === 'pl-a' ? { ...task, disposition: 'cancelled' } : task),
      assignments: adopted.assignments ?? [], obligations: adopted.obligations });
    const proposed = await world.main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: world.goal, basedOn: adopted.ref, draft: cancelled,
      reason: { text: 'P6F F4 cancel pl-a', sources: [], affectedTaskIds: ['pl-a'] },
    }, 'p6f-f4-propose')) as { status: string; code?: string; reason?: string;
      value?: { ref: unknown; revision: number } };
    // The refusal may come at propose or at apply; either way it is the same carrier rule and the same text.
    const refused = proposed.status !== 'committed' ? proposed
      : await world.main.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.value!.ref,
        expectedProposalRevision: proposed.value!.revision, decisionRefs: [] }, 'p6f-f4-apply')) as {
        status: string; code?: string; reason?: string };

    expect(refused, JSON.stringify(refused)).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: expect.stringContaining(obligationId) });
    expect(refused.reason, 'the refusal states the fact only; it must also say what to change').toMatch(REMEDY);
    const goal = ready<{ goal: { activePlanRevision: unknown } }>(await world.world.post('goals/read', {
      scope: { ...S6A_SCOPE }, input: world.goal }), 'goals/read');
    expect(goal.goal.activePlanRevision).toEqual(adopted.ref);
  });
});
