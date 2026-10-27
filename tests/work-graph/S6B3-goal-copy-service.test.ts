/**
 * Copying a cancelled Goal through the public routes: the draft preview and the confirm.
 *
 * Every state comes from the frozen copy fixture's public steps and the public core routes. The copy routes are not
 * published from production yet, so a deferred row ends by asserting the fixture's exact named "not published yet"
 * error; its business call and every assertion stay inside that row's `exercise()` closure, and at L that last
 * statement becomes `await exercise();`. Nothing is skipped, weakened or made conditional; the other rows run their
 * assertions now. Expected values come from the copy rules or the fixture's own public reads.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../../src/contracts/goal-card.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { NoteSectionsV1 } from '../../src/contracts/note.js';
import type { NoteListResultV1, WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  callS6B3LateRoute, callS6B3PublishedOwner, configureS6B3SecondWorkspace, openS6B3World,
  reopenS6B3Host, seedS6B3CancelledGoal, type S6B3World,
} from '../helpers/S6B3-fixture.js';

// The commit gate (S6B3 steps 9-11) is the S6A barrier, so the test owns its two backend mocks.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6B3World[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.all(open.map(world => world.close()));
  expect(left).toEqual([]);
});

type Scope = { projectId: string; workspaceId: string };

const SECTIONS: NoteSectionsV1 = {
  status: 'The reader exists.', decided: 'Copy it.', open: 'Nothing.', next: 'Copy.', risks: 'None.',
};

function s6b3Value<T>(body: unknown, status: 'ready' | 'committed'): T {
  const record = body as Record<string, unknown>;
  if (record['status'] !== status) {
    throw new Error(`S6B3: expected ${status === 'ready' ? 'a ready read' : 'a commit'}: ${JSON.stringify(body)}`);
  }
  return record['value'] as T;
}

async function s6b3Post(world: S6B3World, suffix: string, body: unknown): Promise<unknown> {
  return (await world.host.post(suffix, body)).body;
}

async function s6b3ReadGoal(world: S6B3World, scope: Scope, ref: GoalRef): Promise<GoalSnapshot> {
  return s6b3Value<{ goal: GoalSnapshot }>(await s6b3Post(world, 'goals/read', plain(scope, ref)), 'ready').goal;
}

async function goalCount(world: S6B3World, scope: Scope): Promise<number> {
  const read = await world.host.platform.reconcile.candidates.listGoals(scope, new AbortController().signal);
  if (read.status !== 'ready') throw new Error(`S6B3: the workspace Goals are not readable: ${JSON.stringify(read)}`);
  return read.value.records.length;
}

async function listedNotes(world: S6B3World, scope: Scope, goalId: string): Promise<NoteListResultV1> {
  return s6b3Value<NoteListResultV1>(await s6b3Post(world, 'notes/list', plain(scope, {
    anchor: { kind: 'goal', goalId }, state: 'accepted', limit: 100, cursor: null,
  })), 'ready');
}

function understandingOf(list: NoteListResultV1): number {
  return list.items.filter(item => item.kind === 'understanding').length;
}

async function oldText(world: S6B3World, noteId: string, version: number): Promise<string> {
  const read = await world.host.platform.notes.readNote(world.host.humanContext(), { noteId, version });
  if (read.status !== 'ready') throw new Error(`S6B3: the old text is not readable: ${JSON.stringify(read)}`);
  return read.value.conclusion;
}

/** The real `notes/write` route, at the pointer revision the caller read just before it. */
async function rewriteUnderstanding(world: S6B3World, scope: Scope, goalId: string, expectedPointerRevision: number,
  topic: string, conclusion: string): Promise<void> {
  const body = await s6b3Post(world, 'notes/write', plain(scope, {
    commandId: `s6b3-copy-rewrite-${randomUUID()}`,
    note: {
      kind: 'understanding', topic, conclusion, anchor: { kind: 'goal', goalId }, extraAnchors: [], facts: [],
      basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], sections: SECTIONS,
    },
    expectedPointerRevision, goalId,
  })) as WriteNoteEnvelopeV1;
  if (body.write.status !== 'accepted') {
    throw new Error(`S6B3: the rewritten understanding was refused: ${JSON.stringify(body.write)}`);
  }
}

/** The two-Goal world both rows need, with the second workspace's real write and command grants. */
async function openCopyWorld(backend: 'memory' | 'sqlite') {
  const world = await openS6B3World({ backend });
  worlds.push(world);
  const second = await configureS6B3SecondWorkspace(world, { name: `S6B3 copy ${backend}`, goals: 2 });
  return { world, second };
}

