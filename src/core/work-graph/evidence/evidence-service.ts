/**
 * R3e.1 Evidence service (implementation).
 *
 * The ONE trusted Evidence/verification service the composition root owns.
 * `openVerification` reads the adopted Goal/Plan/subject Run, captures the real
 * VerificationWorkspaceReader source, compiles the pinned VerificationPlan and
 * registers the pending checks under a Round revision CAS. `beginCheck` CASes
 * `pending -> executing` and freezes the ticket. `recordCheckResult` restores
 * the original identity/fingerprint receipt first, then accepts the bound
 * Host's real observation as history/INCONCLUSIVE when the current source or
 * permission changed. `finalizeChecks` folds the frozen coverage and commits
 * round + Evidence + TaskEvidenceIndex + event + receipt in ONE records.commit.
 *
 * Every round, check and TaskEvidenceIndex write is decided by
 * `state/verification-machine.ts` (spec §9 VR-01..VR-03, VR-05, VR-07, VR-08,
 * VR-10..VR-13) after the unchanged receipt lookup: the service reads,
 * captures and mints ids, stops at the machine's exported guard steps where it
 * stopped before each IO, and translates the machine's effects into the commit.
 * A subject has at most one round chain (VD-1, VD-15): `openVerification`
 * reads the subject's rounds before the capture and claims the subject slot in
 * the commit; `queryRoundChainHead` reads the chain head (VD-14).
 *
 * The service never calls completeTask/completeGoal, never releases or advances
 * a Task/Run/Session, and never fabricates a PASS from a missing/blocked check.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type {
    EffectivityAnchorV1, EvidenceOutcome, EvidenceRef, EvidenceSnapshot, EvidenceV1,
} from '../../../contracts/evidence.js';
import { EVIDENCE_SUMMARY_MAX_BYTES } from '../../../contracts/evidence.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { REPORT_CONTENT_TYPE } from '../../../contracts/no-progress.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RunRef, RunSnapshot, SourceRefV1, TaskTriple } from '../../../contracts/dispatch.js';
import type {
    CheckCapabilityV1, CheckExecutionTicket, CheckProcessObservation, RoundCheckSnapshot, RoundSnapshot,
    TrustedCheckConfiguration, VerificationRoundRef,
} from '../../../contracts/verification.js';
import type {
    VerificationRoundMaterialIdentity, VerificationRoundSourceResult,
} from '../../../contracts/verification-context.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
    EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
    UniqueClaimChange,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { architectureBaselineDigest, readArchitectureBaselineSnapshot } from '../architecture/catalog-record-codecs.js';
import {
    readBatch, readGoal, readPinnedCompletionPolicy, readPlan, readRevisionNumber, type Rejected as ReadRejected,
} from '../tasks/plan-readers.js';
import { planRevisionRefKey } from '../tasks/plan-record-codecs.js';
import { taskRequeueRefKey } from '../tasks/claim-record-codecs.js';
import {
    buildEffectiveTaskBasis, isBasisUnsupported,
} from '../tasks/plan-task-basis.js';
import {
    bindTrustedContext, isRecord, isolateWrite, loadReplayEvent, mapStoreFailure, mergeGuards, nonEmpty, sameRef,
} from '../tasks/execution-entry-service.js';
import {
    checkEventAdmission, finalizeRoundOutcome, foldVerdictChecks, frozenBindingProblem, nextTaskEvidenceIndex, outcomeFor,
    roundChainHead, roundOpenBasisProblem, roundOpenChainProblem, roundOpenChecksProblem, roundOpenPointerProblem,
    roundOpenSubjectProblem, roundReviewerEvidenceProblem, roundWriteAdmission, taskEvidenceIndexRefOf, transitionCheck,
    transitionRound,
    type CheckEvent, type CheckVerdictDecisionV1, type RoundChainHeadV1, type RoundFoldFactsV1, type RoundGuardContext,
    type RoundOpenFactsV1, type TaskEvidenceIndexReadV1, type TaskEvidenceIndexWrite, type VerificationEffect,
} from '../state/verification-machine.js';
import { unreachable, type Rejected } from '../state/transition.js';
import { compileVerificationPlan } from './verification-plan.js';
import { evidenceApplicabilityWithBasis } from './coverage.js';
import {
    EVIDENCE_ADMITTED_EVENT_TYPE, VERIFICATION_CHECK_ABANDONED_EVENT_TYPE, VERIFICATION_CHECK_BEGUN_EVENT_TYPE,
    VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE, VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE,
    VERIFICATION_ROUND_BY_TASK_LOOKUP, VERIFICATION_ROUND_FINALIZED_EVENT_TYPE,
    VERIFICATION_ROUND_OPENED_EVENT_TYPE, VERIFICATION_ROUND_ORIGINAL_LOOKUP, VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT,
    checkObservationProblem, decodeVerificationRoundSnapshot,
    encodeEvidenceSnapshot, encodeTaskEvidenceIndexSnapshot, encodeVerificationRoundEvent,
    encodeVerificationRoundSnapshot, verificationRoundEventFromEvent, decodeTaskEvidenceIndexSnapshot,
    type VerificationRoundEvent,
} from './evidence-record-codecs.js';
import type {
    AbandonCheckInput, EvidencePort, EvidenceServiceDependencies, FinalizedChecks, InterruptCheckInput,
    OriginalVerificationQuery, RoundChainHeadQuery,
} from './contracts.js';
import type { GraphWrite } from '../tasks/contracts.js';

type Records = GoalRecordTransactionPort & RecordLookupPort;
type HostActor = { kind: 'human' | 'system'; id: string };
type LoadedRound = { ok: true; round: RoundSnapshot } | { ok: false; rejection: CoreRejection };

// -------------------------------------------------------------------------- //
// Small pure helpers                                                          //
// -------------------------------------------------------------------------- //

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
    return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function notFound(reason: string): CoreRejection { return reject('not_found', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }
function unsupported(reason: string): CoreRejection { return reject('unsupported', reason); }
function cancelled(reason: string): CoreRejection { return reject('cancelled', reason); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function refKeyOf(value: unknown): string | null {
    try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function fingerprintOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function digestOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function identityKeyOf(prefix: string, actor: HostActor, projectId: string, workspaceId: string, requestId: string): string {
    return prefix + sha256Hex(canonicalJson({ actor: { kind: actor.kind, id: actor.id }, projectId, workspaceId, requestId } as unknown as JsonValue));
}
function roundRefProblem(ref: unknown): string | null {
    if (!isRecord(ref) || ref['aggregateType'] !== 'VerificationRound' || !nonEmpty(ref['projectId'])
        || !nonEmpty(ref['workspaceId']) || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId'])
        || !nonEmpty(ref['runId']) || !nonEmpty(ref['roundId'])) {
        return 'the round ref must be a complete VerificationRoundRef';
    }
    return null;
}
function taskTripleProblem(value: unknown): string | null {
    if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
        return 'the subject must be a complete TaskTriple';
    }
    return null;
}
function planRefProblem(value: unknown): string | null {
    if (!isRecord(value) || value['aggregateType'] !== 'PlanRevision' || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
        return 'the plan ref must be a complete PlanRevisionRef';
    }
    return null;
}
function isRunRef(value: unknown): value is RunRef {
    return isRecord(value) && value['aggregateType'] === 'Run' && nonEmpty(value['projectId'])
        && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function mapRejected(result: ReadRejected): CoreRejection {
    return { status: 'rejected', code: result.code, reason: result.reason };
}
function mapWorkspaceRejection(result: { status: 'rejected'; code: string; reason: string }): CoreRejection {
    const code: CoreError = result.code === 'cancelled' || result.code === 'forbidden' || result.code === 'invalid'
        || result.code === 'unavailable' || result.code === 'not_found' ? result.code : 'unavailable';
    return { status: 'rejected', code, reason: result.reason };
}
function mapRead<T>(result: Exclude<ReadResult<T>, { status: 'ready' }>): CoreRejection {
    if (result.status === 'not_found') return notFound('the requested record does not exist');
    if (result.status === 'not_ready') return incomplete('the read is not ready at the required watermark');
    return result;
}
function mapSourceFailure(capture: Exclude<VerificationRoundSourceResult, { status: 'ready' }>): CoreRejection {
    if (capture.status === 'incomplete') return incomplete(capture.missing.join('; ') || 'the workspace source is unavailable');
    return reject('source_stale', capture.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ') || 'the workspace source changed');
}
function checkRoundPin(expected: readonly VersionPin[], ref: VerificationRoundRef):
{ ok: true; revision: number } | CoreRejection {
    if (expected.length !== 1) return invalid('meta.expected must contain exactly one VerificationRound revision pin');
    const raw = expected[0] as unknown;
    if (!isRecord(raw) || !isRecord(raw['ref']) || typeof raw['revision'] !== 'number'
        || !Number.isSafeInteger(raw['revision']) || raw['revision'] < 1) {
        return invalid('the expected round pin must carry a ref and a positive safe revision');
    }
    if (!sameRef(raw['ref'], ref)) return invalid('meta.expected must pin exactly the target round');
    return { ok: true, revision: raw['revision'] as number };
}
function boundedSummary(text: string): string {
    if (Buffer.byteLength(text, 'utf8') <= EVIDENCE_SUMMARY_MAX_BYTES) return text;
    let end = Math.min(text.length, EVIDENCE_SUMMARY_MAX_BYTES);
    while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > EVIDENCE_SUMMARY_MAX_BYTES) end -= 1;
    return text.slice(0, end);
}
function anchorOf(round: RoundSnapshot): EffectivityAnchorV1 {
    return { schemaVersion: 1, planRef: round.adoptedPlanRef, planRevision: round.verificationPlan.planRevision,
        workspaceRevision: round.identity.workspaceRevision,
        pinnedCompletionPolicy: round.verificationPlan.pinnedCompletionPolicy,
        pinnedArchitectureBaseline: round.verificationPlan.pinnedArchitectureBaseline };
}

// -------------------------------------------------------------------------- //
// The verification machine (spec §9)                                          //
// -------------------------------------------------------------------------- //

/** The round machines' guard context for this caller; a service call never holds the reconcile lease. */
function roundCtx(executor: HostActor, actor: HostActor, expectedRevision: number | null): RoundGuardContext {
    return { callerIsExecutor: executor.kind === actor.kind && executor.id === actor.id, expectedRevision,
        instanceLeaseHeld: false };
}

