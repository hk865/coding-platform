import type { PlanRevisionDraft, PlanRevisionSnapshot } from './plan.js';
import type { QueryJobIntentV1, QueryJobSnapshot } from './query-job.js';
import { canonicalJson, sha256Hex } from './fingerprint.js';

export type InitialPlanAssignment = { taskId: string; role: string; instruction: string };
export type AcceptedInitialPlan = { snapshot: QueryJobSnapshot; plan: PlanRevisionSnapshot };
export type InitialPlanOrigin = {
  kind: 'model_coordination'; answerRef: import('./query-job.js').QueryJobAnswerRef; answerDigest: string;
  goalRevision: number; workspaceRevision: number; requestId: string; summary: string; assignments: InitialPlanAssignment[];
};

/** The schema is a response contract, not a pre-filled decomposition. */
export const INITIAL_PLANNING_RESPONSE_GUIDE = `Return one JSON object with kind "plan" or "needs_decision".
For needs_decision, provide summary and questions (an array of concrete product decisions). Do not invent authorization.
For plan, provide summary, assignments, and plan with stages, tasks, obligations, taskHierarchy:{parentOf:[]}, executionDag:{dependsOn:[]}.
Each stage has stageId,title. Each task has taskId,title,requirementLevel:"required",taskKind:"work" or "gate",disposition:"active",phase:"pending",scope:{kind:"stage",stageId} or {kind:"goal"}; stage tasks also have stageId.
Each obligation has obligationId,title,requirementLevel:"required",taskIds and verificationRequirements:[{requirementId,requirementLevel:"required",kind:"dynamic" or "static" or "reviewer",description}].
Use static/dynamic requirements for executable tool checks. Use reviewer requirements for independent semantic review of the current source and original tool reports; a gate title or a static check does not create a Reviewer obligation. When independent review is required, map explicit required reviewer requirements to the work and goal gate being reviewed. Do not encode prose correctness as a tool-only static requirement that would need an unregistered human verdict to unlock Reviewer. Keep objective machine-checkable conditions as separate tool requirements, and describe semantic correctness in reviewer requirements. Reviewer runs are created by the verification workflow, not implementation assignments.
Every work task and the required goal gate must map to required obligations. Required goal gates have scope.kind="goal". Each hard dependency has taskId,dependsOnId,requires:{kind:"artifact" or "output-contract" or "gate-result",label}.
Task hierarchy groups tasks only. Each taskHierarchy.parentOf edge is exactly {parentTaskId,childTaskId}, both referencing taskId values in plan.tasks; never use stageId, parentId or childId. Leave parentOf empty when no task grouping is needed; stage membership is already expressed by task.scope. Each executionDag.dependsOn edge is exactly {taskId,dependsOnId,requires:{kind,label}}, referencing two distinct existing tasks. Dependencies express actual required inputs. Do not synthesize independence or dependencies from stage order; both graphs must be acyclic. Keep task count between 2 and 16; if a faithful plan cannot fit, return needs_decision with the concrete gap.
Each work task has exactly one assignment {taskId,role: a registered Agent template identifier (legacy executor/integrator when no catalog exists),instruction}; instructions must state its acceptance obligations, inputs, expected outputs and checks. Gates have no implementation assignment.
Choose tasks and obligations from the actual user request and sources. Do not change requirements, completion policy, architecture baseline, permissions or already completed work. All tasks start pending. Roles may combine tightly related duties; explain division and integration risks in summary. Return no markdown fences.`;

type InitialPlanningResponse = { status: 'plan'; summary: string; assignments: InitialPlanAssignment[]; plan: PlanRevisionDraft } | { status: 'needs_decision'; summary: string; questions: string[] };

/** The stable persisted identity of an initial proposal, also used to query its
 * accepted projection. This helper does not construct or admit a plan. */
export function initialPlanIdFor(intent: Pick<QueryJobIntentV1, 'projectId' | 'goalId' | 'intentId'>): string {
  return 'model-plan-' + sha256Hex(canonicalJson([intent.projectId, intent.goalId, intent.intentId])).slice(0, 32);
}

/** Parse the public response boundary. Source binding and plan compilation are
 * PlanCompiler behavior; graph/governance admission remains Control's job. */
export function parseInitialPlanningResponse(body: string): InitialPlanningResponse {
  const response = JSON.parse(body) as Record<string, unknown>;
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw Error('invalid initial plan response');
  const text = (value: unknown, label: string) => { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 4096) throw Error('invalid initial planning ' + label); return value; };
  const summary = text(response['summary'], 'summary');
  if (response['kind'] === 'needs_decision') {
    const questions = response['questions']; if (!Array.isArray(questions) || questions.length < 1 || questions.length > 16) throw Error('invalid clarification questions');
    return { status: 'needs_decision', summary, questions: questions.map(question => text(question, 'question')) };
  }
  if (response['kind'] !== 'plan' || !response['plan'] || typeof response['plan'] !== 'object' || Array.isArray(response['plan'])) throw Error('invalid initial plan response');
  const raw = response['plan'] as PlanRevisionDraft;
  if (!Array.isArray(raw.tasks) || raw.tasks.length < 2 || raw.tasks.length > 16 || raw.tasks.some(task => task.phase !== 'pending' || task.disposition !== 'active' || task.requirementLevel !== 'required')) throw Error('initial tasks must be bounded, required, active and pending');
  const assignments = response['assignments'];
  if (!Array.isArray(assignments)) throw Error('initial plan lacks work assignments');
  const parsed: InitialPlanAssignment[] = assignments.map(item => {
    if (!item || typeof item !== 'object' || typeof item.role !== 'string' || !item.role.trim() || Buffer.byteLength(item.role) > 256) throw Error('invalid assignment role');
    return { taskId: text(item.taskId, 'taskId'), role: item.role as InitialPlanAssignment['role'], instruction: text(item.instruction, 'instruction') };
  });
  const work = raw.tasks.filter(task => task.taskKind === 'work');
  if (parsed.length !== work.length || new Set(parsed.map(item => item.taskId)).size !== parsed.length || parsed.some(item => !work.some(task => task.taskId === item.taskId))) throw Error('assignments must exactly cover implementation tasks');
  return { status: 'plan', summary, assignments: parsed, plan: raw };
}
