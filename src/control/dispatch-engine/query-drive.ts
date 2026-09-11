/** Query dispatch uses the persisted Job/Run pair as its outbox.
 * A CAS start commit precedes the runtime call. A stranded running claim is
 * reported as outcome_unknown and never restarted implicitly.
 */
import type { StateLedger } from "../../contracts/ledger.js";
import type { ControlEngine } from "../../contracts/modules.js";
import type { ArtifactPort } from "../../contracts/artifact.js";
import type { CommitCursor } from "../../contracts/command-event.js";
import type { QueryJobDrivePort, QueryJobDriveTrigger, QueryJobDriveResult, QueryContextPort, ReadOnlyQueryPort, QueryJobSnapshot, QueryJobRef, QueryRunRef, QueryContextRequestV1, QueryJobAnswerV1, ReadOnlyQueryResultV1 } from "../../contracts/query-job.js";
import { QUERY_JOB_CONTEXT_BUNDLE_MAX_BYTES, QUERY_JOB_ANSWER_MAX_BYTES, queryRunRefFor } from "../../contracts/query-job.js";
import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";
import { materialAccessGrantIdFor } from '../../contracts/material-access.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../../contracts/commands/material-access.js';

export type QueryJobDriveDeps = { ledger: StateLedger; control: Pick<ControlEngine,'closeQueryJob'|'startQueryJob'|'recordQueryAnswer'|'grantMaterialAccess'>; vault: ArtifactPort; context: QueryContextPort; runtime: ReadOnlyQueryPort; now: () => string };
export class QueryJobDriveEngineImpl implements QueryJobDrivePort {
  private readonly refs = new Map<string, { jobRef: QueryJobRef; runRef: QueryRunRef | null }>();
  private cursor: CommitCursor | null = null;
  constructor(private readonly deps: QueryJobDriveDeps) {}

