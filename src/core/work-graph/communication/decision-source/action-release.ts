import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import { actionRequestCodec } from '../../tasks/action-request-codecs.js';
import { actionRequestCardFacts } from '../../tasks/action-request-card.js';
import { clonePins } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/**
 * The `action_release` decision source: the persisted `ActionRequest` (dispatch or stop), its Goal and the card's own
 * facts. The derived block is the read's DTO, not a source fact, so the branch facts never carry it.
 */
export async function readActionReleaseSource(
  support: SourceReadSupport,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'action_release' }>,
  goalRef: GoalRef,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  const allowedReaderSessionRefs: SessionRef[] = [];
  // The key carries the request's creation revision; another revision names no card.
  if (identity.revision !== 1) {
    return rejectedWithCurrent('invalid', 'an action_release source key carries the creation revision');
  }
  const requestProblem = support.scopeProblem(identity.requestRef);
  if (requestProblem !== null) return requestProblem;
  const goalProblem = support.scopeProblem(goalRef);
  if (goalProblem !== null) return goalProblem;
  const goalRead = await support.readGoal(goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId
    || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the action release Goal is outside the bound scope');
  }
  const read = await support.readDecoded(identity.requestRef, actionRequestCodec.decode, 'action request');
  if (read.status !== 'ready') return read;
  const request = read.value;
  // The request's own Task names the card's Goal; a request of another Goal is not this source.
  if (request.ref.projectId !== goal.ref.projectId || request.ref.goalId !== goal.ref.goalId
    || request.task.goalId !== goal.ref.goalId) {
    return rejectedWithCurrent('forbidden', 'the action request does not belong to the decision source Goal');
  }
  if (request.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the action request is outside the bound scope');
  }
  const facts = actionRequestCardFacts({ request, goal });
  pins = clonePins(facts.source.pins);
  objects = facts.objects.map((object) => structuredClone(object));
  options = facts.options.map((option) => structuredClone(option));
  goalBases = (facts.source.goalBases ?? []).map((basis) => structuredClone(basis));
  closed = facts.closedReason !== null;
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
