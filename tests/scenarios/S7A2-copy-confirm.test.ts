/**
 * C-confirm (7a:732; CR10): the person copies a cancelled Goal and the copy retracts only the interventions it did not
 * select. Deferred form (RGP E0.5; DF `:3`–`:20`): `goals.readCopyInterventions` is published by the later wiring, so every
 * case's first business step is the fixture's published-owner call and each `it` ends on its exact named error; the
 * business assertions first run at L. Expected values are CR10's hand-computed table and lr9 item 3's `retracted`;
 * every state comes from the public steps of `S7A2-fixture.ts` and `S7A-fixture.ts`.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { GoalCopyConfirmInputV1, GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../../src/contracts/goal-card.js';
import type { CopyInterventionCandidateV1 } from '../../src/contracts/goal-copy-retraction.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  committed, crashS7AHost, holdS7ACommitter, openS7AWorkWorld, ready, runS7ASameSessionAgain,
} from '../helpers/S7A-fixture.js';
import {
  callS7A2PublishedOwner, countS7A2Goals, createCancelledS7A2Goal, holdS7A2SecondRun, sendS7A2PersonMessage,
  withdrawS7A2Message,
} from '../helpers/S7A2-fixture.js';

// The lost settle is held at the S6A barrier's own commit, so the test owns its two backend mocks and nothing else.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const NAMED = 'S7A2: the goals.readCopyInterventions command is not published yet (7a2-l)';
const PAGE = { limit: 200 };
type CandidatePage = { candidates: readonly CopyInterventionCandidateV1[]; nextCursor: string | null };
const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  // CR10's cleanup: the barrier's own reset first, then the worlds close.
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.all(open.map(world => world.close()));
  expect(left).toEqual([]);
});

/** CR13 steps 1–2: `openS7AWorkWorld`, a cancelled source, and the person's send to the Work line. */
async function openCopyWorld(backend: 'memory' | 'sqlite') {
  const opened = await openS7AWorkWorld({ backend });
  worlds.push(opened.world);
  const { world, line } = opened;
  const source = await createCancelledS7A2Goal(world);
  const sent = (label: string) =>
    sendS7A2PersonMessage(world, { label, recipient: line.ref, goal: source.goal.ref });
  return { world, line, source, sent };
}

it('(a) the refused selection: the withdrawn intervention is refused and no Goal is born (memory)', async () => {
  const { world, source, sent } = await openCopyWorld('memory');
  await withdrawS7A2Message(world, await sent('a-w'), 'a-w');
  const count = () => countS7A2Goals(world, S6A_SCOPE, new AbortController().signal);
  const exercise = async () => {
    const page = await callS7A2PublishedOwner(world,
      { owner: 'goals.readCopyInterventions', wave: '7a2-l', scope: S6A_SCOPE },
      { sourceGoalRef: source.goal.ref, page: PAGE });
    const [candidate] = ready<CandidatePage>(page, 'the candidate page').candidates;
    const before = await count();
    expect((await world.post('goals/copy-confirm', plain(S6A_SCOPE, {
      commandId: 's7a2-confirm-a', sourceGoalRef: source.goal.ref, expectedSourceRevision: source.revision,
      selectedInterventions: [candidate!.messageRef],
    }))).body).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await count()).toBe(before);
  };
  await exercise();
});

