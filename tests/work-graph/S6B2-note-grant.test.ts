/**
 * AD-02: the note-time grant is re-read from the carrier Jobs at the note call. The first row carries two Goals and
 * writes through the real understanding round to the non-effective one. The second crashes SQLite while the round is
 * entering, lets QRR-02 open a new attempt on the same Job, and closes the carrier through the published advance
 * while the real `record_note` is held: the note is refused and no pointer moves. Named mutation
 * `AD02-note-use-frozen-carrier-command` (frozen command in `W/tasks/secretary-query-run.ts:144`) makes it red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { understandingPointer } from '../helpers/S6B1-fixture.js';
import { holdS6BUnderstandingRound, openS6B2World } from '../helpers/S6B2-fixture.js';
import { s6b2UnderstandingCarrier } from '../helpers/S6B2-handoff-scene.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';

// A3: after the real close commits, hold its return until the note call resumes; the result is returned unchanged.
const closeBox = vi.hoisted(() => {
  let reach!: () => void; let open!: () => void;
  const reached = new Promise<void>(resolve => { reach = resolve; });
  const gate = new Promise<void>(resolve => { open = resolve; });
  return { reached, gate, reach: () => reach(), release: () => open(), armed: false };
});
vi.mock('../../src/business/workflow/session-handoff.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/business/workflow/session-handoff.js')>();
  return { ...real, createSecretaryHandoffWorkflow: (deps: Parameters<typeof real.createSecretaryHandoffWorkflow>[0]) =>
    real.createSecretaryHandoffWorkflow({ ...deps, requests: { ...deps.requests,
      async closeUnderstanding(ctx, input) {
        const result = await deps.requests.closeUnderstanding(ctx, input);
        if (closeBox.armed && result.status === 'committed') { closeBox.reach(); await closeBox.gate; }
        return result;
      } } }) };
});
afterEach(() => { closeBox.armed = false; closeBox.release(); vi.restoreAllMocks(); });

const ANSWER = JSON.stringify({ schemaVersion: 1, body: 'S6B2 note-grant answer', ideas: [], goalCardDrafts: [] });
type World = Awaited<ReturnType<typeof openS6B2World>>['world'];

/** One real request routed to the secretary, so the source owns a Goal root. */
async function goalRoot(world: World, secretary: S6ASession, goal: GoalRef, id: string) {
  const pending = await world.submit({ commandId: `${id}-submit`, goalId: goal.goalId, text: `S6B2 ${id}` });
  if (pending.status !== 'queued') throw new Error(`S6B2: the ${id} request was refused`);
  expect(await world.route({ commandId: `${id}-route`, round: pending.round, to: secretary }))
    .toMatchObject({ status: 'routed' });
}

/** One real `record_note` call to a Goal understanding, from the public pointer (a tool argument, not a fact). */
async function noteCall(world: World, goal: GoalRef, callId: string) {
  const pointer = await understandingPointer(world, { kind: 'goal', goalId: goal.goalId });
  const note = understandingNote({ anchor: { kind: 'goal', goalId: goal.goalId }, topic: 's6b2-understanding',
    conclusion: `S6B2 understanding ${callId}`, structural: false, replaces: pointer.noteId === null ? [] : [pointer.noteId] });
  if (note.kind !== 'understanding') throw new Error('S6B2: the note draft is not an understanding');
  return { pointer, call: { callId, name: 'record_note', args: { op: 'write', kind: note.kind, topic: note.topic,
    conclusion: note.conclusion, anchor: note.anchor, sections: note.sections, structural: note.structural,
    replaces: note.replaces, expectedPointerRevision: pointer.revision } } };
}

describe('the moved grant through the real advance', () => {
  it('a live grant from two Goal requests reaches a note outside the effective Goal', async () => {
    const opened = await openS6B2World({ backend: 'memory', secretaryTools: ['read', 'record_note'] });
    try {
      const secretary = await opened.world.createSecretary('grant');
      for (const [index, goal] of [opened.world.goals.first, opened.world.goals.second].entries()) {
        await goalRoot(opened.world, secretary, goal, `grant-goal-${index}`);
      }
      // The first root is the effective Goal; the note write chooses the second, granted Goal.
      const round = await holdS6BUnderstandingRound(opened.world, { secretary, goals: [opened.world.goals.second] });
      expect((await readQuery(opened.world.ag2b, round.round)).job.job.understanding?.goals.map(entry => entry.goalRef))
        .toEqual([opened.world.goals.first, opened.world.goals.second]);
      expect(round.pointers.map(entry => entry.goal)).toEqual([opened.world.goals.second]);
      expect(round.pointers[0]?.pointer.noteId).not.toBeNull();
      expect(round.pointers[0]?.note.anchor).toMatchObject({ kind: 'goal', goalId: opened.world.goals.second.goalId });
    } finally { await opened.close(); }
  });

  it('the carrier command closed during the note call refuses the note and moves no pointer', async () => {
    const opened = await openS6B2World({ backend: 'sqlite', secretaryTools: ['read', 'record_note'] });
    const world = opened.world;
    try {
      const secretary = await world.createSecretary('ad02');
      const carried = await s6b2UnderstandingCarrier(world, secretary, 'ad02');
      const owner = world.platform.workflow.sessionHandoff!;
      expect((await readQuery(world.ag2b, carried.carrier)).job.job.understanding?.goals.map(entry => entry.goalRef))
        .toEqual([world.goals.first, world.goals.second]);
      const carrier = carried.carrier;
      const note = await noteCall(world, world.goals.second, 'ad02-note-second');
      expect(note.pointer.noteId).toBeNull();
      await world.scripted.script(secretary, [{ kind: 'calls', calls: [note.call] }, { kind: 'text', text: ANSWER }]);
      const tool = await world.gates.toolCall(secretary, 'record_note');
      const started = world.post('queries/start', plain(S6A_SCOPE, { prepared: carried.prepared,
        consumerId: AG2B_CONSUMER_ID, requestId: 'ad02-start-2' })).then(answer => answer.body);
      started.catch(() => undefined);
      await tool.reached;
      // The published advance closes the same command; the close commits before the note resumes.
      closeBox.armed = true;
      const advanced = owner.advance(world.systemContext(), { operation: carried.operation });
      await closeBox.reached;
      tool.release();
      expect(await started).toMatchObject({ status: 'ready' });
      closeBox.release();
      await advanced;
      expect(await understandingPointer(world, { kind: 'goal', goalId: world.goals.second.goalId }))
        .toEqual(note.pointer);
      expect((await readQuery(world.ag2b, carrier)).job.job.understanding?.state).not.toBe('live');
    } finally { closeBox.release(); await opened.close(); }
  });
});
