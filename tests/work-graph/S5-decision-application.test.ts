/** Slice 5 §5.3 AP01–AP09/AP12–AP16, real owners and receipts on both Stores. */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { DecisionApplicationReceiptV1, DecisionApplicationV1, SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { decisionSourceKey, type DecisionChangeProofV1, type DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { decodeGoalSettingsChangedEvent } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { decodePlanRevisionAcceptedEvent } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { sessionMessageFromEvent } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  AUTOMATION, GOAL_A, GOAL_B, GOAL_C, OPERATOR, PLAN_A1, PLAN_B1, PLAN_B2, T, WORKSPACE_SCOPE,
  goalBasisOf, openS5DecisionFixture, type S5DecisionFixture, type S5FixtureKind, type S5Records,
} from '../helpers/S5-decision-fixture.js';
import {
  captureCommits, commitBarrier, committed, control, decoded, goalAt, keyOf, messageAt, owners, pin, queue, ready,
} from '../helpers/S5-application-support.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const ACCEPT: DecisionSelectionV1 = { kind: 'option', optionId: 'accept' };
type DecisionPort = ReturnType<typeof owners>['decisions'];

async function harness(kind: S5FixtureKind) {
  const f = await openS5DecisionFixture(kind, { operatorActor: { ...OPERATOR }, duties: ['adviser'] });
  fixtures.push(f);
  const captured = captureCommits(f.records);
  const records = captured.records;
  const services = owners(f, records);
  let requestSequence = 0;
  const goalPin = async (ref: GoalRef) => pin(ref, (await goalAt(records, ref)).revision);
  const receiptAt = (cursor: CommitCursor): DecisionApplicationReceiptV1 => {
    const matches = captured.commits.filter(commit => commit.receipt.cursor === cursor);
    expect(matches).toHaveLength(1);
    const match = matches[0];
    if (match === undefined) throw new Error('owner commit not captured');
    return { identityKey: match.input.identityKey, fingerprint: match.input.fingerprint, cursor };
  };
  const messageSource = (message: SessionMessage) => {
    if (message.decision === undefined) throw new Error('expected decision metadata');
    // §2.3 requires the shared source to exclude the message's own pin.
    // Preserve that source; the current message pin belongs only in meta.expected.
    return message.decision.source;
  };
  const answerMessage = (message: SessionMessage, requestId: string) => services.decisions.answerDecision(f.ctx, {
    input: { source: messageSource(message), selection: ACCEPT, text: '', annotations: [] },
    meta: { requestId, expected: [pin(message.ref, message.revision), ...messageSource(message).pins] },
  });
  const apply = (receipt: DecisionApplicationReceiptV1, options: {
    port?: DecisionPort; messageRef?: SessionMessageRef; revision?: number; ctx?: CoreCallContext; requestId?: string;
  } = {}) => (options.port ?? services.decisions).recordDecisionApplication(options.ctx ?? f.ctx, {
    input: { messageRef: options.messageRef ?? f.messages.answered.ref, receipt },
    meta: { requestId: options.requestId ?? `s5-ap-apply-${++requestSequence}`,
      expected: [pin(options.messageRef ?? f.messages.answered.ref, options.revision ?? 2)] },
  });
  const settingsReceipt = async (ack: SessionMessageRef, requestId: string, order = [GOAL_B, GOAL_A, GOAL_C]) => {
    const result = committed(await services.settings.reorderGoals(f.ctx, {
      input: { workspace: WORKSPACE_SCOPE, goalOrder: order, decisionMessageRef: ack },
      meta: { requestId, expected: await Promise.all(order.map(goalPin)) },
    }));
    return receiptAt(result.cursor);
  };
  const planReceipt = async () => {
    const response = f.messages.answered.response;
    if (response === null || !('decision' in response)) throw new Error('expected captured answer source');
    const result = committed(await services.plans.applyPlanChange(f.ctx, {
      input: { proposalRef: f.candidates.U1.ref, expectedProposalRevision: 1, decisionRefs: [],
        acknowledgementRef: f.messages.answered.ref, decisionSource: response.decision.source },
      meta: { requestId: 's5-ap-plan', expected: [await goalPin(GOAL_B)] },
    }));
    expect(result.value).toMatchObject({ ref: PLAN_B2, planRevision: 2, revision: 1 });
    return receiptAt(result.cursor);
  };
  const scopeReceipt = async (id: string) => {
    const event = { eventId: id, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: T };
    const receipt = await records.commit({ identityKey: id, fingerprint: `${id}-fp`, guards: [], records: [], claims: [],
      indexGuards: [], indexChanges: [], events: [{ ...event, json: JSON.stringify(event) }] });
    expect(receipt).toMatchObject({ status: 'committed', replayed: false, eventIds: [id], versions: [] });
    if (receipt.status !== 'committed') throw new Error(`scope receipt failed: ${JSON.stringify(receipt)}`);
    return receiptAt(receipt.cursor);
  };
  return { f, records, ...services, receiptAt, goalPin, messageSource, answerMessage, apply, settingsReceipt, planReceipt, scopeReceipt };
}

/** Decode the event referenced by the REAL receipt, not the caller's input or current objects. */
async function proofAt(records: S5Records, receipt: DecisionApplicationReceiptV1, acknowledgementRef: SessionMessageRef) {
  const lookup = await records.lookupCommit({ identityKey: receipt.identityKey, fingerprint: receipt.fingerprint });
  expect(lookup).toMatchObject({ status: 'ready', value: { cursor: receipt.cursor } });
  if (lookup.status !== 'ready') throw new Error(`receipt unavailable: ${JSON.stringify(lookup)}`);
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') throw new Error(`receipt event unavailable: ${JSON.stringify(located)}`);
  expect(located.value.cursor).toBe(receipt.cursor);
  expect(lookup.value.eventIds).toEqual([located.value.event.eventId]);
  let proof: DecisionChangeProofV1 | null | undefined;
  if (located.value.event.eventType === 'GoalSettingsChanged') {
    const event = decoded(decodeGoalSettingsChangedEvent(located.value.event));
    expect(event).toMatchObject({ actor: OPERATOR, identityKey: receipt.identityKey, fingerprint: receipt.fingerprint });
    proof = event.payload.proof;
  } else {
    expect(located.value.event.eventType).toBe('PlanRevisionAccepted');
    const event = decoded(decodePlanRevisionAcceptedEvent(located.value.event));
    expect(event.actor).toEqual(OPERATOR);
    expect(event.payload.acknowledgementRef).toEqual(acknowledgementRef);
    proof = event.payload.decisionApplication;
  }
  if (proof === undefined || proof === null) throw new Error('acknowledged owner event must carry its formal proof');
  expect(proof.acknowledgementRef).toEqual(acknowledgementRef);
  for (const change of proof.changes) {
    expect(lookup.value.versions).toContainEqual({ refKey: keyOf(change.after.ref), revision: change.after.revision });
  }
  return proof;
}

function assertApplication(application: DecisionApplicationV1 | null | undefined,
  receipt: DecisionApplicationReceiptV1, proof: DecisionChangeProofV1) {
  if (application === undefined || application === null) throw new Error('application was not recorded');
  expect({ ...application, basisRebases: application.basisRebases ?? [] }).toEqual({
    schemaVersion: 1, actor: OPERATOR, appliedAt: T, receipt, changes: proof.changes, basisRebases: proof.basisRebases,
  });
}
const sortedChanges = (changes: DecisionChangeProofV1['changes']) => [...changes]
  .sort((a, b) => keyOf(a.before.ref).localeCompare(keyOf(b.before.ref)));
const settingsChanges = [
  { before: pin(GOAL_A, 7), after: pin(GOAL_A, 8) },
  { before: pin(GOAL_B, 7), after: pin(GOAL_B, 8) },
];

describe.each(['memory', 'sqlite'] as const)('S5 decision application (%s)', kind => {
  it('AP01 two entries answering a real Goal cause keep one synthetic message and one source claim', async () => {
    const h = await harness(kind);
    // U1/U2 were recorded against PB1: the existing Goal display exposes the
    // concrete change_pending cause even alongside a running Work.
    const display = ready(await h.plans.queryGoalDisplay(h.f.ctx, { goalRef: GOAL_B }));
    expect(display.display.causes).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'change_pending' })]));
    const causes = ready(await h.causes.readGoalDecisionCauses(h.f.ctx, { goalRef: GOAL_B }));
    const cause = causes.find(item => item.code === 'change_pending');
    if (cause === undefined) throw new Error('the saved change_pending cause must be answerable');
    expect(cause.source.kind).toBe('goal_cause');
    expect(cause.options).toEqual([]);
    const source = cause.source;
    const before = await h.f.storeSnapshot();
    const beforeMessages = await h.f.userMessagesByGoal('B');
    const claimKey = `s5-decision-answer:${canonicalJson({ ...WORKSPACE_SCOPE, kind: source.kind, key: source.key })}`;
    expect(before.claims.filter(claim => claim.claimKey === claimKey)).toEqual([]);
    const barrier = commitBarrier(h.records);
    const decisions = owners(h.f, barrier.records).decisions;
    const results = await Promise.all(['main', 'queue'].map(entry => decisions.answerDecision(h.f.ctx, {
      input: { source, selection: { kind: 'other' }, text: 'Keep the current plan while I review the change.', annotations: [] },
      meta: { requestId: `s5-ap01-${entry}`, expected: source.pins },
    })));
    expect(barrier.arrivals()).toBe(2);
    expect(results.filter(result => result.status === 'committed')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ status: 'rejected', code: 'revision_conflict' }),
    ]);
    const winner = results.find(result => result.status === 'committed');
    if (winner === undefined || winner.status !== 'committed') throw new Error('no winning cause answer');
    expect(winner.value).toMatchObject({ revision: 1, status: 'responded', intent: 'notify',
      recipient: { kind: 'user', ...WORKSPACE_SCOPE }, decision: { syntheticAnswer: true, source: { kind: 'goal_cause', key: source.key } },
      response: { sender: { kind: 'host', actor: OPERATOR }, decision: { selection: { kind: 'other' }, requiresApplication: true } } });
    expect(await h.f.userMessagesByGoal('B')).toEqual(expect.arrayContaining([...beforeMessages, keyOf(winner.value.ref)]));
    expect(await h.f.userMessagesByGoal('B')).toHaveLength(beforeMessages.length + 1);
    expect(await h.f.decisionAnswersBySource('goal_cause', source.key)).toEqual([keyOf(winner.value.ref)]);
    const after = await h.f.storeSnapshot();
    expect(after.recordCount).toBe(before.recordCount + 1);
    expect(after.eventCount).toBe(before.eventCount + 1);
    expect(after.claimCount).toBe(before.claimCount + 1);
    expect(after.claims.filter(claim => claim.claimKey === claimKey)).toEqual([{ claimKey, owner: keyOf(winner.value.ref) }]);
    expect(after.records.filter(record => record.refKey !== keyOf(winner.value.ref))).toEqual(before.records);
    expect(after.claims.filter(claim => claim.claimKey !== claimKey)).toEqual(before.claims);
  });

  it('AP02 an accepted answer and acknowledged settings change have distinct cursors and remain pending application', async () => {
    const h = await harness(kind);
    const answered = committed(await h.answerMessage(h.f.messages.decision, 's5-ap02-answer'));
    expect(answered.value).toMatchObject({ revision: 2, status: 'responded', application: null });
    const receipt = await h.settingsReceipt(answered.value.ref, 's5-ap02-settings');
    expect(receipt.cursor).not.toBe(answered.cursor);
    expect(sortedChanges((await proofAt(h.records, receipt, answered.value.ref)).changes)).toEqual(settingsChanges);
    expect(await messageAt(h.records, answered.value.ref)).toEqual(answered.value);
    const page = await queue(h.f);
    expect(page.answeredPendingApplication.filter(card => keyOf(card.answerMessageRef ?? {}) === keyOf(answered.value.ref)))
      .toMatchObject([{ state: 'answered_pending_application', application: null, answerMessageRef: answered.value.ref }]);
    expect(page.counts.answeredPendingApplication).toBe(2);
  });

  it('AP03 a real settings receipt records exact before/after pins and removes one pending application', async () => {
    const h = await harness(kind);
    const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap03-settings');
    const proof = await proofAt(h.records, receipt, h.f.messages.answered.ref);
    expect(sortedChanges(proof.changes)).toEqual(settingsChanges);
    expect(proof.basisRebases).toEqual([]);
    const beforePage = await queue(h.f);
    expect(beforePage.counts.answeredPendingApplication).toBe(1);
    const before = await h.f.storeSnapshot();
    const result = committed(await h.apply(receipt));
    expect(result.value).toMatchObject({ revision: 3, status: 'responded' });
    assertApplication(result.value.application, receipt, proof);
    const after = await h.f.storeSnapshot();
    expect(after.recordCount).toBe(before.recordCount);
    expect(after.eventCount).toBe(before.eventCount + 1);
    expect(after.claims).toEqual(before.claims);
    expect(after.records.filter(record => record.refKey !== keyOf(result.value.ref)))
      .toEqual(before.records.filter(record => record.refKey !== keyOf(result.value.ref)));
    const event = await h.records.eventAt(result.cursor);
    if (event.status !== 'ready') throw new Error('application event missing');
    expect(event.value.event.eventType).toBe('SessionMessageDecisionApplied');
    expect(decoded(sessionMessageFromEvent(event.value.event))).toEqual(result.value);
    const afterPage = await queue(h.f);
    expect(afterPage.counts.answeredPendingApplication).toBe(beforePage.counts.answeredPendingApplication - 1);
    expect(afterPage.answeredPendingApplication).toEqual([]);
    expect(afterPage.history.filter(card => keyOf(card.answerMessageRef ?? {}) === keyOf(result.value.ref)))
      .toMatchObject([{ state: 'applied', application: result.value.application }]);
  });

  it('AP04 a scope receipt without the required formal event is incomplete with zero persisted writes', async () => {
    const h = await harness(kind); const receipt = await h.scopeReceipt('s5-ap04-scope');
    const before = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    expect(await h.apply(receipt)).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(await messageAt(h.records, h.f.messages.answered.ref)).toEqual({ ...h.f.messages.answered, replyHandler: null, archiveWaitDisposition: null });
  });

  it('AP05 a receipt whose before belongs to another content version is revision_conflict with zero writes', async () => {
    const h = await harness(kind);
    const changed = committed(await h.settings.setGoalSettings(h.f.ctx, {
      input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
      meta: { requestId: 's5-ap05-content', expected: [pin(GOAL_B, 7)] },
    }));
    expect(changed.value).toMatchObject({ revision: 8, settings: { autonomy: 'every_step' } });
    const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap05-settings');
    const proof = await proofAt(h.records, receipt, h.f.messages.answered.ref);
    expect(sortedChanges(proof.changes)).toEqual([
      settingsChanges[0], { before: pin(GOAL_B, 8), after: pin(GOAL_B, 9) },
    ]);
    expect(proof.basisRebases).toEqual([]);
    const before = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    expect(await h.apply(receipt)).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(await messageAt(h.records, h.f.messages.answered.ref)).toEqual({ ...h.f.messages.answered, replyHandler: null, archiveWaitDisposition: null });
  });

  it('AP06 a failed application commit leaves the card pending and recovers after reopen without modifying the object', async () => {
    const h = await harness(kind);
    const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap06-settings');
    const changedGoals = await Promise.all([GOAL_A, GOAL_B, GOAL_C].map(ref => goalAt(h.records, ref)));
    expect(changedGoals.map(goal => ({ ref: goal.ref, revision: goal.revision, order: goal.settings?.order }))).toEqual([
      { ref: GOAL_A, revision: 8, order: 1 }, { ref: GOAL_B, revision: 8, order: 0 }, { ref: GOAL_C, revision: 7, order: 2 },
    ]);
    let failures = 0;
    const failing: S5Records = { ...h.records, async commit(input) {
      if (input.events.some(event => event.eventType === 'SessionMessageDecisionApplied')) {
        failures += 1;
        return { status: 'rejected', code: 'unavailable', reason: 'AP06 injected application commit failure' };
      }
      return h.records.commit(input);
    } };
    const before = await h.f.storeSnapshot();
    expect(await h.apply(receipt, { port: owners(h.f, failing).decisions })).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(failures).toBe(1);
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(await messageAt(h.records, h.f.messages.answered.ref)).toEqual({ ...h.f.messages.answered, replyHandler: null, archiveWaitDisposition: null });
    const intermediate = await queue(h.f);
    expect(intermediate.counts.answeredPendingApplication).toBe(1);
    expect(intermediate.answeredPendingApplication).toMatchObject([
      { answerMessageRef: h.f.messages.answered.ref, state: 'answered_pending_application', application: null },
    ]);
    if (kind === 'sqlite') await h.f.reopen();
    const result = committed(await h.apply(receipt, { port: owners(h.f).decisions }));
    assertApplication(result.value.application, receipt, await proofAt(h.f.records, receipt, h.f.messages.answered.ref));
    expect(result.value.revision).toBe(3);
    expect(await Promise.all([GOAL_A, GOAL_B, GOAL_C].map(ref => goalAt(h.f.records, ref)))).toEqual(changedGoals);
    const after = await h.f.storeSnapshot();
    expect(after.eventCount).toBe(before.eventCount + 1);
    expect(after.records.filter(record => record.refKey !== keyOf(result.value.ref)))
      .toEqual(before.records.filter(record => record.refKey !== keyOf(result.value.ref)));
    expect((await queue(h.f)).counts.answeredPendingApplication).toBe(0);
  });

  it('AP07 a later owner change preserves the historical application when the same receipt is submitted again', async () => {
    const h = await harness(kind); const receipt = await h.planReceipt();
    const first = committed(await h.apply(receipt));
    const proof = await proofAt(h.records, receipt, h.f.messages.answered.ref);
    expect(proof.changes.filter(change => keyOf(change.before.ref) === keyOf(GOAL_B)))
      .toEqual([{ before: pin(GOAL_B, 7), after: pin(GOAL_B, 8) }]);
    assertApplication(first.value.application, receipt, proof);
    const later = committed(await h.settings.setGoalSettings(h.f.ctx, {
      input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
      meta: { requestId: 's5-ap07-later-content', expected: [pin(GOAL_B, 8)] },
    }));
    expect(later.value).toMatchObject({ revision: 9, activePlanRevision: PLAN_B2, settings: { autonomy: 'every_step' } });
    const before = await h.f.storeSnapshot();
    const second = committed(await h.apply(receipt, { revision: 3 }));
    expect(second.value.application).toEqual(first.value.application);
    expect(second.value.revision).toBe(3);
    assertApplication(second.value.application, receipt, proof);
    expect(await messageAt(h.records, first.value.ref)).toEqual(first.value);
    // A new identity is a no-op, not an original-request replay (S5-MSG-04): records
    // and claims stay unchanged. [lead] Whether a receipt-only event is committed for
    // the new identity is not fixed for messages (§2.8 states it only for
    // GoalSettings/Workspace), so events are not asserted.
    expect(await h.f.storeSnapshot()).toMatchObject({
      records: before.records, recordCount: before.recordCount,
      claims: before.claims, claimCount: before.claimCount,
    });
    expect(await goalAt(h.records)).toEqual(later.value);
  });

  it('AP08 automation answering a card is forbidden with zero persisted writes', async () => {
    const h = await harness(kind);
    const automation: CoreCallContext = { ...h.f.ctx, principal: { kind: 'host', actor: { ...AUTOMATION } },
      materialReader: { kind: 'host', ...WORKSPACE_SCOPE, actor: { ...AUTOMATION } } };
    const source = h.messageSource(h.f.messages.decision);
    const before = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    expect(await h.decisions.answerDecision(automation, {
      input: { source, selection: { kind: 'other' }, text: 'automation answer', annotations: [] },
      meta: { requestId: 's5-ap08', expected: [pin(h.f.messages.decision.ref, 1), ...source.pins] },
    })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
  });

  it('AP09 a paused answer followed by resume records exactly the formal control-rebase proof', async () => {
    const h = await harness(kind);
    expect((await control(h.f, 'pause', 's5-ap09-pause')).value).toMatchObject({ revision: 8, desiredState: 'paused' });
    const conflicts = ready(await h.reads.queryGoalConflicts(h.f.ctx, { workspace: WORKSPACE_SCOPE }));
    const sourceKey = decisionSourceKey({ kind: 'goal_conflict', pair: [
      { goalRef: GOAL_A, activePlanRef: PLAN_A1 }, { goalRef: GOAL_B, activePlanRef: PLAN_B1 },
    ] });
    const card = conflicts.cards.find(item => item.source.key === sourceKey);
    if (card === undefined) throw new Error('the shared module M must yield the A/B conflict card');
    const basis = goalBasisOf(await goalAt(h.records));
    const selection = { kind: 'conflict_parallel' as const, earlier: GOAL_A, later: GOAL_B };
    const answered = committed(await h.decisions.answerDecision(h.f.ctx, {
      input: { source: card.source, selection, text: '', annotations: [] },
      meta: { requestId: 's5-ap09-answer', expected: card.source.pins },
    }));
    expect(answered.value).toMatchObject({ revision: 1, status: 'responded', application: null });
    expect((await control(h.f, 'resume', 's5-ap09-resume')).value).toMatchObject({ revision: 9, desiredState: 'active' });
    const changed = committed(await h.settings.resolveGoalConflict(h.f.ctx, {
      input: { source: card.source, selection, decisionMessageRef: answered.value.ref },
      meta: { requestId: 's5-ap09-risk', expected: [pin(GOAL_A, 7), pin(GOAL_B, 9)] },
    }));
    const receipt = h.receiptAt(changed.cursor);
    const proof = await proofAt(h.records, receipt, answered.value.ref);
    expect(proof.changes).toEqual([{ before: pin(GOAL_B, 9), after: pin(GOAL_B, 10) }]);
    expect(proof.basisRebases).toEqual([{ captured: pin(GOAL_B, 8), actualBefore: pin(GOAL_B, 9), basis }]);
    expect(proof.capturedPins).toEqual(card.source.pins);
    expect(await goalAt(h.records)).toMatchObject({ revision: 10, desiredState: 'active', activePlanRevision: PLAN_B1,
      settings: { parallelRisks: [{ otherGoalRef: GOAL_A, selfPlanRef: PLAN_B1, otherPlanRef: PLAN_A1 }] } });
    const result = committed(await h.apply(receipt, { messageRef: answered.value.ref, revision: 1 }));
    expect(result.value.revision).toBe(2);
    assertApplication(result.value.application, receipt, proof);
    const page = await queue(h.f);
    expect(page.history.filter(item => item.source.key === sourceKey)).toMatchObject([
      { state: 'applied', answerMessageRef: answered.value.ref, application: result.value.application },
    ]);
    expect(page.answeredPendingApplication.filter(item => item.source.key === sourceKey)).toEqual([]);
  });

  it('AP12 a corrupt formal receipt event is unavailable and leaves application null with zero writes', async () => {
    const h = await harness(kind); const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap12-settings');
    let corruptedReads = 0;
    const broken: S5Records = { ...h.records, async eventAt(cursor) {
      const read = await h.records.eventAt(cursor);
      if (cursor === receipt.cursor && read.status === 'ready') {
        corruptedReads += 1;
        return { status: 'ready', value: { ...read.value, event: { ...read.value.event, json: '{' } } };
      }
      return read;
    } };
    const before = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    expect(await h.apply(receipt, { port: owners(h.f, broken).decisions })).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(corruptedReads).toBeGreaterThan(0);
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(await messageAt(h.records, h.f.messages.answered.ref)).toEqual({ ...h.f.messages.answered, replyHandler: null, archiveWaitDisposition: null });
  });

  it('AP13 a different real cursor from lookupCommit is revision_conflict with zero writes', async () => {
    const h = await harness(kind); const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap13-settings');
    const other = await h.scopeReceipt('s5-ap13-other');
    expect(other.cursor).not.toBe(receipt.cursor);
    const before = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    expect(await h.apply({ ...receipt, cursor: other.cursor })).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(await messageAt(h.records, h.f.messages.answered.ref)).toEqual({ ...h.f.messages.answered, replyHandler: null, archiveWaitDisposition: null });
  });

  it('AP14 a Session S work_run that is neither modifier nor operator cannot record the application', async () => {
    const h = await harness(kind); const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap14-settings');
    const work: CoreCallContext = { ...h.f.ctx,
      principal: { kind: 'work_run', runRef: h.f.runRA.ref, roleBinding: h.f.runRA.roleBinding },
      materialReader: { kind: 'run', requester: h.f.runRA.ref },
    };
    const before = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    expect(await h.apply(receipt, { ctx: work })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(await messageAt(h.records, h.f.messages.answered.ref)).toEqual({ ...h.f.messages.answered, replyHandler: null, archiveWaitDisposition: null });
  });

  it('AP15 a new requestId preserves the same application; only the original request replays its value and cursor', async () => {
    const h = await harness(kind); const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap15-settings');
    const originalRequest = { requestId: 's5-ap15-apply-original', revision: 2 };
    const first = committed(await h.apply(receipt, originalRequest));
    expect(first.value.revision).toBe(3);
    const proof = await proofAt(h.records, receipt, h.f.messages.answered.ref);
    expect(sortedChanges(proof.changes)).toEqual(settingsChanges);
    assertApplication(first.value.application, receipt, proof);
    const before = await h.f.storeSnapshot();
    const second = committed(await h.apply(receipt, { requestId: 's5-ap15-apply-again', revision: 3 }));
    expect(second.value.application).toEqual(first.value.application);
    expect(second.value.revision).toBe(3);
    expect(await messageAt(h.records, first.value.ref)).toEqual(first.value);
    // [lead] new-identity no-op: records and claims unchanged; events not asserted (see AP07).
    expect(await h.f.storeSnapshot()).toMatchObject({
      records: before.records, recordCount: before.recordCount,
      claims: before.claims, claimCount: before.claimCount,
    });
    // True replay keeps BOTH the original identity and the original message@2
    // pin, even though the saved message is now @3.
    const beforeReplay = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    const replay = committed(await h.apply(receipt, originalRequest));
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await h.f.storeSnapshot()).toEqual(beforeReplay);
    expect(h.f.allocationCounts).toEqual(allocations);
  });

  it('AP16 another real modification receipt is invalid and preserves the complete first application', async () => {
    const h = await harness(kind); const receipt = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap16-first');
    const first = committed(await h.apply(receipt));
    expect(first.value.revision).toBe(3);
    const firstProof = await proofAt(h.records, receipt, h.f.messages.answered.ref);
    expect(sortedChanges(firstProof.changes)).toEqual(settingsChanges);
    assertApplication(first.value.application, receipt, firstProof);
    const other = await h.settingsReceipt(h.f.messages.answered.ref, 's5-ap16-other', [GOAL_C, GOAL_B, GOAL_A]);
    expect(other.cursor).not.toBe(receipt.cursor);
    const otherProof = await proofAt(h.records, other, h.f.messages.answered.ref);
    expect(sortedChanges(otherProof.changes)).toEqual([
      { before: pin(GOAL_A, 8), after: pin(GOAL_A, 9) },
      { before: pin(GOAL_B, 8), after: pin(GOAL_B, 9) },
      { before: pin(GOAL_C, 7), after: pin(GOAL_C, 8) },
    ]);
    const before = await h.f.storeSnapshot(); const allocations = { ...h.f.allocationCounts };
    expect(await h.apply(other, { revision: 3 })).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await messageAt(h.records, first.value.ref)).toEqual(first.value);
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
  });
});
