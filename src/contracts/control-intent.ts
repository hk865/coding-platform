// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { ActorRef } from "./command-event.js";
import type { RunExecutionHistoryV1 } from "./core/execution-history.js";
import type { RunOutcome, RunRef } from "./dispatch.js";
// ------------------------------------------------------------------------ //
// Refs                                                                      //
// ------------------------------------------------------------------------ //
export type ControlIntentRef = {
    aggregateType: "ControlIntent";
    projectId: string;
    workspaceId: string;
    intentId: string;
};
// ------------------------------------------------------------------------ //
// R4.1/R4.3 durable control intent (pause/cancel request plus observation)   //
// ------------------------------------------------------------------------ //
/**
 * Durable execution controls. Directional input is separate from stop fencing;
 * accepted intent alone never proves the requested action happened.
 */
export type ControlIntentKindV1 = 'pause' | 'cancel' | 'resume' | 'steer';
/**
 * The fixed execution entry an observation belongs to. The trusted Runtime
 * observer reads it from the Run's formal V2 authorization and claim
 * generation; it is never supplied by the model or a public `deliverControl`.
 */
export type ControlEntryIdentityV1 = {
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
};
/**
 * The trusted Runtime observer's conclusion about one live control intent.
 *
 * `source.position` is the exact position of the reduced `agent.event` in the
 * fixed Turn's original SessionRecord history, while `kernelEventId` /
 * `kernelEventSequence` are the real `payload.event.meta` identity of that
 * event. `kind` distinguishes a genuine pause, a genuine cancel, a natural
 * terminal that the queued cancel never caused, and an unproven outcome. This
 * declaration is the compatible shape; the observer that actually produces it
 * is a later R4.3a implementation step and does not exist yet.
 */
export type ControlObservationV1 = {
  schemaVersion: 1;
  kind: 'paused' | 'cancelled' | 'resumed' | 'steered' | 'terminal_without_cancel' | 'outcome_unknown';
  entry: ControlEntryIdentityV1;
  history: RunExecutionHistoryV1;
  source: RunExecutionHistoryV1['kernel'] & { position: number };
  kernelEventId: string;
  kernelEventSequence: number;
  observedAt: string;
};
/**
 * A fate the platform proves itself, without a Kernel event (CD-1). It never
 * carries fake Kernel fields; the variant is told apart by its `origin` key.
 */
export type ControlPlatformObservationV1 = {
  schemaVersion: 1;
  origin: 'platform_not_entered' | 'platform_superseded' | 'platform_reconcile' | 'platform_paused_stop';
  kind: 'paused' | 'cancelled' | 'resumed' | 'superseded_by_newer' | 'terminal_without_cancel' | 'outcome_unknown';
  /** Run revision after the same commit. */
  runRevision: number;
  detail:
    /** platform_not_entered (D-7) */
    | { entryPhase: 'none' | 'authorized' | 'revoked' }
    /** platform_superseded (D-8; also a queued steer when a cancel ends the Run) */
    | { supersededBy: ControlIntentRef }
    /** platform_reconcile: no attributable Kernel event at restart; kind `paused` only for CTL-08(f) with runOutcome `crashed`. */
    | { hostInstanceId: string; runOutcome: RunOutcome }
    /**
     * platform_paused_stop (§6 RD-7). `pausedBy` is the pause intent in effect
     * before (null in the LA-7 not-paused case); it is not the read model's
     * `pausedBy: StopRequester`.
     */
    | { basis: 'live_clean' | 'host_instance_takeover'; pausedBy: ControlIntentRef | null };
  observedAt: string;
};
/**
 * The immutable accepted request fields. The original queued producer and any
 * later observation carry exactly these fields; a caller still cannot supply
 * intent identity, status, actor or clock.
 */
export type ControlIntentRequestV1 = {
  schemaVersion: 1;
  ref: ControlIntentRef;
  runRef: RunRef;
  kind: ControlIntentKindV1;
  desiredState: 'paused' | 'cancelled' | 'running' | 'steered';
  reason: string | null;
  requestedAt: string;
  requestedBy: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
/**
 * The durable control snapshot. The legacy queued form keeps `revision: 1`,
 * `status: 'queued'` and no observation; a later real observation is
 * `revision >= 2` with an `applied`/`superseded`/`outcome_unknown` status and
 * the matching `observation`, from the Kernel history or proven by the
 * platform (CD-1). The original submission producer still writes only
 * `queued@1`, and old queued bytes remain readable.
 */
export type ControlIntentSnapshotV1 = ControlIntentRequestV1 & (
  | { revision: 1; status: 'queued'; observation?: never }
  | {
      revision: number;
      status: 'applied' | 'superseded' | 'outcome_unknown';
      observation: ControlObservationV1 | ControlPlatformObservationV1;
    }
);
/** Caller input. The caller cannot supply intent identity, status, actor or clock. */
export type SubmitControlInput = {
    runRef: RunRef;
    kind: ControlIntentKindV1;
    reason: string | null;
};
/** The exact value returned by a successful `submitControl`. */
export type SubmittedControl = {
    intent: ControlIntentSnapshotV1;
    runRevision: number;
};
