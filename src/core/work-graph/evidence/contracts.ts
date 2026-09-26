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
import type { EvidenceOutcome, EvidenceRef, EvidenceSnapshot } from '../../../contracts/evidence.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
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

export interface EvidencePort {
    openVerification(
        ctx: CoreCallContext,
        request: GraphWrite<{
            subjectRunRef: RunRef;
            subject: TaskTriple;
            planRef: PlanRevisionRef;
            gateSubject?: 'goal';
        }>,
    ): Promise<WriteResult<RoundSnapshot>>;
    readVerification(
        ctx: CoreCallContext,
        ref: VerificationRoundRef,
    ): Promise<ReadResult<RoundSnapshot>>;
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

export type EvidenceServiceDependencies = {
    records: GoalRecordTransactionPort & RecordLookupPort;
    materials: MaterialPort;
    materialFacts: MaterialReadFactsPort;
    executions: ExecutionReadPort;
    workspaceHost: WorkspaceHostBindings;
    source: VerificationRoundSourcePort;
    /** Frozen trusted checks configuration. Absent keeps history reads/receipts
     * but makes fresh open/begin explicitly unsupported. */
    configuration?: TrustedCheckConfiguration;
    now(): string;
    newId(): string;
};
