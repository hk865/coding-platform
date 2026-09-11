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
 *
 * checkContinuation is the OBSERVABLE continuation check (never fabricated):
 *   - a restore request (originalRunRef non-null) against a runtime that does
 *     NOT support sessionRestore -> observed "unsupported" naming the missing
 *     capability (session_restore). It NEVER answers restored_original;
 *   - a takeover request (no original session, a NEW run continuing from
 *     durable facts) -> observed "took_over" (the fake supports takeoverRun);
 *   - an invalid / no-run check -> observed "rejected" with an explicit code.
 */
import type {
  ContextContinuationCapabilityResult,
  ContextContinuationCheckV1,
  ContextContinuationObservationV1,
  ContextContinuationPort,
} from "../../contracts/context-continuation-port.js";
import type { RunPort } from "../../contracts/ports.js";

export class FakeContextContinuationRuntimeAdapter implements ContextContinuationPort {
  constructor(private readonly runtime: RunPort) {}

  async capabilities(
    request: {
      workContextRef: import("../../contracts/context-continuity.js").WorkContextRef;
      runRef: import("../../contracts/dispatch.js").RunRef | null;
    },
  ): Promise<ContextContinuationCapabilityResult> {
    // The fake runtime cannot inspect the ledger; it answers from its own
    // honest (frozen) capability matrix.
    void request;
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

  async checkContinuation(request: ContextContinuationCheckV1): Promise<ContextContinuationObservationV1> {
    const observedAt = this.observeTime();
    return observeContinuation(this.runtime, request, observedAt);
  }

  /** P1-16 lane B: the fake runtime has no wall-clock; deterministic marker. */
  private observeTime(): string {
    return "2026-09-06T00:00:00.000Z";
  }
}

/** Deterministic observable continuation classification for the fake runtime. */
function observeContinuation(
  runtime: RunPort,
  request: ContextContinuationCheckV1,
  observedAt: string,
): ContextContinuationObservationV1 {
  void runtime;
  // Invalid check -> explicit rejection (never a fabricated restore).
  if (request.schemaVersion !== 1) {
    return {
      schemaVersion: 1,
      workContextRef: { ...request.workContextRef },
      requestedByRunRef: request.requestedByRunRef ? { ...request.requestedByRunRef } : null,
      originalRunRef: request.originalRunRef ? { ...request.originalRunRef } : null,
      observed: "rejected",
      unsupportedCapabilities: [],
      rejectionCode: "invalid",
      summary: "checkContinuation rejected: unsupported schemaVersion",
      observedAt,
    };
  }
  // A restore of the ORIGINAL session is asked for, but the fake runtime does
  // NOT support sessionRestore -> honest unsupported (never restored_original).
  if (request.originalRunRef !== null) {
    return {
      schemaVersion: 1,
      workContextRef: { ...request.workContextRef },
      requestedByRunRef: request.requestedByRunRef ? { ...request.requestedByRunRef } : null,
      originalRunRef: { ...request.originalRunRef },
      observed: "unsupported",
      unsupportedCapabilities: ["session_restore"],
      rejectionCode: null,
      summary: "original session cannot be restored by this runtime; a new run must continue from durable facts",
      observedAt,
    };
  }
  // No original session and no run to continue on -> explicit rejection.
  if (request.requestedByRunRef === null) {
    return {
      schemaVersion: 1,
      workContextRef: { ...request.workContextRef },
      requestedByRunRef: null,
      originalRunRef: null,
      observed: "rejected",
      unsupportedCapabilities: [],
      rejectionCode: "run_not_found",
      summary: "checkContinuation rejected: no run to continue the work",
      observedAt,
    };
  }
  // A NEW run continuing from durable facts — the fake supports takeoverRun.
  return {
    schemaVersion: 1,
    workContextRef: { ...request.workContextRef },
    requestedByRunRef: { ...request.requestedByRunRef },
    originalRunRef: null,
    observed: "took_over",
    unsupportedCapabilities: [],
    rejectionCode: null,
    summary: "original session unrecoverable; replacement run continues from durable facts (declared, no fake restore)",
    observedAt,
  };
}
