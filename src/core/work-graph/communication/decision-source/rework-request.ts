/**
 * The `rework_request` card source (`book-7c.md:882–:935`, `7c1-start-rulings-v2.md:1396–:1401`):
 * one collection source over the Goal's `rework-request-by-goal` records, ALL states, so a rejected or
 * stale card stays in history (`closedReasonOf`) and an applied card is left to the saved-answer overlay.
 *
 * `communication/` may not import `views/`, so this file publishes the `createCollectionCardSource`
 * SPEC itself (structurally, `views/decision-read-model.ts:277–310`); L1 wraps it with the one generic
 * adapter and registers the switch arm. There is no second card projection and no `reworkRequestCardFacts`
 * helper (DS-08).
 */
import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../../contracts/core/identity.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1, DecisionSourceV1,
  DecisionSubjectV1, GoalDecisionBasisV1,
} from '../../../../contracts/goal-decisions.js';
import type { DecisionCardV1 } from '../../model/decision-contracts.js';
import { decisionSourceKey, decisionSubjectGoalRef } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import { nonEmpty } from '../../../../contracts/validation/common.js';
import type { ReworkRequestRef } from '../../../../contracts/rework-request.js';
import type { PendingReworkRequestV1, ReworkRequestV1 } from '../../state/rework-request.js';
import { goalDecisionBasis } from '../../tasks/goal-basis.js';
import { nestedSourceObject, parseDecisionSourceKey } from '../../tasks/decision-source-identity.js';
import type { ReworkRequestReadPort } from '../../tasks/rework-requests.js';
import type { SourceReadResult, SourceReadSupport, SourceDependencies } from './types.js';

/** The all-state page and the point read the card source needs; both are the service's own reads. */
export type ReworkRequestCardReads = Pick<ReworkRequestReadPort, 'readRequest' | 'listByGoal'>;

/** The `createCollectionCardSource` spec this source publishes; `views/` supplies the adapter. */
export type ReworkRequestCardSourceSpec = {
  kind: 'rework_request';
  serves: readonly ['goal'];
  readCollection(ctx: CoreCallContext, input: { workspace: WorkspaceScope; subject: DecisionSubjectV1 })
    : Promise<ReadResult<readonly ReworkRequestV1[]>>;
  keyOf(record: ReworkRequestV1): string;
  closedReasonOf(record: ReworkRequestV1): DecisionCardV1['closedReason'];
  project(record: ReworkRequestV1, subject: DecisionSubjectV1, goal: GoalSnapshot | null): DecisionCardV1;
  readByKey(ctx: CoreCallContext, input: { workspace: WorkspaceScope; source: DecisionSourceV1 })
    : Promise<ReadResult<{ item: ReworkRequestV1 } | { closed: DecisionCardV1['closedReason']; openedAt: string | null } | null>>;
};

const REQUEST_PAGE_LIMIT = 200;

/** L1's `decision-source-facts` dep slot: the frozen read port (the switch arm reads one record). */
export type ReworkRequestSourceDependencies = SourceDependencies & {
  reworkRequests?: Pick<ReworkRequestReadPort, 'readRequest'>;
};

function reworkRequestPinOf(record: PendingReworkRequestV1): VersionPin {
  return { ref: structuredClone(record.ref) as unknown as VersionPin['ref'], revision: record.revision };
}

function requestRefFromKey(key: string): ReworkRequestRef | null {
  const parsed = parseDecisionSourceKey({ key });
  if (parsed === null || parsed.kind !== 'rework_request') return null;
  const ref = nestedSourceObject(parsed.body, 'requestRef');
  if (ref === null) return null;
  if (ref['aggregateType'] !== 'ReworkRequest' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId'])
    || !nonEmpty(ref['taskId']) || !nonEmpty(ref['requestId'])) return null;
  return ref as unknown as ReworkRequestRef;
}

/** The two fixed choices of a member/rework/handoff/adviser card (`book-7c.md:882–:885`). */
export function reworkRequestOptions(): DecisionOptionV1[] {
  return [
    { id: 'approve', label: 'approve', effect: 'apply' },
    { id: 'reject', label: 'reject', effect: 'reject' },
  ];
}

/** The request as the person's card; `closedReason` stays null (the adapter's `closedReasonOf` decides). */
export function projectReworkRequestCard(
  record: PendingReworkRequestV1, subject: DecisionSubjectV1, goal: GoalSnapshot | null,
): DecisionCardV1 {
  const key = decisionSourceKey({ kind: 'rework_request', requestRef: record.ref });
  const objects: DecisionObjectV1[] = [
    { kind: 'aggregate', pin: reworkRequestPinOf(record), label: 'rework request' },
    // A Task has no stored record; revision 0 is the absence pin `decision-source-facts` already knows.
    { kind: 'aggregate', pin: { ref: { aggregateType: 'Task', ...structuredClone(record.task) } as unknown as VersionPin['ref'],
      revision: 0 }, label: 'task' },
  ];
  return {
    cardKey: key,
    source: {
      kind: 'rework_request', key, subject: structuredClone(subject), pins: [reworkRequestPinOf(record)],
      goalBases: goal === null ? [] : [goalDecisionBasis(goal)],
    },
    state: 'waiting_answer',
    subject: structuredClone(subject),
    senderSessionRef: structuredClone(record.requester.session),
    requestRef: null,
    objects,
    options: reworkRequestOptions(),
    answerMessageRef: null,
    answer: null,
    application: null,
    candidateStatus: null,
    staleReason: null,
    closedReason: null,
    openedAt: record.requestedAt,
    readOnly: false,
    actions: ['answer'],
  };
}

