/** Bounded query material compiled from canonical, scope-checked facts. */
import type { QueryContextPort, QueryContextRequestV1, QueryContextResultV1 } from "../../contracts/query-job.js";
import { QUERY_JOB_CONTEXT_BUNDLE_MAX_BYTES, QUERY_JOB_MAX_FOCUS_REFS, QUERY_JOB_QUESTION_MAX_BYTES } from "../../contracts/query-job.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import type { ArtifactPort } from "../../contracts/artifact.js";
import type { StateLedger, GoalSnapshot } from "../../contracts/ledger.js";
import type { PlanRevisionSnapshot } from "../../contracts/plan.js";

export type QueryContextCompilerDeps = { vault: ArtifactPort; ledger: StateLedger; now: () => string };
export class QueryContextCompilerImpl implements QueryContextPort {
  constructor(private readonly deps: QueryContextCompilerDeps) {}

  async assembleQueryContext(request: QueryContextRequestV1): Promise<QueryContextResultV1> {
    if (request.schemaVersion !== 1 || !request.queryJobRef || !request.question || Buffer.byteLength(request.question) > QUERY_JOB_QUESTION_MAX_BYTES || request.focusTaskRefs.length > QUERY_JOB_MAX_FOCUS_REFS) return { status: "rejected", code: "invalid_request", message: "shape invalid" };
    if (request.declaredPermissions.writeScope.length > 0 || request.declaredPermissions.tools.some((t) => t !== "read")) return { status: "rejected", code: "forbidden_tool_or_scope", message: "query context is read-only" };
    const { projectId, workspaceId } = request.queryJobRef;
    if (request.runRef.projectId !== projectId || request.runRef.workspaceId !== workspaceId || request.runRef.queryJobId !== request.queryJobRef.queryJobId) return { status: "rejected", code: "forbidden_tool_or_scope", message: "query run scope mismatch" };
    if (!Number.isSafeInteger(request.budget.maxBundleBytes) || request.budget.maxBundleBytes <= 0 || request.budget.maxBundleBytes > QUERY_JOB_CONTEXT_BUNDLE_MAX_BYTES) return { status: "needs_material", gaps: [{ code: "budget_exhausted", message: "bundle budget out of bounds" }] };
    const canonicalJob = await this.deps.ledger.load(request.queryJobRef);
    const job = canonicalJob.status === 'found' ? (canonicalJob.snapshot as import('../../contracts/query-job.js').QueryJobSnapshot).job : null;
    const execution = job?.intent.execution;
    if (execution && (canonicalJson(job!.runRef) !== canonicalJson(request.runRef) || job!.goalId !== request.goalId || job!.intent.question !== request.question || canonicalJson(execution.roleBinding) !== canonicalJson(request.roleBindingRef))) return { status: 'rejected', code: 'forbidden_tool_or_scope', message: 'role query differs from canonical intent' };
    if (request.focusTaskRefs.length === 0 && !execution) return { status: "needs_material", gaps: [{ code: "focus_not_found", message: "no focus task refs" }] };
    const focus = [];
    const selectedSources: { kind: string; refKey: string; version: string }[] = [];
    let goalContext = null;
    let acceptedPlan = null;
    if (execution) {
      if (!request.goalId) return { status: 'needs_material', gaps: [{ code: 'focus_not_found', message: 'role query requires an explicit goal' }] };
      const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: request.goalId };
      const found = await this.deps.ledger.load(goalRef);
      const workspace = await this.deps.ledger.load({ aggregateType: 'Workspace', projectId, workspaceId });
      if (found.status !== 'found' || workspace.status !== 'found') return { status: 'needs_material', gaps: [{ code: 'focus_not_found', message: 'goal or workspace missing' }] };
      const goal = found.snapshot as GoalSnapshot;
      if (goal.workspaceRef.workspaceId !== workspaceId) return { status: 'rejected', code: 'forbidden_tool_or_scope', message: 'goal workspace mismatch' };
      if (execution.kind === 'initial_coordination' && goal.activePlanRevision !== null) return { status: 'needs_material', gaps: [{ code: 'stale_versions', message: 'initial coordination requires no installed plan' }] };
      goalContext = { ref: goalRef, objective: goal.objective, revision: goal.revision, activePlanRevision: goal.activePlanRevision, workspaceRevision: workspace.snapshot.revision };
      selectedSources.push({ kind: 'goal', refKey: canonicalJson(goalRef), version: canonicalJson(goalContext) });
      if (goal.activePlanRevision) {
        const loaded = await this.deps.ledger.load(goal.activePlanRevision);
        if (loaded.status !== 'found') return { status: 'needs_material', gaps: [{ code: 'stale_versions', message: 'accepted plan missing' }] };
        acceptedPlan = loaded.snapshot as PlanRevisionSnapshot;
        selectedSources.push({ kind: 'plan', refKey: canonicalJson(acceptedPlan.ref), version: String(acceptedPlan.planRevision) });
      }
    }
    for (const ref of request.focusTaskRefs) {
      if (ref.projectId !== projectId || (request.goalId !== null && ref.goalId !== request.goalId)) return { status: "rejected", code: "forbidden_tool_or_scope", message: "focus scope mismatch" };
      const found = await this.deps.ledger.load({ aggregateType: "Goal", projectId, goalId: ref.goalId });
      if (found.status !== "found") return { status: "needs_material", gaps: [{ code: "focus_not_found", message: "focus goal missing" }] };
      const goal = found.snapshot as GoalSnapshot;
      if (goal.workspaceRef.workspaceId !== workspaceId) return { status: "rejected", code: "forbidden_tool_or_scope", message: "focus workspace mismatch" };
      const planResult = goal.activePlanRevision === null ? null : await this.deps.ledger.load(goal.activePlanRevision);
      const plan = planResult?.status === "found" ? planResult.snapshot as PlanRevisionSnapshot : null;
      const task = plan?.tasks.find((t) => t.taskId === ref.taskId);
      if (!plan || !task) return { status: "needs_material", gaps: [{ code: "focus_not_found", message: "focus task missing from current plan" }] };
      focus.push({ ref, goalRevision: goal.revision, planRef: plan.ref, planRevision: plan.planRevision, task });
      selectedSources.push({ kind: "task", refKey: canonicalJson(ref), version: canonicalJson({ goalRevision: goal.revision, planRef: plan.ref, planRevision: plan.planRevision }) });
    }
    const previousAnswers = [];
    let executionFeedback = null;
    if (execution?.feedback) {
      const f = execution.feedback;
      if (!goalContext || canonicalJson(goalContext.activePlanRevision) !== canonicalJson(f.planRef) || goalContext.workspaceRevision !== f.workspaceRevision)
        return {status:'needs_material',gaps:[{code:'stale_versions',message:'Execution feedback basis changed before investigation'}]};
      const opened = await this.deps.vault.open(f.reportRef,{requesterRunRef:request.runRef,
        currentBasis:{planRef:f.planRef,workspaceRevision:f.workspaceRevision,sourceDigest:f.sourcePin.manifestDigest,sourcePin:f.sourcePin},usage:'current'});
      if(opened.status!=='ready') return {status:'needs_material',gaps:[{code:'vault_unavailable',message:'Exact execution feedback is unavailable or forbidden'}]};
      executionFeedback = {source:f,report:JSON.parse(opened.record.body)};
      selectedSources.push({kind:'artifact',refKey:f.reportRef.digest,version:f.reportRef.digest});
    }
    const queryLoad = await this.deps.ledger.load(request.queryJobRef);
    if (queryLoad.status === "found") {
      const job = (queryLoad.snapshot as import("../../contracts/query-job.js").QueryJobSnapshot).job;
      for (const ref of job.answerRefs.slice(-4)) {
        const loaded = await this.deps.ledger.load(ref);
        if (loaded.status !== "found") return { status: "needs_material", gaps: [{ code: "stale_versions", message: "prior answer missing" }] };
        const prior = (loaded.snapshot as import("../../contracts/query-job.js").QueryJobAnswerSnapshot).answer;
        if (!prior.stale) previousAnswers.push({ ref, answer: prior.answer, sources: prior.sources });
      }
    }
    const bundle = { schemaVersion: 1, previousAnswers, queryJobRef: request.queryJobRef, question: request.question, focus, ...(execution ? { execution, goalContext, acceptedPlan, executionFeedback } : {}), selectedSources, noTranscript: true as const };
    const body = canonicalJson(bundle);
    const totalBytes = Buffer.byteLength(body);
    if (totalBytes > request.budget.maxBundleBytes) return { status: "needs_material", gaps: [{ code: "budget_exhausted", message: `query material requires ${totalBytes} bytes` }] };
    const put = await this.deps.vault.put({ contentType: "application/json", body, sourceRefs: selectedSources.map((s) => ({ kind: "artifact", refId: s.refKey, revision: s.version, digest: "" })), ownerRef: request.runRef, requestedAt: this.deps.now() });
    if (put.status !== "stored") return { status: "needs_material", gaps: [{ code: "vault_unavailable", message: "vault put failed" }] };
    return { status: "ready", bundleRef: put.ref, manifest: { queryJobRef: request.queryJobRef, selectedSources, truncated: [], totalBytes, freshnessCursor: null, noTranscript: true } };
  }
}
