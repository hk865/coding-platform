/**
 * P1-09 Control entry: QueryJobEngineImpl — durable non-blocking query jobs
 * (versioned ControlEngine additions). ENTRY FILE (stub — lane fills).
 * Frozen semantics (HANDOFF "P1-09 契约与存储语义"): submit = validate ->
 * scope/workspace exist -> atomic query-job-record (job@0+run@0, CAS+idempotency)
 * -> NO runtime side effect; answer = validate -> job exists -> run belongs
 * to the job (run_not_answered otherwise) -> rounds < max -> atomic
 * query-answer-record; close = job exists & not already closed -> atomic
 * query-close-record. NEVER touches source Task/Goal phase.
 */
import type { CloseQueryJobCommand, CloseQueryJobReceipt, RecordQueryAnswerCommand, RecordQueryAnswerReceipt, SubmitQueryJobCommand, SubmitQueryJobReceipt } from "../contracts/query-job.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class QueryJobEngineImpl {
  private readonly deps: ControlEngineDeps;
  constructor(deps: ControlEngineDeps) { this.deps = deps; }
  submit(command: SubmitQueryJobCommand): Promise<SubmitQueryJobReceipt> { void command; throw new Error("P1-09 lane: submitQueryJob not implemented yet"); }
  answer(command: RecordQueryAnswerCommand): Promise<RecordQueryAnswerReceipt> { void command; throw new Error("P1-09 lane: recordQueryAnswer not implemented yet"); }
  close(command: CloseQueryJobCommand): Promise<CloseQueryJobReceipt> { void command; throw new Error("P1-09 lane: closeQueryJob not implemented yet"); }
}
