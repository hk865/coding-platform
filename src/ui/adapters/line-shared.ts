/**
 * The one copy of the member/chain line seams (frozen build §10): the line
 * identity read, the run-control submit and the requeue visibility rule.
 * Member builds it; Chain imports it from the same file. Nothing here touches
 * the DOM or a page's local state.
 */
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SubmittedControl } from '../../contracts/control-intent.js';
import type { SessionHistoryEntry } from '../../contracts/session-activity.js';
import type { TaskRow } from '../../contracts/task-graph.js';
import type { UnknownCallReviewRef } from '../../contracts/unknown-call-review.js';
import type { LineControlV1, WorkLineDetailV1 } from '../../contracts/work-line.js';
import {
  committedRouteValue, createHostClient, readyRouteValue,
} from '../host-client.js';
import type { CoreScope } from '../host-client.js';
import type { LineKey } from './nav.js';

/** The Host client type the seam takes; the tree has no exported name for it. */
export type UiClient = ReturnType<typeof createHostClient>;

/** `lines/read`'s two shapes: a line, or the heads of a branched line. */
export type LineReadValue = WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] };

/** The only `lines/read` call both pages make. */
export async function readLine(
  client: UiClient, scope: CoreScope, key: LineKey,
): Promise<LineReadValue> {
  return readyRouteValue<LineReadValue>(
    await client.post('lines/read', scope, { workspace: scope, key }), 'lines/read',
  );
}

/** The only `controls/submit` call both pages make: the control's own pins are
 * the expected versions, and the request id is made once per click. */
export async function submitRunControl(
  client: UiClient, scope: CoreScope, control: LineControlV1,
  kind: 'pause' | 'resume' | 'cancel',
): Promise<SubmittedControl> {
  const runRef = control.target.runRef;
  if (runRef === undefined) throw new Error('this control names no Run');
  return committedRouteValue<SubmittedControl>(await client.write('controls/submit', scope, {
    input: { runRef, kind, reason: null },
    meta: { requestId: crypto.randomUUID(), expected: control.pins },
  }), 'controls/submit');
}

/** The only `sessions/history` read both pages make: the line's latest records,
 * with no cursor window. */
export async function readSessionTrace(
  client: UiClient, scope: CoreScope, sessionRef: LineKey,
): Promise<SessionHistoryEntry[]> {
  const page = readyRouteValue<{ items: SessionHistoryEntry[] }>(await client.post('sessions/history', scope, {
    sessionRef, afterCursor: null, throughCursor: null, limit: 100,
  }), 'sessions/history');
  return page.items;
}

/** K3 L7 (4b): the line task's unknown-call review and the two buttons it allows.
 *  我来处理 needs an unsettled record that is not held yet (unknown-call-review.ts:739-741);
 *  继续 is release-hold, only on a held record. `null` without a readable record. */
export type LineReview = {
  ref: UnknownCallReviewRef; revision: number; status: string;
  held: boolean; canHandle: boolean; canResumeReview: boolean;
};

/** The statuses 我来处理 may pause on (the same five the Main line view lists). */
const HANDLE_STATUSES = new Set([
  'pending_review', 'awaiting_proposal', 'awaiting_advice', 'needs_decision', 'awaiting_approval',
]);

/** The one copy of the review rule: Member, Main, Plan, Decide and Chain read
 *  these two booleans instead of repeating the status table. */
export function reviewOfTaskRow(row: TaskRow | null): LineReview | null {
  const review = row?.unknownCallReview;
  if (review === undefined || review.status === 'unreadable') return null;
  const held = review.hold === 'held';
  return {
    ref: review.ref, revision: review.revision, status: review.status, held,
    canHandle: !held && HANDLE_STATUSES.has(review.status),
    canResumeReview: held,
  };
}

/** X3: 重新入队 is shown only for a failed Task whose public requeue actors
 * include the person; the owner still decides. A held review has no requeue
 * either: this page's requeue carries no `archiveOrigin`, so the owner only
 * accepts release-hold (requeue-service.ts:1206-1207). */
export function requeueVisible(task: TaskRow): boolean {
  if (reviewOfTaskRow(task)?.held === true) return false;
  return task.effectivePhase === 'failed'
    && (task.failure?.requeueActors ?? []).includes('human');
}
