// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { ArchitectureCatalogPinV1 } from './architecture-catalog.js';
import type { ModuleRef } from './core/identity.js';
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

// ------------------------------------------------------------------------ //
// Slice 8A architecture observation DTOs (decision 72 post-note; spec §2)   //
// ------------------------------------------------------------------------ //

/** The existing observed-architecture record ref (fields unchanged). */
export type ObservedCaptureRef = {
  aggregateType: 'ObservedArchitecture';
  projectId: string;
  workspaceId: string;
  captureId: string;
};

/** One formal-vs-observed finding; `certainty: 'unknown'` is never "missing". */
export type FormalObservedFindingV1 = {
  kind: 'dependency_missing' | 'import_undeclared' | 'ungrouped' | 'unresolved' | 'ambiguous' | 'cycle';
  moduleRef: ModuleRef | null;
  path: string | null;
  detail: string;
  certainty: 'proven' | 'unknown';
};

/** Read-only comparison of the adopted catalog against one capture. */
export type FormalObservedComparisonV1 = {
  catalog: ArchitectureCatalogPinV1;
  captureRef: ObservedCaptureRef;
  findings: FormalObservedFindingV1[];
  noVerdict: true;
};

/** One file-level observation node; `nonBlankLines` counted without a parser. */
export type FileGraphNodeV1 = {
  path: string;
  nonBlankLines: number;
  language: string;
};

/** One page of the file-level observation graph for one capture. */
export type FileGraphPageV1 = {
  captureRef: ObservedCaptureRef;
  nodes: FileGraphNodeV1[];
  edges: { from: string; to: string }[];
  nextCursor: string | null;
  complete: boolean;
  notCaptured?: true;
  /** Per-language coverage of the whole capture (8A item 7); `[]` when not captured. */
  languages: LanguageCoverageV1[];
};

/** Per-language coverage of the file-level observation graph. */
export type LanguageCoverageV1 = {
  language: string;
  files: number;
  parsed: number;
  edges: 'supported' | 'unsupported' | 'failed';
  reason: string | null;
  issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[];
  issueCount: number;
  complete: boolean;
};

/** Stored `issues` cap; `issueCount` carries the full count (spec §2). */
export const COVERAGE_ISSUES_MAX = 100;
