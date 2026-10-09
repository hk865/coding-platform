/**
 * Slice 5 scenario SC01 (SPEC §5.4, §6.3 F72; §4.5–§4.6):
 * "two request decisions" on the real platform composition and real SQLite.
 *
 * The world is built entirely through the real owners: two real root QueryJobs
 * Q1/Q2 on the harness Goal A, their candidate proposals U1/U2 from
 * `plans.proposePlan` with `requestRef`, then Q1's adoption. Only after that
 * does the scenario touch the slice-5 decision entries: the Q2 candidate card,
 * the user's free-text + annotation answer, the paused pending application, the
 * replacement of the stale Q2 candidate, the formal change, the missed
 * application, the platform restart and the recorded application.
 *
 * A9: Q1 and Q2 are two real root QueryJobs on the same Goal A; the source is
 * built from the canonical `decisionSourceKey` identity and the annotation
 * object key from `canonicalJson(object)`.
 *
 * Part 1 leaves those entries as stubs, so the test stops at the first one
 * (`requestCandidates.readRequestCandidate`) with its `not implemented:` throw.
 * Scripted provider only; the seed and every read/replay/application entry add
 * no model call.
 */
import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { assertInvariants, cleanupScenarios, openPlatformScenario } from './harness.js';
import { draftFrom } from './support/common.js';
import {
  S5_ANNOTATION_TEXT, S5_ANSWER_TEXT, S5_GOAL_A, S5_OPERATOR, adoptCandidate, answerDecision, applyCandidate,
  controlGoal, proposeCandidate, queryDecisionQueue, readDecisionAnswer, readDecisionCard, readRequestCandidate,
  recordDecisionApplication, s5AnnotatedObject, s5Annotation, s5CandidateKey, s5CommitReceipt,
  s5GoalPin, s5PlanAcceptances, s5StoreSnapshot, seedTwoRequestWorld,
} from './support/S5-decisions.js';

afterEach(async () => {
  await cleanupScenarios();
});

