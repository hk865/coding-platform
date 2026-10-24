import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  DecisionSourceV1, GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import { isRecord } from '../../../../contracts/validation/common.js';
import type { GoalSnapshot } from '../../../../contracts/ledger.js';
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

/** The `planning_question` decision source: a real saved Answer question. */
export async function readPlanningQuestionSource(
  support: SourceReadSupport,
  source: DecisionSourceV1,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'planning_question' }>,
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
  if (jobGoalId === null || jobGoalId.length === 0) return rejectedWithCurrent('incomplete', 'the planning QueryJob names no Goal');
  if (source.goalRef.goalId !== jobGoalId || source.goalRef.projectId !== support.scope.projectId) {
    return rejectedWithCurrent('invalid', 'the planning question does not belong to the named Goal');
  }
  const goalRead = await support.readGoal(source.goalRef);
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
  objects = [];
  options = [];
  goalBases = [goalBasis(goal)];
  closed = goal.desiredState === 'cancelled';
  const readerSessions = await questionReaderSessions(support, answer.answer.runRef);
  if (readerSessions.status !== 'ready') return readerSessions;
  allowedReaderSessionRefs = readerSessions.value;
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
