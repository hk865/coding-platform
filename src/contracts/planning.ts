import type { AmendGoalRequestV1, PlanProposalV1 } from './goal-change.js';
import type { GoalRef, GoalSnapshot } from './ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from './plan.js';
import type { QueryJobAnswerRef, QueryJobAnswerV1, QueryJobSnapshot, SubmitQueryJobReceipt } from './query-job.js';
import type { AcceptedInitialPlan } from './initial-planning.js';

export type PlanningScope = { projectId: string; workspaceId: string; goalId: string };
type PlanningRejection = { status: 'rejected'; code: string; message: string };
export type InitialPlanningRequest = {
  schemaVersion: 1; kind: 'initial'; scope: PlanningScope;
  input: Record<string, unknown>; referenceContext?: string;
};
type InitialPlanningSubmission = {
  queryJobId: string; runId: string; status: 'planning'; executor: 'coding-agent';
  receipt: Extract<SubmitQueryJobReceipt, { status: 'committed' }>;
};
export type InitialPlanningRequestResult = { status: 'accepted'; submission: InitialPlanningSubmission } | PlanningRejection;
export type PlanningAcceptanceTrigger = { reason: string; resultRef?: QueryJobAnswerRef };
export type PlanningAcceptanceReport = {
  status: 'processed'; accepted: PlanRevisionRef[]; needsDecision: QueryJobAnswerRef[];
  issues: { resultRef: QueryJobAnswerRef; message: string }[];
} | PlanningRejection;

export type PlanProposalResult =
  | { status: 'proposal'; proposal: PlanProposalV1 }
  | { status: 'needs_material'; gaps: string[] }
  | PlanningRejection;

/** Existing amendment requests and durable initial coordination share one module.
 * accept discovers persisted results; callers never traverse private workflow state.
 * It requests admission from Control and never starts an implementation run. */
export interface PlanCompilerPort {
  /** Bounded amendment proposal; no Control write. */
  request(intent: AmendGoalRequestV1): Promise<PlanProposalResult>;
  /** Persist a read-only initial-coordination request through Control. */
  requestInitial(intent: InitialPlanningRequest): Promise<InitialPlanningRequestResult>;
  accept(trigger: PlanningAcceptanceTrigger): Promise<PlanningAcceptanceReport>;
}

export type InitialPlanningResultMaterial = { snapshot: QueryJobSnapshot; answer: QueryJobAnswerV1; resultRef: QueryJobAnswerRef };

/** Context-owned, read-only material selection. A ready result is evidence for
 * proposal construction; Control still checks canonical scope/version at commit. */
export interface PlanningMaterialPort {
  amendment(intent: AmendGoalRequestV1): Promise<
    { status: 'ready'; goal: GoalSnapshot; plan: PlanRevisionSnapshot } |
    { status: 'needs_material'; gaps: string[] } | PlanningRejection>;
  initialRequest(scope: PlanningScope, queryJobId: string): Promise<
    { status: 'ready'; goal: GoalSnapshot; prior: QueryJobSnapshot | null } | PlanningRejection>;
  initialResults(resultRef?: QueryJobAnswerRef): Promise<InitialPlanningResultMaterial[]>;
  initialPlan(ref: PlanRevisionRef): Promise<PlanRevisionSnapshot | null>;
  initialCurrentness(snapshot: QueryJobSnapshot): Promise<boolean>;
  acceptedInitialPlans(): Promise<AcceptedInitialPlan[]>;
}

import type { WorkContextRef } from './context-continuity.js';

/** Read-only identity evidence for a task in the proposal's source plan.
 * Absent means no binding exists; unavailable is never an empty answer. */
export type PlanningTaskWorkMaterial = {
  taskId: string;
  originTaskId: string;
} & (
  | { status: 'resolved'; workRef: WorkContextRef }
  | { status: 'absent' }
  | { status: 'unavailable'; reason: string }
);

export type PlanningContextRequest = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  planRef: PlanRevisionRef | null;
  budget: { maxBundleBytes: number };
};

export type PlanningContextRejectionCode = "invalid_request" | "forbidden_tool_or_scope" | "unavailable";

export type PlanningContextResult =
  | {
      status: "ready";
      bundleRef: import("./artifact.js").ArtifactRef;
      manifest: {
        selectedSources: string[];
        freshnessCursor: import("./command-event.js").CommitCursor | null;
        totalBytes: number;
      };
    }
  | { status: "needs_material"; gaps: string[] }
  | { status: "rejected"; code: PlanningContextRejectionCode; message: string };


/** Bounded planning material. This compiles sources; it does not run an Agent. */
export interface PlanningContextPort {
  assemblePlanningContext(request: PlanningContextRequest): Promise<PlanningContextResult>;
}
