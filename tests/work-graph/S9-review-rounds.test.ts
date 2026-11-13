/**
 * S9 G5 R1-R4 (spec §3.7): the review round from the command checks to the booked verdict and completed Goal, the
 * busy/archive history reads, the no-reviewer Task, and the FAIL→rework chain. Public entries only; expected
 * literals from the spec.
 * Named mutations: R1 `nextAfterRound` finalizes after the command checks (`workflow.ts:354`) → not send_system_round.
 * R2 `record_review` drops the booked ref (`workflow.ts:3501-3502`) → INCONCLUSIVE; `readTaskExecutionHistory`
 * refuses an occupied/archived Session (before its locator) → not ready; the packet keys coverage by bare
 * `requirementId` (`exec-review-packet.ts`) → one pair. R3 `nextAfterRound` answers 'review' unconditionally
 * (`workflow.ts:354`) → a system round. R4 the fold maps `fix` to PASS (`evidence-service.ts:1780`) → no FAIL.
 * Green today; gap: none (G1-G3); R1/R3 are the "has reviewer / has none" pair, R2 cites `S9-fold.test.ts:37-45`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import { claimQueryOn, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readBody, sessionQueries } from '../helpers/IV-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { claimedRunOf, ready, receiptOf } from '../helpers/S7A-fixture.js';
import {
  advanceS9Review, answerS9Review, bookS9Review, completeS9Task, finalizeS9Review, openS9ReviewQuery,
  openS9ReviewRound, openS9ReviewWorld, s9ReviewDraft, s9ToolResult, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
const worlds: S9ReviewWorld[] = []; afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });
const s9Open = async (options?: Parameters<typeof openS9ReviewWorld>[0]) => {
  const review = await openS9ReviewWorld(options); worlds.push(review); return review; };
type Card = { round: RoundSnapshot };
const look = async (review: S9ReviewWorld, node: Record<string, unknown>, relation: string, limit: number):
Promise<Card[]> => ready<{ items: Card[] }>(await review.world.post('graph/look', plain(S6A_SCOPE,
  { goalRef: review.goal, target: { kind: 'node', node }, relation, page: { afterCursor: null, limit } })), 'look').items;
/** The Task card's `checks` relation: each item is a round node carrying the full snapshot. */
const taskChecks = async (review: S9ReviewWorld, task: S9ReviewWorld['task'] = review.task): Promise<Card[]> => {
  const plan = await review.main.activePlan(review.goal);
  if (plan === null) throw new Error('S9: the Goal has no adopted Plan');
  return look(review, { kind: 'task', ref: task, planRef: plan.ref }, 'checks', 10); };
const roundOfS9 = async (review: S9ReviewWorld, ref: VerificationRoundRef): Promise<RoundSnapshot> => {
  const round = (await look(review, { kind: 'round', ref }, 'card', 1))[0]?.round;
  if (round === undefined) throw new Error(`S9: no round card for ${ref.roundId}`);
  return round;
};
const taskPhase = async (review: S9ReviewWorld): Promise<string | undefined> => ready<{
  tasks: { ref: { taskId: string }; effectivePhase: string }[] }>(await review.world.post('tasks/query',
  plain(S6A_SCOPE, { goalRef: review.goal })), 'the Task graph').tasks.find(row => row.ref.taskId === review.task.taskId)?.effectivePhase;
const goalDisplay = async (review: S9ReviewWorld): Promise<{ phase: string }> => ready<{ display: { phase: string } }>(
  await review.world.post('goals/display', plain(S6A_SCOPE, { goalRef: review.goal })), 'the Goal display').display;
const nextOfS9 = (result: unknown): WorkflowAdvanceInput => {
  const next = (result as { value?: { next?: WorkflowAdvanceInput | null } }).value?.next;
  if (next === null || next === undefined) throw new Error(`S9: the advance has no next: ${JSON.stringify(result)}`);
  return next;
};
const operationKind = (next: unknown): string | null => typeof next === 'object' && next !== null
  && (next as { kind?: string }).kind === 'perform' ? (next as { operation: { kind: string } }).operation.kind : null;
const selectSubject = (review: S9ReviewWorld) => ({ schemaVersion: 1 as const, goalRef: review.goal,
  flowId: 's9-review-subject', sessionHint: review.workLine.ref, kind: 'select_work' as const, taskId: review.task.taskId });
const selectGoal = (review: S9ReviewWorld) => ({ schemaVersion: 1 as const, goalRef: review.goal,
  flowId: 's9-review-goal', sessionHint: null, kind: 'select_work' as const });