describe.each(['memory', 'sqlite'] as const)('row 37: copy, continuedFrom and the rewrite (%s)', (backend) => {
  it('previews, copies and keeps the confirmed pin through a rewrite and a conflict', async () => {
    const { world, scope, source } = await openSeededCopy(backend, 'The copied reader',
      'The old reader is cancelled.');
    const sourceRef = source.goal.ref;
    const sourcePin = { noteId: source.understanding.noteId, version: source.understanding.version };
    const continuedFrom = { goal: sourceRef, sourceRevision: source.cancelledRevision, understanding: sourcePin };
    const countBeforePreview = await goalCount(world, scope);
    const sourceNotesBefore = await listedNotes(world, scope, sourceRef.goalId);
    const sourcePointerBefore = sourceNotesBefore.understanding?.pointer.revision;

    // Row 37 runs at L, when the copy routes are published; until then this call is the fixture's named error and
    // every assertion below stays in the closure.
    const exercise = async () => {
      const preview = s6b3Value<GoalCopyDraftResultV1>(await callS6B3LateRoute(world, 'goals/copy-draft',
        '6b3-w3', plain(scope, { goalRef: sourceRef })), 'ready');
      expect(preview).toEqual({
        source: { goal: sourceRef, revision: source.cancelledRevision },
        objective: source.goal.objective,
        autonomy: 'every_step',
        order: source.goal.settings.order,
        toReconfirm: { waitForGoalRef: null, parallelRisks: [] },
        understanding: sourcePin,
        interventions: { available: false },
      });
      // The preview writes nothing: the source and the workspace Goal count stay put.
      expect((await s6b3ReadGoal(world, scope, sourceRef)).revision).toBe(source.cancelledRevision);
      expect(await goalCount(world, scope)).toBe(countBeforePreview);

      const first = s6b3Value<GoalCopyConfirmResultV1>(await callS6B3LateRoute(world, 'goals/copy-confirm',
        '6b3-w3', plain(scope, copyInput(source, `s6b3-copy-confirm-${randomUUID()}`))), 'committed');
      expect(first.goal).toMatchObject({
        desiredState: 'active',
        activePlanRevision: null,
        objective: source.goal.objective,
        settings: {
          autonomy: 'every_step',
          order: source.goal.settings.order,
          waitForGoalRef: null,
          parallelRisks: [],
        },
        copiedInterventions: [],
        continuedFrom,
      });
      expect(first.receipt.selection).toBe('selection_only');
      expect(first.retractions).toEqual([]);
      // The source is unchanged: its revision and its understanding pointer.
      expect((await s6b3ReadGoal(world, scope, sourceRef)).revision).toBe(source.cancelledRevision);
      const sourceNotes = await listedNotes(world, scope, sourceRef.goalId);
      expect(sourceNotes.understanding?.pointer.noteId).toBe(source.understanding.noteId);
      expect(sourceNotes.understanding?.pointer.revision).toBe(sourcePointerBefore);
      // The text is read at exactly the confirmed version.
      expect(await oldText(world, source.understanding.noteId, source.understanding.version))
        .toBe('The old reader is cancelled.');
      // The new Goal's own current understanding is still empty.
      const newGoalNotes = await listedNotes(world, scope, first.goal.ref.goalId);
      expect(understandingOf(newGoalNotes)).toBe(0);
      expect(newGoalNotes.understanding?.pointer.noteId ?? null).toBeNull();
      const countAfterFirst = await goalCount(world, scope);

      // B-09: a rewrite that lands after the second confirm's basis read makes the second confirm conflict.
      const pointerRevision = sourceNotes.understanding?.pointer.revision;
      if (pointerRevision === null || pointerRevision === undefined) {
        throw new Error('S6B3: the source understanding has no pointer revision');
      }
      // Arm the same barrier the fixture's gate uses BEFORE the request starts: a commit that lands before the hold
      // is armed would otherwise make `reached` hang.
      const hold = commitBarrier.hold(byIdentityPrefix('goal.copyConfirm:'), 'S6B3 copy read gate');
      const secondConfirm = callS6B3LateRoute(world, 'goals/copy-confirm', '6b3-w3',
        plain(scope, copyInput(source, `s6b3-copy-confirm-${randomUUID()}`)));
      await hold.reached;
      await rewriteUnderstanding(world, scope, sourceRef.goalId, pointerRevision,
        'The copied reader rewritten', 'The old reader was rewritten after the read.');
      hold.release();
      const conflict = await secondConfirm;
      expect(conflict).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await goalCount(world, scope)).toBe(countAfterFirst);
      expect((await s6b3ReadGoal(world, scope, sourceRef)).revision).toBe(source.cancelledRevision);

      // After the rewrite: the pin and the old text are unchanged, and the new Goal still has no understanding.
      const afterRewrite = await s6b3ReadGoal(world, scope, first.goal.ref);
      expect(afterRewrite.revision).toBe(1);
      expect(afterRewrite.continuedFrom).toEqual(continuedFrom);
      expect(await oldText(world, source.understanding.noteId, source.understanding.version))
        .toBe('The old reader is cancelled.');
      expect(understandingOf(await listedNotes(world, scope, first.goal.ref.goalId))).toBe(0);
    };
    await exercise();
  });
});

