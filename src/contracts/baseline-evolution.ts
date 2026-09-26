// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// CandidateArchitectureBaseline (deterministic materialization)             //
// ------------------------------------------------------------------------ //
export type CandidateArchitectureBaselineRef = {
    aggregateType: "CandidateArchitectureBaseline";
    projectId: string;
    workspaceId: string;
    candidateId: string;
};
// ------------------------------------------------------------------------ //
// ArchitectureChangeDecision (independent decision aggregate; plan change authority path is EXISTENCE evidence only) //
// ------------------------------------------------------------------------ //
export type ArchitectureChangeDecisionRef = {
    aggregateType: "ArchitectureChangeDecision";
    projectId: string;
    workspaceId: string;
    decisionId: string;
};
export type MigrationGateTaskRef = {
    aggregateType: "MigrationGateTask";
    projectId: string;
    workspaceId: string;
    gateId: string;
};
// ------------------------------------------------------------------------ //
// BaselineActivation record; the reference move reuses versioned-governance activation. //
// ------------------------------------------------------------------------ //
export type BaselineActivationRef = {
    aggregateType: "BaselineActivation";
    projectId: string;
    workspaceId: string;
    activationId: string;
};
