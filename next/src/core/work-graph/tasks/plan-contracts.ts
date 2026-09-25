/** R3c plan/task slice. WorkGraph owns the rules; the Store owns atomic bytes. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { TaskTriple, TaskAttemptRef, RunRef, TaskEligibility } from '../../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, VersionedRef } from '../../../contracts/ledger.js';
import type { PlanProposalSnapshot } from '../../../contracts/goal-change.js';
import type { DependencyRequirement, Disposition, Phase, PlanRevisionDraft, PlanRevisionRef,
  PlanRevisionSnapshot, PlanValidationError, RuntimeTask, TaskInputRequirementV2,
  TaskRelationV2 } from '../../../contracts/plan.js';
import type { GraphWrite } from './contracts.js';

/** Same full identity as legacy PlanProposal@1; schema v2 has a distinct body. */
export type PlanProposalRef = { aggregateType: 'PlanProposal'; projectId: string;
  workspaceId: string; proposalId: string };
export type PlanChangeReason = { text: string; sources: ArtifactRef[] };
export type PlanProposal =
  | { kind: 'candidate_v2'; ref: PlanProposalRef; revision: number; schemaVersion: 2;
      goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
      reason: PlanChangeReason; status: 'candidate' | 'accepted' | 'rejected';
      issues: PlanValidationError[] }
  | { kind: 'legacy_v1'; ref: PlanProposalRef; revision: 1; schemaVersion: 1;
      goalRef: GoalRef; basedOn: PlanRevisionRef; draft: null;
      legacy: PlanProposalSnapshot; status: 'candidate'; issues: PlanValidationError[] };
export type GoalDetail = { goal: GoalSnapshot; pendingPlan: PlanProposal | null };
export type TaskRow = { ref: TaskTriple; definition: RuntimeTask; effectivePhase: Phase;
  disposition: Disposition; currentAttempt: TaskAttemptRef | null; execution: RunRef | null;
  eligibilityScope: 'task_state'; eligibility: TaskEligibility;
  /** Advisory links only; they do not grant material access or block candidacy. */
  relations: TaskRelationV2[];
  /** Exact v2 inputs. Graph/ready reads never open material and report not_checked. */
  inputRequirements: { requirement: TaskInputRequirementV2; verification: 'not_checked' }[];
  /** V1 hard-edge labels have no exact identity; no availability is inferred. */
  legacyDependencies: { dependsOnId: string; requires: DependencyRequirement;
    verification: 'legacy_unverifiable' }[];
};
export type TaskGraph = { plan: PlanRevisionSnapshot; tasks: TaskRow[]; sourceCursor: CommitCursor };
export type ReadyTask = { task: TaskRow; planRef: PlanRevisionRef; expected: VersionPin[] };
export type TaskPage = { items: ReadyTask[]; nextCursor: string | null; sourceCursor: CommitCursor };
export type PlanPageRequest = { limit: number; cursor?: string; atLeastCursor?: CommitCursor };

export interface PlanTaskPort {
  queryGoal(ctx: CoreCallContext, ref: GoalRef): Promise<ReadResult<GoalDetail>>;
  readPlanProposal(ctx: CoreCallContext, ref: PlanProposalRef): Promise<ReadResult<PlanProposal>>;
  proposePlan(ctx: CoreCallContext, request: GraphWrite<{ goalRef: GoalRef;
    basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
    reason: PlanChangeReason }>): Promise<WriteResult<PlanProposal>>;
  applyPlanChange(ctx: CoreCallContext, request: GraphWrite<{ proposalRef: PlanProposalRef;
    expectedProposalRevision: number; decisionRefs: VersionedRef[] }>): Promise<WriteResult<PlanRevisionSnapshot>>;
  queryTaskGraph(ctx: CoreCallContext, input: { goalRef: GoalRef; planRef?: PlanRevisionRef;
    atLeastCursor?: CommitCursor }): Promise<ReadResult<TaskGraph>>;
  queryReadyTasks(ctx: CoreCallContext, input: { goalRef: GoalRef; roleIds?: string[];
    includeBlocked: boolean; page: PlanPageRequest }): Promise<ReadResult<TaskPage>>;
  /** Reads the exact artifact pinned by an accepted v2 Plan for this task.
   * Uses MaterialPort.openArtifact(current); its real reader, grant and source
   * failures are preserved. No caller-supplied ArtifactRef may replace the pin. */
  readTaskInput(ctx: CoreCallContext, input: { goalRef: GoalRef; planRef: PlanRevisionRef;
    taskId: string; requirementId: string }): Promise<ReadResult<ArtifactRecord>>;
}
