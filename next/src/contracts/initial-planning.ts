// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
export type InitialPlanAssignment = {
    taskId: string;
    role: string;
    instruction: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
export type InitialPlanOrigin = {
    kind: 'model_coordination';
    answerRef: import('./query-job.js').QueryJobAnswerRef;
    answerDigest: string;
    goalRevision: number;
    workspaceRevision: number;
    requestId: string;
    summary: string;
    assignments: InitialPlanAssignment[];
};