/** The operator retires the line: close its open links (`sessions/link` active:false), then archive it. */
const archiveWorkLine = async (review: S9ReviewWorld): Promise<void> => {
  const { world, workLine } = review;
  for (const [index, link] of (await world.readSession(workLine)).links.filter(link => link.until === null).entries()) {
    const card = await world.readSession(workLine);
    expect((await world.post('sessions/link', graphWrite(S6A_SCOPE, { sessionRef: workLine.ref, target: link.ref.target,
      relation: link.ref.relation, active: false }, `s9-r2-unlink-${String(index)}`, [{ ref: card.record.ref,
      revision: card.record.revision }, { ref: link.ref, revision: link.revision }]))).body)
      .toMatchObject({ status: 'committed' });
  }
  const card = await world.readSession(workLine);
  expect((await world.post('sessions/archive', graphWrite(S6A_SCOPE, { sessionRef: workLine.ref,
    reason: 'S9 R2 history' }, 's9-r2-archive', [{ ref: card.record.ref, revision: card.record.revision }]))).body)
    .toMatchObject({ status: 'committed', value: { lifecycle: 'archived' } });
};
describe('R1: the required reviewer opens the round and stops before finalize', () => {
  it('command PASS → an open round card, then the Host consumes the execreview Query; nothing booked yet', async () => {
    const review = await s9Open();
    const round = await openS9ReviewRound({ review });
    expect(operationKind(round.next)).toBe('send_system_round');
    const openCard = await roundOfS9(review, round.roundRef);
    expect(openCard).toMatchObject({ status: 'open', outcome: null, gaps: [], evidenceRefs: [] });
    expect(openCard.checks.some(check => check.phase === 'finished' && check.outcome === 'PASS')).toBe(true);
    expect((await taskChecks(review))[0]?.round).toMatchObject({ ref: round.roundRef, status: 'open' });
    const query = await openS9ReviewQuery({ review, round });
    const read = ready<{ job: { job: { intent: { execution: { kind: string; answerShape: string } } } } }>(
      await review.world.post('queries/read', plain(S6A_SCOPE, query.queryJobRef)), 'the exec review Query');
    expect(read.job.job.intent.execution).toMatchObject({ kind: 'intervention_planning', answerShape: 'exec_review' });
    expect(await readBody(review.world, query.messageRef, 'message')).toContain(`execreview:${round.roundRef.roundId}`);
    expect(await roundOfS9(review, round.roundRef)).toMatchObject({ status: 'open', outcome: null, evidenceRefs: [] });
  });
});
const reviewRequirement = { requirementId: 's9-review', requirementLevel: 'required' as const, kind: 'reviewer',
  description: 'Independent execution review' };
/** Two required reviewer obligations over the same bare `requirementId` (S92-16): two pairs, not one. */
const reviewObligation = (obligationId: string, title: string, taskId: string) => ({ obligationId, title,
  requirementLevel: 'required' as const, taskIds: [taskId], verificationRequirements: [reviewRequirement] });
