// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { PlanRevisionDraft } from './plan.js';

export type InitialPlanAssignment = {
    taskId: string;
    role: string;
    instruction: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
export type InitialPlanOrigin = {
    kind: 'model_coordination';
    answerRef: import('./query-job.js').QueryJobAnswerRef;
    answerDigest: string;
    goalRevision: number;
    workspaceRevision: number;
    requestId: string;
    summary: string;
    assignments: InitialPlanAssignment[];
};

/**
 * R5b.4 §11.3 versioned initial-planning reply protocol (v2).
 *
 * The model returns ONE JSON object. `needs_decision` states only the explicit
 * product/authorization questions the answer really raised; it writes no
 * candidate and is never the normal human gate before every adoption. `plan`
 * carries the model's plan body WITHOUT `planId`/`planRevision`/`goalId`/
 * `origin`: the one normalization derives identity from the saved Job project's
 * Goal and intentId, and origin from the real Goal/Workspace pins and answer
 * digest. A v2 `plan_only` task may legitimately omit assignments/acceptance;
 * the parser never invents a gate, dependency, assignment or Role binding.
 */
export type InitialPlanningResponsePlanV2 = Omit<
  Extract<PlanRevisionDraft, { schemaVersion: 2 }>,
  'planId' | 'planRevision' | 'goalId' | 'origin'
>;

/**
 * R6 cold-start optional setup proposal carried by a v2 plan answer.
 *
 * It is a SUGGESTION only: it grants no Host tool/file permission and is never
 * itself a trusted executor/permissionRevision. The Plan candidate is still
 * created by the original owner from the SAVED Answer, and an explicit user
 * adoption is what later drives the existing architecture/policy/Plan routes.
 * `checks` names only the exact `RegisteredCommandCheck` DTO
 * (checkId/kind/command/cwd/timeoutMs/taskIds); it never carries `coverage`.
 */
export type InitialPlanningSetupV2 = {
  architecture: import('./architecture-catalog.js').AdoptInitialArchitectureInput;
  completionPolicy: import('./governance.js').CompletionPolicyContentV1;
  checks: import('./verification.js').RegisteredCommandCheck[];
};

export type InitialPlanningResponseV2 =
  | { schemaVersion: 2; kind: 'needs_decision'; summary: string; questions: string[] }
  | { schemaVersion: 2; kind: 'plan'; summary: string; plan: InitialPlanningResponsePlanV2;
      /** Optional additive setup proposal; absent keeps the old v2 exactly. */
      setup?: InitialPlanningSetupV2 };
