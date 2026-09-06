/**
 * P1-17 Completed-work context contracts — CompletedWorkContextRequest /
 * ExecutionMemorySelection (first consumer freeze of
 * ContextCompiler.CompletedWorkContextPort).
 *
 * Authority:
 *   - dev_docs/planning/proposed/P1-foundation/tickets/17-completed-work-context.md
 *     (6 Acceptance items; restart / old-premise / scope-isolation / missing
 *      records / no-automatic-validity)
 *   - dev_docs/interfaces/context-lifecycle.md (复用 P1-16 记录与 Context 编译；
 *      文本/精确引用；不等待 P1-12 图索引；作者身份不限制合法接手；旧授权/旧
 *      Task phase/旧 Evidence 自动有效性不得继承)
 *   - ARCHITECTURE.md invariant #14 (archive is never the current source)
 *
 * FROZEN semantics:
 *   - SELECTION ONLY: this ticket reads persisted facts (P1-16 WorkContext
 *     bindings + ExecutionNotes + continuations; P1-05 GoalPhase completion
 *     facts) and composes an applicability-annotated selection of COMPLETED
 *     work for a related NEW task. NO new aggregate, NO new event, NO write
 *     to Work/Note/Task/Goal state; no MemoryStore (works on the durable
 *     records already in the ledger).
 *   - Applicability is EXPLICIT: each selected work gets
 *     "applicable" | "historical_explanation" | "gap", plus changedPremise
 *     (which premise changed and why) when a recorded premise no longer
 *     holds. A gap is never disguised as ready.
 *   - Scope isolation: selection is per (projectId, workspaceId); cross-scope
 *     requests are rejected (permission_denied / cross_scope).
 *   - Missing records / missing body / budget exceed / no permission are
 *     EXPLICIT gaps; original sources are preserved (completed work never
 *     deletes references).
 *   - P1-05 rules stay untouched: required sets and Evidence completion rules
 *     are authoritative — history retrieval never writes completion state.
 *   - The response is bound to the requesting run + the requested versions
 *     (current spec/code snapshot via normal versioned sources is a READ
 *     contract of the REQUIRED material; the selection reports its
 *     sources + freshness).
 */
import type { CommitCursor } from "./command-event.js";
import type { RunRef } from "./dispatch.js";
import type { ArtifactRef } from "./artifact.js";
import type { ExecutionNoteRef, WorkContextRef } from "./context-continuity.js";

export const COMPLETED_WORK_MAX_SELECTED = 8;
export const COMPLETED_WORK_MAX_RELATED_REFS = 32;
export const COMPLETED_WORK_MAX_NOTES = 64;
export const COMPLETED_WORK_MAX_SOURCES = 64;
export const COMPLETED_WORK_SELECTION_MAX_BYTES = 64 * 1024;
export const COMPLETED_WORK_BUNDLE_MAX_BYTES = 256 * 1024;

export type CompletedWorkRelatedRef = {
  kind: "module" | "interface" | "path" | "api" | "spec" | "type";
  /** Canonical ref key (e.g. moduleRef / interfaceRef / path prefix). */
  refKey: string;
  version: string | null;
};

export type CompletedWorkContextRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  /** The NEW related task/work the selection is compiled for. */
  newWorkGoalId: string | null;
  newWorkKind: "task" | "coordination" | "query";
  /** What the new work touches (module/interface/path/spec). */
  relatedRefs: CompletedWorkRelatedRef[];
  /** Optional plan/governance versions the selection must be fresh to. */
  applicableVersions: {
    planRef: import("./plan.js").PlanRevisionRef | null;
    planRevision: number | null;
    workspaceRevision: number;
    governanceRevision: string | null;
  };
  /** The requesting run (the new task's run; owner of any vault body). */
  requestedByRunRef: RunRef;
  declaredPermissions: { tools: string[]; writeScope: string[] };
  budget: { maxSelected: number; maxBundleBytes: number };
};

export type CompletedWorkApplicability =
  | { status: "applicable"; because: string }
  | { status: "historical_explanation"; because: string; premiseChanged: string | null }
  | { status: "gap"; because: string; missing: string[] };

export type CompletedWorkSelectionItemV1 = {
  workRef: WorkContextRef;
  workKind: string;
  goalId: string | null;
  taskId: string | null;
  /** The runs that participated (bounded from the binding). */
  runRefs: RunRef[];
  notes: {
    noteRef: ExecutionNoteRef;
    kind: string;
    summary: string;
    createdAt: string;
    sourceCursor: CommitCursor | null;
  }[];
  applicability: CompletedWorkApplicability;
  /** Sourced references the item is based on (bounded; original stays authoritative). */
  sources: { kind: string; refKey: string; version: string | null; label: string | null }[];
};

export type CompletedWorkGap =
  | { code: "no_records"; message: string }
  | { code: "missing_body"; message: string }
  | { code: "over_budget"; message: string }
  | { code: "cross_scope"; message: string }
  | { code: "permission_denied"; message: string }
  | { code: "stale_versions"; message: string };

/** The durable-composition contract: an applicability-annotated selection of
 * COMPLETED work for a related new task. READ-ONLY composition of persisted
 * P1-16/P1-05 facts. */
export type ExecutionMemorySelectionV1 = {
  schemaVersion: 1;
  selectionId: string;
  projectId: string;
  workspaceId: string;
  requestedByRunRef: RunRef;
  applicableVersions: CompletedWorkContextRequestV1["applicableVersions"];
  selected: CompletedWorkSelectionItemV1[];
  /** Explicit gaps (never disguised as ready). */
  gaps: CompletedWorkGap[];
  /** Premises that changed and were re-evaluated (stale rationale detected). */
  changedPremises: { workRef: WorkContextRef; premise: string; reason: string }[];
  generatedAt: string;
  bodyRef: ArtifactRef;
};

export type CompletedWorkContextResultV1 =
  | {
      status: "ready";
      selectionRef: ArtifactRef;
      manifest: {
        requestId: string;
        selectedCount: number;
        gapCount: number;
        changedPremiseCount: number;
        freshness: {
          observedCursor: CommitCursor | null;
          worksCursor: CommitCursor | null;
          notesCursor: CommitCursor | null;
        };
        totalBytes: number;
      };
    }
  | { status: "needs_material"; gaps: CompletedWorkGap[]; selectedRefs: ArtifactRef[] }
  | { status: "rejected"; code: "invalid_request" | "work_not_found" | "forbidden_tool_or_scope" | "budget_exhausted" | "unavailable"; message: string };

export type CompletedWorkViewQuery = {
  projectId: string;
  workspaceId: string;
  /** Optional completed-work filter by goalId (display only). */
  goalId?: string;
};

export type CompletedWorkViewRow = {
  workRef: WorkContextRef;
  workKind: string;
  goalId: string | null;
  taskId: string | null;
  noteCount: number;
  continuationCount: number;
  sourceCursor: CommitCursor;
};

export type CompletedWorkViewResult =
  | { status: "ready"; rows: CompletedWorkViewRow[]; sourceCursor: CommitCursor }
  | { status: "not_ready"; observedCursor: CommitCursor | null }
  | { status: "not_found"; projectId: string; workspaceId: string };

/** ContextCompiler.CompletedWorkContextPort (interfaces_to_freeze — first consumer). */
export interface CompletedWorkContextPort {
  assembleCompletedWorkContext(request: CompletedWorkContextRequestV1): Promise<CompletedWorkContextResultV1>;
}
