import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import { decodeRun } from '../../materials/run-snapshot-decoder.js';
import { readTaskClosure } from '../../tasks/plan-readers.js';
import { UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX, unknownCallReviewCardFacts,
  unknownCallReviewTargetPaths } from '../../tasks/unknown-call-review-card.js';
import { readReviewTargetDigests } from '../../tasks/unknown-call-review-target-digests.js';
import { clonePins } from './read-support.js';
import type { SourceDependencies, SourceReadResult, SourceReadSupport } from './types.js';

/** The `unknown_call_review` decision source: the real review record and the original Run. */
export async function readUnknownCallReviewSource(
  support: SourceReadSupport,
  ctx: CoreCallContext,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'unknown_call_review' }>,
  deps: SourceDependencies,
  goalRef: GoalRef,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  let allowedReaderSessionRefs: SessionRef[] = [];
  // Re-derive the whole card from the real record, the original
  // Run snapshot and the Goal's current plan window. The caller's pins
  // are never trusted.
  const reviewProblem = support.scopeProblem(identity.reviewRef);
  if (reviewProblem !== null) return reviewProblem;
  const goalProblem = support.scopeProblem(goalRef);
  if (goalProblem !== null) return goalProblem;
  const goalRead = await support.readGoal(goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the review source Goal is outside the bound scope');
  }
  if (deps.unknownCallReviews === undefined) {
    return rejectedWithCurrent('unavailable', 'no UnknownCallReview reader is bound for an unknown_call_review source');
  }
  const reviewRead = await deps.unknownCallReviews.readReview(ctx, { ref: identity.reviewRef });
  if (reviewRead.status === 'not_found') return rejectedWithCurrent('not_found', 'the review record does not exist');
  if (reviewRead.status !== 'ready') return reviewRead;
  const record = reviewRead.value;
  if (record.revision !== identity.revision) {
    return rejectedWithCurrent('revision_conflict', 'the review record moved since the card was read',
      [{ ref: structuredClone(record.ref), revision: record.revision }]);
  }
  if (record.task.goalId !== goal.ref.goalId) {
    return rejectedWithCurrent('invalid', 'the review record belongs to another Goal');
  }
  const runRead = await support.readEncoded(record.runRef);
  if (!runRead.ok) return runRead.rejection;
  const decodedRun = decodeRun(runRead.record);
  if (!decodedRun.ok) {
    return rejectedWithCurrent('unavailable', `the original Run snapshot is damaged: ${decodedRun.reason}`);
  }
  // The ONE canonical Task closure (satisfied/cancelled/
  // superseded), not the Plan disposition. A read failure is rejected.
  const closure = await readTaskClosure(support.records, goal.ref, record.task.taskId);
  if (closure.status !== 'ready') return closure;
  const fileDigests = await readReviewTargetDigests(ctx, deps.workspace,
    unknownCallReviewTargetPaths(record).slice(0, UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX));
  const facts = unknownCallReviewCardFacts({ record, goal, run: decodedRun.value,
    taskActive: !closure.value.closed, fileDigests });
  pins = clonePins(facts.source.pins);
  objects = facts.objects.map((object) => structuredClone(object));
  options = facts.closedReason === null ? facts.options.map((option) => structuredClone(option)) : [];
  goalBases = (facts.source.goalBases ?? []).map((basis) => structuredClone(basis));
  closed = facts.closedReason !== null;
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
