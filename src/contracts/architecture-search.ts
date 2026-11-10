/**
 * UI1 architecture search and current-work-scope DTOs.
 *
 * These are pure read shapes: the file layer is the projection of an observed
 * capture, the module layer is the FORMAL catalog (modules, submodules and
 * containment), and neither is a graph node. The reads that return them
 * (`architecture/find`, `architecture/work-scope`, `architecture/change-scope`)
 * are readonly: no commandId, no idempotency and no CAS.
 */
import type { ObservedCaptureRef } from './architecture-inspection.js';
import type { CommitCursor } from './command-event.js';
import type { ModuleRef } from './core/identity.js';
import type { RunRef, TaskTriple } from './dispatch.js';
import type { GoalRef } from './ledger.js';
import type { PlanRevisionRef } from './plan.js';

/** One searchable identity: an observed file path or a formal module. */
export type ArchitectureNodeRefV1 =
  | { kind: 'file'; path: string }
  | { kind: 'module'; ref: ModuleRef };

/**
 * One formal module/submodule group with its containment ancestors (root first,
 * excluding itself). `path` is the single declared path, `null` when the module
 * declares zero or several.
 */
export type ArchitectureGroupV1 = {
  ref: ModuleRef; name: string;
  path: string | null; paths: string[];
  ancestor: { ref: ModuleRef; name: string }[];
};

export type ArchitectureFileHitV1 = {
  kind: 'file'; nodeRef: ArchitectureNodeRefV1;
  /** The path's basename. */
  label: string; path: string; paths: [string];
  /** The longest legal declared-path owner; a tie or no owner is `null`. */
  module: ArchitectureGroupV1 | null;
  language: string; nonBlankLines: number;
  matchedOn: ('basename' | 'path' | 'module')[];
};

export type ArchitectureModuleHitV1 = {
  kind: 'module'; nodeRef: ArchitectureNodeRefV1;
  label: string; path: string | null; paths: string[];
  module: ArchitectureGroupV1; matchedOn: ('name' | 'path' | 'ancestor')[];
};

export type ArchitectureFindRequestV1 = {
  needle: string; page: { afterCursor: string | null; limit: number };
};

/** The search outcome; `counts` is the full pre-page count. */
export type ArchitectureFindResultV1 = {
  /** The normalized needle, not the caller's original text. */
  needle: string;
  items: (ArchitectureFileHitV1 | ArchitectureModuleHitV1)[];
  counts: { files: number; modules: number; total: number };
  nextCursor: string | null;
  sources: {
    fileGraph: { availability: 'available' | 'not_observed'; captureRef: ObservedCaptureRef | null };
    catalog: { availability: 'available' | 'not_adopted'; revision: number | null };
  };
  readThrough: CommitCursor | null;
};

/** One live Run row of `architecture/work-scope` (one row per Run, never merged). */
export type WorkScopeRunV1 = {
  ref: RunRef; task: TaskTriple; planRef: PlanRevisionRef;
  status: 'starting' | 'running';
  /** `envelope.permissions.writeScope`; no envelope is unknown, not empty. */
  writeScope: string[] | null;
};

export type WorkScopeTaskV1 = { goalId: string; taskId: string };

export type WorkScopeFileV1 = {
  kind: 'file'; nodeRef: { kind: 'file'; path: string };
  label: string; path: string; module: ArchitectureGroupV1 | null;
  tasks: WorkScopeTaskV1[];
};

export type WorkScopeModuleV1 = {
  kind: 'module'; nodeRef: { kind: 'module'; ref: ModuleRef };
  label: string; module: ArchitectureGroupV1;
  files: string[]; tasks: WorkScopeTaskV1[];
  /** A task claimed this module without listing planned files. */
  claimedWithoutFiles: boolean;
};

export type ArchitectureWorkScopeV1 = {
  workspace: { projectId: string; workspaceId: string };
  runs: WorkScopeRunV1[]; files: WorkScopeFileV1[]; modules: WorkScopeModuleV1[];
  counts: { runs: number; files: number; modules: number };
  sources: { catalog: 'available' | 'not_adopted' };
};

/** The files the current Goal's Runs actually changed, summed by each file's one
 *  owning module. The source is `GoalExecutedFilesPort` (`RunActivity.changedFiles`),
 *  never the plan's `plannedFiles` and never the workspace's uncommitted files. */
export type ArchitectureChangeScopeV1 = {
  goalRef: GoalRef;
  /** One row per path; a path any Run changed definitely is `definite` (the
   *  `graph/detail` rule). `moduleRef`/`interfaceId` are the layered ownership;
   *  `interfaceId` is the module's interface id, `null` outside every interface. */
  files: {
    path: string;
    moduleRef: ModuleRef | null;
    interfaceId: string | null;
    certainty: 'definite' | 'possible';
  }[];
  /** Owned files only, sorted by `moduleId`; `changed`/`possible` count distinct
   *  paths of the module itself (its interfaces' files included, its containment
   *  child modules' files not: those are on the child's own row). */
  modules: {
    moduleRef: ModuleRef;
    changed: number;
    possible: number;
  }[];
  counts: { files: number; changed: number; possible: number };
  /** `false` when the port says `possiblyIncomplete`: `changed` is then a lower
   *  bound and the page writes "改动至少 n". */
  complete: boolean;
  sourceCursor: CommitCursor | null;
};
