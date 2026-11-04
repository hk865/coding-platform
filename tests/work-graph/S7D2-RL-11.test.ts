/**
 * RL-11 (`7d2-start-rulings.v4.md:8849`, read per `later-rows-merged.md:198–:200`, plan A; book `:1314`, §3.6
 * `:492–:524`): the platform's automatic add at the open cap opens one capacity episode and its one project card; a
 * later refusal while it is open carries the same number; a public cap set closes it; the card's four answers.
 *
 * World: `openS7D2CapacityWorld` (tests/helpers/S7D2-capacity-world.ts), memory unless named. The automatic add is a
 * split: an adviser line's scripted Work Run calls the real `propose_role_split` (v4 `:3391–:3392`, the saved parent
 * action `role_line_split`). The prior of every instance (write-tests brief `tests-7d2-o3b.txt:44–:47`):
 * `open.adviser = 8`; the adviser holders are exactly H1 = the opening adviser (project scope), H6 = `regionAdviser`
 * (region `src`), H7 on region `src/b`, H2–H5 each on two new goals of their own (default autonomy); one Plan on
 * each line's second goal carries that line's Task. H2 moves its first goal and is held after its child's
 * reservation (`holdS7D2SplitReserved`), and its child's `session-register:` commit is held before it commits (lead
 * ruling 11-04 on the reply's §0: the Host's lifecycle queue would otherwise register the child): 7 holders,
 * 1 reservation, 7 + 1 = 8. Every holder gets one unaccepted
 * person inquiry (none is idle, so the admission's reclaim finds no line), then H3 moves its first goal and is
 * refused: the first refusal, which opens episode 1. Project id: the world's (`S6A_SCOPE.projectId`, brief `:36`).
 *
 * Expected (by hand from the row): every refusal is `capacity` with the reason sentence of
 * `src/core/work-graph/sessions/allocation-read.ts:36–:42` (v4 `:3409–:3413`) and `detail.episode` the open number;
 * the card's identity `{kind:'role_capacity',duty:'adviser',capValue:8,episode}`, its options v4 `:3781–:3786`, its
 * one object v4 `:4017–:4024`; the resolution notice v4 `:4389–:4395` with `capValue` the episode's 8.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, ResolveDecisionReadV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import { byIdentityPrefix, commitBarrier, type CommitHold } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, type S6ABackend, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { withdrawS7A2Message } from '../helpers/S7A2-fixture.js';
import {
  openS7D2CapacityWorld, type S7D2AnswerBody, type S7D2CapacityWorld,
} from '../helpers/S7D2-capacity-world.js';
import { holdS7D2SplitReserved, openTargetsOf } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D2CapacityWorld[] = [];
afterEach(async () => {
  const unreleased = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(unreleased).toEqual([]);
});

const PROJECT_ID = S6A_SCOPE.projectId;
const projectSubject = { kind: 'project', projectRef: { projectId: PROJECT_ID } };
const atCap = (holders: number, reservations: number, episode: number) => ({ status: 'rejected', code: 'capacity',
  reason: `at_cap: adviser has ${String(holders)} holder(s) and ${String(reservations)} reservation(s) against open limit 8`,
  detail: { duty: 'adviser', holders, reservations, open: 8, episode } });
const capacityOptions = [
  { id: 'raise_cap', label: '调高上限', effect: 'apply' },
  { id: 'merge_scopes', label: '合并范围', effect: 'apply' },
  { id: 'archive_line', label: '归档闲线', effect: 'apply' },
  { id: 'wait', label: '先排队', effect: 'defer' },
];
const resolvedSummary = '容量已恢复：adviser 的占用已低于上限 8；本卡已关闭，可继续排队或重新开线';
const ALL: ('waiting_answer' | 'answered_pending_application' | 'history')[] =
  ['waiting_answer', 'answered_pending_application', 'history'];

type Prior = {
  handle: S7D2CapacityWorld;
  /** H1–H7 by number. */
  h: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, S6ASession>>;
  /** Hk's first goal (the one it moves) and its Task. */
  moves: Readonly<Record<2 | 3 | 4 | 5, GoalRef>>;
  tasks: Readonly<Record<2 | 3 | 4 | 5, TaskTriple>>;
  held: CommitHold;
  /** H2's child registration, held before it commits (see the header). */
  register: CommitHold;
  /** H2's held split Run (settles after `held.release()`). */
  run: Promise<unknown>;
  /** H6's one inquiry of the prior. */
  h6Inquiry: SessionMessage;
};

