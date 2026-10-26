/** X-approve-deny (§2.5, §3.3, §5.5): both arms, the awaiting-only admission, replay and the direct proof. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import { createDispatchBasisReader } from '../../src/core/work-graph/tasks/dispatch-basis.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createGoalPointerFacts } from '../../src/core/work-graph/views/pointer-facts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { AT, createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { holdS7AQueryRound, moveS7APointer, openS7AQueryWorld, seedS7AGoalPlan, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
const harnesses: C1Harness[] = [];
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  for (const h of harnesses.splice(0)) await h.close(); });
async function openC1World(kind: ClaimFixtureKind = 'memory'): Promise<C1Harness> {
  const h = await createC1Harness(kind);
  harnesses.push(h);
  return h;
}
type PreparedCommit = Parameters<C1Harness['backend']['records']['commit']>[0];
/** A3: observe the real commit and return its result unchanged. */
function observed(records: C1Harness['backend']['records'], batches: PreparedCommit[]) {
  return { ...records, async commit(batch: PreparedCommit) {
    batches.push(batch);
    return records.commit(batch);
  } };
}
async function read(h: C1Harness, ref: SessionMessageRef) {
  const result = await h.mailbox.readMessage(h.ctxHost, ref);
  if (result.status !== 'ready') throw new Error(`the message is not readable: ${JSON.stringify(result)}`);
  return result.value;
}
async function awaiting(h: C1Harness, requestId = 'x-ad-send') {
  await h.setGoalAutonomy('every_step');
  const sent = await h.mailbox.sendMessage(h.ctxWork, {
    input: { recipient: h.idleSession, text: 'may I proceed?', intent: 'inquiry', needsReply: true },
    meta: { requestId, expected: [] },
  });
  if (sent.status !== 'committed') throw new Error(`the awaiting send did not commit: ${JSON.stringify(sent)}`);
  expect(sent.value).toMatchObject({ revision: 1, status: 'pending', release: 'awaiting',
    approvedAt: null, approvalRevision: null, pins: null });
  return sent.value;
}
function release(h: C1Harness, ref: SessionMessageRef, allow: boolean, requestId: string,
  ctx = h.ctxHost, mailbox = h.mailbox) {
  return mailbox.releaseMessage(ctx, { input: { messageRef: ref, allow }, meta: { requestId, expected: [] } });
}
const arms = [
  { allow: true, action: 'approves', release: 'approved', approvedAt: AT, approvalRevision: 2 },
  { allow: false, action: 'denies', release: 'denied', approvedAt: null, approvalRevision: null },
] as const;

