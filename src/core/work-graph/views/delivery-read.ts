/**
 * The delivery page's read (decision 121-45, acc): one join, no reduction.
 *
 * ACC-08 order: the Goal display (`queryGoalDisplay`, reused), the current GoalPhase revision, the acceptance record
 * keyed by that revision, the node review rows (`readNodeRows`, reused) and the secretary (`resolveDutyRecipient`,
 * reused). ACC-09: the acceptance is returned only while that GoalPhase is the completed one of the Goal's active
 * Plan; no GoalPhase, a Goal not completed, or a Plan the active Plan has replaced all read `null`, and a new Plan is
 * a new delivery. Any failed read is returned unchanged: never a partial page and never an old record.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalDeliveryAcceptanceV1 } from '../../../contracts/goal-delivery.js';
import type { GoalPhaseRef } from '../../../contracts/goal-phase.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { GoalDeliveryPort } from '../model/goal-delivery-contracts.js';
import type { GoalDisplayRead } from '../model/plan-contracts.js';
import type { TaskNodeCommitPort, TaskNodeReviewRowV1 } from '../model/task-node-commit-contracts.js';
import type { DutyRecipientPort } from '../sessions/duty-recipient.js';
import { goalDeliveryProblem } from '../state/goal-delivery.js';
import { readGoalPhase } from '../tasks/plan-readers.js';

/** The delivery page's one value: the Goal, its display, the current completion's acceptance, the node rows and the
 *  secretary. `phaseRevision: null` means no GoalPhase; the page then pins the Goal alone. */
export type GoalDeliveryReadV1 = {
  goal: GoalSnapshot;
  display: GoalDisplayRead['display'];
  /** The current GoalPhase revision; null when no GoalPhase exists. The page pins Goal@goal.revision and GoalPhase@phaseRevision. */
  phaseRevision: number | null;
  acceptance: GoalDeliveryAcceptanceV1 | null;
  nodes: TaskNodeReviewRowV1[];
  secretary: SessionRef | null;
};

export interface GoalDeliveryReadPort {
  readGoalDelivery(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GoalDeliveryReadV1>>;
}

/** The owners this join reads: the Goal display, the delivery acceptance, the node rows, the secretary, and the
 *  records `readGoalPhase` reads the current GoalPhase through. */
export type GoalDeliveryReadDependencies = {
  readGoalDisplay: (ctx: CoreCallContext, input: { goalRef: GoalRef }) => Promise<ReadResult<GoalDisplayRead>>;
  delivery: GoalDeliveryPort;
  nodeCommits: Pick<TaskNodeCommitPort, 'readNodeRows'>;
  duties: Pick<DutyRecipientPort, 'resolveDutyRecipient'>;
  records: GoalRecordTransactionPort;
};

export function createGoalDeliveryRead(deps: GoalDeliveryReadDependencies): GoalDeliveryReadPort {
  async function readGoalDelivery(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<GoalDeliveryReadV1>> {
    const displayRead = await deps.readGoalDisplay(ctx, input);
    if (displayRead.status !== 'ready') return displayRead;
    const { goal, display } = displayRead.value;

    const phaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId: input.goalRef.projectId,
      goalId: input.goalRef.goalId };
    const phaseRead = await readGoalPhase(deps.records, phaseRef);
    if (phaseRead.status !== 'ready') return phaseRead;
    const phase = phaseRead.snapshot;
    let acceptance: GoalDeliveryAcceptanceV1 | null = null;
    if (phase !== null) {
      const acceptanceRead = await deps.delivery.readAcceptance(ctx,
        { goalRef: input.goalRef, phaseRevision: phase.revision });
      if (acceptanceRead.status !== 'ready') return acceptanceRead;
      // ACC-09: the ONE current-delivery predicate (completed phase + its Plan is the active Plan); a new Plan
      // makes the old acknowledgement not the new delivery's.
      if (goalDeliveryProblem(goal, phase) === null) acceptance = acceptanceRead.value;
    }

    const nodesRead = await deps.nodeCommits.readNodeRows(ctx, { goalRef: input.goalRef });
    if (nodesRead.status !== 'ready') return nodesRead;

    const secretaryRead = await deps.duties.resolveDutyRecipient(ctx,
      { workspace: goal.workspaceRef, duty: 'secretary' });
    if (secretaryRead.status !== 'ready') return secretaryRead;

    return { status: 'ready', value: {
      goal,
      display,
      phaseRevision: phase === null ? null : phase.revision,
      acceptance,
      nodes: nodesRead.value.rows,
      secretary: secretaryRead.value,
    } };
  }
  return { readGoalDelivery };
}
