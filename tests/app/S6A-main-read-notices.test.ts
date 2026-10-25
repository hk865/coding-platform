/**
 * The main read's notices over HTTP, on memory and SQLite (slice-6-SPEC L6, the
 * R-12 row): each goal's automatic-rework notices fold into one "n 条自动返工"
 * line that carries its members' views, and the seen position a goal's page
 * allows. The decision queue keeps showing the notices one by one.
 *
 * Prior state is the frozen notices world (tests/helpers/S6A-cards-fixture.ts):
 * three real automatic reworks run by the Workflow, in the order goal 1, goal 2,
 * goal 1. Each notice is written here from its rework's receipts (the failed
 * Run's requeue): the first counted automatic requeue of a task whose Run
 * failed, so count 1 of the Host's automation limit 3 (the world keeps it and
 * only turns `resumeOnStartup` off), reason `auto-rework:run_failed#1`, the
 * system actor class, the summary `自动返工 · <task> · 第 1 次（1/3）`, no
 * objects, and the requeue's canonical JSON as its key. A notice's commit
 * position is opaque: its cursor is the one the world's queue read returned, and
 * `decisions/notices/seen` is sent the token and positions a read returned.
 * Expected folds and advances are hand-computed from L6 and the
 * contiguous-prefix rule: goal 1's page shows 1 and 3, 2 is unseen, so its mark
 * reaches 1 and no further; reading writes nothing. A goal-filtered queue token
 * stays refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoticePositionV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6ANoticesWorld, type S6ANoticesWorld, type S6AReworkNotices } from '../helpers/S6A-cards-fixture.js';
import type { S6ABackend } from '../helpers/S6A-request-fixture.js';

// The notices world runs on the host world, whose gates sit on the frozen commit barrier: the test file owns its two
// mocks (no gate is set here).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

type NoticeLine = NoticeItemV1 & { memberViews?: NoticeItemV1[] };
type Page = { notices: NoticeLine[]; seenThrough: Record<string, unknown>; displayToken: string | null };

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
const worlds: S6ANoticesWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

async function openWorld(backend: S6ABackend): Promise<S6ANoticesWorld> {
  const world = await openS6ANoticesWorld({ backend });
  worlds.push(world);
  return world;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function readMain(world: S6ANoticesWorld, goal: GoalRef): Promise<Page> {
  const body = await world.main.route('main/read', { goalId: goal.goalId, cursor: null });
  if (asRecord(body)['status'] !== 'ready') throw new Error(`main/read of ${goal.goalId} was not ready: ${JSON.stringify(body)}`);
  return asRecord(body)['value'] as Page;
}

/** The three notices, each written from its rework's receipts; only the commit cursor is the read's (see the header). */
function reworkNotices(seeded: S6AReworkNotices): [NoticeItemV1, NoticeItemV1, NoticeItemV1] {
  const views = seeded.notices.map(({ notice, rework }): NoticeItemV1 => {
    const ref = rework.requeueRef;
    const itemKey = 'automatic_rework:{"afterRunId":"' + ref.afterRunId + '","aggregateType":"TaskRequeue","goalId":"'
      + ref.goalId + '","projectId":"' + ref.projectId + '","taskId":"' + ref.taskId + '"}';
    const position: NoticePositionV1 = { kind: 'commit', cursor: notice.position.cursor, itemKey };
    return {
      itemKey, category: 'automatic_rework', subject: { kind: 'goal', goalRef: rework.goal }, position,
      summary: `自动返工 · ${rework.taskId} · 第 1 次（1/3）`, objects: [],
      rework: {
        operation: 'requeue', actorClass: 'system', taskRef: { projectId: ref.projectId, goalId: ref.goalId, taskId: ref.taskId },
        count: 1, cap: 3, reason: 'auto-rework:run_failed#1', sourceRef: ref,
      },
    };
  });
  return [views[0]!, views[1]!, views[2]!];
}

/** The folded line of one goal: its key, the newest member's position, the members and their views. */
function foldedLine(goal: GoalRef, members: readonly NoticeItemV1[]): NoticeLine {
  return {
    itemKey: `automatic_rework_group:${goal.projectId}/${goal.goalId}`, category: 'automatic_rework',
    subject: { kind: 'goal', goalRef: goal },
    position: members.at(-1)!.position, summary: `${String(members.length)} 条自动返工`, objects: [], rework: null,
    members: members.map(member => ({ itemKey: member.itemKey, position: member.position })),
    memberViews: [...members],
  };
}

describe.each(BACKENDS)('main/read notices (%s)', backend => {
  it('R-12: one rework line per goal with its member views; goal 1 shows 1 and 3, so the mark reaches 1', async () => {
    const world = await openWorld(backend);
    const [n1, n2, n3] = reworkNotices(await world.seedReworkNotices());
    const { first, second } = world.world.goals;

    const goal1 = await readMain(world, first);
    expect(goal1.notices).toEqual([foldedLine(first, [n1, n3])]);
    expect(goal1.seenThrough).toEqual({ automatic_rework: n1.position });
    expect(typeof goal1.displayToken).toBe('string');
    const goal2 = await readMain(world, second);
    expect(goal2.notices).toEqual([foldedLine(second, [n2])]);
    expect(goal2.seenThrough).toEqual({});
    // Reading wrote nothing: the queue still shows the three notices, one by one.
    expect((await world.main.readNotices()).notices).toEqual([n1, n2, n3]);

    const marked = await world.main.markSeen({ label: 'goal-1-page', displayToken: goal1.displayToken!, seenThrough: goal1.seenThrough });
    expect(marked['status']).toBe('committed');
    expect((await world.main.readNotices()).notices).toEqual([n2, n3]);
    const goal2After = await readMain(world, second);
    expect(goal2After.notices).toEqual([foldedLine(second, [n2])]);
    expect(goal2After.seenThrough).toEqual({ automatic_rework: n2.position });
    expect((await readMain(world, first)).notices).toEqual([foldedLine(first, [n3])]);
  });

  describe('rejects: decisions/notices/seen', () => {
    it('a token the queue issued for one goal is still refused', async () => {
      const world = await openWorld(backend);
      const [n1, n2, n3] = reworkNotices(await world.seedReworkNotices());
      const filtered = await world.main.readNotices({ goal: world.world.goals.first });
      expect(filtered.seenThrough).toEqual({ automatic_rework: n3.position });
      const answer = await world.main.markSeen({ label: 'queue-goal-1', displayToken: filtered.displayToken!, seenThrough: filtered.seenThrough });
      expect(answer['status']).toBe('rejected');
      expect(answer['code']).toBe('invalid');
      expect((await world.main.readNotices()).notices).toEqual([n1, n2, n3]);
    });
  });
});
