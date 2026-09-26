/**
 * R5b.4 §11.3 the ONE pure v2 normalization and narrow fact-read seam.
 *
 * This file owns the deterministic JSON -> (draft, origin) conversion and the
 * exact fact shape it consumes. It creates no service instance, no port and no
 * candidate store; runtime dependencies run one way (the Plan service calls this
 * pure module).
 *
 * The plan identity is derived from the saved Job project's Goal and intentId.
 * Goal/Workspace revisions and the actual answer digest belong to origin
 * provenance. The parser never invents a gate, dependency, assignment,
 * acceptance or Role binding, and it never turns an omitted optional field into
 * a required one.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { PreparedQueryManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  QueryJobAnswerRef,
  QueryJobAnswerV1,
  QueryJobSnapshot,
  QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type { PlanRevisionDraft } from '../../../contracts/plan.js';
import type {
  InitialPlanAssignment,
  InitialPlanOrigin,
  InitialPlanningResponseV2,
} from '../../../contracts/initial-planning.js';

/**
 * The exact formal facts the normalization may consume. Every field is read from
 * the persisted Query/Plan owners; the Plan service never re-scans the Kernel
 * history or opens the Kernel store to prove the answer again.
 */
export type InitialPlanAnswerFacts = {
  answer: QueryJobAnswerV1;
  answerRef: QueryJobAnswerRef;
  job: QueryJobSnapshot;
  run: QueryRunSnapshot;
  manifest: PreparedQueryManifestV1;
  answerText: string;
};

/**
 * The narrow, one-way read seam. The implementation is supplied by the Plan
 * service with the same `records`/`materials`/`initialPlanning.bodies`
 * instances it already owns; this module declares only the shape.
 */
export type InitialPlanFactReader = (
  ctx: CoreCallContext,
  answerRef: QueryJobAnswerRef,
) => Promise<ReadResult<InitialPlanAnswerFacts>>;

/** The unique normalization value: a real plan draft/origin, or the answer's
 * explicit questions. It is not a proposal, a decision record or a Plan. */
export type InitialPlanNormalization =
  | { status: 'plan'; summary: string; draft: PlanRevisionDraft; origin: InitialPlanOrigin }
  | { status: 'needs_decision'; summary: string; questions: string[] };

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The ONE v2 JSON parse. It judges only the outer protocol shape; the existing
 * Plan codec/validators keep judging task/obligation/DAG/assignment meaning, so
 * this parser never restates them and never repairs the model's plan.
 */
export function parseInitialPlanningResponseV2(
  text: string,
): { status: 'parsed'; response: InitialPlanningResponseV2 } | CoreRejection {
  if (typeof text !== 'string' || text.length === 0) {
    return rejected('invalid', 'the initial-planning answer is empty');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    return rejected('invalid', 'the initial-planning answer is not valid JSON');
  }
  if (!isRecord(parsed)) return rejected('invalid', 'the initial-planning answer must be one JSON object');
  if (parsed['schemaVersion'] !== 2) return rejected('invalid', 'the initial-planning answer must carry schemaVersion 2');
  const summary = parsed['summary'];
  if (typeof summary !== 'string') return rejected('invalid', 'the initial-planning answer must carry a summary string');
  if (parsed['kind'] === 'needs_decision') {
    const questions = parsed['questions'];
    if (!Array.isArray(questions) || !questions.every(nonEmpty)) {
      return rejected('invalid', 'a needs_decision answer must carry a non-empty questions array');
    }
    return { status: 'parsed', response: {
      schemaVersion: 2, kind: 'needs_decision', summary, questions: [...questions] as string[] } };
  }
  if (parsed['kind'] !== 'plan') {
    return rejected('invalid', 'the initial-planning answer kind must be plan or needs_decision');
  }
  const plan = parsed['plan'];
  if (!isRecord(plan)) return rejected('invalid', 'a plan answer must carry a plan object');
  if (plan['schemaVersion'] !== 2) return rejected('invalid', 'the plan body must carry schemaVersion 2');
  for (const key of ['stages', 'tasks', 'obligations'] as const) {
    if (!Array.isArray(plan[key])) return rejected('invalid', `the plan body must carry a ${key} array`);
  }
  if (!isRecord(plan['taskHierarchy']) || !Array.isArray(plan['taskHierarchy']['parentOf'])) {
    return rejected('invalid', 'the plan body must carry taskHierarchy.parentOf');
  }
  if (!isRecord(plan['executionDag']) || !Array.isArray(plan['executionDag']['dependsOn'])) {
    return rejected('invalid', 'the plan body must carry executionDag.dependsOn');
  }
  if (plan['assignments'] !== undefined) {
    if (!Array.isArray(plan['assignments']) || !plan['assignments'].every(validAssignment)) {
      return rejected('invalid', 'the plan assignments must be complete task/role/instruction entries');
    }
  }
  for (const key of ['taskRelations', 'inputRequirements'] as const) {
    if (plan[key] !== undefined && !Array.isArray(plan[key])) {
      return rejected('invalid', `the plan ${key} must be an array when present`);
    }
  }
  return { status: 'parsed', response: parsed as unknown as InitialPlanningResponseV2 };
}