type Refused = { ok: false; code: CoreError; detail: string };

/** A machine refusal as today's rejection (§1.2: code and reason kept); a stale pin also reports the round's revision. */
function refusalOf(refusal: Refused, round?: RoundSnapshot): CoreRejection;
function refusalOf(refusal: Rejected | null, round?: RoundSnapshot): CoreRejection | null;
function refusalOf(refusal: Refused | Rejected | null, round?: RoundSnapshot): CoreRejection | null {
    if (refusal === null || refusal.ok) return null;
    return reject(refusal.code, refusal.detail, refusal.code === 'revision_conflict' && round !== undefined
        ? [{ ref: round.ref, revision: round.revision }] : undefined);
}

/** The effect of one kind (a decided write carries each kind at most once). */
function effectOf<K extends VerificationEffect['kind']>(effects: readonly VerificationEffect[], kind: K):
Extract<VerificationEffect, { kind: K }> | undefined {
    return effects.find((effect): effect is Extract<VerificationEffect, { kind: K }> => effect.kind === kind);
}

/** One decided write: the parts its effects select for the ONE commit. */
type RoundWrite<T> = {
    identity: string;
    fingerprint: string;
    effects: readonly VerificationEffect[];
    /** The machine's next round, written under its CAS when the effects carry `guard_round`. */
    round: RoundSnapshot;
    /** `guard_open_read_set` / `guard_finalize_read_set`: the CAS of every record the operation read. */
    readSet?: readonly RecordGuard[];
    /** `admit_claim_evidence` / `admit_verdict_evidence`: the Evidence@1 rows built from the effect. */
    evidence?: readonly EvidenceSnapshot[];
    /** `append_task_evidence_index`. */
    index?: TaskEvidenceIndexWrite;
    event: VerificationRoundEvent;
    value: T;
    /** The cancel refusal checked just before the commit; null where there is none (`recordCheckResult`). */
    cancelled: string | null;
    /**
     * `claim_round_slot`: the owner's own answer to a lost slot (VR-01), read
     * again from the subject's rounds instead of the generic store mapping.
     */
    slotTaken?: () => Promise<CoreRejection>;
};

/**
 * Translates the effects into ONE RecordStore commit and commits it. Guards:
 * round, read set, index, then each Evidence (CAS null); records: round,
 * Evidence, index; claims: the round slot. A replayed or lost commit restores
 * the original event result.
 */
async function commitRoundWrite<T>(records: Records, signal: AbortSignal, write: RoundWrite<T>): Promise<WriteResult<T>> {
    type Guarded = { record: EncodedRecord; guard: RecordGuard };
    const guarded = (record: EncodedRecord, expectedRevision: number | null): Guarded => ({ record, guard: { refKey: record.refKey, expectedRevision } });
    let round: Guarded[] = [];
    let roundGuard: RecordGuard[] = [];
    let readSet: readonly RecordGuard[] = [];
    let evidence: Guarded[] = [];
    let index: Guarded[] = [];
    let claims: UniqueClaimChange[] = [];
    let events: EncodedDomainEvent[] = [];
    for (const effect of write.effects) {
        switch (effect.kind) {
            case 'guard_round': round = [guarded(encodeVerificationRoundSnapshot(write.round), effect.expectedRevision)]; break;
            case 'guard_round_unchanged': {
                const key = refKeyOf(write.round.ref);
                if (key === null) return invalid('the round ref is not canonical JSON');
                roundGuard = [{ refKey: key, expectedRevision: effect.revision }];
                break;
            }
            case 'guard_open_read_set':
            case 'guard_finalize_read_set':
                readSet = write.readSet ?? [];
                break;
            case 'admit_claim_evidence':
            case 'admit_verdict_evidence':
                evidence = (write.evidence ?? []).map(snapshot => guarded(encodeEvidenceSnapshot(snapshot), null));
                break;
            case 'append_task_evidence_index':
                if (write.index?.write === true) index = [guarded(encodeTaskEvidenceIndexSnapshot(write.index.record), write.index.expectedRevision)];
                break;
            case 'emit_event':
                if (effect.eventType !== write.event.eventType) throw new Error(`the decided event is ${effect.eventType}, not ${write.event.eventType}`);
                events = [encodeVerificationRoundEvent(write.event)];
                break;
            case 'claim_round_slot': claims = [{ ...effect.claim }]; break;
            default: return unreachable(effect, 'verification effect');
        }
    }
    const merged = mergeGuards([...round.map(entry => entry.guard), ...roundGuard, ...readSet,
        ...[...index, ...evidence].map(entry => entry.guard)]);
    if (!merged.ok) return merged.rejection;
    const prepared: PreparedCommit = { identityKey: write.identity, fingerprint: write.fingerprint, guards: merged.guards,
        records: [...round, ...evidence, ...index].map(entry => entry.record), claims, indexGuards: [], indexChanges: [], events };
    const eventType = write.event.eventType;
    try {
        if (write.cancelled !== null && signal.aborted) return cancelled(write.cancelled);
        const receipt = await records.commit(prepared);
        if (receipt.status !== 'committed') {
            if (receipt.code === 'unique_conflict' && write.slotTaken !== undefined) return await write.slotTaken();
            return mapStoreFailure(receipt);
        }
        if (receipt.replayed) return await replayEvent(records, receipt, write.identity, write.fingerprint, eventType) as WriteResult<T>;
        return { status: 'committed', value: write.value, replayed: false, cursor: receipt.cursor };
    } catch (error) {
        return await commitOrRecover(records, write.identity, write.fingerprint, eventType, error) as WriteResult<T>;
    }
}

// -------------------------------------------------------------------------- //
// Store helpers                                                               //
// -------------------------------------------------------------------------- //

