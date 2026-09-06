/** P1-09 Control entry: QueryJobEngineImpl. */
import type { CloseQueryJobCommand, CloseQueryJobReceipt, QueryJobV1, QueryJobSnapshot, QueryRunSnapshot, QueryRunV1, QueryRunRef, RecordQueryAnswerCommand, RecordQueryAnswerReceipt, SubmitQueryJobCommand, SubmitQueryJobReceipt } from "../contracts/query-job.js";
import { queryJobRefFor, queryRunRefFor, queryJobAnswerRefFor } from "../contracts/query-job.js";
import { buildQueryJobRecordCommit, buildQueryAnswerRecordCommit, buildQueryCloseRecordCommit, buildP109Job, buildP109Run } from "../contracts/fixtures/query-job-fixtures.js";
import type { LedgerCommitReceipt, WorkspaceRef } from "../contracts/ledger.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class QueryJobEngineImpl {
  private readonly deps: ControlEngineDeps;
  constructor(deps: ControlEngineDeps) { this.deps = deps; }

  async submit(command: SubmitQueryJobCommand): Promise<SubmitQueryJobReceipt> {
    const intent = command.payload.intent;
    if (intent.schemaVersion !== 1 || !intent.intentId || command.aggregateId.length === 0) { return { status: "rejected", commandId: command.commandId, code: "invalid" }; }
    if (false) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    if (intent.budget.maxTokens <= 0) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    if (intent.multiTurn.maxRounds < 1 || intent.multiTurn.maxRounds > 4) return { status: "rejected", commandId: command.commandId, code: "invalid" };
    const ws: WorkspaceRef = { aggregateType: "Workspace", projectId: command.identity.projectId, workspaceId: intent.workspaceId };
    if ((await this.deps.ledger.load(ws)).status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const batch = buildQueryJobRecordCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now() });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, queryJobRef: queryJobRefFor(command.identity.projectId, intent.workspaceId, command.aggregateId), eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    }
    return { status: "rejected", commandId: command.commandId, code: receipt.code === "revision_conflict" ? "revision_conflict" : receipt.code === "idempotency_conflict" ? "idempotency_conflict" : receipt.code === "invalid_commit" ? "invalid" : "unavailable" };
  }

  private async loadJob(command: { identity: { projectId: string } }, aggregateId: string): Promise<QueryJobSnapshot | null> {
    const ref = queryJobRefFor(command.identity.projectId, "", aggregateId);
    // workspaceId derivation: avoid — load by scanning? Ledger load needs full ref; use the subref with workspaceId from... derive from stored? We cannot: aggregateId only.
    void ref;
    return null;
  }

  async answer(command: RecordQueryAnswerCommand): Promise<RecordQueryAnswerReceipt> {
    // The answer carries its own refs — derive the job ref from the answer.
    const answer = command.payload.answer;
    const jobRef = answer.queryJobRef;
    const runRef = answer.runRef;
    const jobLoad = await this.deps.ledger.load(jobRef);
    if (jobLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const jobSnap = jobLoad.snapshot as QueryJobSnapshot;
    const runLoad = await this.deps.ledger.load(runRef);
    if (runLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const runSnap = runLoad.snapshot as QueryRunSnapshot;
    if (runSnap.run.status === "closed") return { status: "rejected", commandId: command.commandId, code: "run_not_answered" };
    if (answer.roundIndex > jobSnap.job.intent.multiTurn.maxRounds) return { status: "rejected", commandId: command.commandId, code: "rounds_exceeded" };
    const nextJob: QueryJobV1 = { ...jobSnap.job, status: "answered", answerRefs: [...jobSnap.job.answerRefs, queryJobAnswerRefFor(answer.queryJobRef.projectId, answer.queryJobRef.workspaceId, answer.queryJobRef.queryJobId, answer.answerId)], updatedAt: this.deps.now() };
    const isFinal = answer.roundIndex >= jobSnap.job.intent.multiTurn.maxRounds;
    const nextRun: QueryRunV1 = { ...runSnap.run, status: isFinal ? "answered" : "running", endedAt: isFinal ? this.deps.now() : null, outcome: isFinal ? "answered" : null };
    const batch = buildQueryAnswerRecordCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now(), nextRevision: jobSnap.revision + 1, job: nextJob, run: nextRun });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, answerRef: queryJobAnswerRefFor(jobRef.projectId, jobRef.workspaceId, jobRef.queryJobId, answer.answerId), revision: jobSnap.revision + 1, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    }
    console.log("P109-ANSWER-REJECT", JSON.stringify(receipt));
    return { status: "rejected", commandId: command.commandId, code: receipt.code === "revision_conflict" ? "revision_conflict" : receipt.code === "idempotency_conflict" ? "idempotency_conflict" : "unavailable" };
  }

  async close(command: CloseQueryJobCommand): Promise<CloseQueryJobReceipt> {
    const { jobRef, runRef } = command.payload;
    const jobLoad = await this.deps.ledger.load(jobRef);
    if (jobLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const jobSnap = jobLoad.snapshot as QueryJobSnapshot;
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
