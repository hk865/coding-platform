// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/** Independent review canonical lifecycle. These capabilities are supplied only
 * to trusted Verification and Dispatch at composition; they are not HTTP commands. */
import type { ArtifactRef } from './artifact.js';
import type { MaterialAccessGrantRef } from './material-access.js';
export type TaskReviewProtocolRef = {
    aggregateType: 'TaskReviewProtocol';
    projectId: string;
    goalId: string;
    taskId: string;
    planId: string;
};
export type ReviewWorkRef = {
    aggregateType: 'ReviewWork';
    projectId: string;
    workspaceId: string;
    goalId: string;
    reviewId: string;
};
export type ReviewResultRef = {
    aggregateType: 'ReviewResult';
    projectId: string;
    workspaceId: string;
    goalId: string;
    reviewId: string;
};
export type ReviewWorkBinding = {
    kind: 'review';
    reviewWorkRef: ReviewWorkRef;
};
export type ReviewInputBinding = {
    packetRef: ArtifactRef;
    packetDigest: string;
    inputDigest: string;
    descriptorDigest: string;
    grantRefs: MaterialAccessGrantRef[];
};

// Completed-capability migration: selected original declarations, no legacy service port.
import type { DispatchOutboxRef, RoleBindingRefV1, RunRef, TaskAttemptRef, TaskTriple } from './dispatch.js';
import type { PlanRevisionRef } from './plan.js';
import type { ReviewerConfigRef, ReviewerProfileV1 } from './reviewer-context.js';
import type { ReviewMaterialDescriptorV1 } from './reviewer-verification.js';
const INDEPENDENT_REVIEW_PROTOCOL = 'independent-review-v1' as const;
export type ReviewProtocol = typeof INDEPENDENT_REVIEW_PROTOCOL;
export type ReviewOutputBinding = {
    reportRef: ArtifactRef;
    reportDigest: string;
    runRef: RunRef;
    runRevision: number;
    terminalEventId: string;
    terminalEventSeq: number;
    observationId: string;
    sessionId: string;
    packetDigest: string;
    inputDigest: string;
    descriptorDigest: string;
};
export type ReviewWorkSnapshot = {
    ref: ReviewWorkRef;
    schemaVersion: 1;
    revision: number;
    protocolRef: TaskReviewProtocolRef;
    protocol: ReviewProtocol;
    requestId: string;
    requestFingerprint: string;
    subject: TaskTriple;
    planRef: PlanRevisionRef;
    producerRunRef: RunRef;
    producerAttemptRef: TaskAttemptRef;
    descriptor: ReviewMaterialDescriptorV1;
    descriptorRef: ArtifactRef;
    reviewerConfigRef: ReviewerConfigRef;
    reviewerConfigDigest: string;
    reviewerProfile: ReviewerProfileV1;
    reviewerRunRef: RunRef;
    reviewerAttemptRef: TaskAttemptRef;
    outboxRef: DispatchOutboxRef;
    roleBinding: RoleBindingRefV1;
    input: ReviewInputBinding | null;
    output: ReviewOutputBinding | null;
    resultRef: ReviewResultRef | null;
};
