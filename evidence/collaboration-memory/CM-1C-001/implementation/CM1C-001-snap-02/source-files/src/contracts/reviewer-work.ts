/** Independent review canonical lifecycle. These capabilities are supplied only
 * to trusted Verification and Dispatch at composition; they are not HTTP commands. */
import type { ArtifactRef } from './artifact.js';
import type { ActorRef, CommandIdentity, CommandFingerprint } from './command-event.js';
import type { DispatchOutboxRef, RoleBindingRefV1, RunRef, TaskAttemptRef, TaskTriple } from './dispatch.js';
import type { EvidenceRef } from './evidence.js';
import type { MaterialAccessGrantRef } from './material-access.js';
import type { PlanRevisionRef } from './plan.js';
import type { ReviewerConfigRef, ReviewerProfileV1 } from './reviewer-context.js';
import type { ReviewMaterialDescriptorV1 } from './reviewer-verification.js';
import { canonicalJson, sha256Hex } from './fingerprint.js';

const INDEPENDENT_REVIEW_PROTOCOL = 'independent-review-v1' as const;
export type ReviewProtocol = typeof INDEPENDENT_REVIEW_PROTOCOL;
export type TaskReviewProtocolRef = { aggregateType: 'TaskReviewProtocol'; projectId: string; goalId: string; taskId: string; planId: string };
export type ReviewWorkRef = { aggregateType: 'ReviewWork'; projectId: string; workspaceId: string; goalId: string; reviewId: string };
export type ReviewResultRef = { aggregateType: 'ReviewResult'; projectId: string; workspaceId: string; goalId: string; reviewId: string };
export type ReviewWorkBinding = { kind: 'review'; reviewWorkRef: ReviewWorkRef };
export type TaskReviewProtocolSnapshot = { ref: TaskReviewProtocolRef; schemaVersion: 1; revision: number; protocol: ReviewProtocol; planRef: PlanRevisionRef; firstWorkRef: ReviewWorkRef; workRefs?: ReviewWorkRef[]; adoptedAt: string };
export type ReviewInputBinding = { packetRef: ArtifactRef; packetDigest: string; inputDigest: string; descriptorDigest: string; grantRefs: MaterialAccessGrantRef[] };
export type ReviewOutputBinding = {
  reportRef: ArtifactRef; reportDigest: string; runRef: RunRef; runRevision: number;
  terminalEventId: string; terminalEventSeq: number; observationId: string; sessionId: string;
  packetDigest: string; inputDigest: string; descriptorDigest: string;
};
export type ReviewWorkSnapshot = {
  ref: ReviewWorkRef; schemaVersion: 1; revision: number; protocolRef: TaskReviewProtocolRef; protocol: ReviewProtocol;
  requestId: string; requestFingerprint: string; subject: TaskTriple; planRef: PlanRevisionRef;
  producerRunRef: RunRef; producerAttemptRef: TaskAttemptRef; descriptor: ReviewMaterialDescriptorV1; descriptorRef: ArtifactRef;
  reviewerConfigRef: ReviewerConfigRef; reviewerConfigDigest: string; reviewerProfile: ReviewerProfileV1;
  reviewerRunRef: RunRef; reviewerAttemptRef: TaskAttemptRef; outboxRef: DispatchOutboxRef; roleBinding: RoleBindingRefV1;
  input: ReviewInputBinding | null; output: ReviewOutputBinding | null; resultRef: ReviewResultRef | null;
};
export type ReviewerRequirementResult = { obligationId: string; requirementId: string; outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; summary: string };
export type ReviewResultDecision = { status: 'accepted'; requirements: ReviewerRequirementResult[] } | { status: 'rejected'; reasonCodes: string[] };
export type ReviewResultSnapshot = {
  ref: ReviewResultRef; schemaVersion: 1; revision: 1; workRef: ReviewWorkRef; protocol: ReviewProtocol;
  output: ReviewOutputBinding; validatedMaterialIdentityDigest: string; assessmentRef: ArtifactRef; assessmentDigest: string;
  validationVersion: 'review-report-v1';
  decision: (ReviewResultDecision & { evidenceRefs: EvidenceRef[] });
  /** Stored command identity/fingerprint permit recovery without regenerating facts. */
  commandIdentity: CommandIdentity; commandFingerprint: string;
};
export type ValidatedReviewMaterialCommand = { identity: CommandIdentity; requestId: string; descriptor: ReviewMaterialDescriptorV1; descriptorRef: ArtifactRef; reviewerConfigRef: ReviewerConfigRef; reviewerProfile: ReviewerProfileV1 };
export type ValidatedReviewResultCommand = { identity: CommandIdentity; workRef: ReviewWorkRef; expectedWorkRevision: number; output: ReviewOutputBinding; validatedMaterialIdentityDigest: string; assessmentRef: ArtifactRef; assessmentDigest: string; decision: ReviewResultDecision };
export type BindReviewOutputCommand = { identity: CommandIdentity; workRef: ReviewWorkRef; expectedWorkRevision: number; output: ReviewOutputBinding };
export type ReviewPrestartFailureProofV1 = {
  schemaVersion: 1; workRef: ReviewWorkRef; runRef: RunRef; runtimeStatus: 'failed';
  terminalEventId: string; terminalEventSeq: number; observationId: string;
  eventTypes: ['run_crashed']; traceCount: 0; usageCount: 0; modelStarted: false; toolStarted: false;
};
export type ReplaceFailedReviewWorkCommand = {
  identity: CommandIdentity; previousWorkRef: ReviewWorkRef; expectedWorkRevision: number;
  expectedProtocolRevision: number; requestId: string; proof: ReviewPrestartFailureProofV1;
};
export type ReviewCommandReceipt = { status: 'accepted' | 'replayed'; workRef: ReviewWorkRef; workRevision: number; resultRef: ReviewResultRef | null } | { status: 'rejected'; code: string; issues?: string[] };
export type ReviewExecutionObservation = {
  spec: import('./runtime-preparation.js').RunSpec; status: string; sessionId: string;
  events: import('./dispatch.js').RuntimeEventV1[];
  trace: Array<{ type: string; sequence: number; at: string; data: unknown }>;
};
export type ReviewDriveResult = { status: 'output_bound' | 'already_bound' | 'awaiting_runtime' | 'incomplete' | 'rejected'; workRef: ReviewWorkRef; code?: string; issues?: string[] };
export interface ReviewLifecycleControlPort {
  createWork(command: ValidatedReviewMaterialCommand): Promise<ReviewCommandReceipt>;
  replaceFailedWork(command: ReplaceFailedReviewWorkCommand): Promise<ReviewCommandReceipt>;
  recordValidatedResult(command: ValidatedReviewResultCommand): Promise<ReviewCommandReceipt>;
}
export interface ReviewDispatchControlPort { bindOutput(command: BindReviewOutputCommand): Promise<ReviewCommandReceipt> }

