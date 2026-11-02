/**
 * PL-16 (adoption reply): a person's planning message M got its one close-out
 * reply when P1 was written. A later fix round writes P2 with M as the same
 * reply target (the planfix lineage root); adopting P2 must read M and skip it.
 * Writing P2's new answer into the slot is `source_stale` after the adoption has
 * already committed (spec `:1129`, `:2586`; P2's refusal is `intervention.ts:209`).
 */
import { afterEach, expect, it } from 'vitest';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { awaitProposal, proposalRefOf, waitForResponse } from '../helpers/IV-host-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, plStageTwoDraft, plSystemRoundRef,
  plToolPlanOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

type Advance = {
  state: string;
  receipt: { kind: string; result: { status: string } } | null;
  next: { kind: string } | null;
};

/** The one send the Goal selected, performed through the public advance route. */
async function performSend(workflow: PLWorkflowWorld, flowId: string): Promise<void> {
  const send = await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId, sessionHint: null, kind: 'select_work' }, 'send_system_round');
  if (send.kind !== 'perform' || send.operation.kind !== 'send_system_round') {
    throw new Error(`PL-16 reply: the selection did not reach a send: ${JSON.stringify(send)}`);
  }
  ready<Advance>(await workflow.world.post('workflow/advance', plain(S6A_SCOPE, send)), `the ${flowId} send`);
}

it('PL-16: adoption skips a person message that already has its close-out reply', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-16-reply',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-16-reply', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const adviser = await createPLAdviserLine(workflow.world, 'pl-16-reply-adviser');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-16-reply-reviewer');
  const planArgs = (label: string) => ({ answerKind: 'plan' as const, summary: `PL-16 ${label}`,
    plan: plToolPlanOf(plStageTwoDraft(skeleton.plan, workflow.goal, label)),
    reason: { text: `PL-16 ${label}`, affectedTaskIds: ['pl-placeholder-pl-stage-2'] } });
  await workflow.world.scripted.script(adviser, [
    { kind: 'calls', calls: [{ callId: 'pl-16-reply-p1', name: 'submit_plan_round', args: planArgs('p1') }] },
    { kind: 'calls', calls: [{ callId: 'pl-16-reply-p2', name: 'submit_plan_round', args: planArgs('p2') }] },
  ]);
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-16-reply-fix', name: 'submit_plan_review',
      args: { verdict: 'fix', findings: [{ taskId: 'pl-placeholder-pl-stage-2', text: 'PL-16 fix' }] } }] },
    { kind: 'calls', calls: [{ callId: 'pl-16-reply-pass', name: 'submit_plan_review',
      args: { verdict: 'pass', findings: [] } }] },
  ]);

  // M: the person's planning message. P1 is written and M gets its one close-out reply.
  const sent = await sendS7A2PersonMessage(workflow.world, { label: 'pl-16-reply',
    recipient: adviser.ref, goal: workflow.goal });
  const replied = await waitForResponse(workflow.world, sent.ref);
  expect(replied.response, JSON.stringify(replied)).not.toBeNull();
  const p1 = ready<{ ref: { proposalId: string }; sourceMessageRef: unknown }>(
    await awaitProposal(workflow.world, proposalRefOf(sent.ref, workflow.goal)), 'P1');
  expect(p1.sourceMessageRef).toEqual(sent.ref);

  // P1's review asks a fix; the adviser's P2 is the later candidate over the same M.
  await performSend(workflow, 'pl-16-reply-review-p1');
  await waitForResponse(workflow.world,
    await plSystemRoundRef(workflow, reviewer, `planreview:${p1.ref.proposalId}:`));
  await performSend(workflow, 'pl-16-reply-fix');
  const p2 = ready<{ ref: { proposalId: string }; basedOn: unknown }>(
    await awaitProposal(workflow.world,
      proposalRefOf(await plSystemRoundRef(workflow, adviser, 'planfix:'), workflow.goal)), 'P2');
  expect(p2.ref.proposalId).not.toBe(p1.ref.proposalId);

  // P2's review passes, then the Goal selects the adoption.
  await performSend(workflow, 'pl-16-reply-review-p2');
  await waitForResponse(workflow.world,
    await plSystemRoundRef(workflow, reviewer, `planreview:${p2.ref.proposalId}:`));
  const adopt = await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-16-reply-adopt', sessionHint: null, kind: 'select_work' }, 'adopt_plan');

  // The adoption commits, then the already-answered M is skipped (not `source_stale`).
  const body = (await workflow.world.post('workflow/advance', plain(S6A_SCOPE, adopt))).body as
    { status: string; code?: string; reason?: string; value?: Advance };
  expect(body.status, JSON.stringify(body)).toBe('ready');
  const adopted = body.value;
  if (adopted === undefined) throw new Error('PL-16 reply: the adoption returned no value');
  expect(adopted.receipt).toMatchObject({ kind: 'adopt_plan', result: { status: 'committed' } });
  expect(adopted.state).toBe('advance');

  // M keeps the one close-out reply it already had; P2 is the accepted candidate.
  const after = ready<{ response: unknown }>(await workflow.world.post('messages/read', plain(S6A_SCOPE, sent.ref)),
    'the person message after adoption');
  expect(after.response).toEqual(replied.response);
  const accepted = ready<{ status: string }>(await workflow.world.post('plans/proposal',
    plain(S6A_SCOPE, p2.ref)), 'P2 after adoption');
  expect(accepted.status).toBe('accepted');
});