function validAssignment(value: unknown): value is InitialPlanAssignment {
  return isRecord(value) && nonEmpty(value['taskId']) && nonEmpty(value['role']) && nonEmpty(value['instruction']);
}

/** Deterministic identity from the SAVED Job intent only; never a caller field. */
export function initialPlanIdFor(input: { projectId: string; goalId: string; intentId: string }): string {
  return 'initial-plan-' + sha256Hex(canonicalJson({
    schemaVersion: 2, projectId: input.projectId, goalId: input.goalId, intentId: input.intentId,
  } as unknown as JsonValue)).slice(0, 32);
}

/**
 * The deterministic v2 normalization: the answer body plus the real Job/manifest
 * provenance become ONE draft and its origin. Identity comes from the saved Job
 * intent; Goal/Workspace revisions come from the frozen prepared manifest; the
 * digest is the UTF-8 SHA-256 of the actual answer text. Optional `plan_only`
 * nodes stay assignment-free; no gate/dependency/acceptance/Role is invented.
 */
export function normalizeInitialPlanningResponseV2(
  response: InitialPlanningResponseV2,
  facts: InitialPlanAnswerFacts,
): InitialPlanNormalization | CoreRejection {
  const intent = facts.job.job.intent;
  if (!nonEmpty(intent.projectId) || !nonEmpty(intent.workspaceId)
    || !nonEmpty(intent.intentId) || !nonEmpty(intent.goalId)) {
    return rejected('invalid', 'the saved Job intent does not carry the project/workspace/Goal/intentId identity');
  }
  if (response.kind === 'needs_decision') {
    return { status: 'needs_decision', summary: response.summary, questions: [...response.questions] };
  }
  const assignments: InitialPlanAssignment[] = (response.plan.assignments ?? [])
    .map((assignment) => ({ ...assignment }));
  const origin: InitialPlanOrigin = {
    kind: 'model_coordination',
    answerRef: { ...facts.answerRef },
    answerDigest: sha256Hex(facts.answerText),
    goalRevision: facts.manifest.goal.revision,
    workspaceRevision: facts.manifest.workspace.revision,
    requestId: intent.intentId,
    summary: response.summary,
    assignments: assignments.map((assignment) => ({ ...assignment })),
  };
  // Identity and provenance are the ONLY fields this module adds; every model
  // field (optional plan_only omissions included) survives verbatim.
  const draft = {
    ...(JSON.parse(JSON.stringify(response.plan)) as Record<string, unknown>),
    planId: initialPlanIdFor({ projectId: intent.projectId, goalId: intent.goalId, intentId: intent.intentId }),
    planRevision: 1,
    goalId: intent.goalId,
    origin,
  } as unknown as PlanRevisionDraft;
  return { status: 'plan', summary: response.summary, draft, origin };
}
