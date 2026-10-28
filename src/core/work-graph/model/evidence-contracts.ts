/**
 * R3e.1 EvidencePort.
 *
 * The port is the ONE trusted Host-facing evidence/verification write path. It
 * owns the round lifecycle, the check begin/record cursor and the single atomic
 * commit into the existing RecordStore. It never publishes a generic
 * `resolveVerificationInput`/`resolveCheckProducer` callback and never accepts a
 * caller-supplied digest, coverage, PASS verdict or report body.
 *
 * The service's exact raw dependencies (`EvidenceServiceDependencies`) live in
 * `evidence-service.ts`, beside `createEvidenceService` (task D X2, decision 40).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { EvidenceOutcome, EvidenceRef, EvidenceSnapshot } from '../../../contracts/evidence.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { EffectWriteResultV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { NewBasisInputRefV1 } from '../../../contracts/no-progress.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { TaskReworkRefusalSnapshotV1 } from '../../../contracts/task-requeue.js';
import type {
    CheckExecutionTicket,
    CheckProcessObservation,
    RoundSnapshot,
    VerificationRoundRef,
} from '../../../contracts/verification.js';
import type { GraphWrite } from './task-contracts.js';

/** Result of finalizing one frozen round: the persisted snapshot plus the
 * Evidence actually admitted in the same commit. */
export type FinalizedChecks = {
    snapshot: RoundSnapshot;
    outcome: EvidenceOutcome;
    evidence: EvidenceSnapshot[];
    applicable: boolean;
    gaps: RoundSnapshot['gaps'];
};

/**
 * The narrow original-round query: the plan-independent alias of
 * `queryRoundChainHead` for the work chain of exactly this subject Run and
 * Task (spec §9 VD-7, VD-14), so a caller finds the chain head — open or
 * finalized — instead of opening a second round. It never accepts a
 * caller-supplied round identity, digest or verdict.
 *
 * `planRef` is information only (VD-7, C6): when given it must be a
 * PlanRevisionRef of the scope project, and it never selects or filters the
 * round, so a round opened before a later adoption is still found.
 */
export type OriginalVerificationQuery = {
    subjectRunRef: RunRef;
    subject: TaskTriple;
    planRef?: PlanRevisionRef;
};

/**
 * VR-05 (spec §9 VD-6): the runner proved, in the same process, that no
 * process started after `beginCheck`, so the executing check returns to
 * `pending`. `meta.expected` pins the round as re-read.
 */
export type AbandonCheckInput = {
    roundRef: VerificationRoundRef;
    checkId: string;
    invocationId: string;
    cause: 'caller_cancelled' | 'root_changed' | 'permission_changed' | 'read_failed';
};

/**
 * VR-13: the frozen ticket the runner received is incomplete (`ticketProblem`
 * is the proof), so the check is `interrupted` with cause `ticket_invalid` and
 * never runs again in the round. `meta.expected` pins the round as re-read.
 */
export type InterruptCheckInput = {
    roundRef: VerificationRoundRef;
    checkId: string;
    invocationId: string;
} & (
    | { cause: 'ticket_invalid'; ticketProblem: string }
    /** VR-04 (A.2 step 5.6): the start-up reconcile, under this Host's instance lease (D-12, D-18). */
    | { cause: 'host_restart'; hostInstanceId: string }
);

/**
 * Chain-head read (spec §9 VD-14): the work chain of `(subject, subjectRunRef)`,
 * or the gate's own chain with `subjectRunRef: null`.
 */
export type RoundChainHeadQuery = {
    subject: TaskTriple;
    subjectRunRef: RunRef | null;
};

/**
 * Successor-round request (spec §9 VD-12). There is no `trigger`: the actor
 * class is derived from the principal. `onlyIfSourceChanged` only narrows
 * admission; `note` is accepted only from a human operator and is stored by the
 * owner as an Artifact that joins `newInputRefs`; `reason` is never a new basis.
 */
