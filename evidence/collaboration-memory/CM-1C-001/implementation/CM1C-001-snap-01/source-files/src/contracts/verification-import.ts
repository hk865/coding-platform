import type { ArtifactRef } from './artifact.js';
import type { PlanRevisionSnapshot } from './plan.js';
export type VerificationScope = {
    projectId: string;
    workspaceId: string;
    goalId: string;
    runId: string;
};
export type Benchmark = {
    instanceId: string;
    datasetRevision: string;
    failToPass: string[];
    passToPass: string[];
};
export type VerificationCandidate = VerificationScope & {
    candidateId: string;
    candidateDigest: string;
    workspaceDigest: string;
    workspaceRevision: number;
    origin: 'model' | 'assisted-repair';
    benchmark: Benchmark;
    registeredAt: string;
    changedPaths: string[];
    artifactRef: ArtifactRef;
    fingerprint: string;
    planRef: PlanRevisionSnapshot['ref'];
    patch: string;
};
export type VerificationAttempt = VerificationScope & {
    verificationId: string;
    sequence: number;
    candidateId: string;
    candidateDigest: string;
    workspaceRevision: number;
    verdict: 'PASS' | 'FAIL';
    completeness: 'complete' | 'missing';
    purpose: 'original' | 'diagnostic' | 'repair';
    source: {
        name: string;
        reportUri: string;
        reportDigest: string;
    };
    startedAt: string;
    completedAt: string;
    importedAt: string;
    counts: {
        failToPass: number;
        passToPass: number;
        passed: number;
        failed: number;
        missing: number;
    };
    failedTests: string[];
    missingTests: string[];
    control: {
        status: 'applied' | 'pending';
        taskPhase: string | null;
        goalPhase: string | null;
        evidenceIds: string[];
    };
    fingerprint: string;
    reportBody: string;
};
