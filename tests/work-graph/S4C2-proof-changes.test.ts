/**
 * S4C2 rework item 4 (verify §4): the card's `DecisionChangeProofV1.changes`
 * are ONE `{ before, after }` row per CHANGED HEAD — the card's own note and
 * every target superseded in the same commit — and both sides name the SAME
 * NoteHead aggregate (`@v → @v+1`). No CurrentPointer row, no NoteVersion row.
 *
 * Driven through the real `platform.workflow.resolveDecision` and read back
 * through the public `platform.decisions.readDecisionCard`; memory and SQLite.
 */
import { expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const GOAL = { kind: 'goal', goalId: 's4a-goal' } as const;
const PROJECT = 's4a-project';

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'preference', topic: 'default', conclusion: 'default', anchor: GOAL, extraAnchors: [], facts: [],
    basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

function noteHead(noteId: string): { aggregateType: 'NoteHead'; projectId: string; noteId: string } {
  return { aggregateType: 'NoteHead', projectId: PROJECT, noteId };
}

/** ONE user note and ONE pending agent note that replaces it. */
async function seedReplacement(f: S4ANoteFixture): Promise<{ userId: string; agentId: string }> {
  const mine = await f.write(f.ctx(), general({ conclusion: 'user conclusion' }), 's4a-goal');
  const userId = idOf(mine);
  const run = await f.claimRun('proof-changes');
  const agent = await f.write(f.workCtx(run), general({ kind: 'decision', conclusion: 'agent conclusion',
    replaces: [userId] }), 's4a-goal');
  expect(agent).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
  return { userId, agentId: idOf(agent) };
}

/** The real queue's ONE live note card for the fixture Goal. */
async function noteCardOf(f: S4ANoteFixture): Promise<DecisionCardV1> {
  const queue = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 } });
  if (queue.status !== 'ready') throw new Error(`queue read failed: ${JSON.stringify(queue)}`);
  const card = queue.value.waitingAnswer.find(candidate => candidate.source.kind === 'note_review');
  if (card === undefined) throw new Error('the queue has no note_review card');
  return card;
}

async function resolveCard(f: S4ANoteFixture, card: DecisionCardV1, optionId: string, requestId: string):
Promise<void> {
  const resolve = f.platform.workflow.resolveDecision;
  if (resolve === undefined) throw new Error('the composition publishes no resolveDecision');
  const result = await resolve(f.ctx(), {
    input: { source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [] },
    meta: { requestId, expected: card.source.pins } });
  expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
}

async function readChanges(f: S4ANoteFixture, card: DecisionCardV1):
Promise<{ before: unknown; after: unknown }[]> {
  const read = await f.platform.decisions.readDecisionCard(f.ctx(), { source: card.source });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error('the applied card is not readable');
  const application = read.value.application;
  expect(application).not.toBeNull();
  return application!.changes;
}

it.each(KINDS)('S4C2-item4 %s: a supersede proof changes the note head and each superseded target head',
  async kind => {
    const f = await createS4ANoteFixture(kind, { operatorActor: { kind: 'human', id: 's4a-operator' } });
    try {
      const { userId, agentId } = await seedReplacement(f);
      const card = await noteCardOf(f);
      await resolveCard(f, card, 'supersede', `s4c2-item4-supersede-${kind}`);
      expect(await readChanges(f, card)).toEqual([
        { before: { ref: noteHead(agentId), revision: 1 }, after: { ref: noteHead(agentId), revision: 2 } },
        { before: { ref: noteHead(userId), revision: 1 }, after: { ref: noteHead(userId), revision: 2 } },
      ]);
    } finally { await f.close(); }
  });

it.each(KINDS)('S4C2-item4 %s: a reject proof changes only the note head', async kind => {
  const f = await createS4ANoteFixture(kind, { operatorActor: { kind: 'human', id: 's4a-operator' } });
  try {
    const { agentId } = await seedReplacement(f);
    const card = await noteCardOf(f);
    await resolveCard(f, card, 'reject', `s4c2-item4-reject-${kind}`);
    expect(await readChanges(f, card)).toEqual([
      { before: { ref: noteHead(agentId), revision: 1 }, after: { ref: noteHead(agentId), revision: 2 } },
    ]);
  } finally { await f.close(); }
});