/** The capacity cards of every queue section named. */
function capacityCards(queue: DecisionQueueReadV1, sections: ('waitingAnswer' | 'answeredPendingApplication' |
  'history')[]): DecisionCardV1[] {
  return sections.flatMap(section => queue[section]).filter(card => card.source.kind === 'role_capacity');
}

/** The prior (see the header), up to and including the first refusal. */
async function prior(backend: S6ABackend, label: string): Promise<Prior> {
  const handle = await openS7D2CapacityWorld({ backend });
  worlds.push(handle);
  await handle.setOpen('adviser', 8, `${label}-cap-8`);
  const h7 = await handle.line(`${label}-h7`, [{ kind: 'region', moduleRef: handle.modules.sibling }]);
  const lines: Partial<Record<2 | 3 | 4 | 5, S6ASession>> = {};
  const moves: Partial<Record<2 | 3 | 4 | 5, GoalRef>> = {};
  const tasks: Partial<Record<2 | 3 | 4 | 5, TaskTriple>> = {};
  for (const k of [2, 3, 4, 5] as const) {
    const first = await handle.newGoal(`${label}-h${String(k)}-a`);
    const second = await handle.newGoal(`${label}-h${String(k)}-b`);
    lines[k] = await handle.line(`${label}-h${String(k)}`,
      [{ kind: 'goal', goalRef: first }, { kind: 'goal', goalRef: second }]);
    moves[k] = first;
    tasks[k] = (await handle.plan(second, `${label}-h${String(k)}`, [{ taskId: `${label}-h${String(k)}-t`,
      line: lines[k]! }]))[0]!;
  }
  const h = { 1: handle.lines.adviser, 2: lines[2]!, 3: lines[3]!, 4: lines[4]!, 5: lines[5]!, 6: handle.regionAdviser,
    7: h7 };
  const before = await handle.allocation();
  expect(before.duties.adviser.holders.map(holder => holder.session.sessionId).sort())
    .toEqual(Object.values(h).map(line => line.ref.sessionId).sort());
  expect(before.duties.adviser.reservations).toEqual([]);

  const held = holdS7D2SplitReserved();
  const register = commitBarrier.hold(byIdentityPrefix('session-register:'), 'RL-11 H2 child registration');
  const run = handle.split({ line: h[2], task: tasks[2]!, callId: `${label}-h2-split`,
    move: [{ kind: 'goal', goalRef: moves[2]! }], label: `${label}-h2` }).catch((error: unknown) => error);
  await held.reached;
  const sums = async (): Promise<number[]> => {
    const read = await handle.allocation();
    return [read.duties.adviser.holders.length, read.duties.adviser.reservations.length];
  };
  expect(await sums()).toEqual([7, 1]);

  const inquiries = await handle.busy(Object.values(h), `${label}-busy-1`);
  // Q20 (brief :47): the held reservation is still a reservation (the Host's lifecycle queue has not moved it on).
  expect(await sums()).toEqual([7, 1]);
  await handle.split({ line: h[3], task: tasks[3]!, callId: `${label}-h3-split`,
    move: [{ kind: 'goal', goalRef: moves[3]! }], label: `${label}-h3` });
  expect((await handle.toolResult(h[3], `${label}-h3-split`)).json).toEqual(atCap(7, 1, 1));
  expect(await sums()).toEqual([7, 1]);
  return { handle, h, moves: moves as Prior['moves'], tasks: tasks as Prior['tasks'], held, register, run,
    h6Inquiry: inquiries[5]! };
}