/** One Goal's whole request collection, all states; the adapter caches the assembled set per attempt. */
async function readAllRequests(
  reads: ReworkRequestCardReads, ctx: CoreCallContext, goalRef: GoalRef,
): Promise<ReadResult<readonly ReworkRequestV1[]>> {
  const items: ReworkRequestV1[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await reads.listByGoal(ctx, {
      goalRef, page: { limit: REQUEST_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
    });
    if (page.status !== 'ready') return page;
    items.push(...page.value.items);
    const next = page.value.nextCursor;
    if (next === null) return { status: 'ready', value: items };
    cursor = next;
  }
}

/** Only the two handled states close; `applied` belongs to the saved-answer overlay, and a pending
 * request is open. This is the one rule DR-07/DR-08 mutate. */
export function reworkRequestClosedReason(record: PendingReworkRequestV1): DecisionCardV1['closedReason'] {
  return record.state === 'rejected' || record.state === 'stale' ? 'source_resolved' : null;
}

/** Builds the one `createCollectionCardSource` spec the views registration wraps. */
export function reworkRequestCardSourceSpec(reads: ReworkRequestCardReads): ReworkRequestCardSourceSpec {
  return {
    kind: 'rework_request',
    serves: ['goal'],
    async readCollection(ctx, { subject }) {
      const goalRef = decisionSubjectGoalRef({ subject });
      if (goalRef === null) {
        return rejectedWithCurrent('invalid', 'a rework_request card source needs a Goal');
      }
      return readAllRequests(reads, ctx, goalRef);
    },
    keyOf: (record) => decisionSourceKey({ kind: 'rework_request', requestRef: record.ref }),
    closedReasonOf: reworkRequestClosedReason,
    project: projectReworkRequestCard,
    async readByKey(ctx, { source }) {
      const goalRef = decisionSubjectGoalRef(source);
      const requestRef = requestRefFromKey(source.key);
      if (goalRef === null || requestRef === null) return { status: 'ready', value: null };
      if (requestRef.projectId !== goalRef.projectId || requestRef.goalId !== goalRef.goalId) {
        return { status: 'ready', value: null };
      }
      const read = await reads.readRequest(ctx, { ref: requestRef });
      if (read.status === 'not_found') return { status: 'ready', value: null };
      if (read.status !== 'ready') return read;
      const record = read.value;
      const closed = reworkRequestClosedReason(record);
      return closed === null
        ? { status: 'ready', value: { item: record } }
        : { status: 'ready', value: { closed, openedAt: record.requestedAt } };
    },
  };
}

/** L1's switch arm target: the same card projection as branch facts (`SourceReadResult`). */
export async function readReworkRequestSource(
  support: SourceReadSupport,
  ctx: CoreCallContext,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'rework_request' }>,
  deps: ReworkRequestSourceDependencies,
  goalRef: GoalRef,
): Promise<SourceReadResult> {
  const requestProblem = support.scopeProblem(identity.requestRef);
  if (requestProblem !== null) return requestProblem;
  const goalProblem = support.scopeProblem(goalRef);
  if (goalProblem !== null) return goalProblem;
  const goalRead = await support.readGoal(goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  const goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId
    || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the rework_request source Goal is outside the bound scope');
  }
  if (deps.reworkRequests === undefined) {
    return rejectedWithCurrent('unavailable', 'the rework request reader is not bound for a rework_request source');
  }
  const read = await deps.reworkRequests.readRequest(ctx, { ref: identity.requestRef });
  if (read.status === 'not_found') return rejectedWithCurrent('not_found', 'the rework request does not exist');
  if (read.status !== 'ready') return read.status === 'rejected' ? read
    : rejectedWithCurrent('unavailable', 'the rework request is not readable');
  const record = read.value;
  if (record.ref.goalId !== goal.ref.goalId || record.ref.projectId !== support.scope.projectId) {
    return rejectedWithCurrent('invalid', 'the rework request belongs to another Goal');
  }
  const card = projectReworkRequestCard(record, { kind: 'goal', goalRef }, goal);
  const closed = reworkRequestClosedReason(record) !== null;
  const pins = card.source.pins;
  const goalBases: GoalDecisionBasisV1[] = (card.source.goalBases ?? []).map((basis) => structuredClone(basis));
  return { status: 'ready', value: {
    goal,
    objects: card.objects.map((object) => structuredClone(object)),
    options: closed ? [] : card.options.map((option) => structuredClone(option)),
    pins,
    goalBases,
    closed,
    allowedReaderSessionRefs: [],
  } };
}
