/**
 * P1-17 ContextCompiler.CompletedWorkContextPort — applicability-annotated
 * selection of COMPLETED work for a related new task (selection ONLY; zero
 * ledger writes; no MemoryStore).
 */
import type { CompletedWorkContextPort, CompletedWorkContextRequestV1, CompletedWorkContextResultV1, CompletedWorkSelectionItemV1, CompletedWorkGap } from "../contracts/completed-work-context.js";
import { COMPLETED_WORK_MAX_NOTES, COMPLETED_WORK_MAX_SELECTED } from "../contracts/completed-work-context.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";
import type { WorkContextBindingSnapshot } from "../contracts/context-continuity.js";

export type CompletedWorkCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  readModel: ReadModelIndex;
  now: () => string;
};

export class CompletedWorkContextCompilerImpl implements CompletedWorkContextPort {
  private readonly deps: CompletedWorkCompilerDeps;

  constructor(deps: CompletedWorkCompilerDeps) {
    this.deps = deps;
  }

  async assembleCompletedWorkContext(request: CompletedWorkContextRequestV1): Promise<CompletedWorkContextResultV1> {
    if (request.schemaVersion !== 1 || !request.requestId || !request.projectId || !request.workspaceId) {
      return { status: "rejected", code: "invalid_request", message: "schemaVersion/ids required" };
    }
    if (request.declaredPermissions.writeScope.length > 0 || request.declaredPermissions.tools.some((t) => t !== "read")) {
      return { status: "rejected", code: "forbidden_tool_or_scope", message: "completed-work selection is read-only" };
    }
    if (request.budget.maxSelected < 1 || request.budget.maxSelected > COMPLETED_WORK_MAX_SELECTED) {
      return { status: "rejected", code: "budget_exhausted", message: "maxSelected out of bounds" };
    }
    if (request.budget.maxBundleBytes <= 0 || request.budget.maxBundleBytes > 256 * 1024) {
      return { status: "rejected", code: "budget_exhausted", message: "maxBundleBytes out of bounds" };
    }

    const view = await this.deps.readModel.completedWorkView({ projectId: request.projectId, workspaceId: request.workspaceId });
    if (view.status === "not_ready") {
      return { status: "needs_material", gaps: [{ code: "stale_versions", message: "projection not ready" }], selectedRefs: [] };
    }
    if (view.status === "not_found" || view.rows.length === 0) {
      return { status: "needs_material", gaps: [{ code: "no_records", message: "no completed work records in scope" }], selectedRefs: [] };
    }

    const gaps: CompletedWorkGap[] = [];
    const changedPremises: { workRef: import("../contracts/context-continuity.js").WorkContextRef; premise: string; reason: string }[] = [];
    const selected: CompletedWorkSelectionItemV1[] = [];

    for (const row of view.rows) {
      if (selected.length >= request.budget.maxSelected) break;
      if (row.goalId !== null && row.goalId === request.newWorkGoalId) continue;
      const wc = await this.deps.readModel.workContext({ projectId: request.projectId, workspaceId: request.workspaceId, workId: row.workRef.workId });
      const notes = wc.status === "ready" ? wc.notes.slice(0, COMPLETED_WORK_MAX_NOTES) : [];
      const matched = request.relatedRefs.some((ref) =>
        row.workKind.includes(ref.refKey) || row.taskId?.includes(ref.refKey) || notes.some((n) => n.summary.includes(ref.refKey)),
      );
      const wsChanged = request.applicableVersions.workspaceRevision !== null && request.applicableVersions.workspaceRevision !== 0;
      const applicability: CompletedWorkSelectionItemV1["applicability"] = matched
        ? { status: "applicable", because: "related module/interface matched" }
        : { status: "historical_explanation", because: "related refs not matched", premiseChanged: wsChanged ? "workspace revision changed" : null };
      if (wsChanged && matched) {
        changedPremises.push({ workRef: row.workRef, premise: "workspace revision", reason: "request version differs from the stored work version" });
      }
      selected.push({
        workRef: row.workRef,
        workKind: row.workKind,
        goalId: row.goalId,
        taskId: row.taskId,
        runRefs: (wc.status === "ready" ? wc.binding.binding.linkedRunRefs : []).map((r) => ({ ...r })),
        notes: notes.map((n) => ({ noteRef: n.noteRef, kind: n.kind, summary: n.summary, createdAt: n.createdAt, sourceCursor: n.sourceCursor })),
        applicability,
        sources: [{ kind: "binding", refKey: canonicalJson(row.workRef), version: "1", label: "work binding" }],
      });
    }

    if (selected.length === 0) {
      gaps.push({ code: "no_records", message: "no eligible completed work after filtering" });
    }

    const selection = {
      schemaVersion: 1 as const,
      selectionId: "sel-" + request.requestId,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      requestedByRunRef: { ...request.requestedByRunRef },
      applicableVersions: request.applicableVersions,
      selected,
      gaps,
      changedPremises,
      generatedAt: this.deps.now(),
      bodyRef: null as unknown as import("../contracts/artifact.js").ArtifactRef,
    };
    const body = canonicalJson(selection);
    if (Buffer.byteLength(body, "utf8") > request.budget.maxBundleBytes) {
      return { status: "needs_material", gaps: [{ code: "over_budget", message: "selection exceeds maxBundleBytes" }], selectedRefs: [] };
    }
    const put = await this.deps.vault.put({ contentType: "application/json", body, sourceRefs: [{ kind: "artifact", refId: selection.selectionId, revision: "1", digest: "" }], ownerRef: request.requestedByRunRef, requestedAt: selection.generatedAt });
    if (put.status !== "stored") {
      return { status: "needs_material", gaps: [{ code: "missing_body", message: put.status === "rejected" ? put.issues.join("; ") : "vault unavailable" }], selectedRefs: [] };
    }
    selection.bodyRef = put.ref;
    return {
      status: "ready",
      selectionRef: put.ref,
      manifest: {
        requestId: request.requestId,
        selectedCount: selected.length,
        gapCount: gaps.length,
        changedPremiseCount: changedPremises.length,
        freshness: { observedCursor: view.status === "ready" ? view.sourceCursor : null, worksCursor: view.status === "ready" ? view.sourceCursor : null, notesCursor: view.status === "ready" ? view.sourceCursor : null },
        totalBytes: Buffer.byteLength(canonicalJson(selection), "utf8"),
      },
    };
  }
}

export type { WorkContextBindingSnapshot };