export type ReverifyRoundInput = {
    predecessorRoundRef: VerificationRoundRef;
    onlyIfSourceChanged?: boolean;
    newInputRefs?: NewBasisInputRefV1[];
    reason?: string;
    note?: string;
    /**
     * 7A §3.5: the message this recheck acts on, shape-checked only — the owner
     * neither reads it nor compares its scope. Part of the fingerprint only when
     * present, so an old call keeps its fingerprint and its result; a committed
     * call carries the formal `proofReceipt`, one without the key returns its
     * result unchanged.
     */
    acknowledgement?: SessionMessageRef;
};

/** `reverifyRound` result: a committed policy refusal is a value, not a CoreError. */
export type ReverifyOutcomeV1 =
    | { kind: 'reverified'; round: RoundSnapshot }
    | { kind: 'refused'; refusal: TaskReworkRefusalSnapshotV1 };

export interface EvidencePort {
    openVerification(
        ctx: CoreCallContext,
        request: GraphWrite<{
            subjectRunRef: RunRef;
            subject: TaskTriple;
            planRef: PlanRevisionRef;
            gateSubject?: 'goal' | 'stage' | 'module';
        }>,
    ): Promise<WriteResult<RoundSnapshot>>;
    readVerification(
        ctx: CoreCallContext,
        ref: VerificationRoundRef,
    ): Promise<ReadResult<RoundSnapshot>>;
    /**
     * Optional narrow read: the chain head (open or finalized) of exactly this
     * subject Run's work chain, whatever Plan opened it (`queryRoundChainHead`
     * with `subjectRunRef`). A formal zero result is 'not_found'; an invalid
     * chain is 'incomplete' (never a guessed latest). An absent or unknown
     * implementation is NOT 'not_found': a caller must wait rather than treat it
     * as "no round".
     */
    queryOriginalVerification?(
        ctx: CoreCallContext,
        request: OriginalVerificationQuery,
    ): Promise<ReadResult<RoundSnapshot>>;
    /**
     * Spec §9 VD-14: the head of one subject's round chain. `not_found` = no
     * chain; an invalid chain or a page past `ROUND_CHAIN_MAX` is `incomplete`.
     * Optional on the port: a caller without it waits.
     */
    queryRoundChainHead?(
        ctx: CoreCallContext,
        request: RoundChainHeadQuery,
    ): Promise<ReadResult<RoundSnapshot>>;
    /** Spec §9 VR-05 (VD-6): the runner's proven non-start. Optional on the port: without it the window waits. */
    abandonCheck?(
        ctx: CoreCallContext,
        request: GraphWrite<AbandonCheckInput>,
    ): Promise<WriteResult<RoundSnapshot>>;
    /** Spec §9 VR-13: the runner's incomplete ticket. Optional on the port: without it the window waits. */
    interruptCheck?(
        ctx: CoreCallContext,
        request: GraphWrite<InterruptCheckInput>,
    ): Promise<WriteResult<RoundSnapshot>>;
    /**
     * Spec §9 VD-12 (VR-14, A.2 step 5.9): open the successor round of a
     * finalized non-PASS chain head, or commit a policy refusal
     * (`TaskReworkRefusal`, operation `reverify`). The actor class comes from
     * the principal: a Host operator is `human`, a platform automation actor
     * `system`, a `work_run` caller `agent` (through the delegated-write
     * admission). Optional on the port: a caller without it answers
     * `unsupported`.
     */
    reverifyRound?(
        ctx: CoreCallContext,
        request: GraphWrite<ReverifyRoundInput>,
    ): Promise<EffectWriteResultV1<ReverifyOutcomeV1>>;
    beginCheck(
        ctx: CoreCallContext,
        request: GraphWrite<{ roundRef: VerificationRoundRef; checkId: string }>,
    ): Promise<WriteResult<CheckExecutionTicket>>;
    recordCheckResult(
        ctx: CoreCallContext,
        request: GraphWrite<{
            roundRef: VerificationRoundRef;
            checkId: string;
            invocationId: string;
            observation: CheckProcessObservation;
        }>,
    ): Promise<WriteResult<RoundSnapshot>>;
    finalizeChecks(
        ctx: CoreCallContext,
        request: GraphWrite<{ roundRef: VerificationRoundRef; reviewerEvidence?: readonly EvidenceRef[] }>,
    ): Promise<WriteResult<FinalizedChecks>>;
}
