/**
 * R5b.4 §11.3 the ONE pure v2 normalization and the exact facts it consumes.
 *
 * This file owns the deterministic JSON -> (draft, origin) conversion and the
 * exact fact shape it consumes. It creates no service instance, no port and no
 * candidate store; runtime dependencies run one way (the Plan service calls this
 * pure module).
 *
 * The plan identity is derived from the saved Job's project and intentId plus the Goal resolved from the source.
 * Goal/Workspace revisions and the actual answer digest belong to origin
 * provenance. The parser never invents a gate, dependency, assignment,
 * acceptance or Role binding, and it never turns an omitted optional field into
 * a required one.
 */
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlanRevisionDraft } from '../../../contracts/plan.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import { nonEmpty } from '../../../contracts/validation/common.js';
import type {
  InitialPlanAssignment,
  InitialPlanOrigin,
  InitialPlanOriginSourceV1,
  InitializationSourceV1,
  InitialPlanningResponseV2,
} from '../../../contracts/initial-planning.js';

/** The one v2 outer-protocol parse; it lives in contracts so `queries/` reads it too. */
export { parseInitialPlanningResponseV2 } from '../../../contracts/initial-planning-parse.js';

/**
 * The exact formal facts the normalization may consume. The type is declared in
 * `contracts/query-job.ts` (pure data) so the WorkGraph `model` layer can name
 * the read seam without importing `tasks/`; this module re-exports it for the
 * existing importers.
 */
import type { InitialPlanAnswerFacts } from '../../../contracts/query-job.js';
export type { InitialPlanAnswerFacts } from '../../../contracts/query-job.js';

/** The initial-entry propose fingerprint: the complete original input and meta plus the trusted actor/scope, so a
 * committed request restores without re-reading or refreshing pins; the optional source only enters source-aware calls. */
export function initialAnswerProposeFingerprint(input: {
  projectId: string; workspaceId: string; actor: ActorRef;
  answerRef: unknown; reason: unknown; requestId: string; expected: unknown;
  source?: InitializationSourceV1;
}): string {
  const { source, ...base } = input;
  return sha256Hex(canonicalJson({
    schemaVersion: 1, commandType: 'PlanProposeInitial', ...base,
    ...(source === undefined ? {} : { source }),
  } as unknown as JsonValue));
}

/** The explicit-source propose fingerprint: the trusted scope/actor, selector, reason and original request id/pins
 * (no draft, no Goal), so the source arm restores its original receipt before reading the current answer, binding or manifest. */
export function sourceProposeFingerprint(input: {
  projectId: string; workspaceId: string; actor: ActorRef;
  source: InitializationSourceV1; reason: unknown; requestId: string; expected: unknown;
}): string {
  return sha256Hex(canonicalJson({
    schemaVersion: 1, commandType: 'PlanProposeSource', ...input,
  } as unknown as JsonValue));
}

/** The unique normalization value: a real plan draft/origin, or the answer's
 * explicit questions. It is not a proposal, a decision record or a Plan. */
export type InitialPlanNormalization =
  | { status: 'plan'; summary: string; draft: PlanRevisionDraft; origin: InitialPlanOrigin }
  | { status: 'needs_decision'; summary: string; questions: string[] };

/** Deterministic identity from the SAVED Job intent only; never a caller field. */
export function initialPlanIdFor(input: { projectId: string; goalId: string; intentId: string }): string {
  return 'initial-plan-' + sha256Hex(canonicalJson({
    schemaVersion: 2, projectId: input.projectId, goalId: input.goalId, intentId: input.intentId,
  } as unknown as JsonValue)).slice(0, 32);
}

/**
 * The deterministic v2 normalization: the answer body plus the real Job/manifest
 * provenance become ONE draft and its origin. Identity comes from the saved Job
 * intent; the Goal and its revision come from the read's resolved source (never
 * from the Job's own Goal); the digest is the UTF-8 SHA-256 of the actual answer
 * text. Optional `plan_only` nodes stay assignment-free; no gate/dependency/
 * acceptance/Role is invented.
 */
export function normalizeInitialPlanningResponseV2(
  response: InitialPlanningResponseV2,
  facts: InitialPlanAnswerFacts,
): InitialPlanNormalization | CoreRejection {
  const intent = facts.job.job.intent;
  if (!nonEmpty(intent.projectId) || !nonEmpty(intent.workspaceId) || !nonEmpty(intent.intentId)) {
    return rejected('invalid', 'the saved Job intent does not carry the project/workspace/intentId identity');
  }
  if (response.kind === 'needs_decision') {
    return { status: 'needs_decision', summary: response.summary, questions: [...response.questions] };
  }
  const resolution = facts.resolution;
  // Only a binding resolution has a draft to compare with the answer's own `planDraftIndex`.
  if (resolution.kind === 'binding' && resolution.bindingRef.draftIndex !== facts.answer.planDraftIndex) {
    return rejected('invalid', "the answer's plan is not for this draft");
  }
  const source: InitialPlanOriginSourceV1 = resolution.kind === 'plain'
    ? { kind: 'plain' }
    : resolution.kind === 'binding'
      ? { kind: 'binding', selector: { ...resolution.source }, bindingRef: { ...resolution.bindingRef } }
      : { kind: 'prepared_goal', selector: { ...resolution.source } };
  const assignments: InitialPlanAssignment[] = (response.plan.assignments ?? [])
    .map((assignment) => ({ ...assignment }));
  const origin: InitialPlanOrigin = {
    kind: 'model_coordination',
    source,
    answerRef: { ...facts.answerRef },
    answerDigest: sha256Hex(facts.answerText),
    goalRevision: resolution.goalRevision,
    workspaceRevision: facts.manifest.workspace.revision,
    requestId: intent.intentId,
    summary: response.summary,
    assignments: assignments.map((assignment) => ({ ...assignment })),
  };
  // Identity and provenance are the ONLY fields this module adds; every model
  // field (optional plan_only omissions included) survives verbatim.
  const draft = {
    ...(JSON.parse(JSON.stringify(response.plan)) as Record<string, unknown>),
    planId: initialPlanIdFor({ projectId: intent.projectId, goalId: resolution.goal.goalId, intentId: intent.intentId }),
    planRevision: 1,
    goalId: resolution.goal.goalId,
    origin,
  } as unknown as PlanRevisionDraft;
  return { status: 'plan', summary: response.summary, draft, origin };
}