it.each(['memory', 'sqlite'] as const)('(b) (c) (e) world 1: only the unselected set is retracted (%s)', async backend => {
  const { world, line, source, sent } = await openCopyWorld(backend);
  // CR13 step 3: C before the line's next Run, whose own Run accepts it; the clock moves 1 s before each later send
  // (ER 05), so the candidate order comes from `createdAt` alone.
  const c = await sent('world-1-c');
  await runS7ASameSessionAgain(world, line);
  world.clock.advance(1000);
  const a = await sent('world-1-a');
  world.clock.advance(1000);
  const b = await sent('world-1-b');
  world.clock.advance(1000);
  const d = await withdrawS7A2Message(world, await sent('world-1-d'), 'world-1-d');
  const count = () => countS7A2Goals(world, S6A_SCOPE, new AbortController().signal);
  const view = async (ref: SessionMessageRef): Promise<SessionMessage> => ready<SessionMessage>(
    await world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message view');
  const exercise = async () => {
    const page = await callS7A2PublishedOwner(world,
      { owner: 'goals.readCopyInterventions', wave: '7a2-l', scope: S6A_SCOPE },
      { sourceGoalRef: source.goal.ref, page: PAGE });
    const candidates = ready<CandidatePage>(page, 'the candidate page').candidates;
    expect(candidates.map(candidate => candidate.messageRef)).toEqual([c.ref, a.ref, b.ref, d.ref]);
    const [cCandidate, aCandidate, bCandidate, dCandidate] = candidates;
    // (b) the copy-draft lifts the owner's list unchanged, and only A's selection is copied.
    const draft = ready<GoalCopyDraftResultV1>(await world.post('goals/copy-draft',
      plain(S6A_SCOPE, { goalRef: source.goal.ref })), 'the copy draft');
    expect(draft.interventions).toEqual({ available: true, candidates });
    const input: GoalCopyConfirmInputV1 = { commandId: 's7a2-confirm-world-1', sourceGoalRef: draft.source.goal,
      expectedSourceRevision: draft.source.revision, selectedInterventions: [aCandidate!.messageRef] };
    const born = await world.post('goals/copy-confirm', plain(S6A_SCOPE, input));
    expect(born.body).toMatchObject({ status: 'committed' });
    const first = committed<GoalCopyConfirmResultV1>(born, 'the first confirm');
    expect(first.goal.copiedInterventions).toEqual([aCandidate!.messageRef]);
    expect(first.retractions).toEqual([
      { messageRef: cCandidate!.messageRef, status: 'not_retractable', reason: 'delivered' },
      { messageRef: bCandidate!.messageRef, status: 'retracted', reason: null },
      { messageRef: dCandidate!.messageRef, status: 'not_retractable', reason: 'withdrawn' },
    ]);
    expect((await view(a.ref)).withdrawnAt).toBeNull();
    expect((await view(b.ref)).withdrawnAt).not.toBeNull();

    // (c) the same confirm replays: the same Goal and items, and no second Goal (V-14).
    const beforeReplay = await count();
    const replayBody = (await world.post('goals/copy-confirm', plain(S6A_SCOPE, input))).body;
    expect(replayBody).toMatchObject({ status: 'committed', replayed: true });
    const replay = committed<GoalCopyConfirmResultV1>(replayBody, 'the replay');
    expect(replay.goal.ref).toEqual(first.goal.ref);
    expect(replay.goal.revision).toBe(first.goal.revision);
    expect(replay.retractions).toEqual(first.retractions);
    expect(await count()).toBe(beforeReplay);

    // (e) a second copy of the same source selects C, so A is `copied` now and is never withdrawn (N-4; CR5.5 step 3).
    const second = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, {
      ...input, commandId: 's7a2-confirm-world-1-second', selectedInterventions: [cCandidate!.messageRef],
    })), 'the second copy');
    expect(second.retractions[0]).toEqual({ messageRef: aCandidate!.messageRef, status: 'not_retractable',
      reason: 'copied' });
    expect((await view(a.ref)).withdrawnAt).toBeNull();
    const live = ready<CandidatePage>(await callS7A2PublishedOwner(world,
      { owner: 'goals.readCopyInterventions', wave: '7a2-l', scope: S6A_SCOPE },
      { sourceGoalRef: source.goal.ref, page: PAGE }), 'the current candidates');
    expect(live.candidates.find(candidate => candidate.messageRef.messageId === c.ref.messageId)?.state)
      .toBe('copied');
    // The first confirm's saved result is not re-judged: its replay still reads C as `delivered`.
    const beforeSaved = await count();
    const again = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, input)),
      'the first confirm again');
    expect(again.retractions[0]).toEqual({ messageRef: cCandidate!.messageRef, status: 'not_retractable',
      reason: 'delivered' });
    expect(await count()).toBe(beforeSaved);
  };
  await exercise();
});

