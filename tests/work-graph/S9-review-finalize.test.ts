/**
 * S9 G5 R10a/R10b (spec §3.7): a real non-review Query's frozen table carries no `submit_exec_review` and its tool
 * entry refuses the call; the one `finalizeChecks` attribution layer refuses another round's/Task's Evidence with
 * `forbidden` while admitting the current round's booked ref. Public entries only; expected literals from the spec.
 * R10a mutation: `finalToolNamesOf` appends `submit_exec_review` to every Query (red: the frozen table carries it and
 * the preparation no longer matches). R10b mutation: the reviewer-count pre-IO guard rejects `count>0` as
 * `unsupported` (`verification-machine.ts:1138`; the spec cites 1098) (red: all three negatives get `unsupported` and
 * the control never commits). Green today; gaps: none. R10a builds a real `answerShape:'plan_round'` Query through
 * `queries/submit` → `claim` → `prepare` → `start` on the work line; the frozen plan_review variant (6C) was not
 * reachable within this file's budget.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { EvidenceRef } from '../../src/contracts/evidence.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { queryJobRefFor } from '../../src/contracts/query-job.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import { advanceUntil, driveWorkflow, readQuery } from '../helpers/A2-restart-fixture.js';
import { AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORKSPACE_REF, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { claimedRunOf, ready, receiptOf, sessionOf } from '../helpers/S7A-fixture.js';
import { claimQuery, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import {
  advanceS9Review, answerS9Review, bookS9Review, completeS9Task, finalizeS9Review, openS9ReviewRound, openS9ReviewWorld,
  s9ReviewDraft, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });
const s9Open = async (options?: Parameters<typeof openS9ReviewWorld>[0]) => {
  const review = await openS9ReviewWorld(options); worlds.push(review); return review; };
const roundOfS9 = async (review: S9ReviewWorld, ref: VerificationRoundRef): Promise<RoundSnapshot> => {
  const read = await review.world.platform.evidence.readVerification(review.world.humanContext(), ref);
  if (read.status !== 'ready') throw new Error(`S9: the round ${ref.roundId} is not readable`);
  return read.value;
};
const snapshot = async (review: S9ReviewWorld, ref: VerificationRoundRef) => {
  const round = await roundOfS9(review, ref);
  return { revision: round.revision, evidenceRefs: round.evidenceRefs, outcome: round.outcome };
};
const nextOfS9 = (result: unknown): WorkflowAdvanceInput => {
  const next = (result as { value?: { next?: WorkflowAdvanceInput | null } }).value?.next;
  if (next === null || next === undefined) throw new Error(`S9: the advance has no next: ${JSON.stringify(result)}`);
  return next;
};
const reviewStep = (operation: { kind: string }): boolean =>
  operation.kind === 'send_system_round' || operation.kind === 'finalize_checks';
/** R10b ②'s other round: the same Task's rework opens a new Run and a new (root) chain, same anchor/plan. */
const rework = async (review: S9ReviewWorld) => {
  await review.world.scripted.script(review.workLine, [{ kind: 'text', text: 'S9 rework done' }]);
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(review.world.ag2b, nextOfS9(await advanceS9Review(review)),
    { receipts, stopBefore: reviewStep });
  const roundRef = (receiptOf(receipts, 'open_checks')?.result as { value?: { ref?: VerificationRoundRef } }
    | undefined)?.value?.ref;
  if (roundRef === undefined) throw new Error('S9: the rework opened no round');
  return { roundRef, subjectRunRef: claimedRunOf(receipts, review.task.taskId).run,
    next: steps.at(-1)?.next ?? null };
};
/** R10b ③'s other Task: a second required work Task with one static check, driven to a finalized round. */
const twoTaskDraft = (goal: GoalRef): PlanRevisionDraft => {
  const base = s9ReviewDraft(goal);
  const other = { taskId: 's9-other', title: 'S9 other work', requirementLevel: 'required' as const,
    taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
    scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const };
  return { ...base, tasks: [...base.tasks, other], assignments: [...(base.assignments ?? []), { taskId: other.taskId,
    role: S6A_WORK_ROLE.templateId, instruction: 'Do the other S9 work' }],
    obligations: [...base.obligations, { obligationId: 's9-other-obligation', title: 'S9 other acceptance',
      requirementLevel: 'required' as const, taskIds: [other.taskId], verificationRequirements: [{ requirementId: 's9-other-static',
        requirementLevel: 'required' as const, kind: 'static', description: 'Registered static command check' }] }] };
};
const otherTaskEvidence = async (review: S9ReviewWorld): Promise<EvidenceRef> => {
  const other = { ...review.task, taskId: 's9-other' };
  const line = await sessionOf(review.world, await createS6BLine(review.main, { label: 's9-r10b-other',
    role: S6A_WORK_ROLE, tasks: [other] }));
  await review.world.scripted.script(line, [{ kind: 'text', text: 'S9 other work done' }]);
  const claim = await advanceUntil(review.world.ag2b, { schemaVersion: 1, goalRef: review.goal,
    flowId: 's9-r10b-other', sessionHint: line.ref, kind: 'select_work', taskId: other.taskId }, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(review.world.ag2b, claim, { receipts, stopBefore: reviewStep });
  const ref = (receiptOf(receipts, 'open_checks')?.result as { value?: { ref?: VerificationRoundRef } } | undefined)
    ?.value?.ref;
  if (ref === undefined) throw new Error('S9: the other Task opened no round');
  expect(await advanceS9Review(review, steps.at(-1)!.next!)).toMatchObject({ status: 'ready',
    value: { receipt: { kind: 'finalize_checks', result: { status: 'committed' } } } });
  const round = await roundOfS9(review, ref);
  expect(round).toMatchObject({ subject: { taskId: 's9-other' }, status: 'finalized', outcome: 'PASS' });
  expect(round.evidenceRefs).not.toHaveLength(0);
  return round.evidenceRefs[0]!;
};
const expectRefused = async (review: S9ReviewWorld, ref: VerificationRoundRef, bad: EvidenceRef, id: string) => {
  const before = await snapshot(review, ref);
  expect(await finalizeS9Review(review, ref, id, [bad])).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await snapshot(review, ref)).toEqual(before);
  expect(await completeS9Task(review, ref, `${id}-complete`)).toMatchObject({ status: 'rejected', code: 'incomplete' });
};

