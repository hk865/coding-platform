/**
 * RL-22 (`7d2-start-rulings.v4.md:8860`, read per `later-rows-merged.md:214–:215` and the move ruling Q10
 * `later-rows-rulings.md:15`; book `:721–:726`, `:1325`; write-tests brief `tests-7d2-o4a.txt:81–:98`): copying a
 * cancelled goal moves its adviser and scribe to the copy in the copy's birth commit, writes one project notice and
 * leaves a reused or archived source line to the queue; a paused source is not copied.
 *
 * World: `openS7D2QueueWorld` (tests/helpers/S7D2-queue-world.ts) with no drafts, memory, fixed clock. Common prior:
 * G through `goals/create` and an adopted Plan (`plans/propose` + `plans/apply`; the two steps `seedS7AGoalPlan`
 * takes), A_G and S_G through `role-lines/open` on `[goal G]` (adviser, scribe), then (but in D) G cancelled through
 * `goals/control`. The birth commit is `goal.copyConfirm:`; O4a-12 holds its answer with `holdAfter`, so the reads
 * see the landed commit before any post-commit step. G2's ref comes from A_G's new open link (ruling Q25).
 *
 * Expected (by hand from the frozen lines): the old links get `until`, one open responsible link each on the same new
 * goal, `continuedFrom.goal` is G (v4 `:5235–:5237`); one project notice `目标已延续：…` (v4 `:5188`, `:5191`); a replay
 * moves and notifies nothing; G2's first advance finds its adviser (`goal_has_adviser`, drill rulings L-8 `:1805`);
 * a reused or archived source re-resolves through L33 (v4 `:5153`) with one `队列分配：` notice (v4 `:4971`); a paused
 * source is refused with `src/core/work-graph/state/goal-copy.ts:25–:27`'s reason (book `:726`, v4 `:5242–:5244`). The
 * move event's `reason: 'goal_continued'` has no public read, so it is not asserted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../../src/contracts/goal-card.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openS7D2QueueWorld, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { openTargetsOf } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D2QueueWorld[] = [];
afterEach(async () => {
  const unreleased = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(unreleased).toEqual([]);
});

const PROJECT_ID = S6A_SCOPE.projectId;
const continuedNotice = (from: GoalRef, to: GoalRef): string =>
  `目标已延续：${from.goalId} → ${to.goalId}；顾问与记录员已随目标迁移（可归档或重排）`;
const queueNotice = (goalId: string, sessionId: string): string =>
  `队列分配：${goalId} → 顾问 ${sessionId}（规则：队列顺序；可重排或调高上限）`;

type Prior = { q: S7D2QueueWorld; g: GoalRef; ag: S6ASession; sg: S6ASession };

/** The common prior up to (not including) G's cancel. */
async function prior(label: string): Promise<Prior> {
  const q = await openS7D2QueueWorld({ backend: 'memory' });
  worlds.push(q);
  const g = (await q.main.createGoal(`${label}-g`, `RL-22 ${label} G`)).ref;
  await q.plan(g, `${label}-g`);
  const line = async (duty: 'adviser' | 'scribe') => await q.lineOf(`${label}-${duty}`,
    (await q.open({ duty, scope: [{ kind: 'goal', goalRef: g }], requestId: `${label}-${duty}` })).result);
  return { q, g, ag: await line('adviser'), sg: await line('scribe') };
}

/** The `goals/copy-confirm` body the person sends after `goals/copy-draft`. */
async function copyInput(q: S7D2QueueWorld, g: GoalRef, commandId: string) {
  const draft = valueOf<GoalCopyDraftResultV1>(await q.main.route('goals/copy-draft', { goalRef: g }), 'ready',
    'the copy draft');
  return { commandId, sourceGoalRef: draft.source.goal, expectedSourceRevision: draft.source.revision,
    selectedInterventions: [] };
}

/** The responsible goal links of `card` on `goal`, open or closed. */
const linksTo = (card: SessionCard, goal: GoalRef) => card.links.filter(link => link.ref.relation === 'responsible'
  && link.ref.target.kind === 'goal' && link.ref.target.ref.goalId === goal.goalId);
const openGoals = (card: SessionCard): GoalRef[] =>
  openTargetsOf(card).flatMap(target => target.kind === 'goal' ? [target.ref] : []);

async function summariesOf(q: S7D2QueueWorld, prefix: string, subjectGoal?: GoalRef) {
  return (await q.notices()).filter(item => item.summary.startsWith(prefix) && (subjectGoal === undefined
    || (item.subject.kind === 'goal' && item.subject.goalRef.goalId === subjectGoal.goalId)))
    .map(item => ({ summary: item.summary, subject: item.subject }));
}

/** G2's first Plan and one `workflow/advance` of `select_work` (the continued-goal block runs before selection). */
async function adoptAndAdvance(q: S7D2QueueWorld, g2: GoalRef, label: string): Promise<void> {
  await q.plan(g2, `${label}-g2`);
  const body = (await q.world.post('workflow/advance', plain(S6A_SCOPE, { schemaVersion: 1, goalRef: g2,
    flowId: `${label}-advance`, sessionHint: null, kind: 'select_work' }))).body as { status?: string };
  if (body.status !== 'ready') throw new Error(`RL-22: G2's advance did not run: ${JSON.stringify(body)}`);
}