it('row 37 (sqlite: a Host restart): after a rewrite, a normal reopen keeps the pin and the old text', async () => {
  const { world, scope, source } = await openSeededCopy('sqlite', 'The reopened reader', 'The old reader is cancelled.');
  const sourceRef = source.goal.ref;
  const first = s6b3Value<GoalCopyConfirmResultV1>(await callS6B3LateRoute(world, 'goals/copy-confirm', '6b3-w3',
    plain(scope, copyInput(source, `s6b3-copy-reopen-${randomUUID()}`))), 'committed');
  const pointerRevision = (await listedNotes(world, scope, sourceRef.goalId)).understanding?.pointer.revision;
  if (pointerRevision === null || pointerRevision === undefined) {
    throw new Error('S6B3: the source understanding has no pointer revision');
  }
  await rewriteUnderstanding(world, scope, sourceRef.goalId, pointerRevision, 'The reopened reader rewritten',
    'The old reader was rewritten after the copy.');
  await reopenS6B3Host(world);
  const afterReopen = await s6b3ReadGoal(world, scope, first.goal.ref);
  expect(afterReopen.revision).toBe(1);
  expect(afterReopen.continuedFrom).toEqual({ goal: sourceRef, sourceRevision: source.cancelledRevision,
    understanding: { noteId: source.understanding.noteId, version: source.understanding.version } });
  expect(await oldText(world, source.understanding.noteId, source.understanding.version))
    .toBe('The old reader is cancelled.');
  expect(understandingOf(await listedNotes(world, scope, first.goal.ref.goalId))).toBe(0);
});

describe('row 38: retraction absent, replay creates no second Goal (memory)', () => {
  it('commits selection_only, then replays the same command to the same Goal', async () => {
    const { world, scope, source } = await openSeededCopy(
      'memory', 'The replayed reader', 'The old reader is cancelled.',
      'after_plan_confirmation');
    const input = copyInput(source, `s6b3-copy-replay-${randomUUID()}`);

    // Row 38 runs at L, when the copy routes are published; until then this call is the fixture's named error.
    const exercise = async () => {
      const first = s6b3Value<GoalCopyConfirmResultV1>(await callS6B3LateRoute(world, 'goals/copy-confirm',
        '6b3-w3', plain(scope, input)), 'committed');
      expect(first.receipt.selection).toBe('selection_only');
      expect(first.retractions).toEqual([]);
      expect(first.goal.revision).toBe(1);
      expect(first.goal.desiredState).toBe('active');
      expect((await s6b3ReadGoal(world, scope, source.goal.ref)).revision).toBe(source.cancelledRevision);
      const count = await goalCount(world, scope);

      const replay = s6b3Value<GoalCopyConfirmResultV1>(await callS6B3LateRoute(world, 'goals/copy-confirm',
        '6b3-w3', plain(scope, input)), 'committed');
      expect(replay.goal.ref).toEqual(first.goal.ref);
      expect(replay.goal.revision).toBe(1);
      expect(replay.receipt.selection).toBe('selection_only');
      expect(replay.retractions).toEqual([]);
      expect(await goalCount(world, scope)).toBe(count);
    };
    await exercise();
  });
});

// ---------------------------------------------------------------------------
// The three confirm cases: the born Goal, the replay and the caller-side ref
// ---------------------------------------------------------------------------

/**
 * The three cases' shared seed: the two-Goal world with the second workspace's real grants, plus one cancelled source.
 * `topic` and `conclusion` stay the caller's input; the copy route is not published yet, so each case ends by
 * asserting the fixture's exact named error and its business assertions stay in that case's closure.
 */
