/**
 * K3-15 (二) (lead answer 4): `listReviews` gains `{ goalRef, taskId }`.
 *
 * The filter runs over the existing goal-status index (one query per status),
 * decodes and filters by `record.task.taskId`, then pages by refKey to the end.
 * One Task carries TWO real blocked-Run records (the second Run is claimed from
 * the first Run's public requeue); the control Task carries one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  createK3NeedsDecisionRecord, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import { blockedRecordWithClaim, requeueBlockedRecord } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`: the real record's one blocked call is held until the
// recognition path has read the draft (the real shell needs bwrap, which DSH
// does not have). The mock is per test file, so this file owns it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function listByTask(world: K3ReviewCardWorld, taskId: string, limit: number) {
  const seen: UnknownCallReviewV1[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE,
      filter: { goalRef: GOAL_B, taskId },
      page: { limit, ...(cursor === null ? {} : { cursor }) },
    });
    if (page.status !== 'ready') throw new Error(`listReviews failed: ${JSON.stringify(page)}`);
    seen.push(...page.value.items);
    cursor = page.value.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error('listReviews did not terminate');
}

describe('K3-15 listReviews by task', () => {
  it.each(['memory', 'sqlite'] as const)('(%s) returns both records of the requested task and pages to the same result, no duplicates', async kind => {
    // `realKernelCommandFacts`: the real `skip_as_done` disposition below reads
    // the record's blocked command from the production Kernel reader (the same
    // world option B2-07 uses), never from a test-written map.
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    // The FIRST Run of `k3-20-a` goes through the real blocked-Run path
    // (`blockedRecordWithClaim`: public claim → production prepare/start → the
    // §5.1 held shell call → RUN-20/RUN-22) and the real settlement plus
    // `skip_as_done` disposition resolve it, so the Task's next claim passes
    // the review gate (an unsettled record refuses it as pending).
    const firstRun = await blockedRecordWithClaim(world, 'k3-20-a', 'k3-15-first', [
      { callId: 'k3-15-first-call', command: 'echo k3-20-a' },
    ]);
    const recordA = firstRun.record;
    expect(recordA.status).toBe('resolved');
    // The SECOND Run of the SAME Task: the public requeue of the first Run is
    // the basis of its real public claim. Its command is DIFFERENT: repeating
    // the first command would first need a real one-time allowance, which this
    // row does not have.
    const requeue = await requeueBlockedRecord(world, firstRun.claim,
      'a second K3-15 Run of the same Task');
    const secondRun = await blockedRecordWithClaim(world, 'k3-20-a', 'k3-15-second', [
      { callId: 'k3-15-second-call', command: 'echo k3-20-a-second' },
    ], { requeue: requeue.ref });
    const recordA2 = secondRun.record;
    // The control Task still has exactly one record.
    const recordB = await createK3NeedsDecisionRecord(world, 'k3-20-b');
    expect(recordA.task.taskId).toBe('k3-20-a');
    expect(recordA2.task.taskId).toBe('k3-20-a');
    expect(recordA.ref.runId).not.toBe(recordA2.ref.runId);
    expect(recordB.task.taskId).toBe('k3-20-b');

    const onePage = await listByTask(world, 'k3-20-a', 100);
    expect(onePage.map(record => record.task.taskId)).toEqual(['k3-20-a', 'k3-20-a']);
    // The owner returns the merged records in its one refKey order; the other
    // Task's record never enters the result.
    expect(onePage.map(record => record.ref)).toEqual([recordA.ref, recordA2.ref]);
    expect(onePage.map(record => record.ref)).not.toContainEqual(recordB.ref);
    expect(new Set(onePage.map(record => record.ref.runId)).size).toBe(2);

    // limit 1 crosses BOTH pages (the second page carries the second record)
    // and returns the same list, with no duplicate record.
    const paged = await listByTask(world, 'k3-20-a', 1);
    expect(paged.map(record => record.ref)).toEqual([recordA.ref, recordA2.ref]);
    expect(new Set(paged.map(record => `${record.ref.runId}@${String(record.revision)}`)).size)
      .toBe(paged.length);
    expect(paged).toEqual(onePage);
  }, 180_000);

  it.each(['memory', 'sqlite'] as const)('(%s) rejects an empty taskId and leaves the other filters untouched', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    await createK3NeedsDecisionRecord(world, 'k3-20-a');
    const empty = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, filter: { goalRef: GOAL_B, taskId: '' }, page: { limit: 10 },
    });
    expect(empty).toMatchObject({ status: 'rejected', code: 'invalid' });
    const status = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, filter: { goalRef: GOAL_B, status: ['needs_decision'] },
      page: { limit: 10 },
    });
    expect(status).toMatchObject({ status: 'ready' });
    if (status.status === 'ready') {
      expect(status.value.items.every(record => record.status === 'needs_decision')).toBe(true);
    }
  }, 180_000);
});
