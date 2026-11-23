/**
 * P1 R1–R5 (contract `p1-frozen.md` 2.6, 2.8; section 五) and the review table's T-4, T-5, C7 (`cp1-review-rulings.md`): an
 * adviser's planning round asks for a rework or a recheck of tC (whose Run ended and whose check round failed, with
 * no rework yet), with a message as its new basis; the platform's own rework meets the scribe's stop reason. Rounds
 * are `openP1World`'s held planning rounds; the scribe stop and the platform rework go through `P1-platform-entry.ts`
 * (ruling T1). Reworks are read on the Task graph's own rework entries (`tasks/query`), cards on the decision queue,
 * rounds on `verification/round`.
 *
 * Red before P1: the rework and recheck owners took only a Host or a Work Run caller, the mailbox refused the round's
 * send and reply, and `platform.claimHolds` did not exist (R5). Red until the review's fixes: C7 (the replay was
 * admitted again and the ended round refused).
 *
 * Mutations (lead): R1 the rework refuses a `query_run` caller; R2 each of the refusals deleted in turn, the duty
 * check (only an adviser) among them (T-4); R3 the reply handler's read right is not honoured; R4 the approved
 * application reads the requester's Run; R5 the `system` rework no longer refuses on a held scribe reason; T-5 the
 * rework admission guards stay out of the commit; C7 the review fix removed (the receipt lookup before the
 * admission), for the rework and for the recheck. The M rows follow the named mutations (`cp1-mut-rulings.md`): M4-11
 * the gate's scribe wait deleted; M4-14 the rework stops guarding the hold it read; M8-8 every step no longer asks
 * for a round's rework (or refuses it); M8-11 the approval's query-round requester dropped; M8-15 the recheck reads
 * its basis without the round's line, or the "responded only" check deleted.
 *
 * Deviations from the row text: R1 "E replies" is S's round replying (the rule is "a reply by another line is a new
 * basis"; E's reply would need its own Work Run, whose failing check starts another rework). R3 "waits/dispose" is the
 * archive step's own wait transfer: `waits/dispose` moves only a gone line's wait, and a waiting line cannot be
 * archived without disposing it; both write the message's `replyHandler`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RoundReverifyFactV1, VerificationRoundRef } from '../../src/contracts/verification.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { placeScribeStop, platformRework } from '../helpers/P1-platform-entry.js';
import type { P1HeldRound, P1World } from '../helpers/P1-round-fixture.js';
import {
  messageOf, p1Worlds, personSends, reachedBefore, replyAs, reworkEntries, reworkPins, sentRef, write,
} from '../helpers/P1-reads.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { sendS7BWaitingInquiry } from '../helpers/S7B-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds = p1Worlds();
afterEach(async () => {
  const unreleased = commitBarrier.reset();
  await worlds.closeAll();
  expect(unreleased).toEqual([]);
});
const LONG = 600_000;

/** A rework of tC's ended Run (`basis` its new input when given), pinned as the person's `tasks/requeue` is. */
async function reworkRequest(p1: P1World, basis: SessionMessageRef | null, requestId: string) {
  return { input: { taskRef: p1.task.tC, afterRunRef: p1.runC, reason: `P1 ${requestId}`,
    ...(basis === null ? {} : { newInputRefs: [{ kind: 'session_message' as const, ref: basis }] }) },
  meta: { requestId, expected: await reworkPins(p1, p1.runC) } };
}
async function reworkTC(p1: P1World, round: P1HeldRound, basis: SessionMessageRef | null, requestId: string) {
  return await p1.world.platform.claims.requeueTask!(round.ctx, await reworkRequest(p1, basis, requestId));
}

type Rounds = { chain: { reverify: RoundReverifyFactV1 | null;
  rounds: Array<{ roundRef: VerificationRoundRef; revision: number }> } };
/** tC's check rounds (`verification/round` on its ended Run). */
const roundsOf = async (p1: P1World) => ready<Rounds>(await p1.world.post('verification/round',
  plain(S6A_SCOPE, { subjectRunRef: p1.runC })), 'the check rounds').chain.rounds;
/** A recheck of tC's failed round (`basis` its new input when given), pinned only at that round's real revision
 *  (ruling S3). */
async function recheckRequest(p1: P1World, requestId: string, basis: SessionMessageRef | null = null) {
  const failed = (await roundsOf(p1)).at(-1)!;
  return { input: { predecessorRoundRef: failed.roundRef, reason: `P1 ${requestId}`,
    ...(basis === null ? {} : { newInputRefs: [{ kind: 'session_message' as const, ref: basis }] }) },
  meta: { requestId, expected: [{ ref: failed.roundRef, revision: failed.revision }] } };
}

