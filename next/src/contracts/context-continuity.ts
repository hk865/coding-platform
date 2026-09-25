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
export type ExecutionNoteRef = {
    aggregateType: "ExecutionNote";
    projectId: string;
    workspaceId: string;
    workId: string;
    noteId: string;
};
export type ContinuationRecordRef = {
    aggregateType: "ContinuationRecord";
    projectId: string;
    workspaceId: string;
    workId: string;
    reportId: string;
};
