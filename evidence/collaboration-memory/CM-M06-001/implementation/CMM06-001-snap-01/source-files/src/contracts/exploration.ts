import type { PlanRevisionSnapshot } from './plan.js';
import type { ArtifactRef } from './artifact.js';
import type { ApplyPlanRevisionCommand } from './plan.js';
export type ExplorationScope = {
    projectId: string;
    workspaceId: string;
    goalId: string;
};
export type ExplorationTask = {
    taskId: string;
    title: string;
    instruction: string;
    dependsOn: string[];
};
export type ExplorationPlan = ExplorationScope & {
    planOrigin: 'operator';
    planId: string;
    requestId: string;
    tasks: ExplorationTask[];
    gateTaskId: 'gate-goal';
    sourceDigest: string;
    createdAt: string;
    fingerprint: string;
    command: ApplyPlanRevisionCommand;
    status: 'pending' | 'accepted';
};
export type ExplorationReport = ExplorationScope & {
    taskId: string;
    runId: string;
    report: string;
    reportDigest: string;
    sourceDigest: string;
    workspaceRevision: number;
    planRef: PlanRevisionSnapshot['ref'];
    completedAt: string;
    sourceReads: Array<{
        path: string;
        startLine: number;
        endLine: number;
        revision: string;
        callId: string;
    }>;
    artifactRef: ArtifactRef;
};
export type ExplorationReview = ExplorationScope & {
    reviewId: string;
    taskId: string;
    runId: string | null;
    reportDigest: string;
    sourceDigest: string;
    workspaceRevision: number;
    planRef: PlanRevisionSnapshot['ref'];
    verdict: 'PASS' | 'FAIL';
    reviewOrigin: 'operator';
    reviewText: string;
    reviewedAt: string;
    fingerprint: string;
    control: {
        status: 'pending' | 'applied';
        taskPhase: string | null;
        goalPhase: string | null;
        evidenceIds: string[];
    };
};
