/** R3c plan/task slice. WorkGraph owns the rules; the Store owns atomic bytes. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { TaskTriple, TaskAttemptRef, RunRef, RoleBindingRefV1, TaskEligibility } from '../../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, VersionedRef } from '../../../contracts/ledger.js';
import type { GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { PlanProposalSnapshot } from '../../../contracts/goal-change.js';
import type { QueryJobAnswerRef } from '../../../contracts/query-job.js';
import type { DependencyRequirement, Disposition, Phase, PlanRevisionDraft, PlanRevisionRef,
  PlanRevisionSnapshot, PlanValidationError, RuntimeTask, TaskInputRequirementV2,
  TaskRelationV2 } from '../../../contracts/plan.js';
import type { GraphWrite } from './contracts.js';

/**
 * Versioned Agent submission provenance (W2 §8.1).
 *
 * The runtime produces this; candidate input never supplies it. It records the
 * exact formal Run/Session/Role binding and the two authorization generations
 * the write was admitted against. `authorizationRevision` is the entry
 * binding's own revision, never the Run revision. A candidate without this
 * field stays readable/adoptable by the Host under the legacy path and must
 * never be inferred to have an Agent author.
 */
export type PlanWriteProvenanceV1 = {
  schemaVersion: 1;
  runRef: RunRef;
  sessionRef: SessionRef;
  roleBinding: RoleBindingRefV1;
  sessionGeneration: number;
  entryGeneration: number;
  authorizationRevision: number;
  configurationRevision: string;
};
/** Same full identity as legacy PlanProposal@1; schema v2 has a distinct body. */
export type PlanProposalRef = { aggregateType: 'PlanProposal'; projectId: string;
  workspaceId: string; proposalId: string };
export type PlanChangeReason = { text: string; sources: ArtifactRef[] };
export type PlanProposal =
  | { kind: 'candidate_v2'; ref: PlanProposalRef; revision: number; schemaVersion: 2;
      goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
      reason: PlanChangeReason; status: 'candidate' | 'accepted' | 'rejected';
      issues: PlanValidationError[];
      /** W2 Agent branch only; absent on every legacy/Host candidate. */
      submittedBy?: PlanWriteProvenanceV1 }
  | { kind: 'legacy_v1'; ref: PlanProposalRef; revision: 1; schemaVersion: 1;
      goalRef: GoalRef; basedOn: PlanRevisionRef; draft: null;
      legacy: PlanProposalSnapshot; status: 'candidate'; issues: PlanValidationError[] };
export type GoalDetail = { goal: GoalSnapshot; pendingPlan: PlanProposal | null };
/**
 * 只读规划诊断（W2 §4.2）。它由已采用的 Plan + canonical task facts 在内存投影，
 * 不写入 Task/Goal 的运行状态，也不是第二套持久 completeness 表；缺省表示该生产者
 * 尚未提供此投影，不等于“没有缺口”。诊断不执行验证工具、不打开材料、不模拟
 * evidence reduction，也不重新读取治理政策。
 */
export type TaskPlanningDiagnostic = {
  code: 'planning_only' | 'acceptance_not_defined';
  taskId: string;
  message: string;
};
export type GoalPlanningDiagnostic = TaskPlanningDiagnostic | {
  code: 'required_task_unfinished';
  taskId: string;
  message: string;
} | {
  code: 'goal_acceptance_not_defined' | 'goal_gate_not_defined';
  message: string;
};
/** `not_evaluated` 是能力边界字面值，不是新 Goal 状态：即使 diagnostics 为空也
 * 不返回 canComplete/completed，不证明证据、来源或正式归约已经满足。 */
export type GoalPlanningView = {
  completionEvaluation: 'not_evaluated';
  diagnostics: GoalPlanningDiagnostic[];
};
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
  /** 兼容可选；缺省表示该生产者尚未提供投影，不等于无缺口。 */
  planningDiagnostics?: TaskPlanningDiagnostic[];
};
/**
 * R3e.3 formal Goal completion projection. It is INDEPENDENT of the advisory
 * `planning` view: `planning` explains intent gaps, while this reports the
 * formal adopted `GoalPhaseSnapshot@1` (or its confirmed absence) and whether
 * the selected Plan is exactly the Plan the completion was reduced against.
 */