describe('RL-22 A: the copy moves the adviser and the scribe in its birth commit', () => {
  /*
   * Named mutation (v4 `:8860`): only the adviser moves -> step 2's S_G assertions (its old link closed, its one open
   * link on G2) turn red.
   */
  it('RL-22 A (memory): held birth commit, one project notice, the replay, G2\'s first advance', async () => {
    const { q, g, ag, sg } = await prior('rl22-a');
    await q.cancel(g);

    // 1. The birth commit lands; its answer is held.
    const held = commitBarrier.holdAfter(byIdentityPrefix('goal.copyConfirm:'), 'RL-22 A: the birth commit answer');
    const input = await copyInput(q, g, 'rl22-a-copy');
    const confirming = q.main.route('goals/copy-confirm', input).catch((error: unknown) => error);
    await held.reached;

    // 2. Read while held: both lines moved to one new goal G2, which continues G.
    const agCard = await q.readCard(ag);
    expect(linksTo(agCard, g).map(link => link.until === null)).toEqual([false]);
    const moved = openGoals(agCard);
    expect(moved).toHaveLength(1);
    const g2 = moved[0]!;
    expect(g2.goalId).not.toBe(g.goalId);
    const sgCard = await q.readCard(sg);
    expect(linksTo(sgCard, g).map(link => link.until === null)).toEqual([false]);
    expect(openGoals(sgCard)).toEqual([g2]);
    expect(valueOf<{ goal: GoalSnapshot }>(await q.main.route('goals/read', g2), 'ready', 'G2').goal.continuedFrom?.goal)
      .toEqual(g);

    // 3. Released: committed; one project notice for the two goals, none under G2.
    held.release();
    expect(await confirming).toMatchObject({ status: 'committed' });
    expect(await waitFor(() => summariesOf(q, '目标已延续：'), notices => notices.length > 0, 'the copy notice'))
      .toEqual([{ summary: continuedNotice(g, g2), subject: { kind: 'project', projectRef: { projectId: PROJECT_ID } } }]);

    // 4. The same commandId again: no more links, no more notices.
    const links = [(await q.readCard(ag)).links, (await q.readCard(sg)).links];
    await q.main.route('goals/copy-confirm', input);
    expect([(await q.readCard(ag)).links, (await q.readCard(sg)).links]).toEqual(links);
    expect(await waitFor(() => summariesOf(q, '目标已延续：'), notices => notices.length > 0,
      'the copy notice after the replay')).toHaveLength(1);

    // 5. G2's first advance finds its adviser: still only A_G (and S_G), not queued, no queue notice.
    await adoptAndAdvance(q, g2, 'rl22-a');
    expect(await q.linesOf(g2)).toEqual([ag.ref.sessionId, sg.ref.sessionId].sort());
    expect(await q.queueIds()).not.toContain(g2.goalId);
    expect(await summariesOf(q, '队列分配：', g2)).toEqual([]);
  }, 300_000);
});

type Stale = { name: 'reused' | 'archived'; make(q: S7D2QueueWorld, ag: S6ASession, label: string): Promise<void> };

describe('RL-22 B, C: a reused or archived source line leaves G2 to the queue', () => {
  /*
   * Named mutation (B and C): the copy still moves a source link that is already closed -> A_G gets a link to G2: the
   * `linksTo(A_G, G2)` = [] assertion turns red.
   */
  it.each<Stale>([
    { name: 'reused', async make(q, ag, label) {
      valueOf((await q.changeScope({ session: ag, scope: [{ kind: 'region', moduleRef: q.modules.other }],
        requestId: `${label}-reuse` })).result, 'committed', 'the reuse of A_G');
    } },
    // A_G received no message in this world, so there is nothing to withdraw before the archive.
    { name: 'archived', async make(q, ag, label) { await q.archive(ag, `${label}-archive`); } },
  ])('RL-22 $name (memory): no stale link on G2; G2\'s advance assigns it through the queue', async ({ name, make }) => {
    const label = `rl22-${name}`;
    const { q, g, ag, sg } = await prior(label);
    await make(q, ag, label);
    expect(linksTo(await q.readCard(ag), g).map(link => link.until === null)).toEqual([false]);
    await q.cancel(g);
    const g2 = valueOf<GoalCopyConfirmResultV1>(await q.main.route('goals/copy-confirm',
      await copyInput(q, g, `${label}-copy`)), 'committed', 'the copy').goal.ref;
    expect(linksTo(await q.readCard(ag), g2)).toEqual([]);
    expect(openGoals(await q.readCard(sg))).toEqual([g2]);

    await adoptAndAdvance(q, g2, label);
    const on = await waitFor(() => q.linesOf(g2), lines => lines.length === 2, 'G2 to get an adviser through L33');
    const adviser = on.filter(sessionId => sessionId !== sg.ref.sessionId);
    expect(adviser).toHaveLength(1);
    expect(await waitFor(() => summariesOf(q, '队列分配：', g2), notices => notices.length > 0, 'G2\'s queue notice'))
      .toEqual([{ summary: queueNotice(g2.goalId, adviser[0]!), subject: { kind: 'goal', goalRef: g2 } }]);
  }, 300_000);
});

describe('RL-22 D: a paused source is not copied', () => {
  /* Named mutation: the copy accepts a paused source -> the answer is `committed`, the `toEqual` turns red. */
  it('RL-22 D (memory): a paused G is refused and its lines keep their links', async () => {
    const { q, g, ag, sg } = await prior('rl22-d');
    await q.pause(g);
    const read = valueOf<{ goal: { revision: number } }>(await q.main.route('goals/read', g), 'ready', 'G');
    expect(await q.main.route('goals/copy-confirm', { commandId: 'rl22-d-copy', sourceGoalRef: g,
      expectedSourceRevision: read.goal.revision, selectedInterventions: [] }))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'a Goal can be copied only from a cancelled source' });
    expect(await q.goalsOf(ag)).toEqual([g.goalId]);
    expect(await q.goalsOf(sg)).toEqual([g.goalId]);
  }, 300_000);
});