it.each(['memory', 'sqlite'] as const)('(d) a temporary failure: B is unfinished, then the replay retracts it (%s)',
  async backend => {
    const { world, line, source, sent } = await openCopyWorld(backend);
    const a = await sent('world-2-a');
    world.clock.advance(1000);
    // CR13 step 6 (F-4): A sits in the held model request; B is sent while the Run is open and the Run never offers it.
    const release = await holdS7A2SecondRun(world, line);
    const b = await sent('world-2-b');
    const exercise = async () => {
      const page = await callS7A2PublishedOwner(world,
        { owner: 'goals.readCopyInterventions', wave: '7a2-l', scope: S6A_SCOPE },
        { sourceGoalRef: source.goal.ref, page: PAGE });
      const candidates = ready<CandidatePage>(page, 'the candidate page').candidates;
      expect(candidates.map(candidate => candidate.messageRef)).toEqual([a.ref, b.ref]);
      const draft = ready<GoalCopyDraftResultV1>(await world.post('goals/copy-draft',
        plain(S6A_SCOPE, { goalRef: source.goal.ref })), 'the copy draft');
      const input: GoalCopyConfirmInputV1 = { commandId: 's7a2-confirm-world-2', sourceGoalRef: draft.source.goal,
        expectedSourceRevision: draft.source.revision, selectedInterventions: [candidates[0]!.messageRef] };
      const first = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, input)),
        'the first confirm');
      // The withdraw of B meets the open execution: it stays unfinished for this confirm's replay (7a:608).
      expect(first.retractions).toMatchObject([{ messageRef: b.ref, status: 'unfinished' }]);
      // The fixture lets the Run end (step 6), and the replay gives B its definite result (lr9 item 3: `retracted`).
      await release();
      const count = () => countS7A2Goals(world, S6A_SCOPE, new AbortController().signal);
      const before = await count();
      const replay = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, input)),
        'the replay');
      expect(replay.retractions).toEqual([{ messageRef: b.ref, status: 'retracted', reason: null }]);
      expect(await count()).toBe(before);
    };
    await exercise();
  });

it('(f) a lost settle: the crash between the withdraw and the settle recovers on replay (SQLite)', async () => {
  const { world, source, sent } = await openCopyWorld('sqlite');
  const a = await sent('world-3-a');
  world.clock.advance(1000);
  const b = await sent('world-3-b');
  const exercise = async () => {
    const page = await callS7A2PublishedOwner(world,
      { owner: 'goals.readCopyInterventions', wave: '7a2-l', scope: S6A_SCOPE },
      { sourceGoalRef: source.goal.ref, page: PAGE });
    const candidates = ready<CandidatePage>(page, 'the candidate page').candidates;
    expect(candidates.map(candidate => candidate.messageRef)).toEqual([a.ref, b.ref]);
    const [aCandidate, bCandidate] = candidates;
    const draft = ready<GoalCopyDraftResultV1>(await world.post('goals/copy-draft',
      plain(S6A_SCOPE, { goalRef: source.goal.ref })), 'the copy draft');
    const input: GoalCopyConfirmInputV1 = { commandId: 's7a2-confirm-world-3', sourceGoalRef: draft.source.goal,
      expectedSourceRevision: draft.source.revision, selectedInterventions: [aCandidate!.messageRef] };
    // C-01: B is the only unselected item, so the first `settle:` commit is B's, after its withdraw committed.
    const hold = holdS7ACommitter(world, byIdentityPrefix('goal.copyRetraction.settle:'));
    void world.post('goals/copy-confirm', plain(S6A_SCOPE, input)).catch(() => undefined);
    await crashS7AHost(world, hold);
    // After the restart the same confirm recovers B through its own withdraw's receipt (V-01; CR6's table).
    const replay = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, input)),
      'the replay');
    expect(replay.retractions).toEqual([{ messageRef: b.ref, status: 'retracted', reason: null }]);
    const after = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, b.ref)),
      'the withdrawn B');
    expect(after.withdrawnAt).not.toBeNull();
    expect(after.revision).toBe(bCandidate!.version + 1);
    // lr6 2: the hold stays held through every assertion and is released before the world closes.
    hold.release();
  };
  await exercise();
});
