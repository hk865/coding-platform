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
