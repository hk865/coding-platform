/**
 * Row 10 (storage: both backends, plus a SQLite reopen): the
 * `k3-decision-answer-by-source-goal` index keys an answer by its decision
 * SUBJECT's Goal. The owner read `listUnappliedAnswers` finds the Goal's
 * answers, in the index's order, and another Goal's read finds none.
 *
 * Every prior state is public: three real `needs_decision` review records
 * (`createRecord`), their real cards (`reviewCardOf`) and the real decision
 * coordinator (`resolveDecision`) answering each card with its OWN source. The
 * one injected behaviour is the frozen fixture's ③ fault
 * (`failNextApplicationCommit`), so each answer stays unapplied (a recorded
 * application is not an unapplied answer); the fault touches neither ① nor the
 * index entry ① writes.
 *
 * The expected order is the store's lookup order: refKey ascending, compared as
 * UTF-8 bytes. A SessionMessage's refKey is the canonical JSON of its ref, keys
 * sorted; `messageRefKey` writes that string by hand from the returned ref, and
 * the test checks the hand-written order with it. A fresh world's first two
 * answers already sort in creation order, so the sample has three: by refKey
 * the third comes first, an order that is neither the creation order nor its
 * reverse (asserted first).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { openS6BProjectWorld, resolveS6BProjectNote, scribeUnderstanding } from '../helpers/S6B1-fixture.js';
import { reviewCardOf } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';

// The blocking `shell` stand-in, hoisted per test file: the record Run's real
// Kernel Turn holds its first call so the review reads a real unresolved call.
// The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
const projectWorlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
  for (const world of projectWorlds.splice(0)) await world.close();
});

/** The fixture's two Goals, written out. */
const GOAL_A = { aggregateType: 'Goal' as const, projectId: 'P', goalId: 'A' };
const GOAL_B = { aggregateType: 'Goal' as const, projectId: 'P', goalId: 'B' };
/** The review Tasks answered, in creation order. */
const TASKS = ['k3-20-a', 'k3-20-b', 'k3-20-c'] as const;

/** A SessionMessage ref's canonical JSON (keys sorted), written by hand. */
function messageRefKey(ref: SessionMessageRef): string {
  return `{"aggregateType":"SessionMessage","messageId":${JSON.stringify(ref.messageId)},`
    + `"projectId":${JSON.stringify(ref.projectId)},"workspaceId":${JSON.stringify(ref.workspaceId)}}`;
}

/** refKey ascending as UTF-8 bytes. */
function byRefKey(left: SessionMessageRef, right: SessionMessageRef): number {
  return Buffer.compare(Buffer.from(messageRefKey(left), 'utf8'), Buffer.from(messageRefKey(right), 'utf8'));
}

/** One real answered review card whose ③ is not recorded; returns the answer ref. */
async function answerReviewCard(world: K3ReviewCardWorld, taskId: string): Promise<SessionMessageRef> {
  const record = await world.createRecord(taskId);
  const card = await reviewCardOf(world, record);
  world.failNextApplicationCommit();
  const answered = await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
    meta: { requestId: `row10-${taskId}-answer`, expected: card.source.pins },
  });
  expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: {
    state: 'application_not_recorded', answer: { status: 'committed' } } });
  if (answered.status !== 'ready' || answered.value.answer.status !== 'committed') throw new Error(JSON.stringify(answered));
  return answered.value.answer.value.ref;
}

/** The owner read's answers for one Goal: message ref and source subject, in the order read. */
async function unapplied(world: K3ReviewCardWorld, goalRef: typeof GOAL_B) {
  const read = await world.reviews.listUnappliedAnswers(world.fixture.ctx, { goalRef });
  expect(read.status, JSON.stringify(read)).toBe('ready');
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return read.value.answers.map(answer => ({ answerMessageRef: answer.answerMessageRef, subject: answer.source.subject }));
}

