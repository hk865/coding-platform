/**
 * P1-16 Control entry: WorkRecordEngineImpl — durable work identity + reason
 * trail (WorkRecordPort implementor).
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN; lane A fills the
 * implementations). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-16 契约与
 * 存储语义" items 1-6):
 *   1. shape validation (validateBindWorkContextCommand / ...) -> invalid;
 *   2. referential guards (Project/Workspace/Binding/run existence; workKind-
 *      goal/task consistency) -> not_found; binding already exists -> CAS;
 *   3. ExecutionNote author must be a run LINKED to the work binding ->
 *      run_not_in_work (zero write); the note body must already be
 *      body-first'd into the ArtifactVault by the author;
 *   4. run links bounded (WORK_CONTEXT_MAX_RUN_LINKS) -> links_exceeded;
 *   5. ONE atomic commit per command (fold-equality with the shared fixture
 *      builders) with FULL ledger idempotency.
 * No Goal/Task phase write; no CompletionPolicy change; the runtime capability
 * declaration is recorded as reported (capabilitySource), never fabricated.
 */
import type {
  BindWorkContextCommand,
  BindWorkContextReceipt,
  LinkWorkRunCommand,
  LinkWorkRunReceipt,
  RecordContinuationCommand,
  RecordContinuationReceipt,
  RecordExecutionNoteCommand,
  RecordExecutionNoteReceipt,
  WorkRecordPort,
} from "../contracts/context-continuity.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class WorkRecordEngineImpl implements WorkRecordPort {
  private readonly deps: ControlEngineDeps;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
  }

  bindWorkContext(command: BindWorkContextCommand): Promise<BindWorkContextReceipt> {
    throw new Error("P1-16 lane A: bindWorkContext not implemented yet");
  }

  linkWorkRun(command: LinkWorkRunCommand): Promise<LinkWorkRunReceipt> {
    throw new Error("P1-16 lane A: linkWorkRun not implemented yet");
  }

  recordExecutionNote(command: RecordExecutionNoteCommand): Promise<RecordExecutionNoteReceipt> {
    throw new Error("P1-16 lane A: recordExecutionNote not implemented yet");
  }

  recordContinuation(command: RecordContinuationCommand): Promise<RecordContinuationReceipt> {
    throw new Error("P1-16 lane A: recordContinuation not implemented yet");
  }
}
