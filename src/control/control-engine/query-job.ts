import { startQueryJobFingerprint } from "../../contracts/query-job.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import { validQueryExecution } from '../../contracts/query-job.js';
/** P1-09 Control entry: QueryJobEngineImpl. */
import type { CloseQueryJobCommand, CloseQueryJobReceipt, QueryJobV1, QueryJobSnapshot, QueryRunSnapshot, QueryRunV1, RecordQueryAnswerCommand, RecordQueryAnswerReceipt, SubmitQueryJobCommand, SubmitQueryJobReceipt } from "../../contracts/query-job.js";
import { queryJobRefFor, queryJobAnswerRefFor } from "../../contracts/query-job.js";
import { buildQueryJobRecordCommit, buildQueryAnswerRecordCommit, buildQueryCloseRecordCommit } from "./records/query-job.js";
import type { WorkspaceRef } from "../../contracts/ledger.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class QueryJobEngineImpl {
  private readonly deps: ControlEngineDeps;
  constructor(deps: ControlEngineDeps) { this.deps = deps; }

  async submit(command: SubmitQueryJobCommand): Promise<SubmitQueryJobReceipt> {
    const intent = command.payload.intent;
    if (!validQueryExecution(intent.execution)) return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    if (intent.execution?.implementationAuthorization && command.identity.actor.kind !== 'human') return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    if (intent.schemaVersion !== 1 || !intent.intentId || command.aggregateId.length === 0) { return { status: "rejected", commandId: command.commandId, code: "invalid" }; }
    if (intent.projectId !== command.identity.projectId) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    if (!Number.isSafeInteger(intent.budget.maxTokens) || intent.budget.maxTokens <= 0 || !intent.question || Buffer.byteLength(intent.question) > 4096 || intent.focusTaskRefs.length > 16 || !command.payload.runId || (intent.budget.deadline !== null && !Number.isFinite(Date.parse(intent.budget.deadline)))) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    if (!Number.isSafeInteger(intent.multiTurn.maxRounds) || intent.multiTurn.maxRounds < 1 || intent.multiTurn.maxRounds > 4) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    const ws: WorkspaceRef = { aggregateType: "Workspace", projectId: command.identity.projectId, workspaceId: intent.workspaceId };
    if ((await this.deps.ledger.load(ws)).status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const batch = buildQueryJobRecordCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now() });
    if (intent.execution?.feedback) {
      const f = intent.execution.feedback;
      const r = await this.deps.ledger.load(f.runRef);
      const g = intent.goalId ? await this.deps.ledger.load({aggregateType:'Goal',projectId:intent.projectId,goalId:intent.goalId}) : null;
      const w = await this.deps.ledger.load(ws);
      if (command.identity.actor.kind !== 'system' || f.runRef.projectId !== intent.projectId || f.runRef.goalId !== intent.goalId ||
        r.status !== 'found' || r.snapshot.ref.aggregateType !== 'Run' || g?.status !== 'found' || g.snapshot.ref.aggregateType !== 'Goal' || w.status !== 'found')
        return {status:'rejected',commandId:command.commandId,code:'invalid'};
      const run = r.snapshot as import('../../contracts/dispatch.js').RunSnapshot;
      const goal = g.snapshot as import('../../contracts/ledger.js').GoalSnapshot;
      if (run.status !== 'ended' || run.outcome !== 'completed' || run.task.taskId !== f.taskId || run.workspaceSnapshot.workspaceId !== intent.workspaceId ||
        goal.workspaceRef.workspaceId !== intent.workspaceId || canonicalJson(goal.activePlanRevision) !== canonicalJson(f.planRef) ||
        canonicalJson(run.planRef) !== canonicalJson(f.planRef) || w.snapshot.revision !== f.workspaceRevision ||
        canonicalJson(intent.focusTaskRefs) !== canonicalJson([{aggregateType:'Task',projectId:intent.projectId,goalId:intent.goalId,taskId:f.taskId}]))
        return {status:'rejected',commandId:command.commandId,code:'invalid'};
    }
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, queryJobRef: queryJobRefFor(command.identity.projectId, intent.workspaceId, command.aggregateId), eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    }
    return { status: "rejected", commandId: command.commandId, code: receipt.code === "revision_conflict" ? "revision_conflict" : receipt.code === "idempotency_conflict" ? "idempotency_conflict" : receipt.code === "invalid_commit" ? "invalid" : "unavailable" };
  }

  private async replay(command: import("../../contracts/query-job.js").StartQueryJobCommand | RecordQueryAnswerCommand | CloseQueryJobCommand): Promise<{ match: boolean; eventIds: string[]; revision: number; commitCursor: import("../../contracts/command-event.js").CommitCursor } | null> {
    let afterCursor: import("../../contracts/command-event.js").CommitCursor | null = null;
    for (;;) {
      const page = await this.deps.ledger.events({ afterCursor, limit: 256 });
      for (const { event, cursor } of page.events) {
        if (!("projectId" in event) || event.projectId !== command.identity.projectId || !("idempotencyKey" in event) || event.idempotencyKey !== command.identity.idempotencyKey || canonicalJson(event.actor) !== canonicalJson(command.identity.actor)) continue;
        let match = false;
        if (command.commandType === "StartQueryJob" && event.eventType === "QueryRunStarted" && event.payload.job?.status === "running") match = canonicalJson(command.payload.jobRef) === canonicalJson(event.payload.run.queryJobRef) && command.payload.runRef.runId === event.payload.run.runId;
        if (command.commandType === "RecordQueryAnswer" && event.eventType === "QueryJobAnswerRecorded") match = canonicalJson(command.payload.answer) === canonicalJson(event.payload.answer);
        if (command.commandType === "CloseQueryJob" && event.eventType === "QueryJobClosed") match = canonicalJson(command.payload.reason) === canonicalJson(event.payload.reason) && canonicalJson(command.payload.jobRef) === canonicalJson(event.payload.run.queryJobRef) && command.payload.runRef.runId === event.payload.run.runId;
        if (event.eventType === "QueryRunStarted" || event.eventType === "QueryJobAnswerRecorded" || event.eventType === "QueryJobClosed") return { match: match && command.expectedRevision === event.aggregateRevision - 1 && command.aggregateId === (event.eventType === "QueryRunStarted" ? event.payload.run.queryJobRef.queryJobId : event.aggregateId), eventIds: [event.eventId], revision: event.aggregateRevision, commitCursor: cursor };
      }
      if (!page.hasMore) return null;
      afterCursor = page.throughCursor;
    }
  }

  async start(command: import("../../contracts/query-job.js").StartQueryJobCommand): Promise<import("../../contracts/query-job.js").StartQueryJobReceipt> {
    const { jobRef, runRef } = command.payload;
    const reject = (code: "invalid" | "not_found" | "already_started" | "revision_conflict" | "idempotency_conflict" | "unavailable") => ({ status: "rejected" as const, commandId: command.commandId, code });
    if (command.schemaVersion !== 1 || command.identity.projectId !== jobRef.projectId || command.aggregateId !== jobRef.queryJobId || runRef.projectId !== jobRef.projectId || runRef.workspaceId !== jobRef.workspaceId || runRef.queryJobId !== jobRef.queryJobId) return reject("invalid");
    const replay = await this.replay(command);
    if (replay) return replay.match ? { status: "committed", commandId: command.commandId, replayed: true, revision: replay.revision, eventIds: replay.eventIds, commitCursor: replay.commitCursor } : reject("idempotency_conflict");
    const j = await this.deps.ledger.load(jobRef);
    const r = await this.deps.ledger.load(runRef);
    if (j.status !== "found" || r.status !== "found") return reject("not_found");
    const before = j.snapshot as QueryJobSnapshot;
    const previousRun = r.snapshot as QueryRunSnapshot;
    if (!((before.job.status === "pending" && previousRun.run.status === "pending") || (before.job.status === "answered" && previousRun.run.status === "running" && before.job.answerRefs.length < before.job.intent.multiTurn.maxRounds))) return reject("already_started");
    if (before.revision !== command.expectedRevision || previousRun.revision !== before.revision) return reject("revision_conflict");
    if (before.job.runRef !== null && canonicalJson(before.job.runRef) !== canonicalJson(runRef)) return reject("invalid");
    const now = this.deps.now();
    const job: QueryJobV1 = { ...before.job, runRef, status: "running", updatedAt: now };
    const run: QueryRunV1 = { ...previousRun.run, status: "running", startedAt: now };
    const revision = before.revision + 1;
    const receipt = await this.deps.ledger.commit({ commitKind: "query-job-start", schemaVersion: 1, identity: command.identity, fingerprint: startQueryJobFingerprint(command),
      expectedVersions: [{ ref: jobRef, revision: before.revision }, { ref: runRef, revision: previousRun.revision }],
      events: [{ eventId: this.deps.eventId(), eventType: "QueryRunStarted", schemaVersion: 1, projectId: jobRef.projectId, workspaceId: jobRef.workspaceId, aggregateType: "QueryRun", aggregateId: runRef.runId, aggregateRevision: revision, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: command.identity.actor, occurredAt: now, payload: { job, run } }],
      snapshots: [{ ref: jobRef, revision, schemaVersion: 1, job }, { ref: runRef, revision, schemaVersion: 1, run }], outboxIntents: [] });
    if (receipt.status === "committed") return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, revision, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    return reject(receipt.code === "revision_conflict" ? "revision_conflict" : "unavailable");
  }

  async answer(command: RecordQueryAnswerCommand): Promise<RecordQueryAnswerReceipt> {
    // The answer carries its own refs — derive the job ref from the answer.
    const answer = command.payload.answer;
    const jobRef = answer.queryJobRef;
    const runRef = answer.runRef;
    if (command.identity.projectId !== jobRef.projectId || command.aggregateId !== jobRef.queryJobId || runRef.projectId !== jobRef.projectId || runRef.workspaceId !== jobRef.workspaceId || runRef.queryJobId !== jobRef.queryJobId) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    const replay = await this.replay(command);
    if (replay) return replay.match ? { status: "committed", commandId: command.commandId, replayed: true, answerRef: queryJobAnswerRefFor(jobRef.projectId, jobRef.workspaceId, jobRef.queryJobId, answer.answerId), revision: replay.revision, eventIds: replay.eventIds, commitCursor: replay.commitCursor } : { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    const jobLoad = await this.deps.ledger.load(jobRef);
    if (jobLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const jobSnap = jobLoad.snapshot as QueryJobSnapshot;
    const runLoad = await this.deps.ledger.load(runRef);
    if (runLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const runSnap = runLoad.snapshot as QueryRunSnapshot;
    if (runSnap.run.status === "closed") return { status: "rejected", commandId: command.commandId, code: "run_not_answered" };
    if (!Number.isSafeInteger(answer.roundIndex) || answer.roundIndex < 1 || answer.roundIndex > jobSnap.job.intent.multiTurn.maxRounds) return { status: "rejected", commandId: command.commandId, code: "rounds_exceeded" };
    if (jobSnap.revision !== command.expectedRevision) return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    if (answer.roundIndex !== jobSnap.job.answerRefs.length + 1 || Buffer.byteLength(answer.answer) > 16 * 1024) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    if (canonicalJson(answer.followsAnswerRef) !== canonicalJson(jobSnap.job.answerRefs.at(-1) ?? null)) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    const nextJob: QueryJobV1 = { ...jobSnap.job, status: "answered", answerRefs: [...jobSnap.job.answerRefs, queryJobAnswerRefFor(answer.queryJobRef.projectId, answer.queryJobRef.workspaceId, answer.queryJobRef.queryJobId, answer.answerId)], updatedAt: this.deps.now() };
    const isFinal = answer.roundIndex >= jobSnap.job.intent.multiTurn.maxRounds;
    const nextRun: QueryRunV1 = { ...runSnap.run, status: isFinal ? "answered" : "running", endedAt: isFinal ? this.deps.now() : null, outcome: isFinal ? "answered" : null };
    const batch = buildQueryAnswerRecordCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now(), nextRevision: jobSnap.revision + 1, job: nextJob, run: nextRun });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, answerRef: queryJobAnswerRefFor(jobRef.projectId, jobRef.workspaceId, jobRef.queryJobId, answer.answerId), revision: jobSnap.revision + 1, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    }
    return { status: "rejected", commandId: command.commandId, code: receipt.code === "revision_conflict" ? "revision_conflict" : receipt.code === "idempotency_conflict" ? "idempotency_conflict" : "unavailable" };
  }

  async close(command: CloseQueryJobCommand): Promise<CloseQueryJobReceipt> {
    const { jobRef, runRef } = command.payload;
    if (command.identity.projectId !== jobRef.projectId || command.aggregateId !== jobRef.queryJobId || runRef.projectId !== jobRef.projectId || runRef.workspaceId !== jobRef.workspaceId || runRef.queryJobId !== jobRef.queryJobId) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    const replay = await this.replay(command);
    if (replay) return replay.match ? { status: "committed", commandId: command.commandId, replayed: true, revision: replay.revision, eventIds: replay.eventIds, commitCursor: replay.commitCursor } : { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    const jobLoad = await this.deps.ledger.load(jobRef);
    if (jobLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const jobSnap = jobLoad.snapshot as QueryJobSnapshot;
    if (jobSnap.revision !== command.expectedRevision) return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    if (jobSnap.job.status === "closed") return { status: "rejected", commandId: command.commandId, code: "already_closed" };
    const runLoad = await this.deps.ledger.load(runRef);
    if (runLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const runSnap = runLoad.snapshot as QueryRunSnapshot;
    const nextJob: QueryJobV1 = { ...jobSnap.job, status: "closed", closeReason: command.payload.reason, updatedAt: this.deps.now() };
    const nextRun: QueryRunV1 = { ...runSnap.run, status: "closed", endedAt: this.deps.now(), outcome: command.payload.reason.code === "timeout" ? "timeout" : command.payload.reason.code === "gap" ? "gap" : command.payload.reason.code === "failed" ? "failed" : "answered" };
    const batch = buildQueryCloseRecordCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now(), nextRevision: jobSnap.revision + 1, job: nextJob, run: nextRun });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, revision: jobSnap.revision + 1, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    return { status: "rejected", commandId: command.commandId, code: receipt.code === "revision_conflict" ? "revision_conflict" : receipt.code === "idempotency_conflict" ? "idempotency_conflict" : "unavailable" };
  }
}
