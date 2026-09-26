
// Completed-capability migration: selected original declarations, no legacy service port.
/** Candidate source bytes. This is distinct from the complete exploration source pin. */
export interface CandidateWorkspaceSourcePort {
    digest(root: string): Promise<string>;
}
