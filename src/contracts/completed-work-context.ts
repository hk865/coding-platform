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
 * Semantics:
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
 *
 * RW-18 修订（跨工作历史的准入判据）：
 *   - 这个端口**不**判定"这次运行能不能读别的工作的历史"。它只在 scope 内选材，
 *     `declaredPermissions` 是调用方如实的**审计回显**（这条运行实际持有的工具与写入范围），
 *     **不是**准入条件。曾经它被当成准入条件（"只有只读运行才能取已完成工作选材"），那是把两件事
 *     混在一起：只读是运行自身的执行权限，读别人的历史是**对那段历史的访问权限**，两者正交。
 *   - 真正的准入在**派发时编译历史材料**的那一步（data/context-compiler/work-run-materials.ts 的
 *     selectHistory）：逐条材料向既有授权权威（ArtifactVault + Control 登记的 `MaterialAccessGrant`
 *     历史授权）求证"这个申请者是否有权读这段工作的运行历史"，未获授权即如实缺项，绝不静默放行。
 *     判据不在这两个文件里重写一遍 —— 授权规则只有既有 Vault／Control 那一份。
 *   - 边界：本条约束针对**其它工作的运行历史**。记忆与开发记忆是平台的长期记忆，允许被检索；
 *     同一段工作自己的留痕（work-notes）也走既有通道，不受此限。
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
  /**
   * 这条请求运行**实际持有**的工具与写入范围（审计回显）。
   *
   * 它**不是**历史访问的准入判据：准入由"是否被授权读那段工作的历史"决定（见文件头），
   * 与这条运行是不是只读无关。写入型运行不会因为"能写工作区"自动获得历史访问权限，
   * 只读运行也不会因为"只读"自动获得它。调用方必须如实填写（不得为了通过某个判据伪造更窄的声明）。
   */
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
    /** Recorded facts, not reconstructed reasons; additive for older selections. */
    reason?: string;
    alternatives?: string[];
    sourceRefs?: import("./context-continuity.js").ExecutionNoteV1["sourceRefs"];
    applicableVersions?: import("./context-continuity.js").ExecutionNoteV1["applicableVersions"];
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
  /**
   * RW-15（M1）：本行代表的那个 (goal, task) 在账本里**还有几条落选身份被归并掉了**。
   * 0 = 没有发生归并。归并本身沿用 RW-13 的**唯一**选择规则（显式声明的身份优先于推导兜底身份，
   * 同为显式取账本顺序最早），这里只是把"发生过归并、落选者是谁"变成可见事实 —— 此前它被静默丢弃，
   * 落选身份的留痕既不出现在本视图，也不会进入历史选材，读的人无从知道。
   */
  duplicateIdentityCount: number;
  /**
   * 落选身份的精确引用（按 canonical 形式排序，两套后端同序）。它们**不被改名、不被删除**：
   * 仍是不可变历史事实，可按 workId 用 workContextView 直接读取；本视图只是不再让它们代表该任务。
   */
  droppedWorkRefs: WorkContextRef[];
};

export type CompletedWorkViewResult =
  | { status: "ready"; rows: CompletedWorkViewRow[]; sourceCursor: CommitCursor }
  | { status: "not_ready"; observedCursor: CommitCursor | null }
  | { status: "not_found"; projectId: string; workspaceId: string };

/** ContextCompiler.CompletedWorkContextPort (interfaces_to_freeze — first consumer). */
export interface CompletedWorkContextPort {
  assembleCompletedWorkContext(request: CompletedWorkContextRequestV1): Promise<CompletedWorkContextResultV1>;
}
