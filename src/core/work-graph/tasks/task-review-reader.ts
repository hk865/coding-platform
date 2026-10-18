/**
 * F-075: the ONE Task-review paging read. The execution preparation (binding +
 * blocked lines), the continuation brief and the CRR owner's `listTaskReviews`
 * all read the Task's review records through the goal/task index, page to the
 * end with the same guards. A read failure is returned as it is: a missing
 * reader, a thrown read, a non-ready page, a cursor that does not advance or a
 * page loop that never ends is never an empty review set. There is no business
 * page cap here (the P5 cap is a separate ruling).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import type { UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';

/** The paging half of the UnknownCallReview owner; the ONE read this module needs. */
export type TaskReviewPagingPort = Pick<UnknownCallReviewReadPort, 'listReviews'>;

const PAGE_LIMIT = 200;
const MAX_PAGES = 10_000;

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required Task review was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the Task reviews are not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason,
    ...(result.current === undefined ? {} : { current: result.current }) };
}

/**
 * Read every review record of ONE Task, paged to the end. The task filter is
 * repeated on the returned items because the index filter is the owner's; a
 * record of another Task never enters the result. `reviews === undefined` is a
 * missing dependency, never "the Task has no reviews".
 */
export async function readTaskReviews(
  ctx: CoreCallContext,
  reviews: TaskReviewPagingPort | undefined,
  input: { goalRef: GoalRef; taskId: string; workspace: WorkspaceScope },
): Promise<ReadResult<UnknownCallReviewV1[]>> {
  if (reviews === undefined) {
    return rejected('unavailable', 'the Task review reader is not wired');
  }
  const collected: UnknownCallReviewV1[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let read: ReadResult<{ items: UnknownCallReviewV1[]; nextCursor: string | null }>;
    try {
      read = await reviews.listReviews(ctx, {
        workspace: input.workspace,
        filter: { goalRef: input.goalRef, taskId: input.taskId },
        page: { limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      });
    } catch (error) {
      return rejected('unavailable', `the Task reviews could not be read: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') return mapRead(read);
    for (const record of read.value.items) {
      if (record.task.taskId === input.taskId) collected.push(record);
    }
    const next = read.value.nextCursor;
    if (next === null) return { status: 'ready', value: collected };
    if (seenCursors.has(next)) {
      return rejected('unavailable', 'the Task review pages did not advance');
    }
    seenCursors.add(next);
    cursor = next;
    if (page === MAX_PAGES - 1) {
      return rejected('unavailable', 'the Task review pages did not end');
    }
  }
  return rejected('unavailable', 'the Task review pages did not end');
}
