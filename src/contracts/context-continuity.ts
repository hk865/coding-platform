// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// Refs                                                                      //
// ------------------------------------------------------------------------ //
export type WorkContextRef = {
    aggregateType: "WorkContextBinding";
    projectId: string;
    workspaceId: string;
    /** The durable work identity (per (projectId, workspaceId); local id). */
    workId: string;
};