async function readRoundRecord(records: Records, ref: VerificationRoundRef): Promise<LoadedRound> {
    const key = refKeyOf(ref);
    if (key === null) return { ok: false, rejection: invalid('the round ref is not canonical JSON') };
    let read;
    try { read = await records.readMany([key]); }
    catch (error) { return { ok: false, rejection: unavailable(`the round read failed: ${messageOf(error)}`) }; }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) {
        return { ok: false, rejection: read.value.missing.includes(key) ? notFound('the round does not exist') : unavailable('the round key was neither returned nor missing') };
    }
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the round is damaged: ${decoded.reason}`) };
    return { ok: true, round: decoded.value };
}

type LookupOutcome = { status: 'found'; receipt: Extract<StoreCommitReceipt, { status: 'committed' }> }
    | { status: 'absent' } | { status: 'failed'; rejection: CoreRejection };

async function lookupReceipt(records: Records, identity: string, fingerprint: string): Promise<LookupOutcome> {
    try {
        const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
        if (lookup.status === 'ready') return { status: 'found', receipt: lookup.value };
        if (lookup.code === 'not_found') return { status: 'absent' };
        return { status: 'failed', rejection: mapStoreFailure(lookup) };
    } catch (error) {
        return { status: 'failed', rejection: unavailable(`the original receipt could not be read: ${messageOf(error)}`) };
    }
}

type ReplayResult = { status: 'committed'; value: unknown; replayed: true; cursor: CommitCursor } | CoreRejection;

async function replayEvent(
    records: Records,
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
    identity: string,
    fingerprint: string,
    expectedEventType: VerificationRoundEvent['eventType'],
): Promise<ReplayResult> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = verificationRoundEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded round event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.eventType !== expectedEventType) return unavailable('the recorded event type disagrees with the operation');
    if (event.identityKey !== identity || event.fingerprint !== fingerprint) return unavailable('the recorded event disagrees with the request identity');
    return { status: 'committed', value: event.result, replayed: true, cursor: receipt.cursor };
}

async function commitOrRecover(
    records: Records,
    identity: string,
    fingerprint: string,
    expectedEventType: VerificationRoundEvent['eventType'],
    cause: unknown,
): Promise<unknown | CoreRejection> {
    const outcome = await lookupReceipt(records, identity, fingerprint);
    if (outcome.status === 'found') return await replayEvent(records, outcome.receipt, identity, fingerprint, expectedEventType);
    if (outcome.status === 'failed') return outcome.rejection;
    return unavailable(`the commit result is unknown: ${messageOf(cause)}`);
}

async function readPinnedBaseline(records: Records, pin: { ref: { baselineId: string; revision: number }; digest: string }):
Promise<{ ok: true; guard: RecordGuard } | { ok: false; rejection: CoreRejection }> {
    const key = refKeyOf(pin.ref);
    if (key === null) return { ok: false, rejection: incomplete('the pinned baseline ref is not canonical JSON') };
    const read = await readBatch(records, [key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapRejected(read) };
    const record = read.batch.present.get(key);
    if (record === undefined) return { ok: false, rejection: notFound(`the adopted Plan baseline ${pin.ref.baselineId} is missing`) };
    let body: unknown;
    try { body = JSON.parse(record.json); } catch { return { ok: false, rejection: unavailable('the pinned ArchitectureBaseline is not JSON') }; }
    const snapshot = readArchitectureBaselineSnapshot(body);
    if (snapshot === null) return { ok: false, rejection: unavailable('the pinned ArchitectureBaseline is damaged') };
    if (snapshot.ref.baselineId !== pin.ref.baselineId || snapshot.contentRevision !== pin.ref.revision) {
        return { ok: false, rejection: reject('source_stale', 'the pinned ArchitectureBaseline content revision disagrees with the adopted pin') };
    }
    const digest = architectureBaselineDigest(body as { schemaVersion?: unknown; baselineId?: unknown; contentRevision?: unknown; content?: unknown });
    if (digest === null) return { ok: false, rejection: incomplete('the pinned ArchitectureBaseline content is not canonical JSON') };
    if (digest !== pin.digest) return { ok: false, rejection: reject('source_stale', 'the pinned ArchitectureBaseline digest disagrees with the adopted pin') };
    if (record.revision !== snapshot.revision) return { ok: false, rejection: unavailable('the ArchitectureBaseline outer revision disagrees with its body') };
    return { ok: true, guard: { refKey: key, expectedRevision: record.revision } };
}

/** The formal Workspace record's current domain revision. Read through the same
 * existing Plan reader owner; a missing/corrupt row is never a default. */
async function readWorkspaceRevision(records: Records, workspaceRef: { aggregateType: 'Workspace'; projectId: string; workspaceId: string }):
Promise<{ ok: true; revision: number } | { ok: false; rejection: CoreRejection }> {
    const key = refKeyOf(workspaceRef);
    if (key === null) return { ok: false, rejection: incomplete('the Workspace ref is not canonical JSON') };
    const read = await readBatch(records, [key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapRejected(read) };
    const revision = readRevisionNumber(read.batch, key);
    if (revision === null) return { ok: false, rejection: notFound('the subject Workspace does not exist') };
    return { ok: true, revision };
}

/** The subject task's evidence index as read (VR-10..12); a missing row reads as revision 0 with no ids. */
async function readIndex(records: Records, round: RoundSnapshot):
Promise<{ ok: true; index: TaskEvidenceIndexReadV1 } | { ok: false; rejection: CoreRejection }> {
    const ref = taskEvidenceIndexRefOf(round);
    const key = refKeyOf(ref);
    if (key === null) return { ok: false, rejection: invalid('the task evidence index ref is not canonical JSON') };
    let read;
    try { read = await records.readMany([key]); }
    catch (error) { return { ok: false, rejection: unavailable(`the task evidence index read failed: ${messageOf(error)}`) }; }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record: EncodedRecord | undefined = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined || read.value.missing.includes(key)) {
        return { ok: true, index: { ref, exists: false, revision: 0, evidenceIds: [] } };
    }
    const decoded = decodeTaskEvidenceIndexSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the task evidence index is damaged: ${decoded.reason}`) };
    return { ok: true, index: { ...decoded.value, exists: true } };
}

/**
 * One subject's round chain (§9.1 lookups, VD-14): the work chain of the
 * subject Run (`VerificationRoundBySubject`) or, with `subjectRunRef: null`,
 * the gate's chain over every producer (`VerificationRoundByTask`, VD-15). At
 * most `ROUND_CHAIN_MAX + 1` rows; a next page cannot be judged
 * (`incomplete`). Each row is rechecked against the scope and the subject (a
 * candidate index only); legacy slot-less rounds are read like any other.
 */
async function readSubjectChain(
    records: Records,
    scope: { projectId: string; workspaceId: string },
    subject: TaskTriple,
    subjectRunRef: RunRef | null,
): Promise<{ ok: true; chain: RoundChainHeadV1 } | { ok: false; rejection: CoreRejection }> {
    let lookup;
    try {
        lookup = await records.lookup(subjectRunRef === null
            ? { index: VERIFICATION_ROUND_BY_TASK_LOOKUP, values: [scope.projectId, scope.workspaceId, subject.goalId, subject.taskId],
                limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT }
            : { index: VERIFICATION_ROUND_ORIGINAL_LOOKUP,
                values: [scope.projectId, scope.workspaceId, subject.goalId, subject.taskId, subjectRunRef.runId],
                limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT });
    } catch (error) {
        return { ok: false, rejection: unavailable(`the round chain lookup failed: ${messageOf(error)}`) };
    }
    if (lookup.status !== 'ready') return { ok: false, rejection: mapStoreFailure(lookup) };
    if (lookup.value.next !== null) {
        return { ok: false, rejection: incomplete('the round chain is longer than the chain limit; refusing to guess its head') };
    }
    const rounds: RoundSnapshot[] = [];
    for (const record of lookup.value.records) {
        const decoded = decodeVerificationRoundSnapshot(record);
        if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`a chain round is damaged: ${decoded.reason}`) };
        const round = decoded.value;
        if (round.ref.projectId !== scope.projectId || round.ref.workspaceId !== scope.workspaceId
            || !sameRef(round.subject, subject) || (subjectRunRef !== null && !sameRef(round.subjectRunRef, subjectRunRef))) {
            return { ok: false, rejection: unavailable('an indexed round does not match the requested subject') };
        }
        rounds.push(round);
    }
    return { ok: true, chain: roundChainHead(rounds) };
}

/**
 * VR-01 (D-3, §9.4): whether a TaskRequeue covers the subject Run, and the
 * absence guard the open commits with. A backend without the claim schemas
 * cannot hold a TaskRequeue: `unsupported` is a confirmed absence with no guard.
 */
async function readRequeueCover(
    records: Records, run: Pick<RunSnapshot, 'ref' | 'task'>,
): Promise<{ ok: true; covered: boolean; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection }> {
    const key = taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: run.ref.projectId, goalId: run.ref.goalId,
        taskId: run.task.taskId, afterRunId: run.ref.runId });
    const read = await records.readMany([key]);
    if (read.status !== 'ready') {
        if (read.code === 'unsupported') return { ok: true, covered: false, guards: [] };
        return { ok: false, rejection: mapStoreFailure(read) };
    }
    const covered = read.value.records.some(record => record.refKey === key);
    return { ok: true, covered, guards: covered ? [] : [{ refKey: key, expectedRevision: null }] };
}

