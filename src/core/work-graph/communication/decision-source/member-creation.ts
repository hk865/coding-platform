/**
 * The `member_creation` decision source: the stored member operation, re-read by identity and
 * proved against the Goal it names. It is the one pure projector of the member card's facts, so the queue source and
 * this answerability read cannot disagree.
 *
 * `closedReasonOf` keeps the history shape: `done`, `rejected` and `stale` are resolved; the card source still lists
 * them (a person may read why), and only the three in-memory readers filter stage differently. `openedAt` is the
 * operation's own requested time, never the read's clock.
 */
import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1, DecisionSourceV1, GoalDecisionBasisV1,
} from '../../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import type { SessionOperationRecordOf } from '../../model/session-contracts.js';
import type { MemberCreateActionV1 } from '../../state/member-creation.js';
import { decodeSessionOperationRecord } from '../../sessions/session-record-codecs.js';
import { clonePins } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/** The record shell of one `member_create` operation: the frozen arm with the unchanged `CoreOperation` shell. */
export type MemberOperationRecordV1 = SessionOperationRecordOf<MemberCreateActionV1>;

export type MemberCreationCardFactsV1 = {
  source: DecisionSourceV1;
  operation: MemberOperationRecordV1;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  closedReason: 'source_resolved' | null;
  /** The operation's own requested time. */
  openedAt: string;
};

/** `done`/`rejected`/`stale` are the three terminal member stages; every other stage is still open. */
export function memberCreationClosedReason(
  operation: MemberOperationRecordV1,
): 'source_resolved' | null {
  const stage = operation.action.progress.stage;
  return stage === 'done' || stage === 'rejected' || stage === 'stale' ? 'source_resolved' : null;
}

/** The member operation's canonical identity: the operation ref alone. */
export function memberCreationSourceIdentity(
  operation: MemberOperationRecordV1,
): Extract<DecisionSourceIdentityV1, { kind: 'member_creation' }> {
  return { kind: 'member_creation', operationRef: structuredClone(operation.ref) };
}

/**
 * The one pure projection of a member operation onto its card facts. `goal` is the readable Goal for its basis; the
 * view's collection read passes it from the adapter's single Goal read, and the answerability branch passes the Goal it
 * already loaded.
 */
export function memberCreationCardFacts(
  operation: MemberOperationRecordV1,
  goal: GoalSnapshot | null,
): MemberCreationCardFactsV1 {
  const identity = memberCreationSourceIdentity(operation);
  const key = decisionSourceKey(identity);
  const pin: VersionPin = { ref: structuredClone(operation.ref), revision: operation.revision };
  const subject = { kind: 'goal' as const, goalRef: {
    aggregateType: 'Goal' as const,
    projectId: operation.action.input.scope.task.projectId,
    goalId: operation.action.input.scope.task.goalId,
  } };
  const closedReason = memberCreationClosedReason(operation);
  const source: DecisionSourceV1 = {
    kind: 'member_creation',
    key,
    subject,
    pins: [pin],
    goalBases: goal === null ? [] : [{
      goalRef: structuredClone(goal.ref),
      workspaceRef: structuredClone(goal.workspaceRef),
      objective: goal.objective,
      activePlanRef: structuredClone(goal.activePlanRevision),
      settings: structuredClone(goal.settings),
    } satisfies GoalDecisionBasisV1],
  };
  return {
    source,
    operation,
    objects: [{ kind: 'aggregate', pin: structuredClone(pin), label: '成员创建' }],
    options: closedReason === null
      ? [{ id: 'approve', label: '同意', effect: 'apply' },
        { id: 'reject', label: '拒绝', effect: 'reject' }]
      : [],
    closedReason,
    openedAt: operation.requestedAt,
  };
}

/**
 * The answerability branch: re-read the operation by identity, prove its Goal and Task, then rebuild the same facts the
 * card source projects. A missing/damaged operation is propagated, never an empty source.
 */
export async function readMemberCreationSource(
  support: SourceReadSupport,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'member_creation' }>,
  goalRef: GoalRef,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  const allowedReaderSessionRefs: SessionRef[] = [];
  const operationProblem = support.scopeProblem(identity.operationRef);
  if (operationProblem !== null) return operationProblem;
  const goalProblem = support.scopeProblem(goalRef);
  if (goalProblem !== null) return goalProblem;
  const goalRead = await support.readGoal(goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId
    || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the member source Goal is outside the bound scope');
  }
  const read = await support.readDecoded(identity.operationRef, decodeSessionOperationRecord, 'member operation');
  if (read.status !== 'ready') return read;
  const decodedOperation = read.value;
  if ((decodedOperation.action as { kind: string }).kind !== 'member_create') {
    return rejectedWithCurrent('invalid', 'the decision source operation is not a member creation');
  }
  const operation = decodedOperation as unknown as MemberOperationRecordV1;
  if (operation.ref.projectId !== goal.ref.projectId || operation.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the member operation is outside the bound scope');
  }
  const task = operation.action.input.scope.task;
  if (task.projectId !== goal.ref.projectId || task.goalId !== goal.ref.goalId) {
    return rejectedWithCurrent('invalid', 'the member operation names another Goal or Task');
  }
  const facts = memberCreationCardFacts(operation, goal);
  pins = clonePins(facts.source.pins);
  objects = facts.objects.map((object) => structuredClone(object));
  options = facts.options.map((option) => structuredClone(option));
  goalBases = (facts.source.goalBases ?? []).map((basis) => structuredClone(basis));
  closed = facts.closedReason !== null;
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
