import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalSnapshot } from '../../../../contracts/ledger.js';
import type { PlanProposal } from '../../model/plan-contracts.js';
import { readProposal, readRequestCandidateHead } from '../../tasks/plan-readers.js';
import { goalBasis } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/** The `candidate` decision source: the real per-request head or the named proposal. */
export async function readCandidateSource(
  support: SourceReadSupport,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'candidate' }>,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  let allowedReaderSessionRefs: SessionRef[] = [];
  const goalProblem = support.scopeProblem(identity.goalRef);
  if (goalProblem !== null) return goalProblem;
  const goalRead = await support.readGoal(identity.goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the decision source Goal is outside the bound scope');
  }
  let proposal: PlanProposal | null;
  if ('requestRef' in identity) {
    if (identity.requestRef.projectId !== goal.ref.projectId
      || identity.requestRef.workspaceId !== goal.workspaceRef.workspaceId) {
      return rejectedWithCurrent('forbidden', 'the candidate request belongs to another Goal scope');
    }
    const head = await readRequestCandidateHead(support.records, { goalRef: goal.ref, requestRef: identity.requestRef });
    if (head.status !== 'ready') return head;
    proposal = head.head;
  } else {
    const named = await readProposal(support.records, identity.proposalRef);
    if (named.status !== 'ready') return named;
    proposal = named.proposal;
  }
  if (proposal === null || proposal.kind !== 'candidate_v2'
    || proposal.status === 'accepted' || proposal.status === 'rejected') {
    return rejectedWithCurrent('not_found', 'the candidate decision source no longer exists');
  }
  if (proposal.goalRef.projectId !== goal.ref.projectId || proposal.goalRef.goalId !== goal.ref.goalId) {
    return rejectedWithCurrent('not_found', 'the candidate decision source belongs to another Goal');
  }
  pins = [{ ref: structuredClone(goal.ref), revision: goal.revision },
    { ref: structuredClone(proposal.ref), revision: proposal.revision }];
  if (proposal.basedOn !== null) {
    pins.push({ ref: structuredClone(proposal.basedOn), revision: 1 });
  }
  objects = pins.map((pin) => ({ kind: 'aggregate' as const, pin: structuredClone(pin), label: 'candidate' }));
  options = [];
  goalBases = [goalBasis(goal)];
  closed = goal.desiredState === 'cancelled' || proposal.status === 'not_adopted';
  // §4.6 line 915: the candidate's formal saved proposer is the Agent
  // work_run that submitted it; without one there is no reader Session.
  const submittedBy = proposal.submittedBy;
  allowedReaderSessionRefs = submittedBy === undefined ? [] : [{
    projectId: submittedBy.sessionRef.projectId, sessionId: submittedBy.sessionRef.sessionId,
  }];
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