/** The one open capacity card of the waiting section. */
async function openCard(handle: S7D2CapacityWorld): Promise<DecisionCardV1> {
  const cards = capacityCards(await handle.queue(ALL), ['waitingAnswer']);
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

/** The project notices whose summary starts with `容量已恢复`. */
async function resolutions(handle: S7D2CapacityWorld): Promise<{ summary: string; subject: unknown }[]> {
  return (await handle.notices()).filter(item => item.summary.startsWith('容量已恢复'))
    .map(item => ({ summary: item.summary, subject: item.subject }));
}

describe('RL-11 A: one episode while it is open', () => {
  /*
   * Named mutation (v4 :8849): every refusal opens a new episode -> step 2's `toEqual(atCap(7, 1, 1))` (`episode: 1`)
   * and its "still one card, same cardKey" turn red.
   */
  it('RL-11 A (memory): the card, a second refusal, the release, the cap set close, a later episode 2', async () => {
    const { handle, h, moves, tasks, held, register, run } = await prior('memory', 'rl11-a');

    // 1. The one project card of episode 1.
    const card = await openCard(handle);
    expect(capacityCards(await handle.queue(ALL), ['waitingAnswer', 'answeredPendingApplication', 'history']))
      .toHaveLength(1);
    expect(card.subject).toEqual(projectSubject);
    expect(JSON.parse(card.source.key)).toEqual({ kind: 'role_capacity', duty: 'adviser', capValue: 8, episode: 1 });
    expect(card.options).toEqual(capacityOptions);
    const read = await handle.card(card.source);
    expect(read.state).toBe('waiting_answer');
    expect(read.objects).toEqual([{ kind: 'aggregate', label: '容量', pin: {
      ref: { aggregateType: 'RoleCapacityEpisode', projectId: PROJECT_ID, duty: 'adviser', episode: 1 }, revision: 1 } }]);

    // 2. A second refusal while the episode is open: the same number, no second card.
    const holders2 = (await handle.allocation()).duties.adviser.holders.map(holder => holder.session);
    await handle.busy(holders2, 'rl11-a-busy-2');
    await handle.split({ line: h[4], task: tasks[4], callId: 'rl11-a-h4-split',
      move: [{ kind: 'goal', goalRef: moves[4] }], label: 'rl11-a-h4' });
    expect((await handle.toolResult(h[4], 'rl11-a-h4-split')).json).toEqual(atCap(7, 1, 1));
    expect((await openCard(handle)).cardKey).toBe(card.cardKey);

    // 3. The release: the reservation becomes a holder, 8/8, the episode stays open.
    register.release();
    held.release();
    await run;
    const released = await waitFor(() => handle.allocation(), allocation =>
      allocation.duties.adviser.holders.length === 8 && allocation.duties.adviser.reservations.length === 0,
    'the held reservation to become a holder');
    expect(released.duties.adviser.holders).toHaveLength(8);
    expect((await openCard(handle)).cardKey).toBe(card.cardKey);

    // 4. The public cap set 8 -> 9 closes it; 9 -> 8 does not reopen it.
    await handle.setOpen('adviser', 9, 'rl11-a-cap-9');
    expect(capacityCards(await handle.queue(ALL), ['waitingAnswer', 'answeredPendingApplication'])).toEqual([]);
    expect(await handle.card(card.source)).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
    await handle.setOpen('adviser', 8, 'rl11-a-cap-8-again');
    expect(capacityCards(await handle.queue(ALL), ['waitingAnswer', 'answeredPendingApplication'])).toEqual([]);

    // 5. A later refusal opens episode 2 and one new card (every holder, H2's new line too, has an inquiry).
    const holders5 = (await handle.allocation()).duties.adviser.holders.map(holder => holder.session);
    expect(holders5).toHaveLength(8);
    await handle.busy(holders5, 'rl11-a-busy-5');
    await handle.split({ line: h[5], task: tasks[5], callId: 'rl11-a-h5-split',
      move: [{ kind: 'goal', goalRef: moves[5] }], label: 'rl11-a-h5' });
    expect((await handle.toolResult(h[5], 'rl11-a-h5-split')).json).toEqual(atCap(8, 0, 2));
    const pending = capacityCards(await handle.queue(ALL), ['waitingAnswer', 'answeredPendingApplication']);
    expect(pending.map(entry => JSON.parse(entry.source.key) as unknown))
      .toEqual([{ kind: 'role_capacity', duty: 'adviser', capValue: 8, episode: 2 }]);

    // 6. The open and the public cap set's close write no resolution notice.
    expect(await resolutions(handle)).toEqual([]);
  }, 300_000);
});

type Cell = {
  name: 'raise_cap' | 'merge_scopes' | 'archive_line' | 'wait';
  backend: S6ABackend;
};

describe('RL-11 B: the four answers', () => {
  /*
   * Named mutation (book :515–:517; v4 :4255–:4257): `raise_cap`'s application writes `ProjectRoleLimitsChanged`
   * without its `proof` -> the receipt check fails, the answer's `state` is not `applied`: the `raise_cap` cells'
   * `state: 'applied'` assertion turns red.
   */
  it.each<Cell>([
    { name: 'raise_cap', backend: 'memory' },
    { name: 'raise_cap', backend: 'sqlite' },
    { name: 'merge_scopes', backend: 'memory' },
    { name: 'archive_line', backend: 'memory' },
    { name: 'wait', backend: 'memory' },
  ])('RL-11 B $name ($backend): the answer, then the same requestId again changes nothing', async ({ name, backend }) => {
    const label = `rl11-b-${name.replace('_', '-')}-${backend}`;
    const { handle, h, held, register, run, h6Inquiry } = await prior(backend, label);
    const card = await openCard(handle);
    const objectKey = canonicalJson(card.objects[0] as never);
    const lineText = (line: SessionRef, extra: Record<string, unknown> = {}): string =>
      canonicalJson({ line: { projectId: line.projectId, sessionId: line.sessionId }, ...extra } as never);
    if (name === 'archive_line') await withdrawS7A2Message(handle.world, h6Inquiry, `${label}-h6`);
    const body: S7D2AnswerBody = name === 'raise_cap' ? { optionId: 'raise_cap', text: '9', annotations: [] }
      : name === 'merge_scopes' ? { optionId: 'merge_scopes', text: '', annotations: [{ objectKey,
        text: lineText(h[7].ref, { scope: [{ kind: 'region', moduleRef: { projectId: PROJECT_ID, moduleId: 'src/a' } }] }) }] }
        : name === 'archive_line' ? { optionId: 'archive_line', text: '', annotations: [{ objectKey,
          text: lineText(h[6].ref) }] }
          : { optionId: 'wait', text: '', annotations: [] };
    const limitsBefore = await handle.limits();
    const allocationBefore = await handle.allocation();

    const answered = valueOf<ResolveDecisionReadV1>(await handle.answer(card, body, `${label}-answer`), 'ready',
      `the ${name} answer`);
    const pendingCapacity = async (): Promise<DecisionCardV1[]> =>
      capacityCards(await handle.queue(ALL), ['waitingAnswer', 'answeredPendingApplication']);
    const h7Links = async () => (await handle.readCard(h[7])).links
      .filter(link => link.ref.relation === 'responsible' && link.ref.target.kind === 'module');
    if (name === 'raise_cap') {
      expect(answered.state).toBe('applied');
      expect(answered.application).not.toBeNull();
      expect((await handle.limits()).open.adviser).toBe(9);
      expect(await pendingCapacity()).toEqual([]);
      expect(await resolutions(handle)).toEqual([{ summary: resolvedSummary, subject: projectSubject }]);
    } else if (name === 'merge_scopes') {
      expect(answered.state).toBe('applied');
      // The old `src/b` responsible link is closed (`until` set), not removed.
      expect((await h7Links()).filter(link => link.ref.target.kind === 'module'
        && link.ref.target.ref.moduleId === 'src/b').map(link => link.until === null)).toEqual([false]);
      expect(openTargetsOf(await handle.readCard(h[7])).filter(target => target.kind === 'module'))
        .toEqual([{ kind: 'module', ref: { projectId: PROJECT_ID, moduleId: 'src/a' } }]);
      expect(await resolutions(handle)).toEqual([]);
    } else if (name === 'archive_line') {
      expect(answered.state).toBe('applied');
      expect((await handle.readCard(h[6])).record.lifecycle).toBe('archived');
      expect(await pendingCapacity()).toEqual([]);
      expect(await resolutions(handle)).toEqual([{ summary: resolvedSummary, subject: projectSubject }]);
    } else {
      const all = capacityCards(await handle.queue(ALL), ['waitingAnswer', 'answeredPendingApplication', 'history'])
        .filter(entry => entry.cardKey === card.cardKey);
      expect(all.map(entry => entry.state)).toEqual(['answered_no_application']);
      expect(await handle.limits()).toEqual(limitsBefore);
      expect(await handle.allocation()).toEqual(allocationBefore);
      expect(await resolutions(handle)).toEqual([]);
    }

    // The same requestId again: no second change, no second notice (its `state` is not asserted, lead Q6).
    const limitsAfter = await handle.limits();
    const linksAfter = await h7Links();
    const noticesAfter = await resolutions(handle);
    const allocationAfter = await handle.allocation();
    await handle.answer(card, body, `${label}-answer`);
    expect(await resolutions(handle)).toEqual(noticesAfter);
    if (name === 'raise_cap') expect((await handle.limits()).revision).toBe(limitsAfter.revision);
    if (name === 'merge_scopes') expect(await h7Links()).toEqual(linksAfter);
    if (name === 'archive_line') expect((await handle.readCard(h[6])).record.lifecycle).toBe('archived');
    if (name === 'wait') {
      expect(await handle.limits()).toEqual(limitsAfter);
      expect(await handle.allocation()).toEqual(allocationAfter);
    }
    register.release();
    held.release();
    await run;
  }, 300_000);
});
