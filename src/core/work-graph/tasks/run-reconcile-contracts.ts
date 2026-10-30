/**
 * Run reconcile contracts (STATE-MACHINES-SPEC §6.1 contracts (c)/(d), §12;
 * A.2 step 5.6).
 *
 * The WorkGraph writes of a Run end that carries no Kernel terminal: the
 * Runtime reads the Kernel and classifies (`agent-runtime/run-reconcile.ts`),
 * WorkGraph judges it with the pure machines and commits it. A Kernel terminal
 * goes through the extended `recordRunResult` instead (RD-5).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ControlIntentRef } from '../../../contracts/control-intent.js';
import type { WriteResult } from '../../../contracts/core/results.js';
import type { RunReconciliationBasisV1, RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionProbeVerdict } from '../state/session-availability.js';
import type { RunUnknownCause } from '../state/run-machine.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type {
  AcceptedSteerV1, HostInstanceFacts, KernelExecutionBinding, KernelObservationSource, ObservedExecutionHistory,
} from '../model/execution-entry-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { RunActivityFactsV1 } from '../../../contracts/run-activity.js';
import type {
  HostTakeoverProofV1, UnknownCallReviewDraftV1, WorkspaceCaptureV1,
} from '../../../contracts/unknown-call-review.js';

/** The Kernel Turn a reconcile read (§6.2 `reconcile_interrupted_clean`, `stop_paused`, `reconcile_unknown`). */
export type ReconcileTurnV1 = {
  /** The Turn has a Kernel terminal event. */
  terminal: boolean;
  /** `running`/`outcome_unknown` tool calls; Kernel `pending` (declared, not started) is not in flight (LA-7). */
  inFlightToolCallIds: string[];
  lastPosition: number | null;
  /** The Kernel Turn status is `paused` (C4, RD-7). */
  kernelPaused: boolean;
  /** The Turn start, recorded by an end reconciled from `Entering` (ATT-31/32). */
  entered: { enteredAt: string; kernelSource: KernelObservationSource; history: ObservedExecutionHistory } | null;
  /** Queued steers the Kernel accepted (CTL-08(b)). */
  acceptedSteers: AcceptedSteerV1[];
  /** Every `run.input_accepted` of the Turn is confirmed against its source (§10.3). */
  inputsConfirmed: boolean;
};

/**
 * K3 (L25, §2 + U1): the classifier's automatic-closure candidate. The
 * WorkGraph machine re-checks its own guard side against `RunGuardContext` and
 * maps this shape onto its own `AutoCleanupCandidateV1`; `unresolvedCalls`
 * carries every unresolved call so G3 is judged on names, not on the (possibly
 * creation-budget-cut) draft items.
 */
export type AutoCleanupCandidateV1 = {
  proof: HostTakeoverProofV1;
  closure: { status: 'supported'; headActiveRunId: string };
  workspace: WorkspaceCaptureV1;
  unresolvedCalls: Array<{ callId: string; toolName: string }>;
  draft: UnknownCallReviewDraftV1;
};

