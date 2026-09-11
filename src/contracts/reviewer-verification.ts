import type { ArtifactRef } from './artifact.js';
import type { RunRef, RunSnapshot, TaskAttemptRef } from './dispatch.js';
import type { EvidenceCoverageV1, EvidenceRef, VerificationPlanRefV1 } from './evidence.js';
import type { ReviewerConfigRef, ReviewerProfileV1 } from './reviewer-context.js';
import type { ReviewResultDecision, ReviewResultRef, ReviewWorkRef, ReviewWorkSnapshot } from './reviewer-work.js';
import type { VerificationRoundMaterialIdentity, VerificationRoundScope, VerificationRoundSourceProof } from './verification-context.js';

/** Complete immutable index. Verification constructs this from every applicable
 * tool, including tools without a required VR; callers cannot declare eligibility. */
export type ReviewMaterialDescriptorV1 = {
  schemaVersion: 1;
  kind: 'independent-review-material';
  descriptorId: string;
  subject: { scope: VerificationRoundScope; producerRunRef: RunRef; producerAttemptRef: TaskAttemptRef };
  toolRound: {
    roundId: string; requestId: string; aggregateRef: ArtifactRef;
    configurationDigest: string; verificationPlanRef: VerificationPlanRefV1;
  };
  materialIdentity: VerificationRoundMaterialIdentity;
  sourceProof: VerificationRoundSourceProof;
  requiredReviewerCoverage: EvidenceCoverageV1[];
  requirements: Array<EvidenceCoverageV1 & { description: string }>;
  tools: Array<{
    checkId: string; kind: 'static' | 'dynamic'; definitionDigest: string;
    childRequestId: string; observationId: string; reportRef: ArtifactRef;
    coverage: EvidenceCoverageV1[]; result: 'PASS';
  }>;
  toolEvidence: Array<{ evidenceRef: EvidenceRef; coverage: EvidenceCoverageV1[]; aggregateRef: ArtifactRef }>;
  sourceNotes: string[];
};

export type ReviewMaterialResult =
  | { status: 'ready'; descriptor: ReviewMaterialDescriptorV1 }
  | { status: 'incomplete'; code: string; missing: string[] }
  | { status: 'rejected'; code: string; issues: string[] };

export type ReviewerCitationV1 = {
  citationId: string; materialId: string; digest: string;
  location:
    | { kind: 'source-lines'; path: string; startLine: number; endLine: number }
    | { kind: 'artifact-section'; pointer: string };
};
/** The model's raw output. Binding and qualification come from canonical Work,
 * current Context and Verification validation, never from these claims alone. */
export type ReviewerSemanticReportV1 = {
  schemaVersion: 1;
  kind: 'independent-review-result';
  reviewId: string; descriptorDigest: string; packetDigest: string; sourceDigest: string;
  citations: ReviewerCitationV1[];
  requirements: Array<EvidenceCoverageV1 & {
    result: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; rationale: string;
    citationIds: string[]; issueIds: string[]; unknowns: string[];
  }>;
  issues: Array<{
    issueId: string; coverage: EvidenceCoverageV1[]; description: string;
    impact: string; citationIds: string[];
  }>;
};
export type ReviewAssessmentV1 = {
  schemaVersion: 1; kind: 'independent-review-assessment'; validationVersion: 'review-report-v1';
  workRef: ReviewWorkRef; rawReportRef: ArtifactRef; descriptorDigest: string;
  materialIdentityDigest: string;
  decision: ReviewResultDecision;
};
export type ReviewStartInput = {
  requestId: string; roundRequestId: string; reviewerConfigRef: ReviewerConfigRef; allowExecute: true;
};
export type ReviewResumeInput = { requestId: string };
export type ReviewRecoverInput = { requestId: string; previousRequestId: string; allowExecute: true; reason: string };
export type ReviewRecoveryView = { allowed: boolean; code: string; failureReason: string | null; issues: string[] };
export type ReviewPhase =
  | 'requested' | 'material_pending' | 'work_pending' | 'work_rejected'
  | 'awaiting_result' | 'report_recorded' | 'assessment_rejected'
  | 'admission_pending' | 'reduction_pending' | 'settled';
export type ReviewReceipt = {
  requestId: string; reviewId: string; scope: VerificationRoundScope;
  roundRequestId: string; workRef: ReviewWorkRef | null; phase: ReviewPhase;
  recoveryRequest?: { previousRequestId: string; reason: string };
};
export type ReviewRequestView = ReviewReceipt & {
  recovery: ReviewRecoveryView;
  descriptorRef: ArtifactRef | null;
  profile: ReviewerProfileV1 | null;
  work: ReviewWorkSnapshot | null;
  execution: RunSnapshot | null;
  rawReportRef: ArtifactRef | null;
  assessment: { ref: ArtifactRef; body: ReviewAssessmentV1 } | null;
  formal: { resultRef: ReviewResultRef | null; evidenceRefs: EvidenceRef[]; taskPhase: string | null; goalPhase: string | null };
  current: { status: 'current' | 'stale' | 'unavailable'; issues: string[] };
  gaps: Array<{ code: string; message: string }>;
};
export type ReviewRequestResult = { review: ReviewRequestView; replayed: boolean };
/** start/resume authorize Verification work only. Host Dispatch consumes the
 * returned canonical Work. Read and receipt never start, rerun or admit work. */
export interface ReviewerVerificationPort {
  reviewMaterial(scope: VerificationRoundScope, roundRequestId: string): Promise<ReviewMaterialResult>;
  startReview(scope: VerificationRoundScope, input: ReviewStartInput): Promise<ReviewRequestResult>;
  recoverReview(scope: VerificationRoundScope, input: ReviewRecoverInput): Promise<ReviewRequestResult>;
  review(scope: VerificationRoundScope, requestId: string): Promise<ReviewRequestView>;
  reviewReceipt(scope: Pick<VerificationRoundScope, 'projectId' | 'workspaceId' | 'goalId'>, requestId: string): Promise<ReviewReceipt | null>;
  resumeReview(scope: VerificationRoundScope, input: ReviewResumeInput): Promise<ReviewRequestResult>;
  /**
   * 未处置问题：把已提交的工具轮次与独立审阅结论归一成带来源的问题清单。
   * 只读、不判定、不写状态；返工提案与受理由 PlanCompiler/ControlEngine 负责。
   */
  openIssues(request: import('./rework/issues.js').OpenIssuesRequestV1): Promise<import('./rework/issues.js').OpenIssuesViewV1>;
}
