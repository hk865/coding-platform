// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// Refs                                                                       //
// ------------------------------------------------------------------------ //
export type HandoffPacketRef = {
    aggregateType: "HandoffPacket";
    projectId: string;
    goalId: string;
    taskId: string;
    packetId: string;
};
export type ReplacementAttemptRef = {
    aggregateType: "ReplacementAttempt";
    projectId: string;
    goalId: string;
    taskId: string;
    /** The NEW (successor) attempt id — the attempt the ReplacementAttempt covers. */
    attemptId: string;
};