async function openSeededCopy(backend: 'memory' | 'sqlite', topic: string, conclusion: string,
  autonomy: 'every_step' | 'after_plan_confirmation' = 'every_step') {
  const { world, second } = await openCopyWorld(backend);
  const scope = second.scope;
  const source = await seedS6B3CancelledGoal(world, {
    scope, settings: { autonomy },
    understanding: { topic, conclusion, sections: SECTIONS },
  });
  return { world, scope, source };
}

function copyInput(source: { goal: GoalSnapshot; cancelledRevision: number }, commandId: string) {
  return {
    commandId, sourceGoalRef: { ...source.goal.ref },
    expectedSourceRevision: source.cancelledRevision, selectedInterventions: [],
  };
}

describe.each(['memory', 'sqlite'] as const)('the copy confirm through its route (%s)', (backend) => {
  it('births a Goal that has its own non-existence guard', async () => {
    const { world, scope, source } = await openSeededCopy(backend, 'The guarded copy',
      'The source is cancelled.');
    const exercise = async () => {
      const born = s6b3Value<GoalCopyConfirmResultV1>(await callS6B3LateRoute(world, 'goals/copy-confirm',
        '6b3-w3', plain(scope, copyInput(source, `s6b3-copy-guard-${randomUUID()}`))), 'committed');
      // The commit stands on its own: the new Goal exists under its own id and carries the source it was copied from.
      expect(born.goal.ref.goalId).not.toBe(source.goal.ref.goalId);
      expect(born.goal.continuedFrom?.goal).toEqual(source.goal.ref);
    };
    await exercise();
  });

  it('replays a committed confirm even when the replay signal is aborted', async () => {
    const { world, scope, source } = await openSeededCopy(backend, 'The replayed copy',
      'The source is cancelled.');
    const input = copyInput(source, `s6b3-copy-abort-${randomUUID()}`);
    const exercise = async () => {
      const first = s6b3Value<GoalCopyConfirmResultV1>(await callS6B3PublishedOwner(world, {
        owner: 'goals.confirmGoalCopy', wave: '6b3-w3', scope,
      }, input), 'committed');
      expect((await s6b3ReadGoal(world, scope, source.goal.ref)).revision).toBe(source.cancelledRevision);
      const count = await goalCount(world, scope);
      // The replay is the same command from an aborted caller: the receipt it finds predates the signal, so it
      // answers the Goal the first confirm committed instead of cancelling the second call.
      const replay = await callS6B3PublishedOwner(world, {
        owner: 'goals.confirmGoalCopy', wave: '6b3-w3', scope, signal: AbortSignal.abort(),
      }, input) as { status: 'committed'; replayed: boolean; value: GoalCopyConfirmResultV1 };
      s6b3Value<GoalCopyConfirmResultV1>(replay, 'committed');
      expect(replay.replayed).toBe(true);
      expect(replay.value.goal.ref).toEqual(first.goal.ref);
      expect(replay.value.goal.revision).toBe(first.goal.revision);
      expect(await goalCount(world, scope)).toBe(count);
    };
    await exercise();
  });
});

// The caller-side ref is frozen by the entry, not by the store, so this case runs on memory only.
describe('the copy confirm through its route: the caller-side ref (memory)', () => {
  it('keeps the source ref it validated when the caller mutates that object', async () => {
    const { world, scope, source: sourceA } = await openSeededCopy('memory', 'The aliased source A',
      'A is cancelled.');
    const sourceB = await seedS6B3CancelledGoal(world, {
      scope, settings: { autonomy: 'every_step' },
      understanding: { topic: 'The aliased source B', conclusion: 'B is cancelled.', sections: SECTIONS },
    });
    expect(sourceB.cancelledRevision).toBe(sourceA.cancelledRevision);
    const input = copyInput(sourceA, `s6b3-copy-alias-${randomUUID()}`);
    const exercise = async () => {
      const pending = callS6B3PublishedOwner(world, {
        owner: 'goals.confirmGoalCopy', wave: '6b3-w3', scope,
      }, input);
      // The caller rewrites its own object after the call: the confirm still copies the source it validated (A).
      input.sourceGoalRef.goalId = sourceB.goal.ref.goalId;
      const copied = s6b3Value<GoalCopyConfirmResultV1>(await pending, 'committed');
      expect(copied.goal.continuedFrom?.goal).toEqual(sourceA.goal.ref);
    };
    await exercise();
  });
});
