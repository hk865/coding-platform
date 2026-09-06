/**
 * P1-06 WorkerRuntime.HandoffControlPort adapter (replayable fake runtime).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane B fills the
 * implementation). See IMPLEMENTATION-HANDOFF "P1-06 契约与存储语义" item 4:
 *   - MINIMAL control face over the fake runtime: pause/stop per safe point
 *     (NO cancel — P1-10), public snapshot/report ONLY (never hidden context,
 *     noHiddenContextRead: true);
 *   - review/verification semantic runs still go through the formal dispatch
 *     path (P1-03 RunPort); this adapter is the control/snapshot face.
 */
import type { RunPort } from "../contracts/ports.js";
import type {
  HandoffControlCommandResultV1,
  HandoffControlCommandV1,
  HandoffControlPort,
  HandoffSnapshotQueryV1,
  HandoffSnapshotResultV1,
} from "../contracts/handoff-control.js";

export class FakeHandoffControlRuntimeAdapter implements HandoffControlPort {
  constructor(private readonly runtime: RunPort) {
    void runtime;
  }

  async control(command: HandoffControlCommandV1): Promise<HandoffControlCommandResultV1> {
    void command;
    throw new Error("P1-06: FakeHandoffControlRuntimeAdapter.control not implemented yet");
  }

  async snapshot(query: HandoffSnapshotQueryV1): Promise<HandoffSnapshotResultV1> {
    void query;
    throw new Error("P1-06: FakeHandoffControlRuntimeAdapter.snapshot not implemented yet");
  }
}
