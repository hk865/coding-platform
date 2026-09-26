// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// Lease aggregates                                                          //
// ------------------------------------------------------------------------ //
export type WorkspaceReadLeaseRef = {
    aggregateType: "WorkspaceReadLease";
    projectId: string;
    leaseId: string;
};
export type WorkspaceReadLeaseIndexRef = {
    aggregateType: "WorkspaceReadLeaseIndex";
    projectId: string;
    workspaceId: string;
};
export type WorkspaceWriteLeaseRef = {
    aggregateType: "WorkspaceWriteLease";
    projectId: string;
    leaseId: string;
};
export type WorkspaceWriteLeaseIndexRef = {
    aggregateType: "WorkspaceWriteLeaseIndex";
    projectId: string;
    workspaceId: string;
};
