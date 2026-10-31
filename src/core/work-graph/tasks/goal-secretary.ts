/**
 * The goal's current secretary: the owner of the newest kept request root, else the workspace's secretary duty.
 * `tasks/` owns it because `sessions/` may not import `tasks` or `queries`.
 *
 * Candidates are the workspace's request roots in `g:<goalId>` and `no-goal`, newest first (`since`). A root is kept
 * when its derived EFFECTIVE goal is this Goal, so a request attributed after creation is not missed (A-21). The
 * owner is `ownerOf` of the newest kept root with a non-null owner; only a successful `null` continues to an older
 * kept root or falls back to duty. A rejected, `not_found` or `not_ready` read, a damaged root and a bound hit (the
 * 8 x 50 traversal reaches a next page) are all `unavailable` — never "no owner".
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import { messageOf } from '../../../contracts/error-message.js';
import { compareCursors, type GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { REQUEST_ROOT_MARK, REQUEST_ROOTS_BY_GOAL_INDEX, requestGoalSlot } from '../model/request-contracts.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import type { DutyRecipientPort } from '../sessions/duty-recipient.js';
import type { RequestFactsPort } from './request-facts.js';
import { workspaceOf } from './request-service.js';

export type GoalSecretaryDependencies = {
  ordered: RecordOrderedLookupPort;
  requestFacts: Pick<RequestFactsPort, 'ownerOf' | 'effectiveGoalOf'>;
  duty: DutyRecipientPort;
};
export interface GoalSecretaryPort {
  resolveGoalSecretary(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<SessionRef | null>>;
}

/** The chooser's bound: 8 pages of 50 per goal slot; a next page after that is a bound hit. */
const PAGE_LIMIT = 50;
const MAX_PAGES = 8;
type RootCandidate = { requestRoot: QueryJobRef; since: CommitCursor };

/** One goal slot, newest first, bounded. Every failure is `unavailable`. */
async function readGoalSlot(
  ordered: RecordOrderedLookupPort, ctx: CoreCallContext, goalSlot: string,
): Promise<ReadResult<RootCandidate[]>> {
  const roots: RootCandidate[] = [];
  let after: { order: string | number; refKey: string } | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let read: Awaited<ReturnType<RecordOrderedLookupPort['lookupOrdered']>>;
    try {
      read = await ordered.lookupOrdered({
        index: REQUEST_ROOTS_BY_GOAL_INDEX, direction: 'desc', limit: PAGE_LIMIT,
        values: [ctx.projectId, ctx.workspaceId ?? '', REQUEST_ROOT_MARK, goalSlot],
        ...(after === undefined ? {} : { after }),
      });
    } catch (error) {
      return rejected('unavailable', `the goal's request roots could not be read: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') {
      return rejected('unavailable', `the goal's request roots read failed: ${read.code}: ${read.reason}`);
    }
    for (const record of read.value.records) {
      const decoded = decodeQueryJobSnapshot(record);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `a request root is damaged: ${decoded.reason}`);
      }
      roots.push({ requestRoot: decoded.value.ref, since: decoded.value.since });
    }
    if (read.value.next === null) return { status: 'ready', value: roots };
    after = read.value.next;
  }
  return rejected('unavailable',
    `the goal's request roots exceed the ${MAX_PAGES} x ${PAGE_LIMIT} traversal bound`);
}

export function createGoalSecretary(deps: GoalSecretaryDependencies): GoalSecretaryPort {
  return {
    async resolveGoalSecretary(ctx, input) {
      const goalId = input.goalRef.goalId;
      const candidates: RootCandidate[] = [];
      for (const slot of [requestGoalSlot(goalId), requestGoalSlot(null)]) {
        const page = await readGoalSlot(deps.ordered, ctx, slot);
        if (page.status !== 'ready') return page;
        candidates.push(...page.value);
      }
      // Newest first by the commit cursor, never by a wall clock.
      candidates.sort((left, right) => compareCursors(right.since, left.since));
      for (const candidate of candidates) {
        const effective = await deps.requestFacts.effectiveGoalOf(ctx, { requestRoot: candidate.requestRoot });
        if (effective.status !== 'ready') {
          return rejected('unavailable', `the root's effective goal could not be read: ${
            effective.status === 'rejected' ? effective.reason : effective.status}`);
        }
        if (effective.value !== goalId) continue;
        const owner = await deps.requestFacts.ownerOf(ctx, { requestRoot: candidate.requestRoot });
        if (owner.status !== 'ready') {
          return rejected('unavailable', `the root's owner could not be read: ${
            owner.status === 'rejected' ? owner.reason : owner.status}`);
        }
        if (owner.value !== null) return { status: 'ready', value: { ...owner.value } };
      }
      return deps.duty.resolveDutyRecipient(ctx, {
        workspace: workspaceOf(ctx), duty: 'secretary',
      });
    },
  };
}
