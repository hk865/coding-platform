/**
 * P1-16 WorkerRuntime.ContextContinuationPort — explicit continuation
 * capability declaration (FakeRuntime companion for the contract suite).
 *
 * ENTRY FILE (shared baseline — signatures FROZEN; lane B fills the
 * checkContinuation implementation). The Fake adapter HONESTLY declares the
 * FAKE capability set (sessionRestore=false, contextResume=true,
 * takeoverRun=true) — the fake kernel can resume with a bounded context and
 * continue in a new run, but cannot restore an original session. The REAL
 * coding-agent kernel's capabilities are validated once by the integration
 * real-kernel test; the platform NEVER assumes fake == real.
 */
import type {
  ContextContinuationCapabilityResult,
  ContextContinuationCheckV1,
  ContextContinuationObservationV1,
  ContextContinuationPort,
} from "../contracts/context-continuation-port.js";
import type { RunPort } from "../contracts/ports.js";

export class FakeContextContinuationRuntimeAdapter implements ContextContinuationPort {
  constructor(private readonly runtime: RunPort) {}

  async capabilities(request: { workContextRef: import("../contracts/context-continuity.js").WorkContextRef; runRef: import("../contracts/dispatch.js").RunRef | null }): Promise<ContextContinuationCapabilityResult> {
    // The fake runtime cannot inspect the ledger; it answers from its own
    // honest (frozen) capability matrix.
    return {
      status: "supported",
      capabilities: {
        schemaVersion: 1,
        sessionRestore: false,
        contextResume: true,
        takeoverRun: true,
        maxContextBytes: 256 * 1024,
        maxResumeBytes: 0,
      },
    };
  }

  checkContinuation(request: ContextContinuationCheckV1): Promise<ContextContinuationObservationV1> {
    void request;
    void this.runtime;
    throw new Error("P1-16 lane B: checkContinuation not implemented yet");
  }
}
