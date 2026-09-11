import type { ArtifactRef } from '../../contracts/artifact.js';
import type { ReviewerProfileV1 } from '../../contracts/reviewer-context.js';
import type { ReviewAssessmentV1, ReviewMaterialDescriptorV1, ReviewReceipt, ReviewStartInput, ReviewRecoverInput } from '../../contracts/reviewer-verification.js';
import type { ReviewCommandReceipt, ValidatedReviewMaterialCommand, ValidatedReviewResultCommand, ReplaceFailedReviewWorkCommand } from '../../contracts/reviewer-work.js';
import type { VerificationRoundRecord } from '../../contracts/verification-round.js';

/** Request/qualification recovery only. Work, Run and result facts remain in
 * Control; no copied execution log, outbox, lease or model conversation. */
export type ReviewJournalRecord = ReviewReceipt & {
  schemaVersion: 1;
  fingerprint: string;
  input: ReviewStartInput;
  recovery?: { input: ReviewRecoverInput; command: ReplaceFailedReviewWorkCommand | null; receipt: ReviewCommandReceipt | null };
  createdAt: string;
  descriptor: ReviewMaterialDescriptorV1 | null;
  descriptorRef: ArtifactRef | null;
  /** 被审工作当时固定的 plan revision；由正式 Work 绑定写入，是问题时效判断的依据。 */
  planRef: import('../../contracts/plan.js').PlanRevisionRef | null;
  profile: ReviewerProfileV1 | null;
  createCommand: ValidatedReviewMaterialCommand | null;
  createReceipt: ReviewCommandReceipt | null;
  assessment: { ref: ArtifactRef; body: ReviewAssessmentV1 } | null;
  resultCommand: ValidatedReviewResultCommand | null;
  resultReceipt: ReviewCommandReceipt | null;
  rejectedResultAttempts: Array<{ command: ValidatedReviewResultCommand; receipt: ReviewCommandReceipt }>;
  adoptionReduction: VerificationRoundRecord['reduction'];
  reduction: VerificationRoundRecord['reduction'];
  control: VerificationRoundRecord['control'];
  /** Definitively invalid immutable input/report never revives after a reread. */
  terminalRejection: { code: string; message: string } | null;
  gaps: Array<{ code: string; message: string }>;
};
