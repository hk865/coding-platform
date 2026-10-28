/**
 * C-candidates (CR10; 7a:731): the copy interventions page, the candidate facts and the read failure.
 * Deferred form (RGP E0.5): `goals.readCopyInterventions` is published by the later wiring, so each case's first business
 * step is the fixture's call and every row ends on its exact named error; the assertions in `exercise` run at L.
 * Prior states are public steps only. The barrier's two mocks are the file's only mocks and its `reset()` is the
 * cleanup; candidate facts are the contract's state table (CR5.1/CR5.3). C-candidates holds no commit.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { CopyInterventionCandidateV1 } from '../../src/contracts/goal-copy-retraction.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { S7A2_COPY_INTERVENTION_BY_GOAL_LOOKUP } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7AWorkWorld, ready, runS7ASameSessionAgain } from '../helpers/S7A-fixture.js';
import {
  callS7A2PublishedOwner, createCancelledS7A2Goal, sendS7A2PersonMessage, withdrawS7A2Message,
} from '../helpers/S7A2-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const NAMED = 'S7A2: the goals.readCopyInterventions command is not published yet (7a2-l)';
const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

type Page = { candidates: CopyInterventionCandidateV1[]; nextCursor: string | null };
const read = (world: S6AHostWorld, sourceGoalRef: GoalRef, page: { limit: number; cursor?: string }) =>
  callS7A2PublishedOwner(world,
    { owner: 'goals.readCopyInterventions', wave: '7a2-l', scope: S6A_SCOPE }, { sourceGoalRef, page });

it.each(['memory', 'sqlite'] as const)('storage: five queued interventions page in (createdAt, ref) order (%s)',
  async backend => {
    const { world, goal, line } = await openS7AWorkWorld({ backend });
    worlds.push(world);
    const sourceGoalRef = (await createCancelledS7A2Goal(world)).goal.ref;
    const send = (label: string, to: GoalRef) => sendS7A2PersonMessage(world, { label, recipient: line.ref, goal: to });
    const instant = async (labels: readonly string[]) => (await Promise.all(labels.map(label => send(label, sourceGoalRef))))
      .sort((left, right) => (left.ref.messageId < right.ref.messageId ? -1 : 1));
    // Two creation times; inside one instant the numbers name the messages by their `messageId`, lowest first.
    const [p1, p2] = await instant(['p-1', 'p-2']);
    world.clock.advance(1000);
    const [q1, q2, q3] = await instant(['q-1', 'q-2', 'q-3']);
    const pages = [[p1!.ref, p2!.ref], [q1!.ref, q2!.ref], [q3!.ref]];
    // The cross-Goal cursor comes from another Goal's first page, so that Goal needs two messages at limit 1.
    await send('other-1', goal);
    await send('other-2', goal);
    const exercise = async () => {
      let cursor: string | null = null;
      for (const [index, refs] of pages.entries()) {
        const page: Page = ready<Page>(await read(world, sourceGoalRef,
          cursor === null ? { limit: 2 } : { limit: 2, cursor }), `the copy interventions page ${index + 1}`);
        expect(page.candidates.map(candidate => candidate.messageRef)).toEqual(refs);
        if (index === pages.length - 1) expect(page.nextCursor).toBeNull();
        else expect(typeof page.nextCursor).toBe('string');
        cursor = page.nextCursor;
      }
      const otherPage = ready<Page>(await read(world, goal, { limit: 1 }), 'the other Goal page');
      expect(typeof otherPage.nextCursor).toBe('string');
      expect(await read(world, sourceGoalRef, { limit: 2, cursor: otherPage.nextCursor! }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    };
    await exercise();
  });

it('facts: the delivered, withdrawn, copied and queued states reach the candidate row (memory)', async () => {
  const { world, line } = await openS7AWorkWorld({ backend: 'memory' });
  worlds.push(world);
  const source = await createCancelledS7A2Goal(world);
  const sourceGoalRef = source.goal.ref;
  const send = (label: string) => sendS7A2PersonMessage(world, { label, recipient: line.ref, goal: sourceGoalRef });
  const delivered = await send('fact-delivered');
  await runS7ASameSessionAgain(world, line);
  const withdrawn = await send('fact-withdrawn');
  await withdrawS7A2Message(world, withdrawn, 'fact-withdrawn');
  const copied = await send('fact-copied');
  const exercise = async () => {
    await read(world, sourceGoalRef, { limit: 20 });
    // The first copy confirm of the source selects M; the copied set then holds M.
    const confirmed = await world.post('goals/copy-confirm', plain(S6A_SCOPE, {
      commandId: 's7a2-facts-copy', sourceGoalRef, expectedSourceRevision: source.revision,
      selectedInterventions: [copied.ref],
    }));
    expect(confirmed.body).toMatchObject({ status: 'committed' });
    // Sent after that confirm: it is not in the frozen unselected set.
    const queued = await send('fact-queued');
    const after = ready<Page>(await read(world, sourceGoalRef, { limit: 20 }), 'the candidate facts');
    expect(after.candidates).toHaveLength(4);
    expect(after.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageRef: delivered.ref, state: 'delivered', selectable: true, reason: null, retractable: false, retractReason: 'delivered' }),
      expect.objectContaining({ messageRef: withdrawn.ref, state: 'withdrawn', selectable: false, reason: 'withdrawn', retractable: false, retractReason: 'withdrawn' }),
      expect.objectContaining({ messageRef: copied.ref, state: 'copied', selectable: false, reason: 'copied', retractable: false, retractReason: 'copied' }),
      expect.objectContaining({ messageRef: queued.ref, state: 'not_delivered', selectable: true, reason: null, retractable: true, retractReason: null }),
    ]));
  };
  await exercise();
});

it('read failure: a failed ordered lookup is a rejection, never an empty page (memory)', async () => {
  const { world } = await openS7AWorkWorld({ backend: 'memory' });
  worlds.push(world);
  const sourceGoalRef = (await createCancelledS7A2Goal(world)).goal.ref;
  // The barrier's existing read fault, armed on the one ordered lookup by its index name.
  const fault = commitBarrier.failReads(S7A2_COPY_INTERVENTION_BY_GOAL_LOOKUP, 'throw-once');
  const exercise = async () => {
    const page = await read(world, sourceGoalRef, { limit: 2 });
    expect(page).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(page).not.toHaveProperty('value');
    expect(fault.calls()).toBe(1);
  };
  await exercise();
});