it('SC01 two root requests: Q2 candidate@1 until replaced, the same card key, a free-text/annotation answer held by a pause, then the recorded application after a restart', async () => {
  const h = await openPlatformScenario({ actor: S5_OPERATOR, script: { replies: [] } });
  const world = await seedTwoRequestWorld(h);
  expect(h.modelCalls(), 'two root queries and two candidate writes add no provider call').toBe(0);

  // Adopt Q1; Q2's candidate is based on the old active Plan and stays a card.
  const accepted = await adoptCandidate(world.platform, world.ctx, world.candidates.U1);

  // Q2's stale candidate card: still candidate@1 (PC07 / S5-PLAN-03 leaves it
  // untouched until a legitimate replacement or an explicit abandon).
  // Part 1 stub: `not implemented: RequestCandidatePort.readRequestCandidate`.
  const candidate = await readRequestCandidate(world.platform, world.ctx, S5_GOAL_A, world.queries.Q2);
  if (candidate.status !== 'ready') throw new Error(`the Q2 candidate must be readable: ${JSON.stringify(candidate)}`);
  expect(candidate.value).toMatchObject({ head: { ref: world.candidates.U2.ref, revision: 1, status: 'candidate' },
    status: 'stale', closedReason: null });
  const head = candidate.value.head;
  if (head === null) throw new Error('the Q2 candidate head must remain until it is replaced');

  // Only the reader supplies pins and Goal bases; the natural identity is
  // constructed independently. A proposal-only hand-built source cannot prove
  // a later Goal pointer change, especially across pause/resume and replacement.
  const cardKey = s5CandidateKey(S5_GOAL_A, world.queries.Q2);
  const queued = await queryDecisionQueue(world.platform, world.ctx, { goalRef: S5_GOAL_A, sections: ['waiting_answer'] });
  if (queued.status !== 'ready') throw new Error(`the queue must be readable: ${JSON.stringify(queued)}`);
  const queuedCard = queued.value.waitingAnswer.find(entry => entry.cardKey === cardKey);
  if (queuedCard === undefined) throw new Error('Q2 must remain in the real queue');
  const source = queuedCard.source;
  const capturedGoalPin = await s5GoalPin(world.platform, world.ctx, S5_GOAL_A);
  expect(source).toMatchObject({ kind: 'candidate', key: cardKey, goalRef: S5_GOAL_A });
  expect(source.pins).toContainEqual(capturedGoalPin);
  expect(source.goalBases).toEqual([expect.objectContaining({ goalRef: S5_GOAL_A, activePlanRef: accepted.ref })]);
  const card = await readDecisionCard(world.platform, world.ctx, source);
  if (card.status !== 'ready') throw new Error(`the Q2 card must be readable: ${JSON.stringify(card)}`);
  expect(card.value).toMatchObject({ cardKey, state: 'waiting_answer', candidateStatus: 'stale', source });
  expect(queuedCard.cardKey, 'both entrances resolve the same canonical card key').toBe(card.value.cardKey);

  // The user answers Q2 with free text and one annotation on an object the card
  // actually lists (`objectKey = canonicalJson(object)`); nothing is trimmed.
  const annotations = [s5Annotation(s5AnnotatedObject(card.value.objects), S5_ANNOTATION_TEXT)];
  const beforeAnswer = h.counts();
  const answered = await answerDecision(world.platform, world.ctx, { source,
    text: S5_ANSWER_TEXT, annotations, requestId: 's5-answer-q2' });
  if (answered.status !== 'ready' || answered.value.answer.status !== 'committed') {
    throw new Error(`the Q2 answer must commit: ${JSON.stringify(answered)}`);
  }
  const answer = answered.value.answer.value;
  expect(answer).toMatchObject({ status: 'responded', revision: 1,
    response: { decision: { source, selection: { kind: 'other' }, requiresApplication: true, annotations } } });
  expect(h.modelCalls(), 'the answer adds no provider call').toBe(beforeAnswer.modelCalls);

  // The answer reads back its exact text and annotation.
  const readback = await readDecisionAnswer(world.platform, world.ctx, source);
  if (readback.status !== 'ready') throw new Error(`the answer must be readable: ${JSON.stringify(readback)}`);
  expect(readback.value.message?.ref).toEqual(answer.ref);
  expect(readback.value.body).toMatchObject({ text: S5_ANSWER_TEXT,
    annotations: [{ objectKey: annotations[0]!.objectKey, text: S5_ANNOTATION_TEXT }] });

  // The pause leaves the card answered_pending_application; nothing grows meanwhile.
  const paused = await controlGoal(world.platform, world.ctx, { goalRef: S5_GOAL_A, control: 'pause', requestId: 's5-pause' });
  expect(paused).toMatchObject({ status: 'committed' });
  const atPause = h.counts();
  const storeAtPause = s5StoreSnapshot(join(h.database, 'ledger.sqlite'));
  const pending = await queryDecisionQueue(world.platform, world.ctx, { goalRef: S5_GOAL_A, sections: ['answered_pending_application'] });
  if (pending.status !== 'ready') throw new Error(`the pending queue must be readable: ${JSON.stringify(pending)}`);
  expect(pending.value.counts).toMatchObject({ waitingAnswer: 0, answeredPendingApplication: 1 });
  expect(pending.value.answeredPendingApplication).toMatchObject([{ cardKey, answerMessageRef: answer.ref }]);
  expect(h.counts(), 'a paused Goal changes nothing behind the answer').toEqual(atPause);
  expect(s5StoreSnapshot(join(h.database, 'ledger.sqlite'))).toEqual(storeAtPause);

  // Continue.
  const resumed = await controlGoal(world.platform, world.ctx, { goalRef: S5_GOAL_A, control: 'resume', requestId: 's5-resume' });
  expect(resumed).toMatchObject({ status: 'committed' });

  // Adopting the unchanged stale U2 must fail (PC07 / S5-PLAN-03).
  const beforeStale = s5StoreSnapshot(join(h.database, 'ledger.sqlite'));
  const stale = await applyCandidate(world.platform, world.ctx, world.candidates.U2, { requestId: 's5-apply-q2-stale' });
  expect(stale).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(s5StoreSnapshot(join(h.database, 'ledger.sqlite'))).toEqual(beforeStale);
  const original = await world.platform.plans.readPlanProposal(world.ctx, world.candidates.U2.ref);
  expect(original).toMatchObject({ status: 'ready', value: { ref: world.candidates.U2.ref, revision: 1, status: 'candidate' } });

  // Regenerate the Q2 candidate through the legitimate replacement path, then
  // apply the one formal change, attributed to the same answer message.
  const regenerated = await proposeCandidate(world.platform, world.ctx, { goalRef: S5_GOAL_A, basedOn: accepted.ref,
    draft: draftFrom(accepted, 's5-q2-plan-v2'), requestRef: world.queries.Q2,
    replaces: { proposalRef: world.candidates.U2.ref, revision: world.candidates.U2.revision }, requestId: 's5-regenerate-q2' });
  const replaced = await readRequestCandidate(world.platform, world.ctx, S5_GOAL_A, world.queries.Q2);
  if (replaced.status !== 'ready') throw new Error(`the replaced Q2 candidate must be readable: ${JSON.stringify(replaced)}`);
  expect(replaced.value).toMatchObject({ head: { ref: regenerated.ref, revision: 1 }, status: 'candidate' });
  expect(await world.platform.plans.readPlanProposal(world.ctx, world.candidates.U2.ref)).toMatchObject({ status: 'ready',
    value: { status: 'not_adopted', revision: 2, notAdopted: { reason: 'replaced', replacedBy: regenerated.ref } } });
  const beforeFormal = s5PlanAcceptances(h.database).length;
  const actualBefore = await s5GoalPin(world.platform, world.ctx, S5_GOAL_A);
  // SPEC §2.8/§3.3: the acceptance proof retains the answer's captured
  // pins/basis. [lead S5-T3-D8] The trusted caller passes the answer's own
  // response.decision.source as proof data next to acknowledgementRef (never
  // authorization); the Plan owner derives the Goal control rebase from it.
  const formal = await applyCandidate(world.platform, world.ctx, regenerated,
    { requestId: 's5-apply-q2', acknowledgementRef: answer.ref, expected: [actualBefore], decisionSource: source });
  if (formal.status !== 'committed') throw new Error(`the formal change must commit: ${JSON.stringify(formal)}`);
  expect(formal.value.ref).toEqual(expect.objectContaining({ planId: 's5-q2-plan-v2' }));

  // The formal change's real commit identity and fingerprint (from the ledger's
  // own idempotency receipt), never a hand-written pair.
  const receipt = s5CommitReceipt(h.database, formal.cursor);
  const attributed = s5PlanAcceptances(h.database).filter(event =>
    event.payload.acknowledgementRef?.messageId === answer.ref.messageId);
  expect(s5PlanAcceptances(h.database)).toHaveLength(beforeFormal + 1);
  expect(attributed).toHaveLength(1);
  const proof = attributed[0]?.payload.decisionApplication;
  expect(proof).toMatchObject({ acknowledgementRef: answer.ref, capturedPins: source.pins,
    basisRebases: [{ captured: capturedGoalPin, actualBefore, basis: source.goalBases![0] }] });
  expect(proof?.changes).toContainEqual({ before: actualBefore,
    after: { ref: S5_GOAL_A, revision: actualBefore.revision + 1 } });

  // The application is missed, the platform restarts on the same SQLite files,
  // and the same answer message is read back before the application is recorded.
  await h.restart();
  const afterRestart = await readDecisionCard(h.platform, world.ctx, source);
  if (afterRestart.status !== 'ready') throw new Error(`the restarted card must be readable: ${JSON.stringify(afterRestart)}`);
  expect(afterRestart.value).toMatchObject({ cardKey, state: 'answered_pending_application', answerMessageRef: answer.ref,
    answer: { decision: { selection: { kind: 'other' } } } });
  const restartedAnswer = await readDecisionAnswer(h.platform, world.ctx, source);
  expect(restartedAnswer).toMatchObject({ status: 'ready', value: { message: answer,
    body: { text: S5_ANSWER_TEXT, annotations } } });
  const beforeApplication = s5PlanAcceptances(h.database);
  const recorded = await recordDecisionApplication(h.platform, world.ctx, { message: answer, receipt });
  expect(recorded).toMatchObject({ status: 'committed', replayed: false });
  expect(s5PlanAcceptances(h.database), 'application never repeats the formal change').toEqual(beforeApplication);

  // Exactly one application was recorded; the card now reads `applied` and both
  // open sections are empty.
  const final = await readDecisionCard(h.platform, world.ctx, source);
  if (final.status !== 'ready') throw new Error(`the applied card must be readable: ${JSON.stringify(final)}`);
  expect(final.value).toMatchObject({ state: 'applied', application: { receipt } });
  const empty = await queryDecisionQueue(h.platform, world.ctx, { goalRef: S5_GOAL_A,
    sections: ['waiting_answer', 'answered_pending_application'] });
  if (empty.status !== 'ready') throw new Error(`the final queue must be readable: ${JSON.stringify(empty)}`);
  expect(empty.value.counts).toMatchObject({ waitingAnswer: 0, answeredPendingApplication: 0 });
  expect(h.ledgerEventTypes().filter(type => type === 'SessionMessageDecisionApplied'),
    'exactly one application event').toHaveLength(1);
  expect(s5PlanAcceptances(h.database).filter(event =>
    event.payload.acknowledgementRef?.messageId === answer.ref.messageId)).toHaveLength(1);
  expect(h.modelCalls(), 'reads, refusal, restart and application add no model calls').toBe(0);
  await assertInvariants(h, 'SC01 after the recorded application');
}, 180_000);
