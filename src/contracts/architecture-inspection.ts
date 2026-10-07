// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
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
