import type { ArtifactRef } from './artifact.js';
import type { ArchitectureCandidateProposalRef, ArchitectureDecisionBriefRef } from './architecture-inspection.js';
import type { ArchitectureChangeDecisionRef, CandidateArchitectureBaselineRef } from './baseline-evolution.js';
import type { CommandIdentity, CommandFingerprint } from './command-event.js';
import type { WorkContextRef, WorkContextBindingSnapshot } from './context-continuity.js';
import type { RunRef } from './dispatch.js';
import type { AggregateSnapshot, ExpectedVersion, LedgerCommitReceipt } from './ledger.js';
import type { DomainEvent } from './events.js';
import { canonicalJson, sha256Hex } from './fingerprint.js';
export const ARCHITECTURE_REVIEW_MAX_WORKS = 64;
export type ArchitectureReviewRef = {
    aggregateType: 'ArchitectureReview';
    projectId: string;
    workspaceId: string;
    reviewId: string;
};
export type ArchitectureReviewTarget = {
    ref: WorkContextRef;
    revision: number;
    mode: 'notify' | 'resume';
    reason: string;
};
export type ArchitectureReviewSnapshot = {
    ref: ArchitectureReviewRef;
    revision: number;
    schemaVersion: 1;
    reporterRunRef: RunRef;
    briefRef: ArchitectureDecisionBriefRef;
    proposalRef: ArchitectureCandidateProposalRef;
    candidateRef: CandidateArchitectureBaselineRef;
    proposalDigest: string;
    proposalContent: import('./architecture-inspection.js').ArchitectureCandidateProposalV1['normalizedContent'];
    workspaceRevision: number;
    /** Complete set of existing Work bindings at this recorded scope/version. */
    targets: ArchitectureReviewTarget[];
    workSetDigest: string;
    bodyRef: ArtifactRef;
    status: 'pending' | 'accepted' | 'rejected' | 'deferred';
    decisionRef: ArchitectureChangeDecisionRef | null;
    summary: string;
    recordedAt: string;
};
export type ArchitectureReviewCommand = {
    schemaVersion: 1;
    commandId: string;
    identity: CommandIdentity;
    correlationId: string;
    submittedAt: string;
    ref: ArchitectureReviewRef;
    expectedRevision: number;
    action: {
        kind: 'open';
        reporterRunRef: RunRef;
        proposalRef: ArchitectureCandidateProposalRef;
        candidateRef: CandidateArchitectureBaselineRef;
        targets: ArchitectureReviewTarget[];
        bodyRef: ArtifactRef;
        summary: string;
    } | {
        kind: 'modify';
        proposalDigest: string;
        proposalRef: ArchitectureCandidateProposalRef;
        candidateRef: CandidateArchitectureBaselineRef;
        targets: ArchitectureReviewTarget[];
        bodyRef: ArtifactRef;
        summary: string;
    } | {
        kind: 'decide';
        proposalDigest: string;
        outcome: 'accept' | 'reject' | 'defer';
        bodyRef: ArtifactRef;
        summary: string;
    };
};
export type ArchitectureReviewRecordedEvent = {
    eventId: string;
    eventType: 'ArchitectureReviewRecorded';
    schemaVersion: 1;
    projectId: string;
    workspaceId: string;
    aggregateType: 'ArchitectureReview';
    aggregateId: string;
    aggregateRevision: number;
    actor: CommandIdentity['actor'];
    causationId: string;
    correlationId: string;
    idempotencyKey: string;
    occurredAt: string;
    payload: {
        action: ArchitectureReviewCommand['action']['kind'];
        snapshot: ArchitectureReviewSnapshot;
    };
};
export type ArchitectureReviewCommit = {
    commitKind: 'architecture-review';
    schemaVersion: 1;
    identity: CommandIdentity;
    fingerprint: CommandFingerprint;
    command: ArchitectureReviewCommand;
    expectedVersions: ExpectedVersion[];
    events: DomainEvent[];
    snapshots: AggregateSnapshot[];
    outboxIntents: [
    ];
};
export type ArchitectureReviewReceipt = LedgerCommitReceipt | {
    status: 'rejected';
    code: 'invalid' | 'stale' | 'forbidden' | 'not_found';
    reason: string;
};
export type ArchitectureDeliveryCommand = Omit<import('./coordination.js').CommunicationSettleCommand, 'payload'> & {
    payload: {
        outcome: 'architecture_delivery';
        workspaceId: string;
        consumerId: string;
        leaseGeneration: number;
        settledAt: string;
    };
};
export type ArchitectureDeliveryCommit = {
    commitKind: 'architecture-review-delivery';
    schemaVersion: 1;
    identity: CommandIdentity;
    fingerprint: CommandFingerprint;
    command: ArchitectureDeliveryCommand;
    expectedVersions: ExpectedVersion[];
    events: DomainEvent[];
    snapshots: AggregateSnapshot[];
    outboxIntents: [
    ];
};
export type WorkDirectoryResult = {
    status: 'ready';
    bindings: WorkContextBindingSnapshot[];
    digest: string;
} | {
    status: 'unavailable';
    reason: string;
};
export function architectureReviewRef(projectId: string, workspaceId: string, reviewId: string): ArchitectureReviewRef {
    return { aggregateType: 'ArchitectureReview', projectId, workspaceId, reviewId };
}
export function architectureWorkSetDigest(entries: {
    ref: WorkContextRef;
    revision: number;
}[]): string {
    return sha256Hex(canonicalJson(entries.map(({ ref, revision }) => ({ ref, revision })).sort((a, b) => canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)))));
}
export function architectureReviewFingerprint(command: ArchitectureReviewCommand): CommandFingerprint {
    return sha256Hex(canonicalJson(JSON.parse(JSON.stringify({ schemaVersion: command.schemaVersion, ref: command.ref, expectedRevision: command.expectedRevision, identity: command.identity, action: command.action })))) as CommandFingerprint;
}
/** Public material is deterministic business content, never a caller's authorization paraphrase. */
export function architectureReviewBody(review: Pick<ArchitectureReviewSnapshot, 'ref' | 'revision' | 'proposalRef' | 'candidateRef' | 'proposalDigest' | 'proposalContent' | 'targets' | 'status' | 'summary'>, actor: CommandIdentity['actor']): string {
    return canonicalJson({ schemaVersion: 1, kind: 'architecture_review', ref: review.ref, revision: review.revision, proposalRef: review.proposalRef, candidateRef: review.candidateRef, proposalDigest: review.proposalDigest, proposalContent: review.proposalContent, targets: review.targets, status: review.status, summary: review.summary, actor,
        authority: 'This records the human review outcome. Baseline activation and execution still require current formal migration, permission and admission guards.' });
}
export function architectureReviewDeliveryId(ref: ArchitectureReviewRef, revision: number, work: WorkContextRef): string {
    return 'architecture-delivery-' + sha256Hex(canonicalJson([ref, revision, work])).slice(0, 24);
}
export type ArchitectureReviewView = {
    observedCursor: import('./command-event.js').CommitCursor | null;
    rows: {
        review: ArchitectureReviewSnapshot;
        reportSummary: string;
        brief: import('./architecture-inspection.js').ArchitectureDecisionBriefV1;
        proposal: import('./architecture-inspection.js').ArchitectureCandidateProposalV1;
        /** Older readers may omit this observation; omission is not empty. */
        decisionFacts?: import('./query-quality-facts.js').QueryArchitectureDecisionFacts;
        targets: {
            workId: string;
            mode: 'notify' | 'resume';
            stage: 'pending' | 'delivered' | 'waiting' | 'bound' | 'attempted' | 'failed';
            reason: string;
            runId: string | null;
            requestDigest: string | null;
        }[];
        allNotified: boolean;
        allRequiredAttempted: boolean;
    }[];
};