/** VD-1/VD-15 answered with the head pin (§9.4): the caller re-reads the head, never a second root. */
function chainRefusal(refusal: Rejected, chain: RoundChainHeadV1): CoreRejection {
    if (refusal.ok) throw new Error('chainRefusal needs a refusal');
    return reject(refusal.code, refusal.detail, chain.kind === 'head' && refusal.code === 'busy'
        ? [{ ref: chain.head.ref, revision: chain.head.revision }] : undefined);
}

// -------------------------------------------------------------------------- //
// The factory                                                                 //
// -------------------------------------------------------------------------- //

export function createEvidenceService(deps: EvidenceServiceDependencies): EvidencePort {
    const records = deps.records;

    async function storeReport(
        ctx: CoreCallContext,
        round: RoundSnapshot,
        request: { checkId: string; invocationId: string; observation: CheckProcessObservation },
        requestId: string,
        sourceStatus: RoundCheckSnapshot['sourceStatus'],
        outcome: EvidenceOutcome,
    ): Promise<{ ok: true; ref: ArtifactRef } | { ok: false; rejection: CoreRejection }> {
        const body = JSON.stringify({
            schemaVersion: 1, kind: 'registered-check-report', roundRef: round.ref,
            checkId: request.checkId, invocationId: request.invocationId,
            source: { actor: round.executor, runRef: null, checkId: request.checkId },
            subjectRunRef: round.subjectRunRef, subject: round.subject,
            observation: request.observation, sourceStatus, outcome, recordedAt: deps.now(),
        });
        const sources: SourceRefV1[] = [
            { kind: 'plan-revision', refId: round.adoptedPlanRef.planId, revision: String(round.verificationPlan.planRevision) },
            { kind: 'governance', refId: round.verificationPlan.pinnedCompletionPolicy.ref.policyId,
                revision: String(round.verificationPlan.pinnedCompletionPolicy.ref.revision),
                digest: round.verificationPlan.pinnedCompletionPolicy.digest },
        ];
        let stored;
        try {
            stored = await deps.materials.storeArtifact(ctx, { contentType: REPORT_CONTENT_TYPE, body, sources,
                origin: { kind: 'platform_operation', projectId: ctx.projectId,
                    ...(ctx.workspaceId === undefined ? {} : { workspaceId: ctx.workspaceId }),
                    requestId, actor: round.executor } });
        } catch (error) {
            return { ok: false, rejection: unavailable(`the check report could not be stored: ${messageOf(error)}`) };
        }
        if (stored.status !== 'stored') return { ok: false, rejection: unavailable(`the check report was rejected: ${stored.reason}`) };
        return { ok: true, ref: stored.ref };
    }

    async function evaluateSource(
        ctx: CoreCallContext,
        configuration: TrustedCheckConfiguration,
        round: RoundSnapshot,
    ): Promise<Exclude<RoundCheckSnapshot['sourceStatus'], null>> {
        try {
            const resolved = await deps.workspaceHost.resolveRoot(configuration.workspace);
            if (resolved.status !== 'ready') return 'unavailable';
            const authorized = await deps.workspaceHost.authorize(ctx, configuration.workspace);
            if (authorized.status !== 'ready') return 'permission_changed';
            if (authorized.value.permissionRevision !== configuration.permissionRevision) return 'permission_changed';
            const captured = await deps.source.capture(resolved.value.root);
            if (captured.status === 'ready') return captured.sourceDigest === round.identity.sourceDigest ? 'matched' : 'changed';
            if (captured.status === 'rejected' && captured.code === 'source_changed') return 'changed';
            return 'unavailable';
        } catch {
            return 'unavailable';
        }
    }

    async function openVerification(
        ctx: CoreCallContext,
        request: GraphWrite<{ subjectRunRef: RunRef; subject: TaskTriple; planRef: PlanRevisionRef; gateSubject?: 'goal' | 'stage' | 'module' }>,
    ): Promise<WriteResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { ctx: trusted, scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        if (!isRunRef(input.subjectRunRef)) return invalid('a formal round requires a complete subject RunRef');
        if (input.subject.projectId !== scope.projectId) return forbidden('the subject task belongs to another project');
        const subjectProblem = taskTripleProblem(input.subject);
        if (subjectProblem !== null) return invalid(subjectProblem);
        const planProblem = planRefProblem(input.planRef);
        if (planProblem !== null) return invalid(planProblem);
        if (input.gateSubject !== undefined && input.gateSubject !== 'goal'
            && input.gateSubject !== 'stage' && input.gateSubject !== 'module') {
            return invalid('gateSubject must be goal, stage or module when present');
        }
        // Receipt-first: the ORIGINAL open result is restored by the stable
        // identity/fingerprint before any current configuration/source check, so
        // a later missing/changed trusted configuration cannot lose the receipt.
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-open:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-open', subjectRunRef: input.subjectRunRef, subject: input.subject,
                planRef: input.planRef, ...(input.gateSubject === undefined ? {} : { gateSubject: input.gateSubject }),
                expected: owned.expected });
        } catch { return invalid('the open request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            const replayed = await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_ROUND_OPENED_EVENT_TYPE);
            return 'status' in replayed ? replayed as WriteResult<RoundSnapshot> : replayed;
        }
        // R6 cold-start: a FRESH round resolves the CURRENT configuration for
        // exactly its own scope. The scoped resolver takes precedence; the
        // legacy static configuration stays a compatible fallback. Receipt
        // replay above already ran before this current-configuration read.
        const configuration = deps.configurationFor !== undefined
            ? deps.configurationFor(scope)
            : deps.configuration;
        if (configuration === undefined) return unsupported('no trusted check configuration is registered for this workspace; fresh round open is unsupported');
        if (configuration.workspace.projectId !== scope.projectId || configuration.workspace.workspaceId !== scope.workspaceId) {
            return forbidden('the trusted check configuration belongs to another workspace');
        }
        // VR-01: the caller must be the configuration's registered executor.
        const guardCtx = roundCtx(configuration.executor, actor, null);
        const admitted = refusalOf(roundWriteAdmission(null, { kind: 'round_opened' }, guardCtx));
        if (admitted !== null) return admitted;
        if (signal.aborted) return cancelled('the round open was cancelled before the reads');

        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: input.subject.projectId, goalId: input.subject.goalId };
        if (goalRef.projectId !== scope.projectId) return forbidden('the subject Goal belongs to another project');
        const goalRead = await readGoal(records, goalRef);
        if (goalRead.status !== 'ready') return mapRejected(goalRead);
        const goal = goalRead.goal;
        if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return forbidden('the subject Goal belongs to another workspace');
        }
        const planIsActive = goal.activePlanRevision !== null
            && planRevisionRefKey(goal.activePlanRevision) === planRevisionRefKey(input.planRef);
        const pointerProblem = refusalOf(roundOpenPointerProblem(planIsActive));
        if (pointerProblem !== null) return pointerProblem;
        const planRead = await readPlan(records, input.planRef);
        if (planRead.status !== 'ready') return mapRejected(planRead);
        const plan = planRead.plan;
        if (plan.goalRef.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
            return notFound('the adopted Plan belongs to another Goal');
        }
        const basis = buildEffectiveTaskBasis(plan).get(input.subject.taskId);
        const taskBasisResolved = basis !== undefined && !isBasisUnsupported(basis);
        const basisProblem = refusalOf(roundOpenBasisProblem(taskBasisResolved, input.subject));
        if (basisProblem !== null) return basisProblem;
        const execution = await deps.executions.readExecution(trusted, input.subjectRunRef);
        if (execution.status !== 'ready') return mapRead(execution);
        const run = execution.value.run;
        if (!sameRef(run.ref, input.subjectRunRef)) return unavailable('the Run read returned a different aggregate');
        // A gate is not claimable: its round is opened against a formal ended
        // normal work Run of the SAME project/Goal/workspace while the
        // Round/VerificationPlan/taskBasis/Evidence subject stays the gate. The
        // adopted node must be a gate whose ACTUAL scope kind equals the declared
        // gateSubject; that actual kind is preserved unchanged in the round's
        // VerificationRoundScope identity below.
        const subjectNode = plan.tasks.find(task => task.taskId === input.subject.taskId);
        const producerNode = plan.tasks.find(task => task.taskId === run.task.taskId);
        const sameGoal = run.task.projectId === input.subject.projectId && run.task.goalId === input.subject.goalId;
        // VR-01 (D-3, §9.4): a subject Run a TaskRequeue covers is never verified again;
        // its absence is guarded by the commit. A backend without the claim schemas
        // cannot hold a TaskRequeue (`unsupported` is a confirmed absence, no guard).
        const requeueCover = await readRequeueCover(records, run);
        if (!requeueCover.ok) return requeueCover.rejection;
        const subjectFacts: Pick<RoundOpenFactsV1, 'relation' | 'subjectRun' | 'subjectRunRequeued'> = { subjectRun: run,
            subjectRunRequeued: requeueCover.covered,
            relation: input.gateSubject === undefined
                ? { kind: 'work', runTaskIsSubject: sameGoal && run.task.taskId === input.subject.taskId }
                : { kind: 'gate', gateSubject: input.gateSubject,
                    gateAdopted: subjectNode !== undefined && subjectNode.taskKind === 'gate' && subjectNode.scope.kind === input.gateSubject,
                    producer: !sameGoal || run.task.taskId === input.subject.taskId ? 'not_goal_work_run'
                        : producerNode === undefined || producerNode.taskKind !== 'work' ? 'not_adopted_work'
                            : run.workspaceSnapshot.workspaceId !== scope.workspaceId ? 'other_workspace' : 'ok' } };
        const runProblem = refusalOf(roundOpenSubjectProblem(subjectFacts, input.subject));
        if (runProblem !== null) return runProblem;
        // VD-1/VD-15 before the capture: the subject's chain (a gate's on any
        // producer). The slot claim in the commit settles a concurrent open.
        const subjectChainRun = input.gateSubject === undefined ? input.subjectRunRef : null;
        const chainRead = await readSubjectChain(records, scope, input.subject, subjectChainRun);
        if (!chainRead.ok) return chainRead.rejection;
        const chainProblem = roundOpenChainProblem(chainRead.chain, input.subject);
        if (chainProblem !== null) return chainRefusal(chainProblem, chainRead.chain);
        const facts: RoundOpenFactsV1 = { planIsActive, taskBasisResolved, ...subjectFacts, chain: chainRead.chain };
        const policyRead = await readPinnedCompletionPolicy(records, plan.effectiveCompletionPolicy);
        if (policyRead.status !== 'resolved') return mapRejected(policyRead);
        const baseline = await readPinnedBaseline(records, plan.effectiveArchitectureBaseline);
        if (!baseline.ok) return baseline.rejection;
        const resolvedRoot = await deps.workspaceHost.resolveRoot(configuration.workspace);
        if (resolvedRoot.status !== 'ready') return mapWorkspaceRejection(resolvedRoot);
        const authorization = await deps.workspaceHost.authorize(trusted, configuration.workspace);
        if (authorization.status !== 'ready') return mapWorkspaceRejection(authorization);
        if (authorization.value.permissionRevision !== configuration.permissionRevision) {
            return forbidden('the current Host permission revision is not the trusted configuration binding');
        }
        const workspaceRead = await readWorkspaceRevision(records, goal.workspaceRef);
        if (!workspaceRead.ok) return workspaceRead.rejection;
        if (workspaceRead.revision !== resolvedRoot.value.workspaceRevision) {
            return reject('source_stale', 'the Host access workspace revision is not the current Workspace record revision');
        }
        const captured = await deps.source.capture(resolvedRoot.value.root);
        if (captured.status !== 'ready') return mapSourceFailure(captured);
        if (signal.aborted) return cancelled('the round open was cancelled during source capture');

        let configurationDigest: string;
        try { configurationDigest = digestOf(configuration); }
        catch { return invalid('the trusted check configuration is not canonical JSON'); }
        const capabilities: CheckCapabilityV1[] = configuration.checks.map(check => ({
            checkId: check.checkId, kind: check.kind, coversKinds: [check.kind], replayable: false }));
        const compiled = compileVerificationPlan({
            schemaVersion: 1, taskRef: input.subject, planRef: input.planRef, planSnapshot: plan,
            workspaceRevision: resolvedRoot.value.workspaceRevision, changeScope: captured.changeScope,
            semanticChange: 'semantic', risks: [], checkCapabilities: capabilities,
            policy: { requirementKinds: [...policyRead.policyContent.requirementKinds],
                ...(policyRead.policyContent.fastPathDiffClasses === undefined
                    ? {} : { fastPathDiffClasses: [...policyRead.policyContent.fastPathDiffClasses] }) },
            configurationDigest,
        });
        if (compiled.status !== 'ready') {
            return compiled.code === 'invalid'
                ? invalid(compiled.issues.map(issue => issue.message).join('; '))
                : incomplete(`the VerificationPlan could not be compiled (${compiled.code}): ${compiled.issues.map(issue => issue.message).join('; ')}`);
        }
        const verificationPlan = compiled.plan;
        const checksProblem = refusalOf(roundOpenChecksProblem(verificationPlan, configuration));
        if (checksProblem !== null) return checksProblem;
        let identityMaterial: VerificationRoundMaterialIdentity;
        try {
            identityMaterial = {
                schemaVersion: 1,
                scope: { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: goalRef.goalId,
                    runId: input.subjectRunRef.runId, taskId: input.subject.taskId,
                    ...(input.gateSubject === undefined ? {} : { gateSubject: input.gateSubject }) },
                runRef: input.subjectRunRef, runRevision: run.revision, runDigest: digestOf(run),
                planRef: input.planRef, planRevision: plan.planRevision, planDigest: digestOf(plan),
                taskDigest: digestOf(subjectNode ?? input.subject),
                goalRevision: goal.revision, goalDigest: digestOf(goal),
                workspaceRevision: resolvedRoot.value.workspaceRevision,
                workspaceDigest: digestOf({ workspaceRef: goal.workspaceRef, revision: resolvedRoot.value.workspaceRevision }),
                workspaceRoot: resolvedRoot.value.root,
                policyPin: plan.effectiveCompletionPolicy, baselinePin: plan.effectiveArchitectureBaseline,
                sourceDigest: captured.sourceDigest, sourceProofDigest: digestOf(captured.sourceProof),
            };
        } catch { return invalid('the round material identity is not canonical JSON'); }
        const roundRef: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: scope.projectId,
            workspaceId: scope.workspaceId, goalId: goalRef.goalId, taskId: input.subject.taskId,
            runId: input.subjectRunRef.runId, roundId: deps.newId() };
        const decided = transitionRound(null, { kind: 'round_opened', facts, opening: { ref: roundRef, subject: input.subject,
            subjectRunRef: input.subjectRunRef, adoptedPlanRef: input.planRef, taskBasisRef: basis as PlanRevisionRef,
            executor: actor, configuration, configurationDigest, identity: identityMaterial,
            sourceProof: captured.sourceProof, verificationPlan } }, guardCtx);
        if (!decided.ok) return chainRefusal(decided, chainRead.chain);
        const round = decided.next;
        const occurredAt = deps.now();
        const event: VerificationRoundEvent = { eventId: deps.newId(), eventType: VERIFICATION_ROUND_OPENED_EVENT_TYPE,
            schemaVersion: 1, occurredAt, identityKey: identity, roundRef, actor, fingerprint, result: round };
        // The commit CASes the ACTUAL local read set this open consumed: Goal's
        // current adopted pointer, the adopted Plan, the formal Workspace domain
        // revision, the ended subject Run, the pinned policy/baseline and the
        // Round absence. A legal W1 future apply during the capture await moves
        // the Goal pointer and conflicts here instead of landing silently.
        const goalKey = refKeyOf(goalRef);
        const workspaceKey = refKeyOf(goal.workspaceRef);
        const runKey = refKeyOf(run.ref);
        if (goalKey === null || workspaceKey === null || runKey === null) {
            return invalid('the open read refs are not canonical JSON');
        }
        // A concurrent open of the same subject took the slot first: read its
        // chain again and answer like a later open would (VD-1, §9.4).
        const slotTaken = async (): Promise<CoreRejection> => {
            const again = await readSubjectChain(records, scope, input.subject, subjectChainRun);
            if (!again.ok) return again.rejection;
            const problem = roundOpenChainProblem(again.chain, input.subject);
            return problem === null ? unavailable('the subject round slot is held but no round of the subject is readable')
                : chainRefusal(problem, again.chain);
        };
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round, event,
            value: round, cancelled: 'the round open was cancelled before commit', slotTaken,
            readSet: [
                { refKey: goalKey, expectedRevision: goal.revision },
                { refKey: planRevisionRefKey(input.planRef), expectedRevision: plan.revision },
                { refKey: workspaceKey, expectedRevision: workspaceRead.revision },
                { refKey: runKey, expectedRevision: run.revision },
                ...requeueCover.guards,
                ...policyRead.guards,
                baseline.guard,
            ] });
    }

    async function readVerification(ctx: CoreCallContext, ref: VerificationRoundRef): Promise<ReadResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const refProblem = roundRefProblem(ref);
        if (refProblem !== null) return invalid(refProblem);
        if (ref.projectId !== ownedCtx.scope.projectId || ref.workspaceId !== ownedCtx.scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        const loaded = await readRoundRecord(records, ref);
        if (!loaded.ok) return loaded.rejection;
        return { status: 'ready', value: loaded.round };
    }

    /**
     * VD-14: the head of one subject's round chain, open or finalized. Work
     * (`subjectRunRef` given): the chain of that subject Run; gate
     * (`subjectRunRef: null`): the gate's one chain, whatever producer anchors
     * it (VD-15). No chain is exactly `not_found`; an invalid chain (legacy
     * roots, an ordinal gap) or one past the limit is `incomplete`, never a
     * guessed head; a lookup error or a mismatched/undecodable row is
     * `unavailable`, so the Workflow waits instead of opening a second round.
     */
    async function queryRoundChainHead(ctx: CoreCallContext, request: RoundChainHeadQuery): Promise<ReadResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope } = ownedCtx;
        if (!isRecord(request)) return invalid('the chain-head query requires an object');
        const rawSubject: unknown = request.subject;
        const rawRunRef: unknown = request.subjectRunRef;
        const subjectProblem = taskTripleProblem(rawSubject);
        if (subjectProblem !== null) return invalid(subjectProblem);
        if (rawRunRef !== null && !isRunRef(rawRunRef)) {
            return invalid('the chain-head query takes a complete subject RunRef, or null for a gate chain');
        }
        const subject = rawSubject as TaskTriple;
        if (subject.projectId !== scope.projectId || (rawRunRef !== null && rawRunRef.projectId !== scope.projectId)) {
            return forbidden('the chain-head query is outside the trusted Host scope');
        }
        if (rawRunRef !== null && rawRunRef.goalId !== subject.goalId) {
            return invalid('the chain-head query subject Run and Task do not share a Goal');
        }
        const read = await readSubjectChain(records, scope, subject, rawRunRef);
        if (!read.ok) return read.rejection;
        const chain = read.chain;
        switch (chain.kind) {
            case 'none': return { status: 'not_found' };
            case 'invalid': return incomplete(`the verification round chain is invalid (${chain.reason}); refusing to guess its head`);
            case 'head': return { status: 'ready', value: chain.head };
            default: return unreachable(chain, 'round chain');
        }
    }

    /**
     * The plan-independent alias of `queryRoundChainHead` for one subject Run
     * (VD-7, C6): `planRef`, when given, is checked as a PlanRevisionRef of the
     * scope project and never selects the round.
     */
    async function queryOriginalVerification(
        ctx: CoreCallContext,
        request: OriginalVerificationQuery,
    ): Promise<ReadResult<RoundSnapshot>> {
        if (!isRecord(request)) return invalid('the original-round query requires an object');
        const rawRunRef: unknown = request.subjectRunRef;
        const rawPlanRef: unknown = request.planRef;
        if (!isRunRef(rawRunRef)) return invalid('the original-round query requires a complete subject RunRef');
        if (rawPlanRef !== undefined) {
            const planProblem = planRefProblem(rawPlanRef);
            if (planProblem !== null) return invalid(planProblem);
            if ((rawPlanRef as PlanRevisionRef).projectId !== (rawRunRef as RunRef).projectId) {
                return forbidden('the original-round query plan belongs to another project');
            }
        }
        return queryRoundChainHead(ctx, { subject: request.subject, subjectRunRef: rawRunRef });
    }

    async function beginCheck(ctx: CoreCallContext, request: GraphWrite<{ roundRef: VerificationRoundRef; checkId: string }>):
    Promise<WriteResult<CheckExecutionTicket>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.checkId)) return invalid('beginCheck requires a checkId');
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-begin:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-begin', roundRef: input.roundRef, checkId: input.checkId, expected: owned.expected });
        } catch { return invalid('the begin request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_CHECK_BEGUN_EVENT_TYPE) as WriteResult<CheckExecutionTicket>;
        }
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        // VR-02 before any IO: open round, executor, registered check, pin, then `pending`.
        const guardCtx = roundCtx(round.executor, actor, checked.revision);
        const admitted = refusalOf(checkEventAdmission(round, { kind: 'check_begun', checkId: input.checkId }, guardCtx), round);
        if (admitted !== null) return admitted;
        // R6 cold-start: the original round FROZE its trusted configuration when
        // it opened. A later scope approval may never rewrite or re-key it, so
        // this fresh begin and every ticket it issues use the round's frozen
        // configuration, never the current resolver value.
        const configuration = round.configuration;
        // A fresh begin must still match the round's frozen Host grant and its
        // exact frozen source; otherwise no execution ticket is issued. The
        // permission and root are compared before the capture, the source
        // before the invocation id is minted.
        const resolved = await deps.workspaceHost.resolveRoot(configuration.workspace);
        if (resolved.status !== 'ready') return mapWorkspaceRejection(resolved);
        const authorized = await deps.workspaceHost.authorize(ownedCtx.ctx, configuration.workspace);
        if (authorized.status !== 'ready') return mapWorkspaceRejection(authorized);
        const grant = { permissionRevision: authorized.value.permissionRevision, workspaceRoot: resolved.value.root };
        const grantProblem = refusalOf(frozenBindingProblem(round, grant));
        if (grantProblem !== null) return grantProblem;
        const captured = await deps.source.capture(resolved.value.root);
        if (captured.status !== 'ready') return mapSourceFailure(captured);
        const observed = { ...grant, sourceDigest: captured.sourceDigest };
        const sourceProblem = refusalOf(frozenBindingProblem(round, observed));
        if (sourceProblem !== null) return sourceProblem;
        const invocationId = deps.newId();
        const decided = transitionCheck(round, { kind: 'check_begun', checkId: input.checkId, invocationId, observed }, guardCtx);
        if (!decided.ok) return refusalOf(decided, round);
        const definition = round.checks.find(candidate => candidate.checkId === input.checkId)!.definition;
        const ticket: CheckExecutionTicket = { roundRef: round.ref, checkId: input.checkId, invocationId,
            configurationRevision: configuration.configurationRevision, configurationDigest: round.configurationDigest,
            executor: round.executor, workspace: configuration.workspace, workspaceRoot: round.identity.workspaceRoot,
            permissionRevision: configuration.permissionRevision, sourceDigest: round.identity.sourceDigest,
            processAccess: configuration.processAccess, deniedPrefixes: configuration.deniedPrefixes, definition };
        const occurredAt = deps.now();
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: decided.next,
            event: { eventId: deps.newId(), eventType: VERIFICATION_CHECK_BEGUN_EVENT_TYPE, schemaVersion: 1, occurredAt,
                identityKey: identity, roundRef: round.ref, actor, fingerprint, result: ticket },
            value: ticket, cancelled: 'the check begin was cancelled before commit' });
    }

    async function recordCheckResult(ctx: CoreCallContext, request: GraphWrite<{
        roundRef: VerificationRoundRef; checkId: string; invocationId: string; observation: CheckProcessObservation;
    }>): Promise<WriteResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.checkId)) return invalid('recordCheckResult requires a checkId');
        if (!nonEmpty(input.invocationId)) return invalid('recordCheckResult requires an invocationId');
        const observationProblem = checkObservationProblem(input.observation);
        if (observationProblem !== null) return invalid(observationProblem);
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-record:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-record', roundRef: input.roundRef, checkId: input.checkId,
                invocationId: input.invocationId, observation: input.observation, expected: owned.expected });
        } catch { return invalid('the record request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE) as WriteResult<RoundSnapshot>;
        }
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        // VR-03 before any IO: open round, executor, registered check, `executing`, the begun invocation, then the pin.
        const guardCtx = roundCtx(round.executor, actor, checked.revision);
        const admitted = refusalOf(checkEventAdmission(round, { kind: 'check_result_recorded', checkId: input.checkId,
            invocationId: input.invocationId }, guardCtx), round);
        if (admitted !== null) return admitted;
        const sourceStatus = await evaluateSource(ownedCtx.ctx, round.configuration, round);
        // The observation is already an occurred fact. A late caller cancel must not
        // discard the real exit/signal/stdout/stderr/effects/report; the trusted
        // finishing signal keeps the same Host identity/scope (B2 cleanup pattern).
        const finishingCtx: CoreCallContext = { ...ownedCtx.ctx, signal: new AbortController().signal };
        const report = await storeReport(finishingCtx, round, input, owned.requestId, sourceStatus,
            outcomeFor(input.observation, sourceStatus).outcome);
        if (!report.ok) return report.rejection;
        const decided = transitionCheck(round, { kind: 'check_result_recorded', checkId: input.checkId,
            invocationId: input.invocationId, observation: input.observation, sourceStatus, reportRef: report.ref }, guardCtx);
        if (!decided.ok) return refusalOf(decided, round);
        const occurredAt = deps.now();
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: decided.next,
            event: { eventId: deps.newId(), eventType: VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE, schemaVersion: 1,
                occurredAt, identityKey: identity, roundRef: round.ref, actor, fingerprint, result: decided.next },
            value: decided.next, cancelled: null });
    }

    /**
     * VR-05 and VR-13: the runner settles an executing window it proved never
     * ran a process (abandon → `pending`) or whose frozen ticket is
     * incomplete (→ `interrupted`, `ticket_invalid`). The receipt comes first;
     * then the pin, the round and the machine (`checkEventAdmission`: open
     * round, executor, registered check, `executing`, the begun invocation, the
     * pin). The identity is the runner's request id, which it derives from the
     * invocation, so a repeat replays the original round.
     */
    async function settleExecutingCheck(
        ctx: CoreCallContext,
        request: GraphWrite<AbandonCheckInput> | GraphWrite<InterruptCheckInput>,
        kind: 'abandon' | 'interrupt',
    ): Promise<WriteResult<RoundSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite<AbandonCheckInput | InterruptCheckInput>(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.checkId) || !nonEmpty(input.invocationId)) return invalid(`${kind}Check requires a checkId and an invocationId`);
        let event: CheckEvent;
        if (kind === 'abandon') {
            const cause = (input as AbandonCheckInput).cause;
            if (cause !== 'caller_cancelled' && cause !== 'root_changed' && cause !== 'permission_changed' && cause !== 'read_failed') {
                return invalid('abandonCheck requires a known abandon cause');
            }
            event = { kind: 'check_abandoned', checkId: input.checkId, invocationId: input.invocationId, cause, provenNotStarted: true };
        } else {
            const interrupt = input as InterruptCheckInput;
            if (interrupt.cause !== 'ticket_invalid' || !nonEmpty(interrupt.ticketProblem)) {
                return invalid('interruptCheck requires the ticket_invalid cause and its ticket problem');
            }
            event = { kind: 'check_interrupted', checkId: input.checkId, invocationId: input.invocationId, cause: 'ticket_invalid',
                ticketProblem: interrupt.ticketProblem };
        }
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        const eventType = kind === 'abandon' ? VERIFICATION_CHECK_ABANDONED_EVENT_TYPE : VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE;
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf(`r3e-${kind}:`, actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: `r3e-${kind}`, ...input, expected: owned.expected });
        } catch { return invalid(`the ${kind} request is not canonicalizable JSON`); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, eventType) as WriteResult<RoundSnapshot>;
        }
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        const decided = transitionCheck(round, event, roundCtx(round.executor, actor, checked.revision));
        if (!decided.ok) return refusalOf(decided, round);
        const base = { eventId: deps.newId(), schemaVersion: 1 as const, occurredAt: deps.now(), identityKey: identity,
            roundRef: round.ref, actor, fingerprint, checkId: input.checkId, invocationId: input.invocationId, result: decided.next };
        const recorded: VerificationRoundEvent = kind === 'abandon'
            ? { ...base, eventType: VERIFICATION_CHECK_ABANDONED_EVENT_TYPE, cause: (input as AbandonCheckInput).cause }
            : { ...base, eventType: VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE, cause: 'ticket_invalid', hostInstanceId: null };
        // The proven fact is committed even after a late caller cancel (the runner passes a finishing signal).
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: decided.next,
            event: recorded, value: decided.next, cancelled: null });
    }

    async function abandonCheck(ctx: CoreCallContext, request: GraphWrite<AbandonCheckInput>): Promise<WriteResult<RoundSnapshot>> {
        return settleExecutingCheck(ctx, request, 'abandon');
    }

    async function interruptCheck(ctx: CoreCallContext, request: GraphWrite<InterruptCheckInput>): Promise<WriteResult<RoundSnapshot>> {
        return settleExecutingCheck(ctx, request, 'interrupt');
    }

    async function submitEvidence(ctx: CoreCallContext, request: GraphWrite<{ roundRef: VerificationRoundRef; claim: string }>):
    Promise<WriteResult<EvidenceSnapshot>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        if (!nonEmpty(input.claim)) return invalid('submitEvidence requires a non-empty claim');
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-submit:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-submit', roundRef: input.roundRef, claim: input.claim, expected: owned.expected });
        } catch { return invalid('the submit request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, EVIDENCE_ADMITTED_EVENT_TYPE) as WriteResult<EvidenceSnapshot>;
        }
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        // VR-08: the executor's claim attaches to the round's required coverage; the round itself is not written.
        const decided = transitionRound(round, { kind: 'evidence_submitted' }, roundCtx(round.executor, actor, null));
        if (!decided.ok) return refusalOf(decided, round);
        const evidenceId = deps.newId();
        const admittedAt = deps.now();
        const evidence: EvidenceV1 = { schemaVersion: 1, evidenceId, kind: 'claim', outcome: 'INCONCLUSIVE',
            source: { actor: round.executor, runRef: null, checkId: null }, subject: { ...round.subject },
            coverage: effectOf(decided.effects, 'admit_claim_evidence')?.coverage ?? [], anchor: anchorOf(round),
            verificationPlanRef: { planId: round.verificationPlan.planId, planDigest: round.verificationPlan.planDigest },
            summary: { text: boundedSummary(input.claim), artifactRef: null } };
        const snapshot: EvidenceSnapshot = { ref: { aggregateType: 'Evidence', projectId: round.ref.projectId, evidenceId },
            revision: 1, schemaVersion: 1, evidence, admittedAt };
        const indexRead = await readIndex(records, round);
        if (!indexRead.ok) return indexRead.rejection;
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round,
            evidence: [snapshot], index: nextTaskEvidenceIndex(indexRead.index, [evidenceId]),
            event: { eventId: deps.newId(), eventType: EVIDENCE_ADMITTED_EVENT_TYPE, schemaVersion: 1, occurredAt: admittedAt,
                identityKey: identity, roundRef: round.ref, actor, fingerprint, result: snapshot },
            value: snapshot, cancelled: 'the evidence claim was cancelled before commit' });
    }

    async function finalizeChecks(ctx: CoreCallContext, request: GraphWrite<{
        roundRef: VerificationRoundRef; reviewerEvidence?: readonly EvidenceRef[];
    }>): Promise<WriteResult<FinalizedChecks>> {
        const ownedCtx = bindTrustedContext(ctx);
        if (!ownedCtx.ok) return ownedCtx.rejection;
        const { scope, actor, signal } = ownedCtx;
        const owned = isolateWrite(request);
        if (!owned.ok) return owned.rejection;
        const input = owned.input;
        const refProblem = roundRefProblem(input.roundRef);
        if (refProblem !== null) return invalid(refProblem);
        // VR-07's first guard step, where it stood before: ahead of the scope check and the receipt lookup.
        const reviewerEvidenceCount = input.reviewerEvidence === undefined ? 0 : input.reviewerEvidence.length;
        const reviewerProblem = refusalOf(roundReviewerEvidenceProblem(reviewerEvidenceCount));
        if (reviewerProblem !== null) return reviewerProblem;
        if (input.roundRef.projectId !== scope.projectId || input.roundRef.workspaceId !== scope.workspaceId) {
            return forbidden('the round ref is outside the trusted Host scope');
        }
        let identity = '';
        let fingerprint = '';
        try {
            identity = identityKeyOf('r3e-finalize:', actor, scope.projectId, scope.workspaceId, owned.requestId);
            fingerprint = fingerprintOf({ kind: 'r3e-finalize', roundRef: input.roundRef, expected: owned.expected });
        } catch { return invalid('the finalize request is not canonicalizable JSON'); }
        const lookup = await lookupReceipt(records, identity, fingerprint);
        if (lookup.status === 'failed') return lookup.rejection;
        if (lookup.status === 'found') {
            return await replayEvent(records, lookup.receipt, identity, fingerprint, VERIFICATION_ROUND_FINALIZED_EVENT_TYPE) as WriteResult<FinalizedChecks>;
        }
        const checked = checkRoundPin(owned.expected, input.roundRef);
        if ('status' in checked) return checked;
        const loaded = await readRoundRecord(records, input.roundRef);
        if (!loaded.ok) return loaded.rejection;
        const round = loaded.round;
        // VR-07 before any read (reviewer evidence was refused above): open round, executor, then the pin.
        const guardCtx = roundCtx(round.executor, actor, checked.revision);
        const admitted = refusalOf(roundWriteAdmission(round, { kind: 'round_finalized', reviewerEvidenceCount }, guardCtx), round);
        if (admitted !== null) return admitted;

        // Resolve the CURRENT adopted Plan and source once, then judge each
        // finished check's evidence with the existing basis/frozen-definition
        // rule. An unreadable current Plan or a changed/unverifiable source
        // cannot contribute PASS; the historical observation/outcome/anchor and
        // the original receipt are still preserved (never rewritten/re-run).
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: round.subject.projectId, goalId: round.subject.goalId };
        let evidencePlan: PlanRevisionSnapshot | null = null;
        let adoptedPlan: PlanRevisionSnapshot | null = null;
        const contextGaps: RoundSnapshot['gaps'] = [];
        // VR-07 read set: the Goal, the Plans the fold judges against and the
        // subject Run as read, so a concurrent adoption conflicts here.
        const readSet: RecordGuard[] = [];
        const evidencePlanRead = await readPlan(records, round.adoptedPlanRef);
        if (evidencePlanRead.status === 'ready') {
            evidencePlan = evidencePlanRead.plan;
            readSet.push({ refKey: planRevisionRefKey(evidencePlan.ref), expectedRevision: evidencePlan.revision });
        } else contextGaps.push({ code: 'evidence_plan_unavailable', message: 'the round adopted Plan is not readable' });
        const goalRead = await readGoal(records, goalRef);
        if (goalRead.status !== 'ready') {
            contextGaps.push({ code: 'goal_unavailable', message: 'the subject Goal is not readable' });
        } else {
            const goalKey = refKeyOf(goalRef);
            if (goalKey === null) return invalid('the subject Goal ref is not canonical JSON');
            readSet.push({ refKey: goalKey, expectedRevision: goalRead.goal.revision });
            if (evidencePlan !== null) {
                const activeRef = goalRead.goal.activePlanRevision ?? round.adoptedPlanRef;
                if (planRevisionRefKey(activeRef) === planRevisionRefKey(round.adoptedPlanRef)) {
                    adoptedPlan = evidencePlan;
                } else {
                    const adoptedRead = await readPlan(records, activeRef);
                    if (adoptedRead.status === 'ready') {
                        adoptedPlan = adoptedRead.plan;
                        readSet.push({ refKey: planRevisionRefKey(adoptedPlan.ref), expectedRevision: adoptedPlan.revision });
                    } else contextGaps.push({ code: 'adopted_plan_unavailable', message: 'the current adopted Plan is not readable' });
                }
            }
        }
        const subjectRunKey = refKeyOf(round.subjectRunRef);
        if (subjectRunKey === null) return invalid('the subject Run ref is not canonical JSON');
        const subjectRunRead = await readBatch(records, [subjectRunKey]);
        if (subjectRunRead.status !== 'ready') return mapRejected(subjectRunRead);
        const subjectRunRevision = readRevisionNumber(subjectRunRead.batch, subjectRunKey);
        if (subjectRunRevision === null) return unavailable('the round subject Run is not readable');
        readSet.push({ refKey: subjectRunKey, expectedRevision: subjectRunRevision });
        let sourceCurrent = false;
        let currentWorkspaceRevision = round.identity.workspaceRevision;
        const resolved = await deps.workspaceHost.resolveRoot(round.configuration.workspace);
        if (resolved.status === 'ready') {
            currentWorkspaceRevision = resolved.value.workspaceRevision;
            const authorized = await deps.workspaceHost.authorize(ownedCtx.ctx, round.configuration.workspace);
            if (authorized.status === 'ready' && authorized.value.permissionRevision === round.configuration.permissionRevision) {
                const captured = await deps.source.capture(resolved.value.root);
                if (captured.status === 'ready' && captured.sourceDigest === round.identity.sourceDigest) sourceCurrent = true;
                else contextGaps.push({ code: 'source_changed', message: 'the current verification source no longer matches the round fixed source' });
            } else {
                contextGaps.push({ code: 'source_unavailable', message: 'the current Host grant does not authorize the round fixed source' });
            }
        } else {
            contextGaps.push({ code: 'source_unavailable', message: 'the current workspace root is unavailable for the round fixed source' });
        }

        // One candidate verdict (one id) and its applicability per check the
        // fold judges, in the machine's order (VR-07 `foldVerdictChecks`).
        const verdicts = new Map<string, EvidenceV1>();
        const decisions: Record<string, CheckVerdictDecisionV1> = {};
        for (const check of foldVerdictChecks(round)) {
            const evidence: EvidenceV1 = {
                schemaVersion: 1, evidenceId: deps.newId(), kind: 'verdict', outcome: check.outcome ?? 'INCONCLUSIVE',
                source: { actor: round.executor, runRef: null, checkId: check.checkId }, subject: { ...round.subject },
                coverage: check.coverage.map(entry => ({ ...entry })), anchor: anchorOf(round),
                verificationPlanRef: { planId: round.verificationPlan.planId, planDigest: round.verificationPlan.planDigest },
                summary: { text: boundedSummary(`check ${check.checkId} ${check.outcome ?? 'INCONCLUSIVE'}`), artifactRef: check.reportRef },
            };
            verdicts.set(check.checkId, evidence);
            if (evidencePlan !== null && adoptedPlan !== null) {
                const currentAnchor: EffectivityAnchorV1 = { schemaVersion: 1, planRef: adoptedPlan.ref,
                    planRevision: adoptedPlan.planRevision, workspaceRevision: currentWorkspaceRevision,
                    pinnedCompletionPolicy: adoptedPlan.effectiveCompletionPolicy,
                    pinnedArchitectureBaseline: adoptedPlan.effectiveArchitectureBaseline };
                decisions[check.checkId] = evidenceApplicabilityWithBasis({ evidence, adoptedPlan, evidencePlan, currentAnchor });
            }
        }
        const fold: RoundFoldFactsV1 = { decisions: evidencePlan !== null && adoptedPlan !== null ? decisions : null,
            sourceCurrent, contextGaps };
        // The machine mints no ids: one Evidence ref per admission of the fold,
        // after the clock as before; a refused fold mints none.
        const folded = finalizeRoundOutcome({ ...fold, round });
        const admittedAt = folded.status === 'folded' ? deps.now() : '';
        const evidenceRefs: EvidenceRef[] = folded.status !== 'folded' ? [] : folded.admissions.map(() => ({
            aggregateType: 'Evidence', projectId: round.ref.projectId, evidenceId: deps.newId() }));
        const decided = transitionRound(round, { kind: 'round_finalized', reviewerEvidenceCount, fold, evidenceRefs }, guardCtx);
        if (!decided.ok) return refusalOf(decided, round);
        const finalizedRound = decided.next;
        const snapshots: EvidenceSnapshot[] = (effectOf(decided.effects, 'admit_verdict_evidence')?.admissions ?? [])
            .map((admission): EvidenceSnapshot => {
                const verdict = verdicts.get(admission.checkId);
                if (verdict === undefined) throw new Error(`the fold admitted check ${admission.checkId}, which has no candidate verdict`);
                return { ref: admission.ref, revision: 1, schemaVersion: 1,
                    evidence: { ...verdict, evidenceId: admission.ref.evidenceId, coverage: [{ ...admission.coverage }] }, admittedAt };
            });
        const indexRead = await readIndex(records, round);
        if (!indexRead.ok) return indexRead.rejection;
        // VR-07 writes the folded outcome, never null.
        const finalized: FinalizedChecks = { snapshot: finalizedRound, outcome: finalizedRound.outcome!, evidence: snapshots,
            applicable: finalizedRound.outcome === 'PASS', gaps: finalizedRound.gaps };
        return await commitRoundWrite(records, signal, { identity, fingerprint, effects: decided.effects, round: finalizedRound,
            readSet, evidence: snapshots, index: nextTaskEvidenceIndex(indexRead.index, snapshots.map(snapshot => snapshot.ref.evidenceId)),
            event: { eventId: deps.newId(), eventType: VERIFICATION_ROUND_FINALIZED_EVENT_TYPE, schemaVersion: 1,
                occurredAt: admittedAt, identityKey: identity, roundRef: round.ref, actor, fingerprint, result: finalized },
            value: finalized, cancelled: 'the round finalize was cancelled before commit' });
    }

    return { openVerification, readVerification, queryOriginalVerification, queryRoundChainHead, beginCheck, recordCheckResult,
        abandonCheck, interruptCheck, submitEvidence, finalizeChecks };
}
