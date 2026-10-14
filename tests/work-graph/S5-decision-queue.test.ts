/** SPEC §5.3 DQ01–DQ09. Every service row runs on memory and SQLite. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionSelectionV1, DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1, DecisionReadPort, S5RecordPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { PlanTaskPort } from '../../src/core/work-graph/model/plan-contracts.js';
import { createDecisionReadModel, createGoalCauseCardSource, createPlanningQuestionCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createAutomaticReworkNoticeSource } from '../../src/core/work-graph/views/automatic-rework-notices.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { createPlanningQuestionReader } from '../../src/core/work-graph/tasks/planning-question-reader.js';
import { createExecutedFilesStub } from '../../src/core/work-graph/tasks/executed-files-stub.js';
import { createPlanService, createRequestCandidateService } from '../../src/core/work-graph/tasks/plan-service.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionMailbox, createMessageWriteOwner } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { CANDIDATE_U1, CANDIDATE_U2, GOAL_A, GOAL_B, OPERATOR, PLAN_A1, PLAN_B1, T, WORKSPACE,
  WORKSPACE_SCOPE, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { PLANNING_GOAL, answeredPlanningQuestion, committed, exhaustSecondRun, key, mailboxDependencies, materialsFor, modelRequestCounts,
  openUninitializedQueue, pin, ready, storedRecord, workContext } from '../helpers/S5-queue-support.js';

type QueueInput = Parameters<DecisionReadPort['queryDecisionQueue']>[1];
const SECTIONS: QueueInput['sections'] = ['waiting_answer', 'answered_pending_application', 'history', 'notices'];
const ACCEPT: DecisionSelectionV1 = { kind: 'option', optionId: 'accept' };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

function readers(records: S5RecordPort & RecordOrderedLookupPort, plans: PlanTaskPort) {
  return createDecisionReadModel({ records,
    cardSources: [createGoalCauseCardSource(createGoalDecisionCauseReader({ records, plans })),
      createPlanningQuestionCardSource(createPlanningQuestionReader({ records, plans }))],
    noticeSources: [createAutomaticReworkNoticeSource({ records })],
    conflicts: createGoalConflictAssembler({ records, catalog: createArchitectureCatalogService({ records }), executedFiles: createExecutedFilesStub() }),
    positions: createNoticePositionComparator(), displayTokens: createNoticeDisplayToken(new Uint8Array(32)) });
}
function mustCard(cards: readonly DecisionCardV1[], sourceKey: string): DecisionCardV1 {
  const found = cards.filter(card => card.source.key === sourceKey);
  expect(found).toHaveLength(1);
  return found[0]!;
}
async function open(kind: 'memory' | 'sqlite', reopen = false) {
  const f = await openS5DecisionFixture(kind); closers.push(() => f.close());
  if (reopen && kind === 'sqlite') await f.reopen();
  const plans = createPlanService({ records: f.records, materials: materialsFor(f), initialPlanning: { bodies: f.bodies }, now: f.now, eventId: f.newId });
  const reads = readers(f.records, plans);
  const mailboxDeps = mailboxDependencies(f);
  const mailbox = createSessionMailbox(mailboxDeps);
  const decisions = createDecisionMessageService({ records: f.records, now: f.now, newId: f.newId, operatorActor: OPERATOR,
    messages: mailbox, materials: mailboxDeps.materials,
    messageWrites: createMessageWriteOwner(mailboxDeps), sources: createDecisionSourceFacts({ records: f.records }) });
  const q = async (extra: Partial<QueueInput> = {}) => ready(await reads.queryDecisionQueue(f.ctx,
    { workspace: WORKSPACE_SCOPE, sections: SECTIONS, page: { limit: 50 }, ...extra }));
  const card = async (source: DecisionSourceV1) => ready(await reads.readDecisionCard(f.ctx, { source }));
  const answer = async (source: DecisionSourceV1, selection: DecisionSelectionV1 = ACCEPT, messageRef = f.messages.decision.ref) => {
    expect(source.pins.filter(p => key(p.ref) === key(messageRef))).toEqual([]);
    return committed(await decisions.answerDecision(f.ctx, { input: { source, selection, text: '', annotations: [] },
      meta: { requestId: f.newId(), expected: [await pin(f.records, messageRef), ...source.pins] } }));
  };
  const control = async (control: 'pause' | 'cancel', goalRef: GoalRef = GOAL_B) => {
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: goalRef.projectId, goalId: goalRef.goalId };
    const phase = ready(await f.records.readMany([key(phaseRef)])).records[0];
    return committed(await setGoalControlFromHost({ records: f.records, now: f.now, eventId: f.newId }, f.ctx,
      { input: { goalRef, control, reason: `DQ ${control}` },
        meta: { requestId: f.newId(), expected: [await pin(f.records, goalRef), { ref: phaseRef, revision: phase?.revision ?? 0 }] } }));
  };
  const abandon = async (proposalRef: typeof CANDIDATE_U1 | typeof CANDIDATE_U2) => committed(await
    createRequestCandidateService({ records: f.records, now: f.now, eventId: f.newId }).abandonPlanProposal(f.ctx,
      { input: { proposalRef }, meta: { requestId: f.newId(), expected: [await pin(f.records, proposalRef), await pin(f.records, GOAL_B)] } }));
  return { f, plans, q, card, answer, control, abandon, mailbox };
}

async function budgetCause(f: S5DecisionFixture, plans: PlanTaskPort) {
  const run = await exhaustSecondRun(f);
  if (plans.queryGoalDisplay === undefined) throw new Error('missing Goal display entry');
  const display = ready(await plans.queryGoalDisplay(f.ctx, { goalRef: GOAL_B }));
  expect(display.display.causes).toContainEqual(expect.objectContaining({ code: 'budget_exhausted', taskId: 'b-work-2' }));
  return run;
}

describe.each(['memory', 'sqlite'] as const)('S5 decision queue (%s)', kind => {
  it('DQ01 assembles six specified waiting sources and reports unavailable capabilities', async () => {
    const { f, plans, q } = await open(kind);
    const answerRef = await answeredPlanningQuestion(f);
    if (plans.queryGoalDisplay === undefined) throw new Error('missing Goal display entry');
    const pending = ready(await plans.queryGoalDisplay(f.ctx, { goalRef: GOAL_B })).display.causes
      .filter(cause => cause.code === 'change_pending');
    expect(pending).toHaveLength(1);
    const cause = pending[0];
    if (cause?.code !== 'change_pending') throw new Error('missing candidate change cause');
    const read = await q();
    expect(read.waitingAnswer).toHaveLength(6);
    expect(read.waitingAnswer.map(c => c.source.kind).sort()).toEqual([
      'candidate', 'candidate', 'goal_cause', 'goal_conflict', 'message', 'planning_question']);
    const messageKey = decisionSourceKey({ kind: 'message', messageRef: f.messages.decision.ref });
    const message = mustCard(read.waitingAnswer, messageKey);
    expect(message).toMatchObject({ source: { kind: 'message', key: messageKey }, state: 'waiting_answer',
      senderSessionRef: f.sessionS, answerMessageRef: null, options: [
        { id: 'accept', label: 'Accept', effect: 'apply' }, { id: 'reject', label: 'Reject', effect: 'reject' }] });
    expect(message.actions).toContain('answer');
    for (const request of [f.requests.Q1, f.requests.Q2]) {
      const sourceKey = decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, requestRef: request.ref });
      const candidate = mustCard(read.waitingAnswer, sourceKey);
      expect(candidate).toMatchObject({ source: { kind: 'candidate', key: sourceKey }, requestRef: request.ref,
        candidateStatus: 'candidate', state: 'waiting_answer', options: [] });
      expect(candidate.actions).toEqual(expect.arrayContaining(['answer', 'adopt', 'abandon']));
    }
    const planningKey = decisionSourceKey({ kind: 'planning_question', answerRef, questionIndex: 0 });
    const planning = mustCard(read.waitingAnswer, planningKey);
    expect(planning).toMatchObject({ goalRef: PLANNING_GOAL,
      source: { kind: 'planning_question', key: planningKey, goalRef: PLANNING_GOAL }, options: [], state: 'waiting_answer' });
    expect(planning.actions).toContain('answer');
    const conflictKey = decisionSourceKey({ kind: 'goal_conflict', pair: [
      { goalRef: GOAL_A, activePlanRef: PLAN_A1 }, { goalRef: GOAL_B, activePlanRef: PLAN_B1 }] });
    const conflict = mustCard(read.waitingAnswer, conflictKey);
    expect(conflict).toMatchObject({ source: { kind: 'goal_conflict', key: conflictKey } });
    expect(conflict.options).toEqual([
      { id: 'wait', label: '等前一个目标', effect: 'apply' }, { id: 'order', label: '调整顺序', effect: 'apply' },
      { id: 'parallel', label: '接受风险并行', effect: 'apply' }]);
    expect(conflict.actions).toContain('answer');
    const causes = read.waitingAnswer.filter(c => c.source.kind === 'goal_cause');
    expect(causes).toHaveLength(1);
    expect(causes[0]).toMatchObject({ goalRef: GOAL_B, options: [], state: 'waiting_answer' });
    // §3.3 identifies this cause by its concrete pending proposal. The spec does not
    // enumerate the other affected pins or the full action list for this code.
    const identity = JSON.parse(causes[0]!.source.key) as { kind: 'goal_cause'; goalRef: typeof GOAL_B; code: string; affected: VersionPin[] };
    expect(identity).toMatchObject({ kind: 'goal_cause', goalRef: GOAL_B, code: 'change_pending' });
    expect(identity.affected).toContainEqual(await pin(f.records, cause.proposalRef));
    expect(causes[0]!.source.key).toBe(decisionSourceKey(identity));
    expect(causes[0]!.actions).toContain('answer');
    expect(read.counts.waitingAnswer).toBe(6);
    expect(read.countsComplete).toBe(false);
    expect(read.capabilities.filter(c => c.source === 'note_review' || c.source === 'message_release')
      .sort((a, b) => a.source.localeCompare(b.source))).toEqual([
        { source: 'message_release', availability: 'not_available' }, { source: 'note_review', availability: 'not_available' }]);
  });

  it('DQ02 retains a concrete decision cause under a RUNNING Goal display', async () => {
    const { f, plans, abandon, q } = await open(kind);
    await budgetCause(f, plans);
    await abandon(CANDIDATE_U1); await abandon(CANDIDATE_U2);
    if (plans.queryGoalDisplay === undefined) throw new Error('missing Goal display entry');
    expect(ready(await plans.queryGoalDisplay(f.ctx, { goalRef: GOAL_B })).display).toMatchObject({ phase: 'RUNNING',
      causes: expect.arrayContaining([expect.objectContaining({ code: 'budget_exhausted', taskId: 'b-work-2' })]) });
    const causes = (await q({ goalRef: GOAL_B })).waitingAnswer.filter(c => c.source.kind === 'goal_cause');
    expect(causes).toHaveLength(1);
    expect(JSON.parse(causes[0]!.source.key)).toMatchObject({ kind: 'goal_cause', goalRef: GOAL_B, code: 'budget_exhausted' });
  });

  it('DQ03 exposes missing initial architecture as a Goal cause', async () => {
    const f = await openUninitializedQueue(kind); closers.push(f.close);
    expect(await createArchitectureCatalogService({ records: f.records }).readArchitectureRevision(f.ctx, { selection: { kind: 'current' } }))
      .toMatchObject({ status: 'not_found' });
    const read = ready(await readers(f.records, f.plans).queryDecisionQueue(f.ctx,
      { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B, sections: SECTIONS, page: { limit: 50 } }));
    const architecture = read.waitingAnswer.filter(c => c.source.kind === 'goal_cause' && c.actions.includes('adopt_architecture'));
    expect(architecture).toHaveLength(1);
    expect(architecture[0]).toMatchObject({ source: { kind: 'goal_cause' }, options: [] });
    expect(read.waitingAnswer.filter(c => c.source.kind === 'planning_question')).toEqual([]);
  });

  it('DQ04 retains the original sender after acceptance and Session archival', async () => {
    const { f, answer, q } = await open(kind);
    const before = await q();
    const source = f.messages.decision.decision!.source;
    await answer(source);
    await f.settleRunRA();
    const directory = createSessionDirectory({ records: f.records, lookups: f.records });
    const session = ready(await directory.readSession(f.ctx, f.sessionS)).record;
    expect(session.occupancy).toBeNull();
    // The lifecycle owner uses Date directly, so freeze only its clock.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T);
    try {
      committed(await createSessionLifecycleService({ records: f.records, lookups: f.records }).archiveSession(f.ctx,
        { input: { sessionRef: f.sessionS, reason: 'DQ04 sender archived' }, meta: { requestId: f.newId(), expected: [{ ref: session.ref, revision: session.revision }] } }));
    } finally { vi.useRealTimers(); }
    const after = await q();
    expect(after.waitingAnswer).toHaveLength(before.waitingAnswer.length - 1);
    expect(after.answeredPendingApplication).toHaveLength(before.answeredPendingApplication.length + 1);
    expect(after.counts.waitingAnswer).toBe(before.counts.waitingAnswer - 1);
    expect(after.counts.answeredPendingApplication).toBe(before.counts.answeredPendingApplication + 1);
    expect(mustCard(after.answeredPendingApplication, source.key)).toMatchObject({ state: 'answered_pending_application', senderSessionRef: f.sessionS });
    expect(after.waitingAnswer.map(c => c.source.key)).not.toContain(source.key);
  });

  it('DQ05 records a real defer reply outside both open queues', async () => {
    const { f, mailbox, answer, q } = await open(kind);
    const sent = committed(await mailbox.sendUserMessage(workContext(f, f.claimRA), {
      input: { goalRef: GOAL_B, intent: 'decision_request', text: 'Choose when to decide.', needsReply: true, waitAfterSend: false,
        options: [{ id: 'defer', label: '稍后再说', effect: 'defer' },
          { id: 'accept', label: '现在采用', effect: 'apply' }], objects: [] }, meta: { requestId: f.newId(), expected: [] } }));
    if (sent.decision === undefined) throw new Error('send omitted its decision source');
    expect(sent.decision.source.key).toBe(decisionSourceKey({ kind: 'message', messageRef: sent.ref }));
    await answer(sent.decision.source, { kind: 'option', optionId: 'defer' }, sent.ref);
    const read = await q();
    expect(mustCard(read.history, sent.decision.source.key)).toMatchObject({ state: 'answered_no_application' });
    expect([...read.waitingAnswer, ...read.answeredPendingApplication].map(c => c.source.key)).not.toContain(sent.decision.source.key);
  });

  it('DQ06 answers while paused without changing Plan, Run or Goal control', async () => {
    const { f, answer, control, card, q } = await open(kind);
    expect(await control('pause')).toMatchObject({ revision: 8, desiredState: 'paused' });
    const refs = [GOAL_B, PLAN_B1, f.runRA.ref, f.runRB.ref];
    const before = await Promise.all(refs.map(ref => storedRecord(f.records, ref)));
    const current = await card(f.messages.decision.decision!.source);
    expect(current.source.pins.filter(p => key(p.ref) === key(GOAL_B))).toEqual([{ ref: GOAL_B, revision: 8 }]);
    const replied = await answer(current.source);
    expect(replied.response).toMatchObject({ decision: { source: current.source, requiresApplication: true } });
    const decoded = decodeSessionMessageRecord(await storedRecord(f.records, replied.ref));
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    expect(decoded.value.response).toMatchObject({ decision: { source: { pins: expect.arrayContaining([{ ref: GOAL_B, revision: 8 }]) } } });
    expect(mustCard((await q({ goalRef: GOAL_B })).answeredPendingApplication, current.source.key))
      .toMatchObject({ state: 'answered_pending_application' });
    expect(await Promise.all(refs.map(ref => storedRecord(f.records, ref)))).toEqual(before);
  });

  it('DQ07 moves every cancelled Goal source to read-only history', async () => {
    const { f, control, q } = await open(kind);
    await answeredPlanningQuestion(f);
    const beforeB = await q({ goalRef: GOAL_B });
    const beforeD = await q({ goalRef: PLANNING_GOAL });
    expect(beforeB.waitingAnswer.map(c => c.source.kind).sort()).toEqual([
      'candidate', 'candidate', 'goal_cause', 'goal_conflict', 'message']);
    expect(beforeB.answeredPendingApplication).toHaveLength(1);
    expect(beforeD.waitingAnswer.map(c => c.source.kind)).toEqual(['planning_question']);
    expect(beforeD.answeredPendingApplication).toEqual([]);
    expect(await control('cancel')).toMatchObject({ revision: 8, desiredState: 'cancelled' });
    expect(await control('cancel', PLANNING_GOAL)).toMatchObject({ revision: 2, desiredState: 'cancelled' });
    const snapshot = await f.storeSnapshot();
    const models = await modelRequestCounts(f);
    for (const [goalRef, before] of [[GOAL_B, beforeB], [PLANNING_GOAL, beforeD]] as const) {
      const read = await q({ goalRef });
      expect(read.waitingAnswer).toEqual([]);
      expect(read.answeredPendingApplication).toEqual([]);
      expect(read.counts).toMatchObject({ waitingAnswer: 0, answeredPendingApplication: 0 });
      for (const previous of [...before.waitingAnswer, ...before.answeredPendingApplication]) {
        const historical = mustCard(read.history, previous.source.key);
        expect(historical).toMatchObject({ state: 'closed', readOnly: true, closedReason: 'goal_cancelled' });
        expect(historical.actions).not.toContain('answer'); expect(historical.actions).not.toContain('apply');
      }
    }
    expect(await f.storeSnapshot()).toEqual(snapshot);
    expect(await modelRequestCounts(f)).toEqual(models);
  });

  it('DQ08 resolves the same source and answer from both read entrances', async () => {
    const { f, card, q, answer } = await open(kind);
    const source = f.messages.decision.decision!.source;
    const direct = await card(source);
    const queued = mustCard((await q({ goalRef: GOAL_B })).waitingAnswer, source.key);
    expect(queued.cardKey).toBe(direct.cardKey);
    expect(direct.answerMessageRef).toBeNull(); expect(queued.answerMessageRef).toBeNull();
    const reply = await answer(source);
    const after = await card(source);
    const queueAfter = mustCard((await q({ goalRef: GOAL_B })).answeredPendingApplication, source.key);
    expect(after).toMatchObject({ cardKey: direct.cardKey, state: 'answered_pending_application', answerMessageRef: reply.ref });
    expect(queueAfter).toMatchObject({ cardKey: direct.cardKey, state: 'answered_pending_application', answerMessageRef: reply.ref });
    expect(queueAfter.answer).toEqual(after.answer);
  });

  it('DQ09 reads all pages and refreshes without writes or model calls', async () => {
    const { f, q } = await open(kind, true);
    const messageFacts = async () => Promise.all([f.messages.decision.ref, f.messages.answered.ref].map(async ref => {
      const decoded = decodeSessionMessageRecord(await storedRecord(f.records, ref));
      if (decoded.status !== 'decoded') throw new Error(decoded.reason);
      return decoded.value;
    }));
    const before = { store: await f.storeSnapshot(), messages: await messageFacts(), workspace: await storedRecord(f.records, WORKSPACE),
      allocations: { ...f.allocationCounts }, models: await modelRequestCounts(f) };
    expect(before.models).toEqual({ workAttempts: 0, queryAdmissions: 0 });
    const first = await q({ page: { limit: 1 } });
    expect(first.nextCursor).not.toBeNull();
    let cursor = first.nextCursor;
    const cursors = new Set<string>();
    while (cursor !== null) {
      expect(cursors.has(cursor)).toBe(false); cursors.add(cursor);
      const page = await q({ page: { limit: 1, cursor } });
      expect(page.sourceCursor).toEqual(first.sourceCursor); cursor = page.nextCursor;
    }
    expect((await q()).sourceCursor).toEqual(first.sourceCursor);
    expect({ store: await f.storeSnapshot(), messages: await messageFacts(), workspace: await storedRecord(f.records, WORKSPACE),
      allocations: { ...f.allocationCounts }, models: await modelRequestCounts(f) }).toEqual(before);
  });
});
