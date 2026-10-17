/**
 * Slice 4C-2 U3 fault row (rework 2): the §3.3 application-receipt proof reader
 * decodes the `NoteDispositionChanged` row of its proof table. The receipt
 * identity is a real committed event, but the reader reads only the formal
 * receipt and the answer's own ref, so a forged acknowledgement is `invalid`.
 *
 * The forged-proof fault row uses the S5 fixture. The second row is the
 * note-specific "ordinary disposition -> incomplete" case (spec L17, book §2.1):
 * a real answered note card, then an ordinary scribe disposition (withdraw — the
 * only ordinary scribe action a structural pending note permits) before the
 * application, through the public entries only, on memory and SQLite. The
 * formal `NoteDispositionChanged` row carries no proof, so the application read
 * is `incomplete` and nothing is recorded.
 *
 * The S5 decision fixture does not register the note schemas, so the real note
 * disposition event is committed to a real in-memory store built with
 * `NOTE_RECORD_SCHEMAS`; the answer message comes from the S5 fixture itself.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { DecisionChangeProofV1 } from '../../src/contracts/goal-decisions.js';
import type { EncodedDomainEvent } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend, type InMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import {
  NOTE_RECORD_SCHEMAS, encodeNoteDispositionChangedEvent, type NoteDispositionChangedEventV1,
} from '../../src/core/work-graph/persistence/note-record-codecs.js';
import { readApplicationReceiptFacts } from '../../src/core/work-graph/communication/decision-application.js';
import {
  OPERATOR, PROJECT_ID, WORKSPACE_ID, T, openS5DecisionFixture, type S5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';
import {
  createS4C2NoteCardFixture, understandingNote,
  type S4C2NoteCardFixture, type S4C2NoteCardFixtureKind,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4C2NoteCardFixtureKind[] = ['memory', 'sqlite'];
const fixtures: S5DecisionFixture[] = [];
const noteFixtures: S4C2NoteCardFixture[] = [];
const backends: InMemoryRecordBackend[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  for (const f of noteFixtures.splice(0)) await f.close();
  for (const b of backends.splice(0)) await b.close();
});

/** A minimal, decodable NoteHead/NoteVersion pair for a `NoteDispositionChanged`. */
function noteDispositionEvent(input: {
  eventId: string; acknowledgementRef: SessionMessageRef | null; proof: DecisionChangeProofV1 | null;
}): EncodedDomainEvent {
  const body = {
    kind: 'convention', topic: 'topic', topicKey: 'topic', conclusion: 'conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [],
    basis: { planRevision: null, catalogRevision: null, files: [] },
    structural: false, replaces: [], contradicts: [], coexistWith: [],
  };
  const head = { ...body, ref: { aggregateType: 'NoteHead', projectId: PROJECT_ID, noteId: 'note-1' },
    noteId: 'note-1', version: 1, state: 'reviewed', goalId: null, source: { kind: 'platform' },
    stagedRunKey: null, reviewReasons: [], confirmedByUser: false, anchorKey0: 'project', anchorKey1: null,
    anchorKey2: null, anchorKey3: null, anchorKey4: null, createdAt: T, since: null };
  const version = { ...body, ref: { aggregateType: 'NoteVersion', projectId: PROJECT_ID, noteId: 'note-1',
    version: 1 }, noteId: 'note-1', version: 1, state: 'reviewed', goalId: null, source: { kind: 'platform' },
    reviewReasons: [], noticeClass: null,
    change: { kind: 'review', by: { kind: 'platform' }, reason: null, decisionMessageRef: null },
    at: T, since: null };
  return encodeNoteDispositionChangedEvent({
    eventId: input.eventId, schemaVersion: 1, occurredAt: T, eventType: 'NoteDispositionChanged',
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, head, version,
    acknowledgementRef: input.acknowledgementRef, actor: OPERATOR, proof: input.proof,
  } as unknown as NoteDispositionChangedEventV1);
}

async function commitNoteEvent(event: EncodedDomainEvent, identityKey: string):
Promise<{ records: InMemoryRecordBackend['records']; receipt: DecisionApplicationReceiptV1 }> {
  const backend = createInMemoryRecordBackend({ schemas: NOTE_RECORD_SCHEMAS });
  backends.push(backend);
  const fingerprint = identityKey.padEnd(64, '0');
  const committed = await backend.records.commit({
    identityKey, fingerprint, guards: [], records: [], claims: [],
    indexGuards: [], indexChanges: [], events: [event],
  });
  if (committed.status !== 'committed') {
    throw new Error(`note disposition commit failed: ${JSON.stringify(committed)}`);
  }
  expect(committed.eventIds).toEqual([event.eventId]);
  return { records: backend.records, receipt: { identityKey, fingerprint, cursor: committed.cursor } };
}

async function readFacts(f: S5DecisionFixture, event: EncodedDomainEvent, identityKey: string) {
  const { records, receipt } = await commitNoteEvent(event, identityKey);
  const read = readApplicationReceiptFacts(records);
  const ctx: CoreCallContext = f.ctx;
  return { result: await read(ctx, { answer: f.messages.answered, receipt }), receipt };
}

describe('S4C2 U3 NoteDispositionChanged proof row', () => {
  it('rejects a forged proof whose acknowledgementRef names another answer as invalid', async () => {
    const f = await openS5DecisionFixture('memory');
    fixtures.push(f);
    const otherAnswer = f.messages.decision.ref;
    expect(otherAnswer).not.toEqual(f.messages.answered.ref);
    const proof: DecisionChangeProofV1 = {
      acknowledgementRef: otherAnswer, capturedPins: [], changes: [], basisRebases: [],
    };
    const event = noteDispositionEvent({ eventId: 'note-event-forged', acknowledgementRef: otherAnswer, proof });
    const { result } = await readFacts(f, event, 'note-forged');
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
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