describe('row 10: the answer index keys on the decision subject', () => {
  it.each(['memory', 'sqlite'] as const)('%s: three goal-subject answers are found by their own Goal, in refKey order',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      worlds.push(world);
      const created: SessionMessageRef[] = [];
      for (const taskId of TASKS) created.push(await answerReviewCard(world, taskId));

      // The hand-written order (third, first, second) is refKey ascending.
      const [first, second, third] = created as [SessionMessageRef, SessionMessageRef, SessionMessageRef];
      expect([byRefKey(third, first), byRefKey(first, second)]).toEqual([-1, -1]);
      const subject = { kind: 'goal', goalRef: GOAL_B };
      const expected = [third, first, second].map(answerMessageRef => ({ answerMessageRef, subject }));

      expect(await unapplied(world, GOAL_B)).toEqual(expected);
      // The index path holds the subject's Goal: another Goal's read has no candidate.
      expect(await unapplied(world, GOAL_A)).toEqual([]);

      if (kind === 'sqlite') {
        // The store creates the index on open; the saved answers need no migration.
        await world.fixture.reopen();
        expect(await unapplied(world, GOAL_B)).toEqual(expected);
        expect(await unapplied(world, GOAL_A)).toEqual([]);
      }
    }, 120_000);
});

/**
 * The negative side of the index rule: a project-subject answer exists, is readable
 * and carries `goalRef: null`, and neither Goal's query lists it (also after a SQLite reopen).
 *
 * What this case does NOT prove: `readUnappliedAnswers` puts the decision source
 * KIND in its lookup values (`[projectId, workspaceId, input.kind, goalId]`) and
 * `listUnappliedAnswers` always passes `unknown_call_review`, so a `note_review`
 * answer is never a candidate of a Goal query whatever the index's goal path holds.
 * The kind filter is the guard; mutating the goal path does not turn this case red.
 * It stays as a guard on the saved answer's project subject and on the Goal query's
 * empty answer.
 */
describe('row 10: a project-subject answer is never a Goal query’s', () => {
  it.each(['memory', 'sqlite'] as const)('%s: a project-subject answer is readable and found by no Goal',
    async kind => {
      const opened = await openS6BProjectWorld({ backend: kind });
      projectWorlds.push(opened);
      const projectSubject = { kind: 'project', projectRef: { projectId: 'ag2b-collab-project' } };
      const written = await scribeUnderstanding(opened.world, opened.scribe, { label: 'p-index', structural: true });
      expect(written.note.goalId).toBeNull();
      // Answered and read in the main workspace: a SQLite reopen starts a Host that configures the main workspace
      // only (tests/helpers/S6A-request-fixture.ts:885; tests/helpers/S6A-cards-fixture.ts:17).
      const { card } = await resolveS6BProjectNote(opened.main,
        { noteId: written.note.noteId, optionId: 'accept', label: 'p-index' });
      expect(card.subject).toEqual(projectSubject);
      const goalOne = { aggregateType: 'Goal' as const, projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' };
      const goalTwo = { aggregateType: 'Goal' as const, projectId: 'ag2b-collab-project', goalId: 's6a-goal-2' };

      /** The saved answer and each Goal's query, through the public reads of the main workspace. */
      async function readBack(): Promise<void> {
        // The answer exists and is readable: its message names no Goal and its saved
        // decision source carries the project subject.
        const answer = await opened.world.platform.decisionMessages.readDecisionAnswer(
          opened.main.humanContext(), { source: card.source });
        expect(answer).toMatchObject({ status: 'ready', value: { message: { goalRef: null } } });
        if (answer.status !== 'ready' || answer.value.message === null) {
          throw new Error(`the saved project answer is not readable: ${JSON.stringify(answer)}`);
        }
        const response = answer.value.message.response;
        if (response === null || !('decision' in response)) {
          throw new Error(`the saved project answer has no decision response: ${JSON.stringify(response)}`);
        }
        expect(response.decision.source.subject).toEqual(projectSubject);
        // Each Goal's query answers ready with no answer: the project answer is none of them.
        for (const goalRef of [goalOne, goalTwo]) {
          expect(await opened.world.platform.reconcile.reviews.listUnappliedAnswers(
            opened.main.humanContext(), { goalRef })).toMatchObject({ status: 'ready', value: { answers: [] } });
        }
      }

      await readBack();
      if (kind === 'sqlite') {
        // As the goal case does: a new Host on the same directory reads the saved answer back unchanged.
        await opened.world.reopen();
        await readBack();
      }
    }, 120_000);
});
