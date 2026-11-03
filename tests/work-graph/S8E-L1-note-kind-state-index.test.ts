/**
 * Slice 8E L1 C-index: the project-scope `(project, kind, state)` lookup declaration and the goal-anchor `lookup`
 * over one real round.
 *
 * World: the frozen request world's project and goal 1 (`openS6ARequestWorld`), with the platform scribe binding so
 * the scribe's own Run can write; memory and SQLite. All four notes hang on the same goal anchor:
 *   1. the person writes a `pitfall` through `notes/write` (accepted; id from `write.noteId`);
 *   2. the scribe's real Run writes a `pitfall` through the scripted `record_note` tool on the same goal anchor,
 *      contradicting the first note (pending_review; id from the tool result's `write.noteId`);
 *   3. the person writes a `pitfall` and reviews it through `notes/review` (reviewed);
 *   4. the person writes another `pitfall` (accepted).
 * The read back is one `lookup` call on the goal anchor, the owner behind the agent's E5 `lookup`, with a limit
 * covering all four items; the three stored states are compared as sorted id groups. The index declaration is
 * asserted literally from the public `NOTE_RECORD_SCHEMAS`. No migration step is involved or asserted: the stores
 * create their own lookup buckets and the migration diff is D1's.
 */
import { describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { NoteAnchorV1 } from '../../src/contracts/note.js';
import type { NoteDispositionResult, NoteItemV1, WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { NOTE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/note-record-codecs.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { seedS6BScribe } from '../helpers/S6B1-fixture.js';
import {
  openS6ARequestWorld, S6A_SCOPE, type S6ABackend, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';

/** One `notes/write` body: a person's general note on `anchor`, accepted at once unless it contradicts. */
function pitfallWrite(goalId: string, anchor: NoteAnchorV1, topic: string, conclusion: string) {
  return {
    commandId: `s8e-note-${topic}`,
    goalId,
    expectedPointerRevision: null,
    note: {
      kind: 'pitfall' as const, topic, conclusion, anchor,
      extraAnchors: [], facts: [], basisFiles: [], body: `S8E note body ${topic}`,
      structural: false, replaces: [], contradicts: [], coexistWith: [],
    },
  };
}

/** The write receipt of an accepted person write: `noteId` and `version` exactly as the route returned them. */
async function writePitfall(world: S6ARequestWorld, goalId: string, anchor: NoteAnchorV1,
  topic: string): Promise<{ noteId: string; version: number }> {
  const answer = await world.post('notes/write', plain(S6A_SCOPE, pitfallWrite(goalId, anchor, topic,
    `S8E conclusion ${topic}`)));
  if (answer.httpStatus !== 200) throw new Error(`S8E notes/write answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const envelope = answer.body as WriteNoteEnvelopeV1;
  if (envelope.write.status !== 'accepted') {
    throw new Error(`S8E notes/write did not accept ${topic}: ${JSON.stringify(envelope)}`);
  }
  return { noteId: envelope.write.noteId, version: envelope.write.version };
}

/** The JSON tool result the Runtime served the model for `callId` (the last one when a replay repeats the id). */
function lastToolJson(requests: readonly ModelRequest[], callId: string): unknown {
  let found: unknown;
  let seen = false;
  for (const request of requests) {
    for (const message of request.messages) {
      if (message.role !== 'tool' || message.callId !== callId) continue;
      const output = (message.result as { output?: readonly { kind: string; value?: unknown }[] }).output ?? [];
      const block = output.find(candidate => candidate.kind === 'json');
      if (block !== undefined) { found = block.value; seen = true; }
    }
  }
  if (!seen) throw new Error(`the tool result for ${callId} is missing from the recorded model requests`);
  return found;
}

const idsIn = (items: readonly NoteItemV1[], state: NoteItemV1['storedState']): string[] =>
  items.filter(item => item.storedState === state).map(item => item.noteId);

describe('S8E L1 C-index', () => {
  it('C-index declaration: the one kind/state lookup is frozen literally', () => {
    const matching = (NOTE_RECORD_SCHEMAS.lookups ?? []).filter(entry => entry.name === 's8e-note-by-kind-state');
    expect(matching).toHaveLength(1);
    expect(matching[0]).toEqual({
      name: 's8e-note-by-kind-state',
      aggregateType: 'NoteHead',
      paths: ['ref.projectId', 'kind', 'state'],
      orderBy: { path: 'noteId' },
    });
  });

  it.each<S6ABackend>(['memory', 'sqlite'])('C-index %s: one goal-anchor lookup groups the four notes by stored state',
    async backend => {
      const world = await openS6ARequestWorld({ backend, scribe: true });
      try {
        const goal = world.goals.first;
        const anchor: NoteAnchorV1 = { kind: 'goal', goalId: goal.goalId };
        const scribe = await seedS6BScribe(world);

        // 1. The person's first pitfall: accepted, id from the write receipt.
        const n1 = await writePitfall(world, goal.goalId, anchor, 's8e-pitfall-one');

        // 2. The scribe's real Run writes the contradiction on the same goal anchor.
        const callId = 's8e-pitfall-scribe';
        world.scriptReplies([
          { kind: 'calls', calls: [{ callId, name: 'record_note', args: {
            op: 'write', kind: 'pitfall', topic: 's8e-pitfall-two',
            conclusion: 'S8E conclusion s8e-pitfall-two', body: 'S8E note body s8e-pitfall-two',
            anchor, contradicts: [n1.noteId],
          } }] },
          { kind: 'text', text: 'S8E scribe wrote the contradiction' },
        ]);
        const callsBefore = world.model.calls();
        await driveWorkflow(world.ag2b, {
          schemaVersion: 1, goalRef: scribe.goal, flowId: 's8e-note-index',
          sessionHint: scribe.line.ref, kind: 'select_work', taskId: scribe.nextTask().taskId,
        });
        expect(world.model.calls()).toBe(callsBefore + 2);
        const scribeResult = lastToolJson(world.model.requests, callId) as {
          write?: { status?: string; noteId?: string; version?: number } };
        expect(scribeResult.write?.status).toBe('pending_review');
        if (scribeResult.write?.noteId === undefined) {
          throw new Error(`S8E the scribe's write result has no noteId: ${JSON.stringify(scribeResult)}`);
        }
        const n2 = { noteId: scribeResult.write.noteId, version: scribeResult.write.version ?? 1 };

        // 3. The person's third pitfall, reviewed by its own version: reviewed.
        const n3 = await writePitfall(world, goal.goalId, anchor, 's8e-pitfall-three');
        const reviewed = await world.post('notes/review', plain(S6A_SCOPE, {
          commandId: 's8e-note-review-three', noteId: n3.noteId, expectedVersion: n3.version,
          expectedPointerRevision: null, verdict: 'review', reason: null,
        }));
        if (reviewed.httpStatus !== 200) throw new Error(`S8E notes/review answered ${reviewed.httpStatus}: ${JSON.stringify(reviewed.body)}`);
        const disposition = reviewed.body as NoteDispositionResult;
        expect(disposition).toMatchObject({ status: 'done', noteId: n3.noteId, state: 'reviewed' });

        // 4. The person's fourth pitfall: accepted.
        const n4 = await writePitfall(world, goal.goalId, anchor, 's8e-pitfall-four');

        // One lookup on the goal anchor, the E5 read's owner, with a limit covering all four items.
        const read = await world.platform.notes.memoryLookup(world.humanContext(), {
          v: 1, op: 'lookup', anchor, limit: 8, cursor: null,
        });
        if (read.status !== 'ready') throw new Error(`S8E the goal-anchor lookup is not ready: ${JSON.stringify(read)}`);
        const items = read.value.items;
        expect(items).toHaveLength(4);
        expect(items.every(item => item.kind === 'pitfall')).toBe(true);

        // Each group is compared in ascending noteId order; accepted follows the two receipt ids, not write order.
        expect(idsIn(items, 'accepted')).toEqual([n1.noteId, n4.noteId].sort());
        expect(idsIn(items, 'reviewed')).toEqual([n3.noteId]);
        expect(idsIn(items, 'pending_review')).toEqual([n2.noteId]);
      } finally {
        await world.close();
      }
    });
});