  async driveQuery(trigger: QueryJobDriveTrigger): Promise<QueryJobDriveResult> {
    const result: QueryJobDriveResult = { scanned: 0, started: 0, answered: 0, closed: 0, failures: [] };
    const refs = this.refs;
    // Rebuild intent identities from durable events; always load current state
    // before driving. This also recovers legacy pending jobs with runRef=null.
    for (;;) {
      const page = await this.deps.ledger.events({ afterCursor: this.cursor, limit: 256 });
      for (const { event } of page.events) {
        if (event.eventType === "QueryJobSubmitted") {
          const job = event.payload.job;
          const jobRef: QueryJobRef = { aggregateType: "QueryJob", projectId: job.projectId, workspaceId: job.workspaceId, queryJobId: job.queryJobId };
          refs.set(canonicalJson(jobRef), { jobRef, runRef: job.runRef });
        } else if (event.eventType === "QueryRunStarted") {
          const entry = refs.get(canonicalJson(event.payload.run.queryJobRef));
          if (entry) entry.runRef = queryRunRefFor(entry.jobRef.projectId, entry.jobRef.workspaceId, entry.jobRef.queryJobId, event.payload.run.runId);
        }
      }
      this.cursor = page.throughCursor;
      if (!page.hasMore) break;
    }
    const max = trigger.maxIntents ?? 8;
    if (!Number.isSafeInteger(max) || max < 1) return result;
    for (const { jobRef, runRef: recoveredRunRef } of refs.values()) {
      const loaded = await this.deps.ledger.load(jobRef);
      if (loaded.status !== "found") continue;
      let snapshot = loaded.snapshot as QueryJobSnapshot;
      const job = snapshot.job;
      if (job.status === "closed" || (job.status === "answered" && job.answerRefs.length >= job.intent.multiTurn.maxRounds)) continue;
      if (result.scanned >= max) break;
      result.scanned++;
      const runRef = job.runRef ?? recoveredRunRef;
      const fail = (code: string, message: string) => result.failures.push({ intentId: job.intent.intentId, code, message });
      if (!runRef) { fail("run_not_found", "pending query has no associated run"); continue; }
      const key = sha256Hex(canonicalJson(jobRef));
      const close = async (code: "timeout" | "gap" | "failed", message: string) => {
        const receipt = await this.deps.control.closeQueryJob({ schemaVersion: 1, commandType: "CloseQueryJob", commandId: `query-close-${key}-${snapshot.revision}`, identity: { projectId: job.projectId, actor: { kind: "system", id: "query-dispatch" }, idempotencyKey: `query-close-${key}-${snapshot.revision}` }, aggregateId: job.queryJobId, expectedRevision: snapshot.revision, correlationId: job.intent.correlationId, submittedAt: this.deps.now(), payload: { jobRef, runRef, reason: { code, message } } });
        if (receipt.status === "committed") result.closed++; else fail(receipt.code, "query close rejected");
      };
      const deadline = job.intent.budget.deadline;
      if (deadline !== null && Date.parse(deadline) <= Date.parse(this.deps.now())) { await close("timeout", "query deadline elapsed"); continue; }
      if (job.status === "running") { fail("outcome_unknown", "query was already claimed; no implicit runtime restart"); continue; }
      const round = job.answerRefs.length + 1;
      const roundBudget = job.intent.execution?.runtimeBudget.contextWindowTokens ?? (Math.floor(job.intent.budget.maxTokens / job.intent.multiTurn.maxRounds) + (round <= job.intent.budget.maxTokens % job.intent.multiTurn.maxRounds ? 1 : 0));
      if (roundBudget === 0) { await close("failed", "query token budget exhausted"); continue; }
      const request: QueryContextRequestV1 = { schemaVersion: 1, requestId: `query-context-${key}-${round}`, queryJobRef: jobRef, runRef, goalId: job.goalId, question: job.intent.question, focusTaskRefs: job.intent.focusTaskRefs, requestedByRunRef: null, roleBindingRef: job.intent.execution?.roleBinding ?? { schemaVersion: 1, bindingId: "query-reader", templateId: "query-reader", templateRevision: "1", bindingVersion: 1, policyRevision: "read-only-v1" }, declaredPermissions: { tools: ["read"], writeScope: [] }, budget: { maxBundleBytes: QUERY_JOB_CONTEXT_BUNDLE_MAX_BYTES } };
      try {
        const caps = this.deps.runtime.capabilities({ runRef });
        if (!caps.supported || !caps.readOnly || Buffer.byteLength(request.question) > caps.maxQuestionBytes) { await close("failed", "query runtime capability unavailable"); continue; }
        const feedback = job.intent.execution?.feedback;
        if (feedback && job.goalId) {
          const basis = {planRef:feedback.planRef,workspaceRevision:feedback.workspaceRevision,sourceDigest:feedback.sourcePin.manifestDigest,sourcePin:feedback.sourcePin};
          const grantId = materialAccessGrantIdFor(runRef,[feedback.reportRef],basis);
          const grant = buildMaterialAccessGrantV1({grantId,scope:{projectId:job.projectId,workspaceId:job.workspaceId,goalId:job.goalId},
            materials:[feedback.reportRef],reader:runRef,issuedBy:{aggregateType:'Control',projectId:job.projectId,goalId:job.goalId},
            purpose:'Investigate this exact execution feedback in a separate readonly coordinator',basis,grantedAt:job.submittedAt});
          const receipt = await this.deps.control.grantMaterialAccess(buildGrantMaterialAccessCommand(grant,{commandId:grantId,projectId:job.projectId,
            actorKind:'system',actorId:'feedback-dispatch',idempotencyKey:grantId,correlationId:job.intent.correlationId,submittedAt:job.submittedAt}));
          if(receipt.status!=='committed') { await close('gap','Feedback source permission unavailable: '+receipt.code); continue; }
        }
        const assembled = await this.deps.context.assembleQueryContext(request);
        if (assembled.status !== "ready") { await close("gap", assembled.status === "needs_material" ? assembled.gaps.map((g) => g.message).join("; ") : assembled.message); continue; }
        const start = await this.deps.control.startQueryJob({ schemaVersion: 1, commandType: "StartQueryJob", commandId: `query-start-${key}-${round}`, identity: { projectId: job.projectId, actor: { kind: "system", id: "query-dispatch" }, idempotencyKey: `query-start-${key}-${round}` }, aggregateId: job.queryJobId, expectedRevision: snapshot.revision, correlationId: job.intent.correlationId, submittedAt: this.deps.now(), payload: { jobRef, runRef } });
        if (start.status !== "committed" || start.replayed) continue;
        result.started++;
        snapshot = { ...snapshot, revision: start.revision };
        let timer: ReturnType<typeof setTimeout> | undefined;
        let answer: ReadOnlyQueryResultV1;
        try {
          const work = this.deps.runtime.startQuery({ runRef, bundleRef: assembled.bundleRef, question: request.question, budget: { maxTokens: roundBudget } });
          answer = deadline === null ? await work : await Promise.race([work, new Promise<ReadOnlyQueryResultV1>((resolve) => { timer = setTimeout(() => resolve({ schemaVersion: 1, runRef, outcome: "timeout", answer: null, sources: [], message: "query deadline elapsed", endedAt: this.deps.now() }), Math.max(0, Date.parse(deadline) - Date.parse(this.deps.now()))); })]);
        } finally { if (timer !== undefined) clearTimeout(timer); }
        if (answer.outcome !== "answered" || answer.answer === null) { await close(answer.outcome === "timeout" ? "timeout" : answer.outcome === "gap" ? "gap" : "failed", answer.message ?? "query failed"); continue; }
        if (canonicalJson(answer.runRef) !== canonicalJson(runRef) || Buffer.byteLength(answer.answer) > Math.min(caps.maxAnswerBytes, QUERY_JOB_ANSWER_MAX_BYTES)) { await close("failed", "runtime returned invalid identity or oversized answer"); continue; }
        const refreshed = await this.deps.context.assembleQueryContext(request);
        const stale = refreshed.status !== "ready" || canonicalJson(refreshed.manifest.selectedSources) !== canonicalJson(assembled.manifest.selectedSources);
        if (answer.sources.length > 64 || answer.sources.some(s => !s.kind || !s.refKey || (s.version !== null && typeof s.version !== "string"))) { await close("failed", "runtime source manifest invalid"); continue; }
        const sources = [...new Map([...assembled.manifest.selectedSources, ...answer.sources].map(source => [canonicalJson(source), source])).values()];
        if (sources.length > 64) { await close('gap', 'combined source manifest exceeds the report bound'); continue; }
        const body = await this.deps.vault.put({ contentType: "application/json", body: canonicalJson({ answer: answer.answer, sources }), ownerRef: runRef, sourceRefs: [{ kind: "artifact", refId: assembled.bundleRef.digest, revision: "1", digest: assembled.bundleRef.digest }], requestedAt: answer.endedAt });
        if (body.status !== "stored") { await close("failed", "query answer body could not be stored"); continue; }
        const recorded: QueryJobAnswerV1 = { schemaVersion: 1, answerId: `query-answer-${key}-${round}`, queryJobRef: jobRef, runRef, roundIndex: round, answer: answer.answer, sources: sources.map((s) => ({ ...s, label: null })), followsAnswerRef: job.answerRefs.at(-1) ?? null, stale, staleReason: stale ? "source_changed" : null, answeredAt: answer.endedAt, bodyRef: body.ref };
        const receipt = await this.deps.control.recordQueryAnswer({ schemaVersion: 1, commandType: "RecordQueryAnswer", commandId: recorded.answerId, identity: { projectId: job.projectId, actor: { kind: "system", id: "query-dispatch" }, idempotencyKey: recorded.answerId }, aggregateId: job.queryJobId, expectedRevision: snapshot.revision, correlationId: job.intent.correlationId, submittedAt: answer.endedAt, payload: { answer: recorded } });
        if (receipt.status === "committed") result.answered++; else fail(receipt.code, "query answer rejected");
      } catch (error) { await close("failed", String(error)); }
    }
    return result;
  }
}
