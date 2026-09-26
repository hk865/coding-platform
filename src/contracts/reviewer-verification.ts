
// Completed-capability migration: selected original declarations, no legacy service port.
import type { ArtifactRef } from './artifact.js';
import type { RunRef, TaskAttemptRef } from './dispatch.js';
import type { EvidenceCoverageV1, EvidenceRef, VerificationPlanRefV1 } from './evidence.js';
import type { VerificationRoundMaterialIdentity, VerificationRoundScope, VerificationRoundSourceProof } from './verification-context.js';
/** Complete immutable index. Verification constructs this from every applicable
 * tool, including tools without a required VR; callers cannot declare eligibility. */
export type ReviewMaterialDescriptorV1 = {
    schemaVersion: 1;
    kind: 'independent-review-material';
    descriptorId: string;
    subject: {
        scope: VerificationRoundScope;
        producerRunRef: RunRef;
        producerAttemptRef: TaskAttemptRef;
    };
    toolRound: {
        roundId: string;
        requestId: string;
        aggregateRef: ArtifactRef;
        configurationDigest: string;
        verificationPlanRef: VerificationPlanRefV1;
    };
    materialIdentity: VerificationRoundMaterialIdentity;
    sourceProof: VerificationRoundSourceProof;
    requiredReviewerCoverage: EvidenceCoverageV1[];
    requirements: Array<EvidenceCoverageV1 & {
        description: string;
    }>;
    tools: Array<{
        checkId: string;
        kind: 'static' | 'dynamic';
        definitionDigest: string;
        childRequestId: string;
        observationId: string;
        reportRef: ArtifactRef;
        coverage: EvidenceCoverageV1[];
        result: 'PASS';
    }>;
    toolEvidence: Array<{
        evidenceRef: EvidenceRef;
        coverage: EvidenceCoverageV1[];
        aggregateRef: ArtifactRef;
    }>;
    sourceNotes: string[];
};
