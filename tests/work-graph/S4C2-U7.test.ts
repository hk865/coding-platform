/**
 * Slice 4C-2 U7 (rework 2): the note-card source on a REAL pending card, over
 * the shared no-spy acceptance fixture in BOTH backends.
 *
 * One user-confirmed note and one real executor Run's pending replacement are
 * written through the public `platform.notes.writeNote` routes
 * (`f.writeUser`/`f.writeAgent`). Nothing is captured from the note service and
 * no `NoteDecisionSourcePort` is reassembled: the ONLY double is a call-counting
 * wrapper around the REAL `createNoteReviewCardSource` produced during
 * composition, installed by spying on that production export. `readPage` counts
 * a list read; `readByKey` counts a by-key read and records the pin the key
 * names (parsed from the literal canonical JSON key, never `decisionSourceKey`).
 *
 * The wrapper proves:
 *   - the real queue assembles the Goal's collection once (list 1, by-key 0);
 *   - `readDecisionCard` by the card's source is a by-key read (list stays 1);
 *   - a missing key is `not_found` (list stays 1);
 *   - the real card is still `waiting_answer`;
 *   - M1: the same g1 card source carrying goalRef g2 is `not_found` and leaves
 *     the g1 card waiting.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DecisionCardSourcePort } from '../../src/core/work-graph/model/decision-contracts.js';
import * as decisionReadModelModule from '../../src/core/work-graph/views/decision-read-model.js';
import {
  createS4C2NoteCardFixture, generalNote,
  type S4C2NoteCardFixture, type S4C2NoteCardFixtureKind,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4C2NoteCardFixtureKind[] = ['memory', 'sqlite'];
const PROJECT_ID = 's4a-scope-project';
/**
 * Hand-computed JCS card key of the pending replacement: the first write is
 * `s4c2-note-1` (user) and the agent's `replaces` write is `s4c2-note-2` at
 * version 1 in project `s4a-scope-project`.
 */
const AGENT_CARD_KEY = '{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead",'
  + '"noteId":"s4c2-note-2","projectId":"s4a-scope-project"},"revision":1}}';
/** Hand-computed JCS card key of a note that was never written. */
const MISSING_CARD_KEY = '{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead",'
  + '"noteId":"missing-note","projectId":"s4a-scope-project"},"revision":1}}';

type Pins = { noteId: string; version: number }[];
type Counters = { listCalls: () => number; byKeyPins: () => Pins };

function idOf(result: { status: string }): string {
  return (result as unknown as { noteId: string }).noteId;
}

/** The pin the source key names, read out of the literal key itself. */
function pinOfKey(key: string): { noteId: string; version: number } {
  const identity = JSON.parse(key) as { note: { ref: { noteId: string }; revision: number } };
  return { noteId: identity.note.ref.noteId, version: identity.note.revision };
}

/** The REAL source with read counters; every result still comes from production. */
function countingSource(real: DecisionCardSourcePort,
  list: { value: number }, byKey: Pins): DecisionCardSourcePort {
  const realByKey = real.readByKey;
  if (realByKey === undefined) throw new Error('the note_review source has no by-key read');
  return {
    kind: real.kind,
    needsGoal: real.needsGoal,
    async readPage(ctx, input) {
      list.value += 1;
      return real.readPage(ctx, input);
    },
    async readByKey(ctx, input) {
      byKey.push(pinOfKey(input.source.key));
      return realByKey(ctx, input);
    },
  };
}

/**
 * Compose the shared fixture with the production card-source factory spied:
 * the platform receives the real source wrapped in the counters. The spy is
 * restored immediately after composition.
 */
async function withCountedFixture<T>(kind: S4C2NoteCardFixtureKind,
  body: (f: S4C2NoteCardFixture, counters: Counters) => Promise<T>): Promise<T> {
  const list = { value: 0 };
  const byKey: Pins = [];
  const original = decisionReadModelModule.createNoteReviewCardSource;
  const spy = vi.spyOn(decisionReadModelModule, 'createNoteReviewCardSource')
    .mockImplementation(deps => countingSource(original(deps), list, byKey));
  const f = await (async () => {
    try { return await createS4C2NoteCardFixture(kind); } finally { spy.mockRestore(); }
  })();
  try {
    return await body(f, { listCalls: () => list.value, byKeyPins: () => [...byKey] });
  } finally {
    await f.close();
  }
}

