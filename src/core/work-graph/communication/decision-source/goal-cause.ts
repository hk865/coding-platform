import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import { isRecord } from '../../../../contracts/validation/common.js';
import type { GoalSnapshot } from '../../../../contracts/ledger.js';
import type { PlanProposalRef } from '../../model/plan-contracts.js';
import type { GoalDecisionCauseReader } from '../../tasks/goal-decision-reader.js';
import { readProposal } from '../../tasks/plan-readers.js';
import { goalBasis, isAbsencePin } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/** §4.2 source 2: the concrete persisted "must decide" codes the reader can yield. */
const KNOWN_CAUSE_CODES: ReadonlySet<string> = new Set([
  'initial_plan_pending', 'change_pending', 'required_task_deferred',
  'auto_rework_count', 'auto_rework_pending',
  'auto_rework_cap_reached', 'no_new_basis', 'verification_uncovered',
  'budget_exhausted', 'not_reworkable', 'unknown_outcome', 'interrupted_pending_resume',
  'automation_confirmation_required',
  'missing_initial_architecture', 'missing_initial_completion_policy',
]);

/**
 * §4.2 source 2 / S5-MSG-03: prove a `goal_cause` source against the formal
 * reader. A cause that is absent is `not_found`; a read failure is returned
 * (`unavailable`/`forbidden`), never turned into "no such cause".
 */
async function verifyRealCause(
  ctx: CoreCallContext,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'goal_cause' }>,
  goalCauses: GoalDecisionCauseReader | null,
): Promise<ReadResult<never> | null> {
  if (goalCauses === null) return null;
  let read: Awaited<ReturnType<typeof goalCauses.readGoalDecisionCauses>>;
  try {
    read = await goalCauses.readGoalDecisionCauses(ctx, { goalRef: identity.goalRef });
  } catch {
    return rejectedWithCurrent('unavailable', 'the formal Goal causes could not be read');
  }
  if (read.status !== 'ready') {
    return read.status === 'rejected' ? read : rejectedWithCurrent('unavailable', 'the formal Goal causes are not readable');
  }
  const match = read.value.some((cause) => cause.source.key === decisionSourceKey(identity));
  if (!match) return rejectedWithCurrent('not_found', 'the named Goal cause does not exist');
  return null;
}

/** The `goal_cause` decision source: one real formal Goal cause and its affected objects. */
export async function readGoalCauseSource(
  support: SourceReadSupport,
  ctx: CoreCallContext,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'goal_cause' }>,
  goalCauses: GoalDecisionCauseReader | null,
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
  if (!KNOWN_CAUSE_CODES.has(identity.code)) {
    return rejectedWithCurrent('not_found', 'the named Goal cause does not exist');
  }
  const goalRead = await support.readGoal(identity.goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the decision source Goal is outside the bound scope');
  }
  // §4.2 source 2: with the formal reader injected, the (goalRef, code,
  // affected) identity must match one real derived cause.
  const realCause = await verifyRealCause(ctx, identity, goalCauses);
  if (realCause !== null) return realCause;
  for (const pin of identity.affected) {
    const pinProblem = support.scopeProblem(pin.ref);
    if (pinProblem !== null) return pinProblem;
    // §2.1: a revision-0 Task/virtual focus pin is not a stored record.
    if (isAbsencePin(pin)) continue;
    const pinRead = await support.readEncoded(pin.ref);
    if (!pinRead.ok) return pinRead.rejection;
    if (pinRead.record.revision !== pin.revision) {
      return rejectedWithCurrent('revision_conflict', 'a Goal cause affected object moved since the cause was read',
        [{ ref: structuredClone(pin.ref), revision: pinRead.record.revision }]);
    }
  }
  if (identity.code === 'missing_initial_architecture' || identity.code === 'missing_initial_completion_policy') {
    const active = identity.code === 'missing_initial_architecture'
      ? { aggregateType: 'ProjectArchitectureBaselineActive', projectId: support.scope.projectId }
      : { aggregateType: 'ProjectCompletionPolicyActive', projectId: support.scope.projectId };
    const read = await support.readEncoded(active);
    // Present = the cause has been resolved; a genuine read failure is
    // returned, never folded into "absent".
    if (read.ok) return rejectedWithCurrent('not_found', 'the named Goal cause has already been resolved');
    if (read.rejection.code !== 'not_found') return read.rejection;
  }
  if (identity.code === 'change_pending' || identity.code === 'initial_plan_pending') {
    // These causes are the real pending proposal; an affected proposal
    // that is absent or already resolved is not a live cause. A read
    // failure (`unavailable`) is returned unchanged.
    if (identity.affected.length !== 1) return rejectedWithCurrent('not_found', 'the pending Goal cause names no live proposal');
    const proposalRef = identity.affected[0]!.ref;
    if (!isRecord(proposalRef) || proposalRef['aggregateType'] !== 'PlanProposal') {
      return rejectedWithCurrent('not_found', 'the pending Goal cause does not name a proposal');
    }
    const proposal = await readProposal(support.records, proposalRef as unknown as PlanProposalRef);
    if (proposal.status !== 'ready') return proposal;
    if (proposal.proposal.status === 'accepted' || proposal.proposal.status === 'rejected') {
      return rejectedWithCurrent('not_found', 'the pending Goal cause proposal is already resolved');
    }
    if (proposal.proposal.goalRef.projectId !== goal.ref.projectId
      || proposal.proposal.goalRef.goalId !== goal.ref.goalId) {
      return rejectedWithCurrent('not_found', 'the pending Goal cause proposal belongs to another Goal');
    }
  }
  pins = [{ ref: structuredClone(goal.ref), revision: goal.revision },
    ...identity.affected.map((pin) => structuredClone(pin))];
  objects = identity.affected.map((pin) => ({
    kind: 'aggregate' as const, pin: structuredClone(pin), label: identity.code,
  }));
  options = [];
  goalBases = [goalBasis(goal)];
  closed = goal.desiredState === 'cancelled';
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