/** The `rework_request` card a `needs_decision` answer names, as the decision queue lists it (`decisions/card`). */
async function queuedCardOf(p1: P1World, answer: unknown): Promise<DecisionCardV1> {
  const cardKey = (answer as { cardKey?: string }).cardKey;
  const queue = ready<DecisionQueueReadV1>(await p1.world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef: p1.goal, sections: ['waiting_answer'], page: { limit: 100 } })), 'the queue');
  const listed = queue.waitingAnswer.find(card => card.cardKey === cardKey);
  if (listed === undefined) throw new Error(`P1: no card ${String(cardKey)}`);
  return ready<DecisionCardV1>(await p1.world.post('decisions/card', plain(S6A_SCOPE, { source: listed.source })),
    'the rework_request card');
}

/** The person approves `card` (`decisions/answer`); the route's own answer body, for the row to judge. */
async function approveCard(p1: P1World, card: DecisionCardV1, requestId: string) {
  return (await p1.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
  }, requestId, card.source.pins))).body;
}

describe('R1, R3: a reply by another line is the round\'s new basis', () => {
  it('R1: A asks S, S replies; A\'s round reworks tC with that message, counted as the agent\'s', async () => {
    const p1 = await worlds.open();
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'r1');
    const asked = sentRef(await p1.world.platform.messages.sendMessage(a.ctx, write({ recipient: p1.lines.S.ref,
      text: 'P1 R1 question', needsReply: true }, 'r1-ask')));
    expect(await replyAs(p1.world, s.ctx, asked, 'P1 R1 answer', 'r1-reply')).toMatchObject({ status: 'committed' });
    expect(await reworkTC(p1, a, asked, 'r1-rework'))
      .toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    // The first automatic rework of the chain, counted (2.8: a round's own actor is `agent`; the read model has no
    // `counted` field, so the count is `autoCount` and the class is the requester, the round's own agent actor).
    if (a.ctx.principal.kind !== 'query_run') throw new Error('P1: not a QueryRun');
    expect(await reworkEntries(p1, p1.task.tC)).toMatchObject([{ reason: 'P1 r1-rework', automatic: true, autoCount: 1,
      requestedBy: { kind: 'agent', queryRunRef: a.ctx.principal.queryRunRef } }]);
  }, LONG);

  it('R3: E asks S and waits; the person hands the wait to A; S replies; A\'s round reworks tC on that question', async () => {
    const p1 = await worlds.open();
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'r3');
    const question = await sendS7BWaitingInquiry(p1.world, { goal: p1.goal, session: p1.lines.E, taskId: p1.task.tA.taskId,
      label: 'p1-r3', body: { recipient: p1.lines.S.ref, text: 'P1 R3 question', needsReply: true,
        waitAfterSend: true } });
    // The person archives E and hands its open wait to A in the same step (`sessions/archive-line`'s wait transfer;
    // `waits/dispose` moves only a gone line's wait, and a waiting line cannot go without disposing it). E's Tasks go
    // to E2. The message now names A as its reply handler.
    const card = await p1.world.readSession(p1.lines.E);
    const runRef = question.sender.kind === 'work_run' ? question.sender.runRef : null;
    expect((await p1.world.post('sessions/archive-line', graphWrite(S6A_SCOPE, { sessionRef: p1.lines.E.ref,
      reason: 'P1 R3 E leaves', wait: { kind: 'transfer', runRef, messageRef: question.ref, to: p1.lines.A.ref },
      tasks: card.links.filter(link => link.ref.relation === 'responsible' && link.until === null)
        .map(link => ({ target: link.ref.target, disposition: { kind: 'transfer', to: p1.lines.E2.ref } })),
    }, 'r3-archive-e', [{ ref: card.record.ref, revision: card.record.revision }]))).body).toMatchObject({ status: 'ready' });
    expect((await messageOf(p1.world, question.ref)).replyHandler?.sessionRef).toEqual(p1.lines.A.ref);
    expect(await replyAs(p1.world, s.ctx, question.ref, 'P1 R3 answer', 'r3-reply'))
      .toMatchObject({ status: 'committed' });
    expect(await reworkTC(p1, a, question.ref, 'r3-rework'))
      .toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
  }, LONG);
});