describe('R10b ①: the previous round\'s finalized review ref cannot be this round\'s', () => {
  it('a same-chain FAIL ref → forbidden, unchanged, still incomplete; the chain supersedes it', async () => {
    const review = await s9Open();
    const first = await openS9ReviewRound({ review });
    const fix = await answerS9Review(review, 'fix', { round: first });
    const previous = await bookS9Review(review, fix.roundRef, 'r10b-a-book');
    expect(await finalizeS9Review(review, fix.roundRef, 'r10b-a-final', [previous]))
      .toMatchObject({ status: 'committed', value: { outcome: 'FAIL' } });
    const failed = await roundOfS9(review, fix.roundRef);
    const reverified = await review.world.platform.evidence.reverifyRound!(review.world.humanContext(), {
      input: { predecessorRoundRef: fix.roundRef },
      meta: { requestId: 'r10b-a-reverify', expected: [{ ref: fix.roundRef, revision: failed.revision }] },
    });
    if (reverified.status !== 'committed' || reverified.value.kind !== 'reverified') {
      throw new Error(`S9: the reverify opened no successor: ${JSON.stringify(reverified)}`);
    }
    const current = reverified.value.round;
    const steps = await driveWorkflow(review.world.ag2b, nextOfS9(await advanceS9Review(review)),
      { receipts: [], stopBefore: reviewStep });
    const query = await answerS9Review(review, 'pass', { round: { roundRef: current.ref,
      subjectRunRef: current.subjectRunRef, next: steps.at(-1)?.next ?? null } });
    const expected = await bookS9Review(review, query.roundRef, 'r10b-a-current');
    expect(expected.evidenceId).not.toBe(previous.evidenceId);
    await expectRefused(review, current.ref, previous, 'r10b-a-negative');
    expect((await roundOfS9(review, current.ref)).chain.supersededEvidenceIds).toContain(previous.evidenceId);
  }, 120_000);
});
describe('R10b ②: another round of the same Task and anchor/plan cannot supply this round\'s ref', () => {
  it('the rework round\'s FAIL-chain ref → forbidden; same task/plan/source, different chain', async () => {
    const review = await s9Open();
    const first = await openS9ReviewRound({ review });
    const fix = await answerS9Review(review, 'fix', { round: first });
    const previous = await bookS9Review(review, fix.roundRef, 'r10b-b-book');
    expect(await finalizeS9Review(review, fix.roundRef, 'r10b-b-final', [previous]))
      .toMatchObject({ status: 'committed', value: { outcome: 'FAIL' } });
    const failed = await roundOfS9(review, fix.roundRef);
    const reworked = await rework(review);
    const current = await roundOfS9(review, reworked.roundRef);
    expect(current).toMatchObject({ subject: { taskId: review.task.taskId }, adoptedPlanRef: failed.adoptedPlanRef,
      status: 'open', chain: { ordinal: 1, predecessorRoundRef: null } });
    expect(current.identity.sourceDigest).toBe(failed.identity.sourceDigest);
    const query = await answerS9Review(review, 'pass', { round: reworked });
    const expected = await bookS9Review(review, query.roundRef, 'r10b-b-current');
    expect(expected.evidenceId).not.toBe(previous.evidenceId);
    await expectRefused(review, reworked.roundRef, previous, 'r10b-b-negative');
  }, 120_000);
});
describe('R10b ③ + control: another Task\'s ref is refused; this round\'s booked ref finalizes PASS', () => {
  it('the other Task\'s Evidence → forbidden; then the booked ref → committed PASS and complete', async () => {
    const review = await s9Open({ draft: twoTaskDraft });
    const other = await otherTaskEvidence(review);
    const round = await openS9ReviewRound({ review });
    const query = await answerS9Review(review, 'pass', { round });
    const expected = await bookS9Review(review, query.roundRef, 'r10b-c-current');
    expect(other.evidenceId).not.toBe(expected.evidenceId);
    await expectRefused(review, round.roundRef, other, 'r10b-c-negative');
    const finalized = await finalizeS9Review(review, round.roundRef, 'r10b-c-final', [expected]);
    expect(finalized).toMatchObject({ status: 'committed', value: { outcome: 'PASS', gaps: [] } });
    const card = await roundOfS9(review, round.roundRef);
    expect(card.evidenceRefs).toContainEqual(expected);
    expect(await completeS9Task(review, round.roundRef, 'r10b-c-complete'))
      .toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
  }, 120_000);
});
describe('R10a: a real plan_round Query never freezes submit_exec_review', () => {
  it('the frozen table has no submit_exec_review; the tool entry refuses it and no exec Evidence appears', async () => {
    const review = await s9Open();
    const round = await openS9ReviewRound({ review });
    const before = await snapshot(review, round.roundRef);
    const source = await sendS7A2PersonMessage(review.world, { label: 'r10a', recipient: review.workLine.ref,
      goal: review.goal });
    const queryJobRef = queryJobRefFor(S6A_SCOPE.projectId, S6A_SCOPE.workspaceId, 's9-r10a-job');
    const queryRunRef = { aggregateType: 'QueryRun' as const, ...S6A_SCOPE, queryJobId: queryJobRef.queryJobId,
      runId: 's9-r10a-run' };
    const goal = ready<{ goal: { revision: number } }>((await review.world.post('goals/read', plain(S6A_SCOPE,
      review.goal))).body, 'the Goal');
    const submitted = await review.world.post('queries/submit', graphWrite(S6A_SCOPE, {
      queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId,
      intent: { schemaVersion: 1, intentId: queryJobRef.queryJobId, ...S6A_SCOPE, goalId: review.goal.goalId,
        question: 'S9 R10a plan round', focusTaskRefs: [], budget: AG2B_QUERY_BUDGET, multiTurn: { maxRounds: 1 },
        correlationId: 's9-r10a', execution: { kind: 'intervention_planning', answerShape: 'plan_round',
          sourceMessageRef: source.ref, roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET } },
    }, 's9-r10a-submit', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
      { ref: review.goal, revision: goal.goal.revision }, { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 }]));
    expect(submitted.body).toMatchObject({ status: 'committed' });
    expect(await claimQuery(review.world, queryJobRef, review.workLine, null, 's9-r10a-claim'))
      .toMatchObject({ status: 'committed' });
    const prepared = await prepareAttempt(review.world, queryJobRef, 's9-r10a-prepare');
    const manifest = JSON.parse(ready<{ body: string }>((await review.world.post('materials/open', plain(S6A_SCOPE,
      { ref: prepared.bundleRef, usage: 'historical_explanation' }))).body, 'the bundle').body) as PreparedQueryManifestV1;
    expect(manifest.promptSet.toolNames).toContain('submit_plan_round');
    expect(manifest.promptSet.toolNames).not.toContain('submit_exec_review');
    await review.world.scripted.script(review.workLine, [
      { kind: 'calls', calls: [{ callId: 's9-r10a-exec', name: 'submit_exec_review',
        args: { verdict: 'pass', basis: 'S9 R10a basis', report: 'S9 R10a report' } }] },
      { kind: 'calls', calls: [{ callId: 's9-r10a-plan', name: 'submit_plan_round',
        args: { answerKind: 'questions', summary: 'S9 R10a round', questions: ['S9 R10a question'] } }] },
    ]);
    expect(await start(review.world, prepared, 's9-r10a-start')).toMatchObject({ status: 'ready' });
    const refused = (await review.world.scripted.requests(review.workLine)).flatMap(request =>
      request.messages.flatMap(message => message.role === 'tool' && message.callId === 's9-r10a-exec'
        ? [message.result] : []))[0];
    expect(refused).toMatchObject({ status: 'error', error: { code: 'unknown_tool' } });
    if (refused?.status !== 'error') throw new Error(`S9: no unknown_tool refusal: ${JSON.stringify(refused)}`);
    expect(refused.error.code).not.toBe('invalid');
    const after = await readQuery(review.world.ag2b, queryJobRef);
    expect(after.job.job).toMatchObject({ status: 'answered', closeReason: null });
    expect(after.job.job.answerRefs).toHaveLength(1);
    expect(await snapshot(review, round.roundRef)).toEqual(before);
  }, 120_000);
});
