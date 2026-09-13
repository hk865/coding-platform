/**
 * P1-04 ReadModel surface — task-detail verification view.
 * Authority: modules/data/read-model-index.md + runtime-collaboration.md
 * ("ReadModelIndex 扩展：验证详情；不把报告文字投影为正式完成状态") +
 * ticket 04 output artifact task-detail-verification-view.
 *
 * Semantics:
 *   - Verdict/claim/observation evidence set rebuilds ONLY from committed
 *     events (EvidenceAdmitted / TaskReductionUpdated). Display only: the
 *     view never grants completion — the canonical TaskReduction phase is a
 *     projected fact, and the 3-state applicability is recomputed by the pure
 *     evidence.py functions against the projected current plan.
 *   - Freshness reuses the opaque CommitCursor semantics: not_ready !=
 *     not_found; not_found only after observedCursor covered atLeastCursor.
 *   - Full-scope key (projectId, goalId, taskId).
 */
import type { CommitCursor } from "./command-event.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef } from "./dispatch.js";
import type { EvidenceApplicability, EvidenceCoverageV1, EvidenceKind, EvidenceOutcome } from "./evidence.js";
import type { EffectivityAnchorV1 } from "./evidence.js";
import type { PlanRevisionRef } from "./plan.js";
import type { TaskReductionCause, TaskReductionPhase } from "./reduction.js";

export type TaskVerificationViewQuery = {
  projectId: string;
  goalId: string;
  taskId: string;
  atLeastCursor?: CommitCursor;
};

export type EvidenceBindingView = {
  evidenceId: string;
  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  coverage: EvidenceCoverageV1[];
  /** Derived at query time against the view's current anchor (never written back). */
  applicability: EvidenceApplicability | null;
  anchor: EffectivityAnchorV1;
  verificationPlanId: string;
  verificationPlanDigest: string;
  sourceRunRef: RunRef | null;
  checkId: string | null;
  summary: string;
  artifactRef: ArtifactRef | null;
  admittedAt: string;
  /** 1-based admission order in the task evidence index. */
  evidenceIndex: number;
};

export type TaskVerificationView = {
  projectId: string;
  goalId: string;
  taskId: string;
  /** The current effectivity tuple the view derives applicability under
   * (null before the first TaskReductionUpdated — no authoritative current
   * anchor can be derived from events alone). */
  currentAnchor: EffectivityAnchorV1 | null;
  planRef: PlanRevisionRef;
  planRevision: number;
  evidence: EvidenceBindingView[];
  effectiveEvidenceIds: string[];
  blockingEvidenceIds: string[];
  reduction: {
    phase: TaskReductionPhase;
    causes: TaskReductionCause[];
    effectiveEvidenceIds: string[];
    blockingEvidenceIds: string[];
    staleEvidenceIds: string[];
    outOfScopeEvidenceIds: string[];
    satisfiedObligationIds: string[];
    planRef: PlanRevisionRef;
    reducedAt: string;
    sourceCursor: CommitCursor;
  } | null;
  sourceCursor: CommitCursor;
};

export type TaskVerificationViewResult =
  | { status: "ready"; verification: TaskVerificationView; observedCursor: CommitCursor }
  | {
      status: "not_ready";
      requiredCursor: CommitCursor;
      observedCursor: CommitCursor | null;
    }
  | { status: "not_found"; observedCursor: CommitCursor | null };
