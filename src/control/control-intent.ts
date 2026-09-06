/**
 * P1-10 Control entry: ControlIntentEngineImpl — durable desired-state
 * intents + safe-point acks (ControlIntentPort implementor; versioned
 * ControlEngine additions).
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN; lane fills the
 * implementations). Frozen semantics (HANDOFF "P1-10 契约与存储语义"):
 *   submit: shape validation -> invalid; scope resolution (workspace exists;
 *   optionally goal/task/run exist) -> not_found; NO active desired-state
 *   conflict check beyond CAS; ONE atomic control-intent-record commit
 *   (CAS@0 + full idempotency); NO runtime side effect here.
 *   recordSafePointAck: validate; intent exists -> not_found; ack.intentRef
 *   matches; ack.runRef (if any) belongs to the intent scope run (else
 *   stale_ack); acks <= CONTROL_INTENT_MAX_ACKS -> acks_exceeded; fold into
 *   appended intent snapshot (status from ack.applied -> applied/rejected;
 *   ack reason maps) -> ONE atomic control-ack commit (CAS@N).
 */
import type { RecordSafePointAckCommand, RecordSafePointAckReceipt, SubmitControlCommand, SubmitControlReceipt } from "../contracts/control-intent.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class ControlIntentEngineImpl {
  private readonly deps: ControlEngineDeps;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
  }

  submit(command: SubmitControlCommand): Promise<SubmitControlReceipt> {
    void command;
    throw new Error("P1-10 lane: submitControl not implemented yet");
  }

  recordSafePointAck(command: RecordSafePointAckCommand): Promise<RecordSafePointAckReceipt> {
    void command;
    throw new Error("P1-10 lane: recordSafePointAck not implemented yet");
  }
}
