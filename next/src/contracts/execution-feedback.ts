
// Completed-capability migration: selected original declarations, no legacy service port.
import type { ArtifactRef } from './artifact.js';
import type { RunRef } from './dispatch.js';
import type { PlanRevisionRef } from './plan.js';
export type FeedbackSource = {
    runRef: RunRef;
    taskId: string;
    planRef: PlanRevisionRef;
    workspaceRevision: number;
    reportRef: ArtifactRef;
    sourcePin: import('./material-access.js').MaterialSourcePinV1;
    /** Exact persisted verification issues consumed by this investigation. */
    failureIssueIds?: string[];
    /** A new current-basis investigation preserves and supersedes this exact job. */
    supersedesQueryJobId?: string;
    decisionRef?: import('./goal-change.js').UserDecisionSnapshot['ref'];
};