type ReviewEventBase = { eventId: string; schemaVersion: 1; projectId: string; workspaceId: string; aggregateId: string; aggregateRevision: number; causationId: string; correlationId: string; idempotencyKey: string; actor: ActorRef; occurredAt: string };
type TaskReviewProtocolAdoptedEvent = ReviewEventBase & { eventType: 'TaskReviewProtocolAdopted'; aggregateType: 'TaskReviewProtocol'; payload: { protocol: TaskReviewProtocolSnapshot } };
export type ReviewWorkCreatedEvent = ReviewEventBase & { eventType: 'ReviewWorkCreated'; aggregateType: 'ReviewWork'; payload: { work: ReviewWorkSnapshot; run: import('./dispatch.js').RunSnapshot; attempt: import('./dispatch.js').TaskAttemptSnapshot; outbox: import('./dispatch.js').DispatchOutboxEntrySnapshot } };
export type FailedReviewWorkReplacedEvent = ReviewEventBase & { eventType: 'FailedReviewWorkReplaced'; aggregateType: 'ReviewWork'; payload: { work: ReviewWorkSnapshot; previousWorkRef: ReviewWorkRef; protocol: TaskReviewProtocolSnapshot; run: import('./dispatch.js').RunSnapshot; attempt: import('./dispatch.js').TaskAttemptSnapshot; outbox: import('./dispatch.js').DispatchOutboxEntrySnapshot } };
type ReviewInputBoundEvent = ReviewEventBase & { eventType: 'ReviewInputBound'; aggregateType: 'ReviewWork'; payload: { work: ReviewWorkSnapshot } };
type ReviewOutputBoundEvent = ReviewEventBase & { eventType: 'ReviewOutputBound'; aggregateType: 'ReviewWork'; payload: { work: ReviewWorkSnapshot; commandFingerprint: string } };
type ReviewResultRecordedEvent = ReviewEventBase & { eventType: 'ReviewResultRecorded'; aggregateType: 'ReviewResult'; payload: { work: ReviewWorkSnapshot; result: ReviewResultSnapshot } };
export type ReviewDomainEvent = TaskReviewProtocolAdoptedEvent | ReviewWorkCreatedEvent | FailedReviewWorkReplacedEvent | ReviewInputBoundEvent | ReviewOutputBoundEvent | ReviewResultRecordedEvent;
export function reviewCommandFingerprint(kind: string, command: object): CommandFingerprint { return sha256Hex(canonicalJson({ kind, command } as never)) as CommandFingerprint; }
export function reviewWorkRefFor(scope: { projectId: string; workspaceId: string; goalId: string }, requestId: string): ReviewWorkRef {
  return { aggregateType: 'ReviewWork', projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId, reviewId: 'review-' + sha256Hex(canonicalJson({ projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId, requestId })).slice(0, 40) };
}
