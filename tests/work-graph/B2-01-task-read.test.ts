/**
 * Rework 1 item 1 / B2-01 (Codex's a201/z): the task-form `listReviews` fixes
 * the merged raw page WINDOW and its cursor BEFORE filtering by task.
 *
 * Every record is a REAL blocked Run: ONE real `pending_review` record per
 * attempt (`createK3PendingReview`), settled through `settleK3Review` for the
 * target/other-task records, with the production UCR owner for the read. An
 * un-settled record of another status supplies Codex's other-task `z` page.
 *
 * Shape with limit 2: the fixture mints increasing real run ids, so the five
 * refKeys sort in creation order (`filler < other < other < target < z`). The
 * test derives that order by sorting the created refs (never the old `s5-id-N`
 * digits); the two raw window slots of the first page are other-task records, so
 * the first page returns 0 target items with a non-null cursor. Filtering
 * before fixing the window used to jump the cursor to `z` (the last raw record)
 * and lose the target forever; the fixed window advances to the target and
 * returns it exactly once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  createK3PendingReview, settleK3Review,
} from '../helpers/K3-proposal-round.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

let seq = 0;
async function needsDecision(world: K3ReviewCardWorld, taskId: string): Promise<UnknownCallReviewV1> {
  seq += 1;
  const pending = await createK3PendingReview(world, {
    taskId, label: `b2-01-read-${String(seq)}`,
    callId: `b2-01-read-call-${String(seq)}`, command: `echo ${String(seq)}`,
  });
  return await settleK3Review(world, pending, { cause: 'review_unavailable' });
}

async function listByTask(
  world: K3ReviewCardWorld, taskId: string, limit: number,
): Promise<{ records: UnknownCallReviewV1[]; cursors: Array<string | null>; emptyPages: number }> {
  const records: UnknownCallReviewV1[] = [];
  const cursors: Array<string | null> = [];
  let emptyPages = 0;
  let cursor: string | null = null;
  for (let pages = 1; pages <= 100; pages += 1) {
    const page = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, filter: { goalRef: GOAL_B, taskId },
      page: { limit, ...(cursor === null ? {} : { cursor }) },
    });
    if (page.status !== 'ready') throw new Error(`listReviews failed: ${JSON.stringify(page)}`);
    if (page.value.items.length === 0) emptyPages += 1;
    records.push(...page.value.items);
    cursors.push(page.value.nextCursor);
    cursor = page.value.nextCursor;
    if (cursor === null) return { records, cursors, emptyPages };
  }
  throw new Error('listReviews did not terminate');
}

describe('rework 1 item 1 / B2-01 task-form read', () => {
  it.each(['memory', 'sqlite'] as const)('(%s) pages to the task record when another status page supplies the last raw window record', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const filler = await needsDecision(world, 'k3-20-e');
    const otherA = await needsDecision(world, 'k3-20-b');
    const otherB = await needsDecision(world, 'k3-20-c');
    const targetRecord = await needsDecision(world, 'k3-20-a');
    // A real unsettled record of another status, created last (Codex's `z`).
    seq += 1;
    const z = await createK3PendingReview(world, {
      taskId: 'k3-20-d', label: `b2-01-z-${String(seq)}`,
      callId: `b2-01-z-call-${String(seq)}`, command: 'echo z',
    });
    expect(z.status).toBe('pending_review');

    // F-026: the expected refKey order is hand-computed, not sorted with the
    // production comparator. `runIdGeneratorOf` mints `...0001`, `...0002`, …
    // (padded to 12 digits), so the canonical refKeys (`aggregateType`,
    // `goalId`, `projectId`, `runId`) sort in creation order:
    // filler < otherA < otherB < target < z.
    const ordered = [filler, otherA, otherB, targetRecord, z];
    const target = targetRecord;
    expect(ordered[ordered.length - 1]!.ref).toEqual(z.ref);
    expect(target.status).toBe('needs_decision');

    const paged = await listByTask(world, target.task.taskId, 2);
    expect(paged.records.map(record => record.ref)).toEqual([target.ref]);
    // The target is outside the first raw window: 0 items with an advancing cursor.
    expect(paged.emptyPages).toBeGreaterThanOrEqual(1);
    expect(paged.cursors.slice(0, -1).every(cursor => cursor !== null)).toBe(true);
    expect(paged.cursors.at(-1)).toBeNull();

    const onePage = await listByTask(world, target.task.taskId, 100);
    expect(onePage.records.map(record => record.ref)).toEqual([target.ref]);
  }, 240_000);
});