describe('rejects: R2, T-4, a basis or a round that may not ask; no rework is written', () => {
  it('A\'s own reply (E asked A, A replied): invalid, own reply', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'r2-own');
    const asked = await personSends(p1.world, p1.lines.A, 'P1 R2 question to A', 'r2-own-ask');
    expect(await replyAs(p1.world, a.ctx, asked, 'P1 R2 own answer', 'r2-own-reply'))
      .toMatchObject({ status: 'committed' });
    const refused = await reworkTC(p1, a, asked, 'r2-own-rework');
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('own reply');
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);

  it('A asked E and E has not replied: invalid', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'r2-open');
    const asked = sentRef(await p1.world.platform.messages.sendMessage(a.ctx, write({ recipient: p1.lines.E.ref,
      text: 'P1 R2 unanswered', needsReply: true }, 'r2-open-ask')));
    expect(await reworkTC(p1, a, asked, 'r2-open-rework')).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);

  it('a message to S that A can neither read nor answer: forbidden', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'r2-closed');
    const toS = await personSends(p1.world, p1.lines.S, 'P1 R2 to S', 'r2-closed-ask');
    const refused = await reworkTC(p1, a, toS, 'r2-closed-rework');
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    // The basis is read with the round's own context (2.8): the mailbox's read refusal, not the caller admission.
    if (refused.status === 'rejected') expect(refused.reason).toContain('not addressed to or sent by the caller Session');
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);

  it('T-4: the secretary S\'s planning round asks to rework tC: forbidden (adviser planning round)', async () => {
    const p1 = await worlds.open();
    const s = await p1.hold(p1.lines.S, 'r2-duty-s');
    const refused = await reworkTC(p1, s, null, 'r2-duty-s-rework');
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('adviser planning round');
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);

  // The recheck's side of R2 (mutation M8-15: the recheck reads the basis without the round's line).
  const recheckBases: Array<[string, string, (p1: P1World, a: P1HeldRound) => Promise<SessionMessageRef>]> = [
    ['the round\'s own reply', 'an own reply is not a new basis', async (p1, a) => {
      const asked = await personSends(p1.world, p1.lines.A, 'P1 M8-15 question to A', 'm815-own-ask');
      expect(await replyAs(p1.world, a.ctx, asked, 'P1 M8-15 own answer', 'm815-own-reply'))
        .toMatchObject({ status: 'committed' });
      return asked;
    }],
    ['no reply yet', 'only a responded message is a new basis', async (p1, a) => sentRef(await p1.world.platform.messages
      .sendMessage(a.ctx, write({ recipient: p1.lines.E.ref, text: 'P1 M8-15 unanswered', needsReply: true },
        'm815-open-ask')))],
  ];
  it.each(recheckBases)('M8-15: A\'s round asks to recheck tC on a message with %s: invalid (%s); no successor round', async (_what, reason, basisOf) => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'm815-a');
    const refused = await p1.world.platform.evidence.reverifyRound!(a.ctx,
      await recheckRequest(p1, 'm815-recheck', await basisOf(p1, a)));
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid', reason: expect.stringContaining(reason) });
    expect(await roundsOf(p1)).toHaveLength(1);
  }, LONG);
});