describe('X-approve-deny: the person\'s two arms', () => {
  it.each(arms)('$action an awaiting message and writes its one event', async (arm) => {
    const h = await openC1World();
    const message = await awaiting(h);
    // A3: observe the real decide's one commit; a direct call writes `proof: null`.
    const batches: PreparedCommit[] = [];
    const decided = await h.makeMailbox(observed(h.backend.records, batches)).releaseMessage(h.ctxHost,
      { input: { messageRef: message.ref, allow: arm.allow }, meta: { requestId: 'x-ad-decide', expected: [] } });
    if (decided.status !== 'committed') throw new Error(`the decide did not commit: ${JSON.stringify(decided)}`);
    expect(decided).toMatchObject({ status: 'committed', replayed: false });
    expect(decided.value).toMatchObject({ revision: 2, status: 'pending', release: arm.release,
      approvedAt: arm.approvedAt, approvalRevision: arm.approvalRevision, delivery: 'queued', deadline: null });
    expect(await read(h, message.ref)).toEqual(decided.value);

    expect(batches).toHaveLength(1);
    const event = JSON.parse(batches[0]!.events.at(-1)!.json) as Record<string, unknown>;
    expect(event).toMatchObject({ eventType: 'SessionMessageReleaseDecided', proof: null });
    expect(event['message']).toMatchObject({ release: arm.release, approvedAt: arm.approvedAt,
      approvalRevision: arm.approvalRevision });
  });

  it('refuses a second decide because release_decided admits only awaiting', async () => {
    const h = await openC1World();
    const message = await awaiting(h);
    expect(await release(h, message.ref, true, 'x-ad-first')).toMatchObject({ status: 'committed' });
    expect(await release(h, message.ref, false, 'x-ad-second'))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await read(h, message.ref)).toMatchObject({ revision: 2, release: 'approved',
      approvedAt: AT, approvalRevision: 2 });
  });

  it('refuses every non-person caller and writes nothing', async () => {
    const h = await openC1World();
    const message = await awaiting(h);
    expect(await release(h, message.ref, true, 'x-ad-work', h.ctxWork))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await read(h, message.ref)).toMatchObject({ revision: 1, release: 'awaiting',
      approvedAt: null, approvalRevision: null });
  });

  it('approves after the world moved without reading the versions or writing a counter', async () => {
    const h = await openC1World();
    await h.setGoalAutonomy('every_step');
    const records = h.backend.records;
    const real = createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) });
    let reads = 0;
    const counting: NonNullable<SessionMailboxDependencies['dispatchBasis']> = {
      async readDispatchFacts(ctx, input) {
        reads += 1;
        return real.readDispatchFacts(ctx, { goalRef: input.goalRef });
      },
    };
    const mailbox = h.makeMailbox(records, h.materials, undefined, undefined, counting);
    const expected = { planRevision: 1, pointerRevision: 'none' as const, dispatchSequence: 0 };
    const sent = await mailbox.sendMessage(h.ctxWork, {
      input: { recipient: h.idleSession, text: 'proceed?', intent: 'action_request', needsReply: true, expected },
      meta: { requestId: 'x-ad-action-send', expected: [] },
    });
    if (sent.status !== 'committed') throw new Error(`the awaiting action_request did not commit: ${JSON.stringify(sent)}`);
    expect(sent).toMatchObject({ status: 'committed',
      value: { release: 'awaiting', pins: expected } });
    expect(reads).toBe(1);

    // The public Plan owner moves the Plan to the next revision from the accepted snapshot.
    const plan = h.fixture.plan;
    const draft = { schemaVersion: 2 as const, planId: 'x-ad-plan-move', planRevision: plan.planRevision + 1,
      goalId: h.fixture.goalRef.goalId, stages: plan.stages, tasks: plan.tasks,
      ...(plan.assignments === undefined ? {} : { assignments: plan.assignments }),
      obligations: plan.obligations, taskHierarchy: plan.taskHierarchy, executionDag: plan.executionDag };
    const proposed = await h.fixture.plans.proposePlan(h.ctxHost, {
      meta: { requestId: 'x-ad-plan-propose', expected: [await h.fixture.goalPin()] },
      input: { goalRef: h.fixture.goalRef, basedOn: plan.ref, draft,
        reason: { text: 'the world moved before the approval', sources: [] } } });
    if (proposed.status !== 'committed') throw new Error(`the Plan proposal did not commit: ${JSON.stringify(proposed)}`);
    const applied = await h.fixture.plans.applyPlanChange(h.ctxHost, {
      meta: { requestId: 'x-ad-plan-apply', expected: [await h.fixture.goalPin()] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`the Plan adoption did not commit: ${JSON.stringify(applied)}`);

    await h.setGoalAutonomy('after_plan_confirmation');
    const moved = await real.readDispatchFacts(h.ctxHost, { goalRef: h.fixture.goalRef });
    if (moved.status !== 'ready') throw new Error(`the moved basis is not readable: ${JSON.stringify(moved)}`);
    expect(moved.value.values).toMatchObject({ planRevision: 2, pointerRevision: 'none', dispatchSequence: 0 });
    const counted = await mailbox.sendMessage(h.ctxWork, {
      input: { recipient: h.idleSession, text: 'count me', intent: 'action_request', needsReply: true,
        expected: moved.value.values },
      meta: { requestId: 'x-ad-action-count', expected: [] },
    });
    expect(counted).toMatchObject({ status: 'committed',
      value: { release: 'released', pins: moved.value.values } });
    const after = await real.readDispatchFacts(h.ctxHost, { goalRef: h.fixture.goalRef });
    if (after.status !== 'ready') throw new Error(`the counted basis is not readable: ${JSON.stringify(after)}`);
    // The new basis differs on both axes that can move here (the pointer axis is a separate row below).
    expect(after.value.values).toEqual({ planRevision: 2, pointerRevision: 'none', dispatchSequence: 1 });
    expect(after.value.values).not.toEqual(expected);

    const decided = await mailbox.releaseMessage(h.ctxHost, {
      input: { messageRef: sent.value.ref, allow: true },
      meta: { requestId: 'x-ad-action-release', expected: [] },
    });
    expect(decided).toMatchObject({ status: 'committed',
      value: { revision: 2, release: 'approved', approvalRevision: 2, pins: expected } });
    // The approval consults neither the versions nor the counter: it still reads 1.
    expect(reads).toBe(2);
    expect(await real.readDispatchFacts(h.ctxHost, { goalRef: h.fixture.goalRef })).toMatchObject({
      status: 'ready', value: { values: after.value.values },
    });
  });
});

