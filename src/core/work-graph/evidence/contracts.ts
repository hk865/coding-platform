/**
 * R3e.1 EvidencePort and its exact raw dependencies.
 *
 * The port is the ONE trusted Host-facing evidence/verification write path. It
 * owns the round lifecycle, the check begin/record cursor and the single atomic
 * commit into the existing RecordStore. It never publishes a generic
 * `resolveVerificationInput`/`resolveCheckProducer` callback and never accepts a
 * caller-supplied digest, coverage, PASS verdict or report body.
 *
 * The dependency set is exactly what the service reads:
 *  - the ONE RecordStore transaction/lookup pair already owned by composition;
 *  - the same Material body writer + read-facts seam;
 *  - the existing ExecutionReadPort for the real subject Run;
 *  - the trusted WorkspaceHostBindings + the existing
 *    `VerificationRoundSourcePort` (VerificationWorkspaceReader);
 *  - the optional frozen trusted checks configuration (absent => fresh
 *    open/begin are explicitly unsupported while history reads keep working).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { EvidenceOutcome, EvidenceRef, EvidenceSnapshot } from '../../../contracts/evidence.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { NewBasisInputRefV1 } from '../../../contracts/no-progress.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { TaskReworkRefusalSnapshotV1 } from '../../../contracts/task-requeue.js';
import type {
    CheckExecutionTicket,
    CheckProcessObservation,
    RoundSnapshot,
    TrustedCheckConfiguration,
    VerificationRoundRef,
} from '../../../contracts/verification.js';
import type { VerificationRoundSourcePort } from '../../../contracts/verification-context.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { WorkspaceHostBindings } from '../../workspace/access.js';
import type { MaterialPort, MaterialReadFactsPort } from '../materials/contracts.js';
import type { ExecutionReadPort } from '../tasks/execution-read-contracts.js';
import type { GraphWrite } from '../tasks/contracts.js';

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
 * The narrow original-round query. It names exactly the subject Run, Task and
 * adopted Plan of an already-ended Work Run so a caller can find the ONE round
 * already produced for it — open or finalized — instead of opening a second
 * round. It never accepts a caller-supplied round identity, digest or verdict;
 * the lookup is a read over the existing RecordStore only.
 *
 * `planRef` is optional in the type (spec §9 VD-7, C6): it becomes information
 * only once the query is the plan-independent alias of `queryRoundChainHead`.
 * Until then every caller still passes it and the service still requires it.
 */
export type OriginalVerificationQuery = {
    subjectRunRef: RunRef;
    subject: TaskTriple;
    planRef?: PlanRevisionRef;
};

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
     * Optional narrow read: the ONE original round (open or finalized) for
     * exactly this subject Run/task/plan. A formal zero result is 'not_found',
     * exactly one candidate is 'ready', and more than one candidate is
     * 'incomplete' (never a guessed latest). An absent or unknown implementation
     * is NOT 'not_found': a caller must wait rather than treat it as "no round".
     * The service implements it as a candidate lookup over the existing
     * RecordStore; no second store, table or manager is created.
     */
    queryOriginalVerification?(
        ctx: CoreCallContext,
        request: OriginalVerificationQuery,
    ): Promise<ReadResult<RoundSnapshot>>;
    /**
     * Spec §9 VD-14: the head of one subject's round chain. `not_found` = no
     * chain; an invalid chain or a page past `ROUND_CHAIN_MAX` is `incomplete`.
     * Optional until the evidence service implements it (A.2 step 5).
     */
    queryRoundChainHead?(
        ctx: CoreCallContext,
        request: RoundChainHeadQuery,
    ): Promise<ReadResult<RoundSnapshot>>;
    /**
     * Spec §9 VD-12 (VR-14): open the successor round of a finalized non-PASS
     * chain head, or commit a policy refusal. Optional until the evidence
     * service implements it (A.2 step 5).
     */
    reverifyRound?(
        ctx: CoreCallContext,
        request: GraphWrite<ReverifyRoundInput>,
    ): Promise<WriteResult<ReverifyOutcomeV1>>;
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
    submitEvidence(
        ctx: CoreCallContext,
        request: GraphWrite<{ roundRef: VerificationRoundRef; claim: string }>,
    ): Promise<WriteResult<EvidenceSnapshot>>;
    finalizeChecks(
        ctx: CoreCallContext,
        request: GraphWrite<{ roundRef: VerificationRoundRef; reviewerEvidence?: readonly EvidenceRef[] }>,
    ): Promise<WriteResult<FinalizedChecks>>;
}

/**
 * R6 cold-start scoped checks resolver. It returns the CURRENT trusted checks
 * configuration for exactly one workspace scope, or `undefined` when that scope
 * has none. A fresh round resolves and FREEZES its own configuration; an
 * already-open round/ticket keeps the exact configuration it recorded. The
 * resolver never crosses a workspace and never widens a permission: Stage 2
 * reuses the existing Host workspace authorization to build the configuration.
 */
export type CheckConfigurationResolver = (scope: WorkspaceScope) => TrustedCheckConfiguration | undefined;

export type EvidenceServiceDependencies = {
    records: GoalRecordTransactionPort & RecordLookupPort;
    materials: MaterialPort;
    materialFacts: MaterialReadFactsPort;
    executions: ExecutionReadPort;
    workspaceHost: WorkspaceHostBindings;
    source: VerificationRoundSourcePort;
    /** Legacy frozen trusted checks configuration. Kept byte-compatible for
     * existing callers; a scoped `configurationFor` takes precedence for a
     * fresh round when both are supplied. Absent keeps history reads/receipts
     * but makes fresh open/begin explicitly unsupported. */
    configuration?: TrustedCheckConfiguration;
    /** R6 scoped resolver; Stage 1 declares the seam only. */
    configurationFor?: CheckConfigurationResolver;
    now(): string;
    newId(): string;
};