describe('R4, R5: the recheck card and the scribe stop', () => {
  it('R4: every step; A\'s round asks to recheck tC\'s failed round (a card from A); after the round ended the person approves it: a successor round requested by that round', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'r4');
    if (a.ctx.principal.kind !== 'query_run') throw new Error('P1: not a QueryRun');
    const round = a.ctx.principal.queryRunRef;
    const requested = await p1.world.platform.evidence.reverifyRound!(a.ctx, await recheckRequest(p1, 'r4-recheck'));
    expect(requested).toMatchObject({ status: 'needs_decision' });
    await a.end();

    const card = await queuedCardOf(p1, requested);
    // The requester is A's round: the card names A's Session (2.8 `requester`, the `query_run` arm).
    expect(card.senderSessionRef).toEqual(p1.lines.A.ref);
    expect(await approveCard(p1, card, 'r4-approve')).toMatchObject({ status: 'ready',
      value: { state: 'applied', application: { status: 'committed' } } });
    const rounds = await roundsOf(p1);
    expect(rounds).toHaveLength(2);
    // The successor round's own read names this very round as its requester (not only the line).
    const successor = ready<Rounds>(await p1.world.post('verification/round',
      plain(S6A_SCOPE, { roundRef: rounds.at(-1)!.roundRef })), 'the successor round');
    expect(successor.chain.reverify?.requestedBy).toMatchObject({ kind: 'agent', queryRunRef: round });
  }, LONG);

  it('M8-8, M8-11: every step; A\'s round asks to rework tC (a card from A); after the round ended the person approves it: the rework is written, requested by that round', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'm88');
    if (a.ctx.principal.kind !== 'query_run') throw new Error('P1: not a QueryRun');
    const round = a.ctx.principal.queryRunRef;
    const requested = await reworkTC(p1, a, null, 'm88-rework');
    expect(requested).toMatchObject({ status: 'needs_decision' });
    await a.end();
    const card = await queuedCardOf(p1, requested);
    expect(card.senderSessionRef).toEqual(p1.lines.A.ref);
    expect(await approveCard(p1, card, 'm88-approve')).toMatchObject({ status: 'ready',
      value: { state: 'applied', application: { status: 'committed' } } });
    expect(await reworkEntries(p1, p1.task.tC)).toMatchObject([{ reason: 'P1 m88-rework',
      requestedBy: { kind: 'agent', queryRunRef: round } }]);
  }, LONG);

  it('R5: tC holds the platform\'s scribe stop; the platform\'s own rework is busy (scribe_stop_held); none is written', async () => {
    const p1 = await worlds.open();
    const source = await personSends(p1.world, p1.lines.A, 'P1 R5 scribe source', 'r5-source', false);
    expect(await placeScribeStop(p1.world, { taskRef: p1.task.tC, reason: 'P1 R5 scribe stop', sourceMessage: source,
      run: p1.runC, operationId: 'p1-r5-scribe' }, 'r5-scribe')).toMatchObject({ status: 'committed' });
    const refused = await platformRework(p1.world, p1.autoRework);
    expect(refused).toMatchObject({ status: 'rejected', code: 'busy' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('scribe_stop_held');
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);

  it('M4-11: tC holds the platform\'s scribe stop; the Workflow\'s own stopped rework step, advanced again, waits at its gate (scribe_stop_held); none is written', async () => {
    const p1 = await worlds.open();
    const source = await personSends(p1.world, p1.lines.A, 'P1 M4-11 scribe source', 'm411-source', false);
    expect(await placeScribeStop(p1.world, { taskRef: p1.task.tC, reason: 'P1 M4-11 scribe stop', sourceMessage: source,
      run: p1.runC, operationId: 'p1-m411-scribe' }, 'm411-scribe')).toMatchObject({ status: 'committed' });
    expect(ready(await p1.world.post('workflow/advance', plain(S6A_SCOPE, p1.autoRework)), 'the stopped rework step'))
      .toMatchObject({ state: 'waiting', receipt: null, reason: expect.stringContaining('scribe_stop_held') });
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);
});

describe('T-5, C7 (storage, both backends): the round\'s rework guards the round, and replays after it', () => {
  it.each(['memory', 'sqlite'] as const)('T-5 %s: A\'s round ends under its held rework commit: revision_conflict; no rework', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 't5-a');
    const held = commitBarrier.hold(commit => commit.records.some(record =>
      record.refKey.includes('"aggregateType":"TaskRequeue"')), 'T-5 rework');
    const reworking = reworkTC(p1, a, null, 't5-rework');
    try {
      await reachedBefore(held.reached, reworking);
      await a.end();
    } finally {
      held.release();
    }
    expect(await reworking).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);

  it.each(['memory', 'sqlite'] as const)('M4-14 %s: the platform\'s scribe stop on tC lands under A\'s held rework commit: revision_conflict; no rework', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'm414-a');
    const held = commitBarrier.hold(commit => commit.records.some(record =>
      record.refKey.includes('"aggregateType":"TaskRequeue"')), 'M4-14 rework');
    const reworking = reworkTC(p1, a, null, 'm414-rework');
    let placed: unknown;
    let reworked: PromiseSettledResult<unknown>;
    try {
      await reachedBefore(held.reached, reworking);
      placed = await placeScribeStop(p1.world, { taskRef: p1.task.tC, reason: 'P1 M4-14 scribe stop',
        sourceMessage: a.source, run: p1.runC, operationId: 'p1-m414-scribe' }, 'm414-scribe');
    } finally {
      held.release();
      [reworked] = await Promise.allSettled([reworking]);
    }
    expect(placed).toMatchObject({ status: 'committed' });
    expect(reworked).toMatchObject({ status: 'fulfilled', value: { status: 'rejected', code: 'revision_conflict' } });
    expect(await reworkEntries(p1, p1.task.tC)).toEqual([]);
  }, LONG);

  it.each([['rework', 'memory'], ['rework', 'sqlite'], ['recheck', 'memory'], ['recheck', 'sqlite']] as const)('C7 %s %s: after A\'s round ended, the same command answers its original receipt', async (kind, backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, `c7-${kind}-a`);
    const send = kind === 'rework'
      ? await (async () => { const request = await reworkRequest(p1, null, 'c7-rework');
        return async () => await p1.world.platform.claims.requeueTask!(a.ctx, request); })()
      : await (async () => { const request = await recheckRequest(p1, 'c7-recheck');
        return async () => await p1.world.platform.evidence.reverifyRound!(a.ctx, request); })();
    const first = await send();
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    await a.end();
    const again = await send();
    // The original receipt itself (ruling X6): its value and its cursor, only marked as a replay.
    expect(again).toEqual({ ...first, replayed: true });
  }, LONG);
});