describe.each(['memory', 'sqlite'] as const)('X-approve-deny: the approval replay (%s)', kind => {
  it('restores the original receipt and conflicts on a changed allow', async () => {
    const h = await openC1World(kind);
    const message = await awaiting(h);
    const first = await release(h, message.ref, true, 'x-ad-replay');
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    // A real commit moves the ledger after the first receipt was written.
    expect(await h.mailbox.sendMessage(h.ctxHost, {
      input: { recipient: h.busySession, text: 'move', needsReply: false },
      meta: { requestId: 'x-ad-replay-other', expected: [] },
    })).toMatchObject({ status: 'committed' });
    expect(await release(h, message.ref, true, 'x-ad-replay'))
      .toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor, value: first.value });
    expect(await release(h, message.ref, false, 'x-ad-replay'))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });
});

it('approves an awaiting action_request on the old pins after the pointer moved', async () => {
  const { world, session } = await openS7AQueryWorld({ backend: 'memory' }); worlds.push(world);
  const { goal } = await seedS7AGoalPlan(world, { pointer: 'one' }); await setS7AAutonomy(world, goal, 'every_step');
  const basis = async () => ((await world.dispatch('goals/dispatch-basis', world.humanContext(),
    plain(S6A_SCOPE, { goalRef: goal }))) as { value: { planRevision: number; pointerRevision: number; dispatchSequence: number } }).value;
  const old = await basis(); expect(old).toEqual({ planRevision: 1, pointerRevision: 1, dispatchSequence: 0 });
  // The Runtime's own `query_run` context of a held secretary round is the real sender (no built ctx).
  const sent = await holdS7AQueryRound(world, { label: 'x-ad-old-pins', goalId: goal.goalId }, async context => {
    const saved = await world.platform.messages.sendMessage(context, { input: { recipient: session.ref,
      text: 'may I proceed?', intent: 'action_request', needsReply: true, expected: old },
      meta: { requestId: 'x-ad-old-pins-send', expected: [] } });
    if (saved.status !== 'committed') throw new Error(`the old-pins send did not commit: ${JSON.stringify(saved)}`);
    return saved.value; });
  expect(sent).toMatchObject({ release: 'awaiting', approvalRevision: null, pins: old });
  expect((await moveS7APointer(world, goal)).revision).toBe(2);
  expect(await basis()).toEqual({ planRevision: 1, pointerRevision: 2, dispatchSequence: 0 });
  const approved = await world.dispatch('messages/release', world.humanContext(),
    graphWrite(S6A_SCOPE, { messageRef: sent.ref, allow: true }, 'x-ad-old-pins-release'));
  expect(approved).toMatchObject({ status: 'committed', value: { revision: 2, release: 'approved', approvedAt: expect.any(String), approvalRevision: 2, pins: old } });
  // Neither the reads nor the approval wrote a counter: the sequence is still 0, the pointer already moved.
  expect(await basis()).toEqual({ planRevision: 1, pointerRevision: 2, dispatchSequence: 0 });
});
// The non-null proof cell waits for a real trusted caller: the trusted entry builds a
// `DecisionChangeProofV1`, releases through that entry, and asserts the event carries it while a direct
// call still writes `null`. (deferred: 7a2)
describe.each(['memory', 'sqlite'] as const)('X-commit-writer: companion records first (%s)', kind => {
  it('commits the counter and activity companions before the message record', async () => {
    const h = await openC1World(kind);
    await h.setGoalAutonomy('after_plan_confirmation');
    const records = h.backend.records;
    const dispatchBasis = createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) });
    const batches: PreparedCommit[] = [];
    const sent = await h.makeMailbox(observed(records, batches), h.materials, undefined, undefined, dispatchBasis)
      .sendMessage(h.ctxWork, {
        input: { recipient: h.idleSession, text: 'a released request', intent: 'action_request', needsReply: true,
          expected: { planRevision: 1, pointerRevision: 'none', dispatchSequence: 0 } },
        meta: { requestId: 'x-ad-companion', expected: [] },
      });
    if (sent.status !== 'committed') throw new Error(`the released action_request did not commit: ${JSON.stringify(sent)}`);
    expect(sent.value.release).toBe('released');
    const batch = batches[0]!;
    const messageAt = batch.records.findIndex(record => record.refKey === sessionMessageRefKey(sent.value.ref));
    expect(messageAt).toBeGreaterThan(0);
    expect(batch.records.slice(0, messageAt).map(record => record.refKey)).toEqual([
      expect.stringContaining('DispatchCounter'), expect.stringContaining('SessionActivity')]);
    expect(batch.events).toEqual([expect.objectContaining({ eventType: 'SessionMessageSent' })]);
  });
});
