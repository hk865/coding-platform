/**
 * P1-10 WorkerRuntime.LifecycleControlPort — fake runtime adapter with
 * declared safe points (honest capability declaration).
 *
 * ENTRY FILE (shared baseline — signatures FROZEN; lane fills apply()).
 * capabilities: the Fake runtime declares safePointDelivery=true,
 * pause/cancel/steer=true, maxSteerPayloadBytes=1024. apply() is
 * deterministic: rejected for unknown/unsupported or when the run is not
 * active at the declared point; applied acknowledgement otherwise. NEVER
 * assumes success — the caller persists ack BEFORE treating the intent as
 * applied (desired-state-first).
 */
import type { ControlIntentV1, LifecycleControlPort, SafePointAcknowledgementV1 } from "../contracts/control-intent.js";

export class FakeLifecycleControlAdapter implements LifecycleControlPort {
  capabilities(request: { runRef: import("../contracts/dispatch.js").RunRef | null }): {
    safePointDelivery: boolean; pause: boolean; cancel: boolean; steer: boolean; maxSteerPayloadBytes: number;
  } {
    void request;
    return { safePointDelivery: true, pause: true, cancel: true, steer: true, maxSteerPayloadBytes: 1024 };
  }

  apply(intent: ControlIntentV1, atRunRef: import("../contracts/dispatch.js").RunRef | null): Promise<SafePointAcknowledgementV1> {
    void intent;
    void atRunRef;
    throw new Error("P1-10 lane: lifecycle apply not implemented yet");
  }
}
