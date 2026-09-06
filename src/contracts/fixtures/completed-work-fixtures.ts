/**
 * P1-17 shared fixtures: completed-work selection scenario request/selection
 * builders used by BOTH adapter suites and the restart path.
 */
import type { RunRef } from "../dispatch.js";
import { canonicalJson } from "../fingerprint.js";
import type { CompletedWorkContextRequestV1, CompletedWorkSelectionItemV1 } from "../completed-work-context.js";
import { COMPLETED_WORK_MAX_SELECTED, COMPLETED_WORK_MAX_RELATED_REFS } from "../completed-work-context.js";
import { workContextRefFor } from "../context-continuity.js";

export const P117_PROJECT = "proj-alpha";
export const P117_WORKSPACE = "ws-shared";
export const P117_REQUEST = "req-p117-1";
export const P117_NEW_GOAL = "goal-p117-new";
export const P117_SCHEMA = "2026-09-06T00:00:00.000Z";

export function buildP117Request(deps: Partial<CompletedWorkContextRequestV1> = {}): CompletedWorkContextRequestV1 {
  return {
    schemaVersion: 1,
    requestId: P117_REQUEST,
    projectId: P117_PROJECT,
    workspaceId: P117_WORKSPACE,
    newWorkGoalId: P117_NEW_GOAL,
    newWorkKind: "task",
    relatedRefs: [{ kind: "module", refKey: "src/query", version: null }],
    applicableVersions: { planRef: null, planRevision: null, workspaceRevision: 1, governanceRevision: null },
    requestedByRunRef: { aggregateType: "Run", projectId: P117_PROJECT, goalId: P117_NEW_GOAL, runId: "run-p117-new" },
    declaredPermissions: { tools: ["read"], writeScope: [] },
    budget: { maxSelected: COMPLETED_WORK_MAX_SELECTED, maxBundleBytes: 256 * 1024 },
    ...deps,
  };
}

export function buildP117SelectionItem(workId: string, runRefs: RunRef[], noteKinds: string[]): CompletedWorkSelectionItemV1 {
  return {
    workRef: workContextRefFor(P117_PROJECT, P117_WORKSPACE, workId),
    workKind: "task",
    goalId: "goal-p117-1",
    taskId: "task-p117-work",
    runRefs: runRefs.map((r) => ({ ...r })),
    notes: noteKinds.map((kind, i) => ({
      noteRef: { aggregateType: "ExecutionNote", projectId: P117_PROJECT, workspaceId: P117_WORKSPACE, workId, noteId: "note-p117-" + String(i + 1) },
      kind,
      summary: "已完成工作的关键理由（第 " + String(i + 1) + " 条）",
      createdAt: P117_SCHEMA,
      sourceCursor: null,
    })),
    applicability: { status: "applicable", because: "同模块/接口范围内已完成工作的记录仍适用" },
    sources: [{ kind: "artifact", refKey: "body-p117-" + workId, version: "1", label: "已完成工作正文引用" }],
  };
}

export function p117ScopeKey(projectId: string, workspaceId: string): string {
  return canonicalJson({ projectId, workspaceId });
}