/** ONE user-confirmed note and ONE real pending agent note that replaces it. */
async function seedPending(f: S4C2NoteCardFixture): Promise<{ userId: string; agentId: string }> {
  const mine = await f.writeUser(generalNote({ conclusion: 'user conclusion' }), f.goalRef.goalId);
  expect(mine).toMatchObject({ status: 'accepted', confirmedByUser: true });
  const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision',
    conclusion: 'agent conclusion', replaces: [idOf(mine)] }), f.goalRef.goalId);
  expect(agent).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
  return { userId: idOf(mine), agentId: idOf(agent) };
}

describe('S4C2 U7 note-card source (real pending card, counted production source)', () => {
  it.each(KINDS)('U7 %s: the queue assembles once, a direct read is by key, a missing key is not_found and M1 leaves the g1 card waiting', async kind => {
    await withCountedFixture(kind, async (f, counters) => {
      const { userId, agentId } = await seedPending(f);
      // Deterministic ids make the expected literal key meaningful.
      expect([userId, agentId]).toEqual([f.noteId(1), f.noteId(2)]);

      const queue = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
        workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 },
      });
      expect(queue.status).toBe('ready');
      if (queue.status !== 'ready') return;
      const card = queue.value.waitingAnswer.find(candidate => candidate.source.kind === 'note_review');
      expect(card).toBeDefined();
      if (card === undefined) return;
      expect(card).toMatchObject({
        cardKey: AGENT_CARD_KEY,
        state: 'waiting_answer',
        source: { kind: 'note_review', key: AGENT_CARD_KEY, goalRef: f.goalRef,
          pins: [{ ref: { aggregateType: 'NoteHead', projectId: PROJECT_ID, noteId: agentId },
            revision: 1 }] },
      });
      // The queue assembled the Goal's whole note collection exactly once.
      expect(counters.listCalls()).toBe(1);
      expect(counters.byKeyPins()).toEqual([]);

      const direct = await f.platform.decisions.readDecisionCard(f.ctx(), { source: card.source });
      expect(direct).toMatchObject({ status: 'ready', value: { cardKey: AGENT_CARD_KEY,
        state: 'waiting_answer', source: { kind: 'note_review', key: AGENT_CARD_KEY } } });
      // No paging and no collection read: the card came back by its key.
      expect(counters.listCalls()).toBe(1);
      expect(counters.byKeyPins()).toEqual([{ noteId: 's4c2-note-2', version: 1 }]);

      const missing = await f.platform.decisions.readDecisionCard(f.ctx(), {
        source: { ...card.source, key: MISSING_CARD_KEY },
      });
      expect(missing).toEqual({ status: 'not_found' });
      expect(counters.listCalls()).toBe(1);
      expect(counters.byKeyPins()).toEqual([
        { noteId: 's4c2-note-2', version: 1 }, { noteId: 'missing-note', version: 1 },
      ]);

      // M1: the same g1 card key carrying goalRef g2 is not that Goal's card.
      const crossGoal = await f.platform.decisions.readDecisionCard(f.ctx(), {
        source: { ...card.source, goalRef: f.goal2Ref },
      });
      expect(crossGoal).toEqual({ status: 'not_found' });
      expect(counters.listCalls()).toBe(1);
      expect(counters.byKeyPins()).toEqual([
        { noteId: 's4c2-note-2', version: 1 },
        { noteId: 'missing-note', version: 1 },
        { noteId: 's4c2-note-2', version: 1 },
      ]);

      // The real g1 card is still waiting after both failed reads.
      const again = await f.platform.decisions.readDecisionCard(f.ctx(), { source: card.source });
      expect(again).toMatchObject({ status: 'ready', value: { cardKey: AGENT_CARD_KEY,
        state: 'waiting_answer', source: { kind: 'note_review', goalRef: f.goalRef } } });
      expect(counters.listCalls()).toBe(1);
      // The confirmed user note stayed accepted; the agent's replacement is the
      // only pending note.
      expect(await f.platform.notes.readNote(f.ctx(), { noteId: userId })).toMatchObject({
        status: 'ready', value: { storedState: 'accepted' } });
      expect(await f.platform.notes.readNote(f.ctx(), { noteId: agentId })).toMatchObject({
        status: 'ready', value: { storedState: 'pending_review' } });
      expect(await f.waitingCards()).toHaveLength(1);
    });
  });
});
