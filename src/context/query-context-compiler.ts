/** P1-09 ContextCompiler.QueryContextPort — bounded read-only query context. */
import type { QueryContextPort, QueryContextRequestV1, QueryContextResultV1 } from "../contracts/query-job.js";
import { QUERY_JOB_CONTEXT_BUNDLE_MAX_BYTES } from "../contracts/query-job.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import type { ArtifactPort } from "../contracts/artifact.js";

export type QueryContextCompilerDeps = { vault: ArtifactPort; now: () => string };

export class QueryContextCompilerImpl implements QueryContextPort {
  private readonly deps: QueryContextCompilerDeps;
  constructor(deps: QueryContextCompilerDeps) { this.deps = deps; }

  async assembleQueryContext(request: QueryContextRequestV1): Promise<QueryContextResultV1> {
    if (request.schemaVersion !== 1 || !request.queryJobRef || !request.question) return { status: "rejected", code: "invalid_request", message: "shape invalid" };
    if (request.declaredPermissions.writeScope.length > 0 || request.declaredPermissions.tools.some((t) => t !== "read")) return { status: "rejected", code: "forbidden_tool_or_scope", message: "query context is read-only" };
    if (request.budget.maxBundleBytes <= 0 || request.budget.maxBundleBytes > QUERY_JOB_CONTEXT_BUNDLE_MAX_BYTES) return { status: "needs_material", gaps: [{ code: "budget_exhausted", message: "bundle budget out of bounds" }] };
    if (request.focusTaskRefs.length === 0) return { status: "needs_material", gaps: [{ code: "focus_not_found", message: "no focus task refs" }] };
    const bundle = {
      schemaVersion: 1,
      queryJobRef: request.queryJobRef,
      question: request.question,
      focus: request.focusTaskRefs,
      selectedSources: request.focusTaskRefs.map((r) => ({ kind: "task", refKey: r.taskId, version: "1" })),
      noTranscript: true as const,
      generatedAt: this.deps.now(),
    };
    const body = canonicalJson(bundle);
    const put = await this.deps.vault.put({ contentType: "application/json", body, sourceRefs: [{ kind: "artifact", refId: request.requestId, revision: "1", digest: "" }], ownerRef: request.requestedByRunRef ?? { aggregateType: "Run", projectId: request.queryJobRef.projectId, goalId: "query", runId: "query-owner-" + request.queryJobRef.queryJobId }, requestedAt: bundle.generatedAt });
    if (put.status !== "stored") return { status: "needs_material", gaps: [{ code: "vault_unavailable", message: "vault put failed" }] };
    return { status: "ready", bundleRef: put.ref, manifest: { queryJobRef: request.queryJobRef, selectedSources: bundle.selectedSources, truncated: [], totalBytes: Buffer.byteLength(body), freshnessCursor: null, noTranscript: true } };
  }
}
