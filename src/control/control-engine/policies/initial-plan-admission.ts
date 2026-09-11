import type { PlanRevisionDraft } from '../../../contracts/plan.js';
import type { QueryJobAnswerV1, QueryJobIntentV1 } from '../../../contracts/query-job.js';
import { initialPlanIdFor, parseInitialPlanningResponse, type InitialPlanOrigin } from '../../../contracts/initial-planning.js';
import { sha256Hex } from '../../../contracts/fingerprint.js';

/** Control-owned deterministic admission normalization. It binds the registered
 * public response to exact source versions and stable IDs, copying the model's
 * tasks/obligations/assignments without making semantic planning choices.
 * PlanCompiler uses the same policy to submit the candidate that Control will
 * recompute and compare at admission. Neither caller owns a second algorithm. */
export function normalizeInitialPlanProposal(intent: QueryJobIntentV1, answer: QueryJobAnswerV1): { status: 'plan'; plan: PlanRevisionDraft } | { status: 'needs_decision'; summary: string; questions: string[] } {
  if (intent.execution?.kind !== 'initial_coordination' || !intent.goalId || answer.stale || answer.queryJobRef.queryJobId !== intent.intentId || answer.queryJobRef.projectId !== intent.projectId || answer.queryJobRef.workspaceId !== intent.workspaceId) throw Error('initial planning source mismatch');
  const response = parseInitialPlanningResponse(answer.answer);
  if (response.status === 'needs_decision') return response;
  const sourceGoal = answer.sources.find(source => source.kind === 'goal');
  const context = sourceGoal?.version ? JSON.parse(sourceGoal.version) as { ref: { projectId: string; goalId: string }; revision: number; workspaceRevision: number; activePlanRevision: unknown } : null;
  if (!context || context.ref.projectId !== intent.projectId || context.ref.goalId !== intent.goalId || context.activePlanRevision !== null || !Number.isSafeInteger(context.revision) || !Number.isSafeInteger(context.workspaceRevision)) throw Error('initial plan lacks an exact unplanned goal source');
  const origin: InitialPlanOrigin = { kind: 'model_coordination', answerRef: { ...answer.queryJobRef, aggregateType: 'QueryJobAnswer', answerId: answer.answerId }, answerDigest: sha256Hex(answer.answer), goalRevision: context.revision, workspaceRevision: context.workspaceRevision, requestId: intent.intentId, summary: response.summary, assignments: response.assignments };
  const raw = response.plan;
  return { status: 'plan', plan: { schemaVersion: 1, reviewAdmissionProtocol: 'independent-review-v1', planId: initialPlanIdFor(intent), planRevision: 1, goalId: intent.goalId, stages: raw.stages, tasks: raw.tasks, obligations: raw.obligations, taskHierarchy: raw.taskHierarchy, executionDag: raw.executionDag, origin } };
}
