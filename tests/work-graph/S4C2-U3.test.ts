/**
 * Slice 4C-2 U3 fault row (rework 2): the §3.3 application-receipt proof reader
 * decodes the `NoteDispositionChanged` row of its proof table. TWO real pending
 * note cards A and B are built through the S4C2 card fixture. A is answered only
 * (no application), B is answered and applied through the real coordinator; the
 * formal `NoteDispositionChanged` write of B carries the real proof whose
 * `acknowledgementRef` is B's answer. Handing B's real receipt to A's answer is
 * `invalid`: the reader compares the proof's acknowledgement with this answer.
 *
 * The second row is the note-specific "ordinary disposition -> incomplete" case
 * (spec L17, book §2.1): a real answered note card, then an ordinary scribe
 * disposition (withdraw — the only ordinary scribe action a structural pending
 * note permits) before the application, through the public entries only, on
 * memory and SQLite. The formal `NoteDispositionChanged` row carries no proof,
 * so the application read is `incomplete` and nothing is recorded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createS4C2NoteCardFixture, understandingNote,
  type S4C2NoteCardFixture, type S4C2NoteCardFixtureKind,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4C2NoteCardFixtureKind[] = ['memory', 'sqlite'];
const noteFixtures: S4C2NoteCardFixture[] = [];
afterEach(async () => {
  for (const f of noteFixtures.splice(0)) await f.close();
});

describe('rejects: S4C2 U3 NoteDispositionChanged proof row (another answer\'s receipt)', () => {
  it('rejects a forged proof whose acknowledgementRef names another answer as invalid', async () => {
    const f = await createS4C2NoteCardFixture('memory');
    noteFixtures.push(f);
    // (1) TWO real pending structural understanding cards, A in g1 and B in g2,
    //     each written by that Goal's real executor Run through the notes owner.
    const noteA = await f.writeAgent(f.executor,
      understandingNote({ structural: true, conclusion: 'card A' }), f.goalRef.goalId);
    expect(noteA).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
    const noteAId = (noteA as unknown as { noteId: string }).noteId;
    const cardA = await f.cardOf(noteAId);
    expect(cardA).not.toBeNull();
    expect(cardA!.options.map(option => option.id)).toEqual(['accept', 'reject']);

    const noteB = await f.writeAgent(f.executor2,
      understandingNote({ structural: true, conclusion: 'card B', anchor: { kind: 'goal', goalId: f.goal2Ref.goalId } }),
      f.goal2Ref.goalId);
    expect(noteB).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
    const noteBId = (noteB as unknown as { noteId: string }).noteId;
    const cardB = await f.cardOf(noteBId);
    expect(cardB).not.toBeNull();
    expect(cardB!.options.map(option => option.id)).toEqual(['accept', 'reject']);

    // (2) A is answered ONLY through the public answer entry: answered, pending
    //     application, with no formal disposition receipt yet.
    const answeredA = await f.platform.decisionMessages.answerDecision(f.ctx(), {
      input: { source: cardA!.source, selection: { kind: 'option', optionId: 'accept' }, text: '', annotations: [] },
      meta: { requestId: 's4c2-u3-answer-a', expected: cardA!.source.pins },
    });
    expect(answeredA.status).toBe('committed');
    if (answeredA.status !== 'committed') throw new Error(`card A was not answered: ${JSON.stringify(answeredA)}`);
    const answerA = answeredA.value;
    const beforeA = await f.readCard(noteAId);
    expect(beforeA).toMatchObject({ state: 'answered_pending_application', application: null,
      answerMessageRef: answerA.ref });

    // (3) B is answered and applied by the REAL coordinator. Its formal
    //     `NoteDispositionChanged` write returns the receipt whose proof names
    //     B's own answer — nothing is built or forged here.
    const resolvedB = await f.resolve(cardB!, 'accept', 's4c2-u3-answer-b');
    expect(resolvedB).toMatchObject({ status: 'ready', value: {
      state: 'applied', answer: { status: 'committed' },
      action: { status: 'done', noteId: noteBId, state: 'accepted' },
      application: { status: 'committed' } } });
    if (resolvedB.status !== 'ready') throw new Error(`card B was not resolved: ${JSON.stringify(resolvedB)}`);
    const actionB = resolvedB.value.action;
    if (actionB === null || actionB.status !== 'done') {
      throw new Error(`card B had no formal disposition receipt: ${JSON.stringify(actionB)}`);
    }
    expect(actionB.receipt).toMatchObject({ identityKey: expect.any(String), fingerprint: expect.any(String),
      cursor: expect.any(String) });

    // (4) Handing A's answer the real receipt of B is `invalid`: the proof's
    //     acknowledgementRef names B's answer, not this one.
    const recorded = await f.platform.decisionMessages.recordDecisionApplication(f.ctx(), {
      input: { messageRef: answerA.ref, receipt: actionB.receipt },
      meta: { requestId: 's4c2-u3-cross-application',
        expected: [{ ref: answerA.ref, revision: answerA.revision }] },
    });
    expect(recorded).toMatchObject({ status: 'rejected', code: 'invalid' });

    // A's public read is unchanged: still answered, pending application.
    expect(await f.readCard(noteAId)).toEqual(beforeA);
  });
});

describe('S4C2 U3 note-specific ordinary disposition row', () => {
  it.each(KINDS)('%s: an ordinary scribe disposition after the answer leaves the application incomplete', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    noteFixtures.push(f);
    // (1) ONE pending STRUCTURAL understanding in g1: the real card is
    //     accept/reject and pins the NoteHead.
    const note = await f.writeAgent(f.executor,
      understandingNote({ structural: true, conclusion: 'ordinary disposition before application' }),
      f.goalRef.goalId);
    expect(note).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
    const noteId = (note as unknown as { noteId: string }).noteId;
    const card = await f.cardOf(noteId);
    expect(card).not.toBeNull();
    expect(card!.source.pins).toEqual([{ ref: { aggregateType: 'NoteHead',
      projectId: 's4a-scope-project', noteId }, revision: 1 }]);
    expect(card!.options.map(option => option.id)).toEqual(['accept', 'reject']);

    // (2) The user answers the card through the public answer entry. Nothing
    //     applies the answer yet: the card is answered, pending application.
    const answered = await f.platform.decisionMessages.answerDecision(f.ctx(), {
      input: { source: card!.source, selection: { kind: 'option', optionId: 'accept' }, text: '', annotations: [] },
      meta: { requestId: 's4c2-u3-note-answer', expected: card!.source.pins },
    });
    expect(answered.status).toBe('committed');
    if (answered.status !== 'committed') throw new Error(`the note answer was not committed: ${JSON.stringify(answered)}`);
    const answer = answered.value;

    // (3) BEFORE the application the project scribe makes an ORDINARY
    //     disposition. On a structural pending understanding the live
    //     user-reason set (`structural`) reserves accept/reject for the user and
    //     `review` only starts from `accepted`, so the scribe's real ordinary
    //     action here is `withdraw` (pending_review -> withdrawn v2). Its
    //     `NoteDispositionChanged` row carries acknowledgementRef null and
    //     proof null — no card proof.
    const dispositioned = await f.withdraw(f.scribe, noteId, { expectedVersion: 1,
      reason: 'ordinary scribe disposition' });
    expect(dispositioned).toMatchObject({ status: 'done', noteId, version: 2, state: 'withdrawn',
      receipt: { identityKey: expect.any(String), fingerprint: expect.any(String), cursor: expect.any(String) } });
    if (dispositioned.status !== 'done') {
      throw new Error(`the ordinary note disposition was not done: ${JSON.stringify(dispositioned)}`);
    }

    // (4) The public application entry reads the formal receipt's row: it has no
    //     decision change proof, so the application is `incomplete` and nothing
    //     is written.
    const recorded = await f.platform.decisionMessages.recordDecisionApplication(f.ctx(), {
      input: { messageRef: answer.ref, receipt: dispositioned.receipt },
      meta: { requestId: 's4c2-u3-note-application',
        expected: [{ ref: answer.ref, revision: answer.revision }] },
    });
    expect(recorded).toMatchObject({ status: 'rejected', code: 'incomplete',
      reason: 'the formal event carries no decision change proof' });

    // The card is still answered and pending application in the by-key read...
    expect(await f.readCard(noteId)).toMatchObject({ state: 'answered_pending_application',
      application: null, answerMessageRef: answer.ref });
    // ...and in the queue's answered section.
    const queue = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
      workspace: f.scope, sections: ['answered_pending_application'], page: { limit: 100 },
    });
    expect(queue.status).toBe('ready');
    if (queue.status !== 'ready') throw new Error(`the decision queue read failed: ${JSON.stringify(queue)}`);
    const pending = queue.value.answeredPendingApplication.filter(entry => entry.cardKey === card!.cardKey);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ state: 'answered_pending_application', application: null,
      answerMessageRef: answer.ref });
  });
});