export type GoalCompletionView =
  | { status: 'not_recorded' }
  | { status: 'recorded'; snapshot: GoalPhaseSnapshot; selectedPlanMatches: boolean };
export type TaskGraph = { plan: PlanRevisionSnapshot; tasks: TaskRow[]; sourceCursor: CommitCursor;
  /** 兼容可选；Goal 级完成解释基于同一次已读 Plan + canonical tasks。 */
  planning?: GoalPlanningView;
  /** 兼容可选；正式 Goal 完成投影，缺省表示该生产者尚未提供，不等于未完成。 */
  completion?: GoalCompletionView };
export type ReadyTask = { task: TaskRow; planRef: PlanRevisionRef; expected: VersionPin[] };
export type TaskPage = { items: ReadyTask[]; nextCursor: string | null; sourceCursor: CommitCursor };
export type PlanPageRequest = { limit: number; cursor?: string; atLeastCursor?: CommitCursor };

/**
 * R5b.4 §11.2 explicit initial-planning decision. It returns ONLY the questions
 * the formal answer actually raised; it carries no candidate, writes nothing and
 * invents no Decision. `needs_decision` is not the normal gate before adoption.
 */
export type InitialPlanDecision = {
  status: 'needs_decision';
  answerRef: QueryJobAnswerRef;
  summary: string;
  questions: string[];
};

/** The one thin initial-plan consumer result: the SAME candidate_v2 writer, or
 * the answer's explicit questions. It is never a shadow proposal/Plan type. */
export type InitialPlanProposalResult = WriteResult<PlanProposal> | InitialPlanDecision;

export interface PlanTaskPort {
  queryGoal(ctx: CoreCallContext, ref: GoalRef): Promise<ReadResult<GoalDetail>>;
  readPlanProposal(ctx: CoreCallContext, ref: PlanProposalRef): Promise<ReadResult<PlanProposal>>;
  proposePlan(ctx: CoreCallContext, request: GraphWrite<{ goalRef: GoalRef;
    basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
    reason: PlanChangeReason }>): Promise<WriteResult<PlanProposal>>;
  applyPlanChange(ctx: CoreCallContext, request: GraphWrite<{ proposalRef: PlanProposalRef;
    expectedProposalRevision: number; decisionRefs: VersionedRef[] }>): Promise<WriteResult<PlanRevisionSnapshot>>;
  /**
   * R5b.4 §11.2 the ONE thin consumer of a formal `initial_coordination` answer.
   * It accepts no caller draft/origin/assignments/digest: the candidate is the
   * unique v2 normalization of the real persisted Answer/Job/Run/body. The model
   * branch reuses the existing `proposePlan` commit and receipt; `needs_decision`
   * returns the original questions with no write. Stage one declares this seam
   * and leaves the algorithm explicitly unsupported. The `initial-planning`
   * `initialPlanning.bodies` dependency only reads the QueryRun's prepared body.
   * Optional only so the older read-only `PlanTaskPort` doubles that predate this
   * batch keep compiling; the real Plan service always publishes it.
   */
  proposeInitialPlanFromAnswer?(ctx: CoreCallContext, request: GraphWrite<{
    answerRef: QueryJobAnswerRef; reason: PlanChangeReason
  }>): Promise<InitialPlanProposalResult>;
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

/**
 * The REAL Plan service surface. `PlanTaskPort` keeps the seam optional only for
 * the older read-only Port doubles; `createPlanService` always publishes it, so
 * the composition root and every real consumer see the required method.
 */
export type PlanServicePort = PlanTaskPort & Required<Pick<PlanTaskPort, 'proposeInitialPlanFromAnswer'>>;
