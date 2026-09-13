/**
 * P1-10 WorkerRuntime.LifecycleControlPort — fake runtime adapter with
 * declared safe points (honest capability).
 */
import type { ControlIntentV1, LifecycleControlPort, SafePointAcknowledgementV1 } from "../../contracts/control-intent.js";
import { sha256Hex } from "../../contracts/fingerprint.js";

export class FakeLifecycleControlAdapter implements LifecycleControlPort {
  capabilities(request: { runRef: import("../../contracts/dispatch.js").RunRef | null }): {
    safePointDelivery: boolean; pause: boolean; cancel: boolean; steer: boolean; maxSteerPayloadBytes: number;
  } {
    void request;
    return { safePointDelivery: true, pause: true, cancel: true, steer: true, maxSteerPayloadBytes: 1024 };
  }

  async apply(intent: ControlIntentV1, atRunRef: import("../../contracts/dispatch.js").RunRef | null): Promise<SafePointAcknowledgementV1> {
    const applied = atRunRef === null || intent.scope.runRef === null || atRunRef.runId === intent.scope.runRef.runId;
    return {
      schemaVersion: 1,
      ackId: "ack-" + intent.intentId,
      intentRef: { aggregateType: "ControlIntent", projectId: intent.projectId, workspaceId: intent.workspaceId, intentId: intent.intentId },
      runRef: atRunRef ? { ...atRunRef } : null,
      safePoint: { seq: 1, eventSeq: null, at: "2026-09-06T00:00:00.000Z" },
      applied,
      reason: applied ? null : "run_mismatch — no safe point delivered for this run",
      resumeOutcome: applied && intent.kind === "resume" ? { status: "original", detail: "fake runtime resumes the same session" } : null,
      deliveryCursor: applied && intent.kind === "steer" ? sha256Hex("delivery-" + intent.intentId).slice(0, 24) : null,
      recordedAt: "2026-09-06T00:00:00.000Z",
    };
  }
}