const twoReviewObligations = (goal: Parameters<typeof s9ReviewDraft>[0]): PlanRevisionDraft => {
  const base = s9ReviewDraft(goal);
  return { ...base, obligations: [base.obligations[0]!, reviewObligation('s9-review-a', 'S9 review A', 's9-work'),
    reviewObligation('s9-review-b', 'S9 review B', 's9-work')] };
};
type HistoryPage = { items: unknown[]; nextCursor: string | null };
describe('R2: the booked verdict finalizes the round, satisfies both pairs and completes the Goal', () => {
  it('record_review books one verdict → command refs + it, PASS, both same-id pairs pass, display COMPLETED',
    async () => {
      const review = await s9Open({ draft: twoReviewObligations });
      const round = await openS9ReviewRound({ review });
      const query = await answerS9Review(review, 'pass', { round });
      const packet = JSON.parse((await readBody(review.world, query.messageRef, 'message')).split('\n')
        .find(line => line.startsWith('coverage: '))!.slice('coverage: '.length)) as unknown[];
      expect(packet).toEqual([{ obligationId: 's9-review-a', requirementId: 's9-review' }, { obligationId: 's9-review-b', requirementId: 's9-review' }]);
      const receipts: WorkflowStepReceipt[] = [];
      expect((await driveWorkflow(review.world.ag2b, selectSubject(review), { receipts })).at(-1)?.state)
        .toBe('completed');
      const booked = receiptOf(receipts, 'record_review')?.result as { status?: string; value?: { evidenceRef?: { evidenceId: string } } } | undefined;
      expect(booked).toMatchObject({ status: 'committed' });
      expect(receiptOf(receipts, 'finalize_checks')?.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS', gaps: [] } });
      const ref = booked?.value?.evidenceRef;
      const roundCard = await roundOfS9(review, round.roundRef);
      expect(roundCard).toMatchObject({ status: 'finalized', outcome: 'PASS', gaps: [] });
      expect(roundCard.evidenceRefs).toHaveLength(2);
      expect(roundCard.evidenceRefs.at(-1)).toEqual(ref);
      const read = ready<{ delivery: { requirements: { obligationId: string; requirementId: string; state: string }[] } }>(
        await review.world.post('verification/round', plain(S6A_SCOPE, { roundRef: round.roundRef })), 'the read');
      expect(read.delivery.requirements.map(entry => ({ obligationId: entry.obligationId,
        requirementId: entry.requirementId, state: entry.state }))).toEqual([
        { obligationId: 's9-obligation', requirementId: 's9-static', state: 'pass' },
        { obligationId: 's9-review-a', requirementId: 's9-review', state: 'pass' },
        { obligationId: 's9-review-b', requirementId: 's9-review', state: 'pass' },
      ]);
      expect(await taskPhase(review)).toBe('satisfied');
      expect((await driveWorkflow(review.world.ag2b, selectGoal(review))).at(-1)?.state).toBe('completed');
      expect(await goalDisplay(review)).toMatchObject({ phase: 'COMPLETED' });
    });
  it.each([
    { name: 'busy: a claimed Query on the subject Session', archive: false },
    { name: 'archived: sessions/archive of the subject Session', archive: true },
  ])('$name — both history entries stay ready, full pages, same items', async ({ archive }) => {
    const review = await s9Open();
    const { world, workLine } = review;
    const round = await openS9ReviewRound({ review });
    if (archive) await archiveWorkLine(review);
    else {
      await claimQueryOn(world.ag2b, { ref: workLine.aggregateRef,
        revision: (await world.readSession(workLine)).record.revision }, 's9-r2-busy');
      expect((await world.readSession(workLine)).availability).toBe('busy');
      expect((await sessionQueries(world, workLine)).map(item => item.run.executionState?.phase)).toContain('claimed');
    }
    const page = async (afterCursor: string | null): Promise<HistoryPage> => ready<HistoryPage>(await world.post(
      'executions/history', plain(S6A_SCOPE, { runRef: round.subjectRunRef, afterCursor, limit: 1 })), 'the history route');
    const first = await page(null);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect((await page(first.nextCursor)).items).not.toEqual(first.items);
    await answerS9Review(review, [{ kind: 'calls', calls: [{ callId: 's9-r2-history', name: 'read_execution_history',
      args: { limit: 1 } }] }, { kind: 'calls', calls: [{ callId: 's9-r2-pass', name: 'submit_exec_review',
      args: { verdict: 'pass', basis: 'R2 basis', report: 'R2 report' } }] }], { round });
    const result = await s9ToolResult(review, 's9-r2-history');
    expect(result).toMatchObject({ status: 'success', output: [{ kind: 'json', value: { status: 'ready' } }] });
    const tool = (result.output![0]!.value as { value: HistoryPage }).value;
    expect(tool.items).toHaveLength(1);
    expect({ items: tool.items, nextCursor: tool.nextCursor }).toEqual({ items: first.items, nextCursor: first.nextCursor });
  });
});
/** The R3 two-Task world: `s9-work` carries only the static requirement, `s9-review-other` the reviewer. */
const twoTaskDraft = (goal: Parameters<typeof s9ReviewDraft>[0]): PlanRevisionDraft => {
  const base = s9ReviewDraft(goal);
  return { ...base, tasks: [...base.tasks, { taskId: 's9-review-other', title: 'S9 reviewer-only task',
    requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
    executionIntent: 'request_execution' }], assignments: [...(base.assignments ?? []), { taskId: 's9-review-other',
    role: S6A_WORK_ROLE.templateId, instruction: 'Do the other S9 work' }], obligations: [base.obligations[0]!,
    reviewObligation('s9-other-review', 'S9 other review', 's9-review-other')] };
};
describe('R3: a same-Goal Task without a reviewer item starts no review', () => {
  it('static-only Task → finalize; no execreview message/Query, no Session/Run, no second round', async () => {
    const review = await s9Open({ draft: twoTaskDraft });
    const round = await openS9ReviewRound({ review });
    const sessions = (await review.world.listSessions()).length;
    expect(operationKind(round.next)).toBe('finalize_checks');
    expect(await advanceS9Review(review, round.next!)).toMatchObject({ status: 'ready', value: { receipt:
      { kind: 'finalize_checks', result: { status: 'committed' } } } });
    const message = systemRoundMessageRef(S6A_SCOPE, `execreview:${round.roundRef.roundId}`);
    if (message.status !== 'ready') throw new Error('R3: no deterministic exec review message ref');
    expect((await review.world.post('messages/read', plain(S6A_SCOPE, message.value))).body)
      .toMatchObject({ status: 'not_found' });
    expect(await sessionQueries(review.world, review.reviewLine!)).toEqual([]);
    expect((await review.world.listSessions()).length).toBe(sessions);
    expect(await taskChecks(review, { ...review.task, taskId: 's9-review-other' })).toEqual([]);
    expect((await taskChecks(review)).map(item => item.round.ref)).toEqual([round.roundRef]);
    expect(await roundOfS9(review, round.roundRef)).toMatchObject({ status: 'finalized', outcome: 'PASS' });
  });
});
describe('R4: a FAIL is kept, reworked as the same Task\'s new Attempt, then superseded by the new PASS', () => {
  it('fix → FAIL; select_work → new Run/round execreview:<new> → pass; old FAIL retained and superseded', async () => {
    const review = await s9Open();
    const { world } = review;
    const first = await openS9ReviewRound({ review });
    const fix = await answerS9Review(review, 'fix', { round: first });
    const failRef = await bookS9Review(review, fix.roundRef, 's9-r4-book-fix');
    expect(await finalizeS9Review(review, fix.roundRef, 's9-r4-finalize-fix', [failRef]))
      .toMatchObject({ status: 'committed', value: { outcome: 'FAIL' } });
    const failed = await roundOfS9(review, fix.roundRef);
    expect(failed).toMatchObject({ status: 'finalized', outcome: 'FAIL' });
    expect(failed.evidenceRefs).toContainEqual(failRef);
    expect(await goalDisplay(review)).not.toMatchObject({ phase: 'COMPLETED' });
    // The rework: select_work issues the same Task's next Attempt; its normal end opens the next round.
    await world.scripted.script(review.workLine, [{ kind: 'text', text: 'S9 rework done' }]);
    const receipts: WorkflowStepReceipt[] = [];
    const steps = await driveWorkflow(world.ag2b, nextOfS9(await advanceS9Review(review)), { receipts,
      stopBefore: operation => operation.kind === 'send_system_round' || operation.kind === 'finalize_checks' });
    const newRoundRef = (receiptOf(receipts, 'open_checks')?.result as { value?: { ref?: VerificationRoundRef } })?.value?.ref;
    if (newRoundRef === undefined) throw new Error('R4: the rework opened no new round');
    const reworkRun = claimedRunOf(receipts, 's9-work').run;
    expect(newRoundRef.roundId).not.toBe(first.roundRef.roundId);
    expect(reworkRun.runId).not.toBe(first.subjectRunRef.runId);
    expect((await roundOfS9(review, newRoundRef)).subject).toEqual(review.task);
    const pass = await answerS9Review(review, 'pass', { round: { roundRef: newRoundRef, subjectRunRef: reworkRun,
      next: steps.at(-1)?.next ?? null } });
    const passRef = await bookS9Review(review, pass.roundRef, 's9-r4-book-pass');
    expect(await finalizeS9Review(review, pass.roundRef, 's9-r4-finalize-pass', [passRef])).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    const passed = await roundOfS9(review, pass.roundRef);
    expect(passed).toMatchObject({ status: 'finalized', outcome: 'PASS', gaps: [] });
    expect(passed.evidenceRefs).toContainEqual(passRef);
    // The old FAIL is still recorded, not overwritten; the new PASS and the requeue's supersede let completion go on.
    expect((await roundOfS9(review, fix.roundRef)).evidenceRefs).toContainEqual(failRef);
    expect(await completeS9Task(review, pass.roundRef, 's9-r4-complete')).toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
    expect((await driveWorkflow(world.ag2b, selectSubject(review))).at(-1)?.state).toBe('completed');
    expect((await driveWorkflow(world.ag2b, selectGoal(review))).at(-1)?.state).toBe('completed');
    expect(await goalDisplay(review)).toMatchObject({ phase: 'COMPLETED' });
  });
});
