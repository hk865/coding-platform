
// Completed-capability migration: selected original declarations, no legacy service port.
// ------------------------------------------------------------------------ //
// Change scope / risks / semantic classification                             //
// ------------------------------------------------------------------------ //
export type ChangeScopeV1 = {
    /** Machine-readable diff class, e.g. "docs-only" | "code-change" | "contract". */
    diffClass: string;
    /** Bounded file list (<= CHANGE_SCOPE_MAX_FILES). */
    changedFiles: string[];
    /** Bounded human summary (<= CHANGE_SCOPE_SUMMARY_MAX_BYTES). */
    writeSummary: string;
};
export const CHANGE_SCOPE_MAX_FILES = 64;
export type VerificationIssue = {
    path: string;
    message: string;
};
