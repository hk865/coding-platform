// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// Refs                                                                      //
// ------------------------------------------------------------------------ //
export type ArchitectureInspectionRef = {
    aggregateType: "ArchitectureInspection";
    projectId: string;
    workspaceId: string;
    inspectionId: string;
};
export type ArchitectureFindingRef = {
    aggregateType: "ArchitectureFinding";
    projectId: string;
    workspaceId: string;
    findingId: string;
};
export type ArchitectureDecisionBriefRef = {
    aggregateType: "ArchitectureDecisionBrief";
    projectId: string;
    workspaceId: string;
    briefId: string;
};
export type ArchitectureCandidateProposalRef = {
    aggregateType: "ArchitectureCandidateProposal";
    projectId: string;
    workspaceId: string;
    proposalId: string;
};
// ------------------------------------------------------------------------ //
// CodeGraph value types                                                     //
// ------------------------------------------------------------------------ //
export type CodeGraphNode = {
    nodeId: string;
    kind: "module" | "interface" | "type" | "function" | "file";
    name: string;
    path: string;
    /** Canonical structural key of the node (deterministic identity in diffs). */
    structuralKey: string;
    /** Digest of the node's normalized content (change detection). */
    contentDigest: string;
};
export type CodeGraphEdge = {
    edgeId: string;
    fromNode: string;
    toNode: string;
    kind: "module_dependency" | "interface_uses" | "type_references" | "calls";
    structuralKey: string;
};