/** §6.1 contract (c) `ReconciledObservation`, as the Runtime classifier gives it. */
export type ReconcileRunInput = {
  runRef: RunRef;
  /** `host_instance_takeover` at a restart; `live_clean` from the in-process Runtime (RUN-16, RUN-23). */
  basis: RunReconciliationBasisV1;
  /** The claim Session's probe verdict (§8.2): `ready`, or `missing`/`damaged` for RUN-20(ii). */
  probe: SessionProbeVerdict;
  result:
    /** RUN-16: the readable Kernel Store holds no Turn of the fixed identity. */
    | { kind: 'not_entered'; kernel: KernelExecutionBinding }
    /** RUN-20: (i) tool calls without a result, (ii) an unreadable Kernel, (iii) an unrebuildable continuation. */
    | { kind: 'unknown'; cause: RunUnknownCause; unresolvedToolCallIds: string[]; observedThroughPosition: number | null;
        turn: ReconcileTurnV1 | null;
        /**
         * K3 RUN-25 (L25): the classifier's automatic-closure candidate when
         * every Runtime-side guard held, or the first `blockedBy` it proved.
         * Absent for every pre-K3 RUN-20 event.
         */
        autoCleanup?: AutoCleanupCandidateV1 | { blockedBy: string } }
    /** RUN-19 / RUN-24: no Kernel terminal, nothing in flight; the WG machine picks the row by the pointer. */
    | { kind: 'interrupted_clean'; turn: ReconcileTurnV1 }
    /**
     * RUN-23: the queued cancel and a Turn with no Kernel terminal, nothing in
     * flight. `pausedBy` (CTL-10): the pause in effect when the cancel stopped
     * the Run; in process the pause the live handle consumed, at a restart
     * null (the Run no longer points to that pause once the cancel is queued,
     * and the Kernel `run.paused` names no intent, CD-1).
     */
    | { kind: 'paused_stop'; cancelIntentRef: ControlIntentRef; pausedBy: ControlIntentRef | null; turn: ReconcileTurnV1 };
  /**
   * Slice 2B L5: the tally read alongside the reconcile window, written in the
   * SAME commit as the Run end. Absent means no record is written (L7). A
   * `not_entered` result must not carry it.
   */
  activity?: RunActivityFactsV1;
};

/** §6.1 contract (d): the operator's attestation of an unknown Run end (RUN-22). */
export type ResolveUnknownRunInput = {
  runRef: RunRef;
  reason: string;
  /** Read by the Host entry before the attestation: the Turn has no Kernel terminal, or the Kernel is unreadable. */
  kernelTurnOpen: boolean;
  /** Every accepted input confirmed; `null` when the Kernel is unreadable. */
  inputsConfirmed: boolean | null;
  /**
   * K3 (L8, KR3): the review draft the Host entry read before attesting. The
   * owner checks the receipt first and only validates this on a miss.
   */
  review: UnknownCallReviewDraftV1;
};

/** What the operator's attestation request itself carries (its fingerprint), before the Host entry reads the Kernel. */
export type AttestationRequest = Pick<ResolveUnknownRunInput, 'runRef' | 'reason'>;

/**
 * CTL-08(a)/(d)/(e): the start-up reconcile settles the queued intents a Run
 * keeps without any other reconcile write: on a Run that never entered
 * (RUN-09..11 (R)), on an ended Run whose acks a crash lost, on an unknown end.
 */
export type ReconcileRunControlsInput = {
  runRef: RunRef;
  hostInstanceId: string;
  /** Queued steers the Kernel accepted before the Run ended (CTL-08(b) through (e)). */
  acceptedSteers: AcceptedSteerV1[];
};

export interface RunReconcilePort {
  /** RUN-16, RUN-19, RUN-20, RUN-23, RUN-24 (with CTL-04(b), CTL-08, CTL-10 and SES-06). */
  reconcileRun(ctx: CoreCallContext, request: GraphWrite<ReconcileRunInput>): Promise<WriteResult<RunSnapshot>>;
  /** RUN-22: only through the Host holding the instance lease (L-1). */
  resolveUnknownRun(ctx: CoreCallContext, request: GraphWrite<ResolveUnknownRunInput>): Promise<WriteResult<RunSnapshot>>;
  /** CTL-08(a)/(d)/(e); a Run with nothing queued is answered `ready`-like with the Run as read (no commit). */
  reconcileRunControls(ctx: CoreCallContext, request: GraphWrite<ReconcileRunControlsInput>): Promise<WriteResult<RunSnapshot>>;
}

/** The service the Host composes: the port plus the attestation replay its Host entry asks first. */
export interface RunReconcileService extends RunReconcilePort {
  /**
   * RUN-22 原回执回放 (§12.10 step 4): the original receipt of an attestation
   * committed under this request identity, or `null` when none was; the same
   * identity with other content is `idempotency_conflict` (§1.2).
   */
  replayResolveUnknownRun(ctx: CoreCallContext, request: GraphWrite<AttestationRequest>): Promise<WriteResult<RunSnapshot> | null>;
}

export type RunReconcileDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  reads: ExecutionReadPort;
  hostInstance?: HostInstanceFacts;
  now(): string;
  eventId(): string;
};
