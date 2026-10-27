import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1, GoalDecisionBasisV1,
  PlanningQuestionIdentityV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import { isRecord } from '../../../../contracts/validation/common.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import type { InitializationBindingReadPort } from '../../model/goal-card-contracts.js';
import { decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot,
  decodeQueryRunSnapshotRecord } from '../../queries/query-record-codecs.js';
import { parseInitialPlanningResponseV2 } from '../../tasks/initial-plan.js';
import { goalBasis, sameJson } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/**
 * §4.6 line 915: the QueryRun's formal Session is the planning question's
 * reader fact, when saved. The saved answer's `runRef` is a REQUIRED formal
 * fact (the QueryJobAnswer codec refuses a missing one), so a missing or
 * damaged QueryRun is a read failure returned to the caller
 * (`unavailable`/`incomplete`) — never silently folded into an empty reader
 * set, which would make the asking Session `forbidden` instead of
 * `unavailable`. A readable QueryRun that genuinely carries no
 * Session stays an empty reader list.
 */
async function questionReaderSessions(support: SourceReadSupport, runRef: unknown): Promise<ReadResult<SessionRef[]>> {
  if (!isRecord(runRef)) {
    return rejectedWithCurrent('unavailable', 'the planning QueryJobAnswer names no formal QueryRun');
  }
  const read = await support.readDecoded(runRef, decodeQueryRunSnapshotRecord, 'QueryRun');
  if (read.status !== 'ready') {
    return read.status === 'rejected' && read.code === 'not_found'
      ? rejectedWithCurrent('unavailable', 'the planning question QueryRun record does not exist')
      : read;
  }
  const sessionRef = read.value.run.executionState?.sessionRef;
  return { status: 'ready', value: sessionRef === undefined
    ? [] : [{ projectId: sessionRef.projectId, sessionId: sessionRef.sessionId }] };
}

/** The `planning_question` decision source: a real saved Answer question. A binding source takes its Goal from the
 * binding (guarded against the subject's Goal) and admits a no-Goal Job; without a binding the Job must name the Goal. */
export async function readPlanningQuestionSource(
  support: SourceReadSupport,
  ctx: CoreCallContext,
  identity: PlanningQuestionIdentityV1,
  goalRef: GoalRef,
  bindings: InitializationBindingReadPort,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  let allowedReaderSessionRefs: SessionRef[] = [];
  const answerProblem = support.scopeProblem(identity.answerRef);
  if (answerProblem !== null) return answerProblem;
  const answerRead = await support.readDecoded(identity.answerRef, decodeQueryJobAnswerSnapshot, 'QueryJobAnswer');
  if (answerRead.status !== 'ready') return answerRead;
  const answer = answerRead.value;
  const jobRead = await support.readDecoded(answer.answer.queryJobRef, decodeQueryJobSnapshot, 'QueryJob');
  if (jobRead.status !== 'ready') return jobRead;
  const job = jobRead.value;
  const jobGoalId = job.job.goalId;
  // A binding card's Goal is the binding's, never the Job's; the answer must still be the Job's own, and a missing read/record is unavailable/not_found.
  let bindingPin: VersionPin | null = null;
  if (identity.binding === undefined) {
    if (jobGoalId === null || jobGoalId.length === 0) return rejectedWithCurrent('incomplete', 'the planning QueryJob names no Goal');
    if (goalRef.goalId !== jobGoalId || goalRef.projectId !== support.scope.projectId) {
      return rejectedWithCurrent('invalid', 'the planning question does not belong to the named Goal');
    }
  } else {
    const bindingRead = await bindings.readBindingByAnswerDraft(ctx,
      { answerRef: identity.answerRef, draftIndex: identity.binding.draftIndex });
    if (bindingRead.status === 'not_found') {
      return rejectedWithCurrent('not_found', 'the initialization binding for this answer and draft does not exist');
    }
    if (bindingRead.status !== 'ready') return bindingRead;
    if (!sameJson(bindingRead.value.ref, identity.binding)) {
      return rejectedWithCurrent('invalid', 'the stored initialization binding is not the named binding');
    }
    if (!sameJson(bindingRead.value.goalRef, goalRef)) {
      return rejectedWithCurrent('invalid', 'the initialization binding belongs to another Goal');
    }
    bindingPin = { ref: structuredClone(identity.binding), revision: 1 };
  }
  const goalRead = await support.readGoal(goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the planning question Goal is outside the bound scope');
  }
  if (job.job.status !== 'answered'
    || !job.job.answerRefs.some((ref) => sameJson(ref, identity.answerRef))) {
    return rejectedWithCurrent('not_found', 'the planning question has no saved formal answer');
  }
  const parsed = parseInitialPlanningResponseV2(answer.answer.answer);
  if (parsed.status !== 'parsed' || parsed.response.kind !== 'needs_decision'
    || !Number.isSafeInteger(identity.questionIndex) || identity.questionIndex < 0
    || identity.questionIndex >= parsed.response.questions.length) {
    return rejectedWithCurrent('not_found', 'the named planning question does not exist');
  }
  pins = [{ ref: structuredClone(goal.ref), revision: goal.revision },
    { ref: structuredClone(identity.answerRef), revision: 1 },
    { ref: structuredClone(job.ref), revision: job.revision }];
  if (bindingPin !== null) pins.push(bindingPin);
  objects = [];
  options = [];
  goalBases = [goalBasis(goal)];
  closed = goal.desiredState === 'cancelled';
  const readerSessions = await questionReaderSessions(support, answer.answer.runRef);
  if (readerSessions.status !== 'ready') return readerSessions;
  allowedReaderSessionRefs = readerSessions.value;
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
