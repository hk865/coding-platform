/**
 * Round/Evidence/index/event codecs (implementation).
 *
 * This is the ONE owner of:
 *  - the immutable persisted `VerificationRoundSnapshot@1`;
 *  - the immutable `EvidenceSnapshot@1` (created once at revision 1);
 *  - the per-task `TaskEvidenceIndexSnapshot@1` (revision == evidence count);
 *  - the discriminated round replay events, each carrying the
 *    ORIGINAL returned value of its operation so a receipt replay restores the
 *    original value/cursor instead of re-deriving it from the current Round.
 *
 * Existing Evidence/Index or TaskReduction owners are NOT re-registered here.
 * The validators are pure and closed: they never start I/O, never fake
 * `decoded`, and never accept arbitrary JSON.
 *
 * A.2 (spec §9.1, C5): a round carries `chain` (shape-checked) and a check
 * `incompleteCause`; four events (interrupted, abandoned, report booked,
 * reverified) and the gate-chain and open-round lookups are registered with
 * the original ones.
 */
import type {
    DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type { EvidenceSnapshot, TaskEvidenceIndexSnapshot } from '../../../contracts/evidence.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { SessionMessageRefShape } from '../../../contracts/data-format-refs.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import {
    hasOnlyKeys, invalid, isRecord, nonEmpty, parseObject,
} from '../../../contracts/validation/common.js';
import {
    ROUND_CHAIN_MAX,
    type CheckExecutionTicket, type CheckProcessObservation, type RoundSnapshot, type VerificationRoundRef,
} from '../../../contracts/verification.js';
import { MIB, type ResourceCapUnavailableReasonV1 } from '../../../contracts/resource-caps.js';
import type { FinalizedChecks } from '../model/evidence-contracts.js';
import {
    actorRefProblem, incompleteCauseProblem, isSha256Hex, newBasisInputRefsProblem, reverifyBasisProblem,
    noticeOriginFieldsProblem, NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS, type NoticeOriginWireV1,
} from './rework-codecs.js';
import { encodeEventEnvelope } from './event-envelope.js';

// -------------------------------------------------------------------------- //
// Schema names (frozen)                                                      //
// -------------------------------------------------------------------------- //

export const VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID = 'VerificationRoundSnapshot@1' as const;
export const EVIDENCE_SNAPSHOT_SCHEMA_ID = 'EvidenceSnapshot@1' as const;
export const TASK_EVIDENCE_INDEX_SNAPSHOT_SCHEMA_ID = 'TaskEvidenceIndexSnapshot@1' as const;

export const VERIFICATION_ROUND_OPENED_EVENT_TYPE = 'VerificationRoundOpened' as const;
export const VERIFICATION_CHECK_BEGUN_EVENT_TYPE = 'VerificationCheckBegun' as const;
export const VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE = 'VerificationCheckResultRecorded' as const;
export const VERIFICATION_ROUND_FINALIZED_EVENT_TYPE = 'VerificationRoundFinalized' as const;
/** A.2 check reconciliation and successor-round events (spec §9.2; VR-04, VR-13, VD-6, VR-14). */
export const VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE = 'VerificationCheckInterrupted' as const;
export const VERIFICATION_CHECK_ABANDONED_EVENT_TYPE = 'VerificationCheckAbandoned' as const;
export const VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE = 'VerificationRoundReverified' as const;
export const EVIDENCE_EVENT_SCHEMA_VERSION = 1 as const;

/** Why an executing check was interrupted (written as its `incompleteCause`). */
export type CheckInterruptionCause = 'host_restart' | 'ticket_invalid';
/** Why a begun check was proven never started and returned to pending (VD-6). */
export type CheckAbandonCause = 'caller_cancelled' | 'root_changed' | 'permission_changed' | 'read_failed';

/** Trusted Host actor for a committed evidence/round operation. */
export type EvidenceEventActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

/**
 * Common identity of every committed evidence/round event. The original
 * returned value travels as `result` on the event so a replay restores the
 * ORIGINAL value even after the Round/current configuration/source changed.
 * The cursor stays owned by the original Store receipt; it is not re-derived
 * from the later current state.
 */
type EvidenceEventBase = {
    eventId: string;
    schemaVersion: typeof EVIDENCE_EVENT_SCHEMA_VERSION;
    occurredAt: string;
    identityKey: string;
    roundRef: VerificationRoundRef;
    actor: EvidenceEventActor;
    fingerprint: string;
};

/**
 * Discriminated replay event union. The `result` is narrowed per `eventType`;
 * a broad `result` union that does not distinguish the event type is forbidden.
 */
export type VerificationRoundEvent =
    | (EvidenceEventBase & { eventType: typeof VERIFICATION_ROUND_OPENED_EVENT_TYPE; result: RoundSnapshot })
    | (EvidenceEventBase & { eventType: typeof VERIFICATION_CHECK_BEGUN_EVENT_TYPE; result: CheckExecutionTicket })
    | (EvidenceEventBase & { eventType: typeof VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE; result: RoundSnapshot })
    | (EvidenceEventBase & { eventType: typeof VERIFICATION_ROUND_FINALIZED_EVENT_TYPE; result: FinalizedChecks })
    /** VR-04 (reconcile, with the reconciling `hostInstanceId`) and VR-13 (`ticket_invalid`, no Host instance). */
    | (EvidenceEventBase & {
        eventType: typeof VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE;
        checkId: string;
        invocationId: string;
        cause: CheckInterruptionCause;
        hostInstanceId: string | null;
        result: RoundSnapshot;
    })
    /** VD-6: the runner proved the process never started. */
    | (EvidenceEventBase & {
        eventType: typeof VERIFICATION_CHECK_ABANDONED_EVENT_TYPE;
        checkId: string;
        invocationId: string;
        cause: CheckAbandonCause;
        result: RoundSnapshot;
    })
    /** VR-14: `roundRef` and `result` are the new successor round (chain ordinal ≥ 2). */
    | (EvidenceEventBase & { eventType: typeof VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE; result: RoundSnapshot;
        acknowledgement?: SessionMessageRef });

export const VERIFICATION_ROUND_EVENT_TYPES: readonly VerificationRoundEvent['eventType'][] = [
    VERIFICATION_ROUND_OPENED_EVENT_TYPE,
    VERIFICATION_CHECK_BEGUN_EVENT_TYPE,
    VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE,
    VERIFICATION_ROUND_FINALIZED_EVENT_TYPE,
    VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE,
    VERIFICATION_CHECK_ABANDONED_EVENT_TYPE,
    VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE,
];

// -------------------------------------------------------------------------- //
// Pure shape helpers                                                         //
// -------------------------------------------------------------------------- //

type UnknownRecord = Record<string, unknown>;

function isSafeInteger(value: unknown, minimum = 0): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function actorProblem(value: unknown): string | null {
    if (!isRecord(value) || (value['kind'] !== 'human' && value['kind'] !== 'system') || !nonEmpty(value['id'])) {
        return 'the actor must be a trusted human/system actor';
    }
    return null;
}
function refProblem(value: unknown, aggregateType: string, fields: readonly string[]): string | null {
    if (!isRecord(value) || value['aggregateType'] !== aggregateType) {
        return `${aggregateType} ref must be a complete ${aggregateType} reference`;
    }
    for (const field of fields) {
        if (!nonEmpty(value[field])) return `${aggregateType} ref is missing ${field}`;
    }
    return null;
}

// -------------------------------------------------------------------------- //
// Round snapshot codec                                                       //
// -------------------------------------------------------------------------- //

const ROUND_STATUSES = ['open', 'finalized'] as const;
const CHECK_PHASES = ['pending', 'executing', 'finished', 'interrupted'] as const;
const OUTCOMES = ['PASS', 'FAIL', 'INCONCLUSIVE'] as const;
const SOURCE_STATUSES = ['matched', 'changed', 'unavailable', 'permission_changed'] as const;

function roundRefProblem(value: unknown): string | null {
    return refProblem(value, 'VerificationRound', ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId']);
}
function taskTripleProblem(value: unknown): string | null {
    if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
        return 'the subject must be a complete TaskTriple';
    }
    return null;
}
function checkSnapshotProblem(value: unknown): string | null {
    if (!isRecord(value)) return 'a round check must be an object';
    if (!nonEmpty(value['checkId'])) return 'a round check requires a checkId';
    if (!isRecord(value['definition']) || !nonEmpty((value['definition'] as UnknownRecord)['checkId'])) {
        return 'a round check requires its frozen definition';
    }
    if (!Array.isArray(value['coverage'])) return 'a round check coverage must be an array';
    if (!CHECK_PHASES.includes(value['phase'] as typeof CHECK_PHASES[number])) return 'a round check phase is not recognized';
    if (value['invocationId'] !== null && !nonEmpty(value['invocationId'])) return 'a round check invocationId must be null or a string';
    if (value['outcome'] !== null && !OUTCOMES.includes(value['outcome'] as typeof OUTCOMES[number])) return 'a round check outcome is not recognized';
    if (value['reportRef'] !== null && !isRecord(value['reportRef'])) return 'a round check reportRef must be null or an object';
    if (value['sourceStatus'] !== null && !SOURCE_STATUSES.includes(value['sourceStatus'] as typeof SOURCE_STATUSES[number])) {
        return 'a round check sourceStatus is not recognized';
    }
    // VR-04/VR-13 with C5: the current writer always records why an executing
    // check was interrupted, so an interrupted check without a cause is damaged
    // (decision 79), not an old shape. Pending/executing and PASS/FAIL checks
    // keep the optional cause: it may be absent or null.
    if (value['phase'] === 'interrupted' && (value['incompleteCause'] === undefined || value['incompleteCause'] === null)) {
        return 'an interrupted round check requires its incompleteCause';
    }
    if (value['incompleteCause'] !== undefined) {
        const cause = incompleteCauseProblem(value['incompleteCause'], 'a round check incompleteCause');
        if (cause !== null) return cause;
    }
    // L16（决定 55）：检查撞上内存上限时 `recordCheckResult` 在这一次提交里写下的小字段；
    // 旧记录没有它（读作没有）。形状照 §2 `RoundCheckSnapshot.resourceCapHit`。
    if (value['resourceCapHit'] !== undefined) {
        const hit = value['resourceCapHit'];
        if (!isRecord(hit) || !hasOnlyKeys(hit, ['memory', 'memoryCapMiB'])) {
            return 'a round check resourceCapHit must be { memory: cap_hit, memoryCapMiB }';
        }
        if (hit['memory'] !== 'cap_hit') return 'a round check resourceCapHit memory must be cap_hit';
        if (!isSafeInteger(hit['memoryCapMiB'], 1)) {
            return 'a round check resourceCapHit memoryCapMiB must be a positive integer';
        }
    }
    return null;
}

const REVERIFY_FAILURE_CLASSES: readonly string[] = ['check_failed', 'check_incomplete'];
const REVERIFY_EXEMPTIONS: readonly string[] = ['none', 'host_interruption', 'not_started'];
const ACTOR_CLASSES: readonly string[] = ['human', 'system', 'agent'];

/** `RoundReverifyFactV1`: `requestedBy` may be an Agent (it is not the event actor). */
function reverifyFactProblem(value: unknown): string | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ['requestedBy', 'actorClass', 'failureClass', 'requestedAt', 'basis',
        'exemption', 'sourceChanged', 'newInputRefs', 'reason'])) {
        return 'a round chain reverify must be a RoundReverifyFactV1';
    }
    const actor = actorRefProblem(value['requestedBy'], 'a round chain reverify requestedBy');
    if (actor !== null) return actor;
    if (!ACTOR_CLASSES.includes(value['actorClass'] as string)) return 'a round chain reverify actorClass is not a ReworkActorClass';
    if (!REVERIFY_FAILURE_CLASSES.includes(value['failureClass'] as string)) {
        return 'a round chain reverify failureClass must be check_failed or check_incomplete';
    }
    if (!nonEmpty(value['requestedAt'])) return 'a round chain reverify requires requestedAt';
    const basis = reverifyBasisProblem(value['basis'], 'a round chain reverify basis');
    if (basis !== null) return basis;
    if (!REVERIFY_EXEMPTIONS.includes(value['exemption'] as string)) return 'a round chain reverify exemption is not recognized';
    if (typeof value['sourceChanged'] !== 'boolean') return 'a round chain reverify sourceChanged must be a boolean';
    const inputs = newBasisInputRefsProblem(value['newInputRefs'], 'a round chain reverify newInputRefs');
    if (inputs !== null) return inputs;
    if (!(value['reason'] === null || typeof value['reason'] === 'string')) return 'a round chain reverify reason must be a string or null';
    return null;
}

/**
 * `RoundChainV1` shape (spec §9.1, C5): `ordinal ≥ 1`; `predecessorRoundRef =
 * null ⇔ ordinal = 1 ⇔ reverify = null`; a chain root has no superseded
 * evidence, no basis digests and `autoCount = 0`; a successor's predecessor is
 * another round of the same subject. Cross-record linearity is `roundChainHead`'s.
 */
function roundChainProblem(value: unknown, ref: UnknownRecord): string | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'ordinal', 'predecessorRoundRef', 'predecessorRevision',
        'supersededEvidenceIds', 'basisDigests', 'autoCount', 'reverify'])) {
        return 'VerificationRoundSnapshot chain must be a RoundChainV1';
    }
    if (value['schemaVersion'] !== 1) return 'the round chain schemaVersion must be 1';
    const ordinal = value['ordinal'];
    if (!isSafeInteger(ordinal, 1) || ordinal > ROUND_CHAIN_MAX) {
        return `the round chain ordinal must be an integer between 1 and ${String(ROUND_CHAIN_MAX)}`;
    }
    const superseded = value['supersededEvidenceIds'];
    if (!Array.isArray(superseded) || !superseded.every(nonEmpty)) return 'the round chain supersededEvidenceIds must be evidence ids';
    const digests = value['basisDigests'];
    if (!Array.isArray(digests) || !digests.every(isSha256Hex)) return 'the round chain basisDigests must be sha256 hex digests';
    const autoCount = value['autoCount'];
    if (!isSafeInteger(autoCount) || autoCount > ordinal - 1) {
        return 'the round chain autoCount must be a non-negative integer below the ordinal';
    }
    const predecessor = value['predecessorRoundRef'];
    if (ordinal === 1) {
        if (predecessor !== null || value['predecessorRevision'] !== null || value['reverify'] !== null) {
            return 'a chain root (ordinal 1) has no predecessor and no reverify fact';
        }
        if (superseded.length > 0 || digests.length > 0 || autoCount !== 0) {
            return 'a chain root (ordinal 1) has no superseded evidence, no basis digests and autoCount 0';
        }
        return null;
    }
    const predecessorProblem = roundRefProblem(predecessor);
    if (predecessorProblem !== null) return `a successor round needs its predecessor: ${predecessorProblem}`;
    const predecessorRef = predecessor as UnknownRecord;
    if (predecessorRef['projectId'] !== ref['projectId'] || predecessorRef['workspaceId'] !== ref['workspaceId']
        || predecessorRef['goalId'] !== ref['goalId'] || predecessorRef['taskId'] !== ref['taskId']
        || predecessorRef['runId'] !== ref['runId'] || predecessorRef['roundId'] === ref['roundId']) {
        return 'a successor round predecessor must be another round of the same subject';
    }
    if (!isSafeInteger(value['predecessorRevision'], 1)) return 'a successor round needs the predecessor revision';
    if (value['reverify'] === null) return 'a successor round needs its reverify fact';
    return reverifyFactProblem(value['reverify']);
}

function roundSnapshotProblem(value: unknown): string | null {
    if (!isRecord(value)) return 'VerificationRoundSnapshot must be an object';
    if (!hasOnlyKeys(value, ['ref', 'revision', 'schemaVersion', 'subject', 'subjectRunRef', 'adoptedPlanRef',
        'taskBasisRef', 'executor', 'configuration', 'configurationDigest', 'identity', 'sourceProof',
        'verificationPlan', 'checks', 'status', 'outcome', 'gaps', 'evidenceRefs', 'chain',
        'since', 'noticeAutomationCap', 'finalizedAt'])) {
        return 'VerificationRoundSnapshot carries unknown fields';
    }
    const ref = roundRefProblem(value['ref']);
    if (ref !== null) return ref;
    if (!isSafeInteger(value['revision'], 1)) return 'VerificationRoundSnapshot revision must be a positive safe integer';
    if (value['schemaVersion'] !== 1) return 'VerificationRoundSnapshot schemaVersion must be 1';
    const subject = taskTripleProblem(value['subject']);
    if (subject !== null) return subject;
    const subjectRun = refProblem(value['subjectRunRef'], 'Run', ['projectId', 'goalId', 'runId']);
    if (subjectRun !== null) return subjectRun;
    const adopted = refProblem(value['adoptedPlanRef'], 'PlanRevision', ['projectId', 'planId']);
    if (adopted !== null) return adopted;
    const basis = refProblem(value['taskBasisRef'], 'PlanRevision', ['projectId', 'planId']);
    if (basis !== null) return basis;
    if (actorProblem(value['executor']) !== null) return 'VerificationRoundSnapshot executor must be a trusted actor';
    if (!isRecord(value['configuration'])) return 'VerificationRoundSnapshot configuration must be an object';
    if (!nonEmpty(value['configurationDigest'])) return 'VerificationRoundSnapshot configurationDigest is required';
    if (!isRecord(value['identity'])) return 'VerificationRoundSnapshot identity must be an object';
    if (!isRecord(value['sourceProof'])) return 'VerificationRoundSnapshot sourceProof must be an object';
    if (!isRecord(value['verificationPlan'])) return 'VerificationRoundSnapshot verificationPlan must be an object';
    if (!Array.isArray(value['checks'])) return 'VerificationRoundSnapshot checks must be an array';
    for (const check of value['checks']) {
        const problem = checkSnapshotProblem(check);
        if (problem !== null) return problem;
    }
    if (!ROUND_STATUSES.includes(value['status'] as typeof ROUND_STATUSES[number])) return 'VerificationRoundSnapshot status is not recognized';
    if (value['outcome'] !== null && !OUTCOMES.includes(value['outcome'] as typeof OUTCOMES[number])) return 'VerificationRoundSnapshot outcome is not recognized';
    if (!Array.isArray(value['gaps'])) return 'VerificationRoundSnapshot gaps must be an array';
    if (!Array.isArray(value['evidenceRefs'])) return 'VerificationRoundSnapshot evidenceRefs must be an array';
    // Wire-only notice origin (absent on old rounds): the creating commit
    // cursor and the write-time cap for an automatic reverify.
    const originProblem = noticeOriginFieldsProblem(value, 'VerificationRoundSnapshot', { allowFinalizedAt: true });
    if (originProblem !== null) return originProblem;
    // `finalizedAt` is written only by the VR-07 finalize commit: an open round
    // that carries it is invalid (L14 end).
    if (value['finalizedAt'] !== undefined && value['status'] !== 'finalized') {
        return 'VerificationRoundSnapshot.finalizedAt is only allowed on a finalized round';
    }
    return roundChainProblem(value['chain'], value['ref'] as UnknownRecord);
}

function roundRecordProblem(record: EncodedRecord): string | null {
    if (record.schemaId !== VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID) {
        return `expected schemaId ${VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`;
    }
    const body = parseObject(record.json);
    if (body === null) return 'VerificationRoundSnapshot is not a JSON object';
    const problem = roundSnapshotProblem(body);
    if (problem !== null) return problem;
    // A finalized round always records its finalization instant: VR-07 writes
    // `finalizedAt` on the stored record (the public DTO omits it).
    if (body['status'] === 'finalized' && body['finalizedAt'] === undefined) {
        return 'VerificationRoundSnapshot.finalizedAt is required on a finalized round';
    }
    if (canonicalOf(body['ref']) !== record.refKey) return 'VerificationRound ref is not the outer canonical ref_key';
    if (body['revision'] !== record.revision) return 'VerificationRound revision disagrees with the encoded record';
    return null;
}

/** Removes the wire-only notice origin from a decoded public DTO (SPEC §2.5). */
function withoutNoticeOrigin<T extends Record<string, unknown>>(value: T): T {
    const copy = { ...value };
    delete copy['since'];
    delete copy['noticeAutomationCap'];
    delete copy['finalizedAt'];
    return copy;
}

/**
 * Encode a round snapshot into its immutable RecordStore record. An overload
 * with `origin` writes the wire-only notice origin (`since` and, for an
 * automatic reverify, `noticeAutomationCap`); the public DTO is never extended.
 * The single-argument overload keeps the historical `records.map(encode…)` use.
 */
export function encodeVerificationRoundSnapshot(snapshot: RoundSnapshot): EncodedRecord;
export function encodeVerificationRoundSnapshot(snapshot: RoundSnapshot, origin: NoticeOriginWireV1): EncodedRecord;
export function encodeVerificationRoundSnapshot(snapshot: RoundSnapshot, origin?: NoticeOriginWireV1): EncodedRecord {
    const refKey = canonicalOf(snapshot.ref);
    if (refKey === null) throw new Error('VerificationRound ref is not canonical JSON');
    return { refKey, schemaId: VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID, revision: snapshot.revision,
        json: JSON.stringify(origin === undefined ? snapshot : { ...snapshot, ...origin }) };
}

/** Decode and validate one `VerificationRoundSnapshot@1` record; the public DTO never carries the origin. */
export function decodeVerificationRoundSnapshot(record: EncodedRecord): DecodeResult<RoundSnapshot> {
    const problem = roundRecordProblem(record);
    if (problem !== null) return invalid(problem);
    return { status: 'decoded', value: withoutNoticeOrigin(parseObject(record.json)!) as unknown as RoundSnapshot };
}

// -------------------------------------------------------------------------- //
// Evidence / index codecs                                                    //
// -------------------------------------------------------------------------- //

const EVIDENCE_KINDS = ['claim', 'observation', 'verdict'] as const;

function evidenceProblem(value: unknown): string | null {
    if (!isRecord(value)) return 'EvidenceV1 must be an object';
    if (value['schemaVersion'] !== 1) return 'EvidenceV1 schemaVersion must be 1';
    if (!nonEmpty(value['evidenceId'])) return 'EvidenceV1 requires an evidenceId';
    if (!EVIDENCE_KINDS.includes(value['kind'] as typeof EVIDENCE_KINDS[number])) return 'EvidenceV1 kind is not recognized';
    if (!OUTCOMES.includes(value['outcome'] as typeof OUTCOMES[number])) return 'EvidenceV1 outcome is not recognized';
    if (!isRecord(value['source'])) return 'EvidenceV1 source must be an object';
    if (taskTripleProblem(value['subject']) !== null) return 'EvidenceV1 subject must be a complete TaskTriple';
    if (!Array.isArray(value['coverage']) || value['coverage'].length === 0) return 'EvidenceV1 coverage must be non-empty';
    if (!isRecord(value['anchor'])) return 'EvidenceV1 anchor must be an object';
    if (!isRecord(value['verificationPlanRef'])) return 'EvidenceV1 verificationPlanRef must be an object';
    if (!isRecord(value['summary'])) return 'EvidenceV1 summary must be an object';
    return null;
}

function evidenceRecordProblem(record: EncodedRecord): string | null {
    if (record.schemaId !== EVIDENCE_SNAPSHOT_SCHEMA_ID) {
        return `expected schemaId ${EVIDENCE_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`;
    }
    const body = parseObject(record.json);
    if (body === null) return 'EvidenceSnapshot is not a JSON object';
    if (!hasOnlyKeys(body, ['ref', 'revision', 'schemaVersion', 'evidence', 'admittedAt'])) return 'EvidenceSnapshot carries unknown fields';
    if (refProblem(body['ref'], 'Evidence', ['projectId', 'evidenceId']) !== null) return 'EvidenceSnapshot ref is incomplete';
    if (body['revision'] !== 1) return 'EvidenceSnapshot revision must be 1';
    if (record.revision !== 1) return 'EvidenceSnapshot record revision must be 1';
    if (body['schemaVersion'] !== 1) return 'EvidenceSnapshot schemaVersion must be 1';
    const problem = evidenceProblem(body['evidence']);
    if (problem !== null) return problem;
    if (!nonEmpty(body['admittedAt'])) return 'EvidenceSnapshot admittedAt is required';
    if (canonicalOf(body['ref']) !== record.refKey) return 'Evidence ref is not the outer canonical ref_key';
    return null;
}

/** Encode an evidence snapshot (created once at revision 1). */
export function encodeEvidenceSnapshot(snapshot: EvidenceSnapshot): EncodedRecord {
    const refKey = canonicalOf(snapshot.ref);
    if (refKey === null) throw new Error('Evidence ref is not canonical JSON');
    return { refKey, schemaId: EVIDENCE_SNAPSHOT_SCHEMA_ID, revision: 1, json: JSON.stringify(snapshot) };
}

/** Decode and validate one `EvidenceSnapshot@1` record. A decoder never fakes `decoded`. */
export function decodeEvidenceSnapshot(record: EncodedRecord): DecodeResult<EvidenceSnapshot> {
    const problem = evidenceRecordProblem(record);
    if (problem !== null) return invalid(problem);
    return { status: 'decoded', value: parseObject(record.json) as unknown as EvidenceSnapshot };
}

function indexRecordProblem(record: EncodedRecord): string | null {
    if (record.schemaId !== TASK_EVIDENCE_INDEX_SNAPSHOT_SCHEMA_ID) {
        return `expected schemaId ${TASK_EVIDENCE_INDEX_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`;
    }
    const body = parseObject(record.json);
    if (body === null) return 'TaskEvidenceIndexSnapshot is not a JSON object';
    if (!hasOnlyKeys(body, ['ref', 'revision', 'schemaVersion', 'evidenceIds'])) return 'TaskEvidenceIndexSnapshot carries unknown fields';
    if (refProblem(body['ref'], 'TaskEvidenceIndex', ['projectId', 'goalId', 'taskId']) !== null) return 'TaskEvidenceIndex ref is incomplete';
    if (body['schemaVersion'] !== 1) return 'TaskEvidenceIndexSnapshot schemaVersion must be 1';
    if (!Array.isArray(body['evidenceIds']) || !body['evidenceIds'].every(nonEmpty)) return 'TaskEvidenceIndex evidenceIds must be non-empty strings';
    if (!isSafeInteger(body['revision'], 1) || body['revision'] !== body['evidenceIds'].length) {
        return 'TaskEvidenceIndex revision must equal its evidence count';
    }
    if (body['revision'] !== record.revision) return 'TaskEvidenceIndex revision disagrees with the encoded record';
    if (canonicalOf(body['ref']) !== record.refKey) return 'TaskEvidenceIndex ref is not the outer canonical ref_key';
    return null;
}

/** Encode a task evidence index. */
export function encodeTaskEvidenceIndexSnapshot(snapshot: TaskEvidenceIndexSnapshot): EncodedRecord {
    const refKey = canonicalOf(snapshot.ref);
    if (refKey === null) throw new Error('TaskEvidenceIndex ref is not canonical JSON');
    return { refKey, schemaId: TASK_EVIDENCE_INDEX_SNAPSHOT_SCHEMA_ID, revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

/** Decode and validate one `TaskEvidenceIndexSnapshot@1` record. */
export function decodeTaskEvidenceIndexSnapshot(record: EncodedRecord): DecodeResult<TaskEvidenceIndexSnapshot> {
    const problem = indexRecordProblem(record);
    if (problem !== null) return invalid(problem);
    return { status: 'decoded', value: parseObject(record.json) as unknown as TaskEvidenceIndexSnapshot };
}

// -------------------------------------------------------------------------- //
// Discriminated events                                                       //
// -------------------------------------------------------------------------- //

function eventEnvelopeProblem(body: UnknownRecord, event: EncodedDomainEvent): string | null {
    if (body['eventId'] !== event.eventId) return 'event json does not match the envelope eventId';
    if (body['eventType'] !== event.eventType) return 'event json does not match the envelope eventType';
    if (body['schemaVersion'] !== event.schemaVersion) return 'event json does not match the envelope schemaVersion';
    if (body['occurredAt'] !== event.occurredAt) return 'event json does not match the envelope occurredAt';
    if (!nonEmpty(body['identityKey'])) return 'the event identityKey is required';
    if (!nonEmpty(body['fingerprint'])) return 'the event fingerprint is required';
    const actor = actorProblem(body['actor']);
    if (actor !== null) return actor;
    const round = roundRefProblem(body['roundRef']);
    if (round !== null) return round;
    if (!isRecord(body['result'])) return 'the event result payload must be an object';
    return null;
}

/** Encode one discriminated round/Evidence event, including its original result. */
export function encodeVerificationRoundEvent(event: VerificationRoundEvent): EncodedDomainEvent {
    return encodeEventEnvelope(event);
}

/** Decode one discriminated round/Evidence event, including its original result. */
export function verificationRoundEventFromEvent(event: EncodedDomainEvent): DecodeResult<VerificationRoundEvent> {
    if (!isRecord(event)) return invalid('a round event must be an object');
    if (!VERIFICATION_ROUND_EVENT_TYPES.includes(event['eventType'] as VerificationRoundEvent['eventType'])) {
        return invalid(`unexpected round eventType ${String(event['eventType'])}`);
    }
    if (event['schemaVersion'] !== EVIDENCE_EVENT_SCHEMA_VERSION) {
        return invalid(`expected schemaVersion ${String(EVIDENCE_EVENT_SCHEMA_VERSION)}, got ${String(event['schemaVersion'])}`);
    }
    if (!nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])) return invalid('the round event envelope is incomplete');
    if (typeof event['json'] !== 'string') return invalid('the round event json must be a string');
    const body = parseObject(event['json']);
    if (body === null) return invalid('the round event is not a JSON object');
    const problem = eventEnvelopeProblem(body, event);
    if (problem !== null) return invalid(problem);
    const a2Problem = a2RoundEventProblem(body);
    if (a2Problem !== null) return invalid(a2Problem);
    const result = withoutNoticeOrigin(body['result'] as UnknownRecord);
    return { status: 'decoded', value: { ...body, result } as unknown as VerificationRoundEvent };
}

const INTERRUPTION_CAUSES: readonly string[] = ['host_restart', 'ticket_invalid'];
const ABANDON_CAUSES: readonly string[] = ['caller_cancelled', 'root_changed', 'permission_changed', 'read_failed'];

/** The A.2 events carry the written round as `result`; it must be that event's round. */
function a2ResultRoundProblem(body: UnknownRecord): string | null {
    const result = body['result'];
    const problem = roundSnapshotProblem(result);
    if (problem !== null) return `the event result round is invalid: ${problem}`;
    if (canonicalOf((result as UnknownRecord)['ref']) !== canonicalOf(body['roundRef'])) {
        return 'the event result round is not the event roundRef';
    }
    return null;
}
function a2CheckOf(body: UnknownRecord): UnknownRecord | string {
    if (!nonEmpty(body['checkId']) || !nonEmpty(body['invocationId'])) return 'the check event requires checkId and invocationId';
    const checks = (body['result'] as UnknownRecord)['checks'] as unknown[];
    const check = checks.find(entry => isRecord(entry) && entry['checkId'] === body['checkId']);
    return isRecord(check) ? check : 'the check event names a check that is not in its round';
}

/** Per-type payload checks of the four A.2 round events (spec §9.2). */
function a2RoundEventProblem(body: UnknownRecord): string | null {
    switch (body['eventType']) {
        case VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE: {
            const round = a2ResultRoundProblem(body);
            if (round !== null) return round;
            const check = a2CheckOf(body);
            if (typeof check === 'string') return check;
            if (!INTERRUPTION_CAUSES.includes(body['cause'] as string)) return 'an interruption cause must be host_restart or ticket_invalid';
            if (body['cause'] === 'host_restart' ? !nonEmpty(body['hostInstanceId']) : body['hostInstanceId'] !== null) {
                return 'a host_restart interruption names the reconciling hostInstanceId; ticket_invalid names none';
            }
            if (check['phase'] !== 'interrupted' || check['incompleteCause'] !== body['cause']) {
                return 'the interrupted check must be interrupted with the event cause';
            }
            return null;
        }
        case VERIFICATION_CHECK_ABANDONED_EVENT_TYPE: {
            const round = a2ResultRoundProblem(body);
            if (round !== null) return round;
            const check = a2CheckOf(body);
            if (typeof check === 'string') return check;
            return ABANDON_CAUSES.includes(body['cause'] as string) ? null : 'an abandon cause is not recognized';
        }
        case VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE: {
            const round = a2ResultRoundProblem(body);
            if (round !== null) return round;
            const chain = (body['result'] as UnknownRecord)['chain'];
            if (!isRecord(chain) || !isSafeInteger(chain['ordinal'], 2)) return 'a reverified round must be a successor round (chain ordinal >= 2)';
            // 7A §3.5: the reverified arm is the only one carrying the key;
            // `persistence` may not import `tasks`, so the shared ref field table
            // checks it. The store runs this check at commit time.
            if (body['acknowledgement'] !== undefined) {
                const acknowledgementProblem = checkShape(SessionMessageRefShape, body['acknowledgement'], 'stored');
                if (acknowledgementProblem !== null) return `the reverified acknowledgement is invalid: ${acknowledgementProblem}`;
            }
            return null;
        }
        default:
            return null;
    }
}

// -------------------------------------------------------------------------- //
// Runner-facing pure shape checks                                            //
// -------------------------------------------------------------------------- //

function capturedOutputProblem(value: unknown, what: string): string | null {
    if (!isRecord(value) || typeof value['text'] !== 'string' || !isSafeInteger(value['totalBytes'])
        || typeof value['truncated'] !== 'boolean') {
        return `${what} must carry text, totalBytes and truncated`;
    }
    return null;
}

const RESOURCE_CAP_UNAVAILABLE_REASONS = [
    'not_linux', 'no_cgroup_v2', 'no_systemd_run', 'no_user_session',
    'controllers_not_delegated', 'literal_arguments_not_preserved', 'sandbox_unavailable',
    'probe_failed', 'not_configured',
] as const satisfies readonly ResourceCapUnavailableReasonV1[];

/**
 * MF-6: the optional executed `resourceCaps` is `ResourceCapsReportV1`, a closed
 * union (spec §2, L10/L13). Legacy observations without it stay valid; this is
 * only called when the field is present.
 */
function resourceCapsReportProblem(value: unknown): string | null {
    if (!isRecord(value)) return 'an observation resourceCaps report must be an object';
    const status = value['status'];
    if (status === 'not_started') {
        return hasOnlyKeys(value, ['status']) ? null : 'a not_started resourceCaps report carries only status';
    }
    if (status === 'none') {
        if (!hasOnlyKeys(value, ['status', 'reason', 'text'])) {
            return 'a none resourceCaps report carries only status, reason and text';
        }
        if (!(RESOURCE_CAP_UNAVAILABLE_REASONS as readonly unknown[]).includes(value['reason'])) {
            return 'a none resourceCaps report must name a known unavailability reason';
        }
        return nonEmpty(value['text']) ? null : 'a none resourceCaps report requires a non-empty text';
    }
    if (status !== 'applied') return 'a resourceCaps report status must be applied, none or not_started';
    const appliedKeys = ['status', 'memoryMaxBytes', 'tasksMax', 'memory', 'processes', 'observationComplete'];
    if (!hasOnlyKeys(value, appliedKeys)) {
        return 'an applied resourceCaps report carries only status, memoryMaxBytes, tasksMax, memory, processes and observationComplete';
    }
    const memoryMaxBytes = value['memoryMaxBytes'];
    if (typeof memoryMaxBytes !== 'number' || !Number.isSafeInteger(memoryMaxBytes)
        || memoryMaxBytes < 16 * MIB || memoryMaxBytes % MIB !== 0) {
        return 'an applied resourceCaps memoryMaxBytes must be a whole number of MiB, at least 16 MiB';
    }
    const tasksMax = value['tasksMax'];
    if (typeof tasksMax !== 'number' || !Number.isSafeInteger(tasksMax) || tasksMax < 8 || tasksMax > 4_194_304) {
        return 'an applied resourceCaps tasksMax must be an integer from 8 to 4194304';
    }
    if (!['cap_hit', 'none_observed', 'uncertain'].includes(value['memory'] as string)) {
        return 'an applied resourceCaps memory must be cap_hit, none_observed or uncertain';
    }
    if (!['cap_hit', 'none_observed', 'unknown'].includes(value['processes'] as string)) {
        return 'an applied resourceCaps processes must be cap_hit, none_observed or unknown';
    }
    if (typeof value['observationComplete'] !== 'boolean') {
        return 'an applied resourceCaps observationComplete must be a boolean';
    }
    return null;
}

/** Used by callers that only need to prove an observation shape before write. */
export function checkObservationProblem(observation: CheckProcessObservation): string | null {
    if (!isRecord(observation)) return 'a check observation must be an object';
    if (!nonEmpty(observation['startedAt']) || !nonEmpty(observation['finishedAt'])) {
        return 'a check observation requires startedAt and finishedAt';
    }
    if (observation['kind'] === 'not_started') {
        if (observation['reason'] !== 'sandbox_unavailable' && observation['reason'] !== 'launch_failed') {
            return 'a not_started observation requires sandbox_unavailable or launch_failed';
        }
        return null;
    }
    if (observation['kind'] !== 'executed') return 'a check observation kind must be executed or not_started';
    if (observation['exitCode'] !== null && !isSafeInteger(observation['exitCode'])) return 'an executed exitCode must be null or a safe integer';
    if (observation['signal'] !== null && typeof observation['signal'] !== 'string') return 'an executed signal must be null or a string';
    if (typeof observation['timedOut'] !== 'boolean' || typeof observation['cancelled'] !== 'boolean') {
        return 'an executed observation requires timedOut and cancelled booleans';
    }
    const stdout = capturedOutputProblem(observation['stdout'], 'an executed stdout');
    if (stdout !== null) return stdout;
    const stderr = capturedOutputProblem(observation['stderr'], 'an executed stderr');
    if (stderr !== null) return stderr;
    const effects = observation['effects'];
    if (!isRecord(effects) || (effects['workspaceRevision'] !== null && typeof effects['workspaceRevision'] !== 'string')
        || !Array.isArray(effects['changedPaths']) || !effects['changedPaths'].every(nonEmpty)) {
        return 'an executed observation requires real effects';
    }
    if (!nonEmpty(observation['sandboxProfileVersion'])) return 'an executed observation requires a sandboxProfileVersion';
    if (observation['resourceCaps'] !== undefined) {
        const resourceCaps = resourceCapsReportProblem(observation['resourceCaps']);
        if (resourceCaps !== null) return resourceCaps;
    }
    return null;
}

/** Used by the runner/begin path to prove a ticket shape before execution. */
export function checkExecutionTicketProblem(ticket: CheckExecutionTicket): string | null {
    if (!isRecord(ticket)) return 'a check ticket must be an object';
    const ref = roundRefProblem(ticket['roundRef']);
    if (ref !== null) return ref;
    if (!nonEmpty(ticket['checkId'])) return 'a check ticket requires a checkId';
    if (!nonEmpty(ticket['invocationId'])) return 'a check ticket requires an invocationId';
    if (!nonEmpty(ticket['configurationRevision'])) return 'a check ticket requires a configurationRevision';
    if (!nonEmpty(ticket['configurationDigest'])) return 'a check ticket requires a configurationDigest';
    if (actorProblem(ticket['executor']) !== null) return 'a check ticket requires a trusted executor';
    if (refProblem(ticket['workspace'], 'Workspace', ['projectId', 'workspaceId']) !== null) return 'a check ticket requires a workspace ref';
    if (!nonEmpty(ticket['workspaceRoot'])) return 'a check ticket requires a workspaceRoot';
    if (!nonEmpty(ticket['permissionRevision'])) return 'a check ticket requires a permissionRevision';
    if (!nonEmpty(ticket['sourceDigest'])) return 'a check ticket requires a sourceDigest';
    if (ticket['processAccess'] !== 'all_except_denied') return 'a check ticket processAccess must be all_except_denied';
    if (!Array.isArray(ticket['deniedPrefixes']) || !ticket['deniedPrefixes'].every(nonEmpty)) return 'a check ticket requires deniedPrefixes';
    if (!isRecord(ticket['definition']) || !nonEmpty((ticket['definition'] as UnknownRecord)['command'])) return 'a check ticket requires a registered definition';
    return null;
}

// -------------------------------------------------------------------------- //
// Registration                                                               //
// -------------------------------------------------------------------------- //

function validateRoundRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
    const problem = roundRecordProblem(record);
    return problem !== null ? invalid(problem) : { status: 'decoded', value: record };
}
function validateEvidenceRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
    const problem = evidenceRecordProblem(record);
    return problem !== null ? invalid(problem) : { status: 'decoded', value: record };
}
function validateIndexRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
    const problem = indexRecordProblem(record);
    return problem !== null ? invalid(problem) : { status: 'decoded', value: record };
}
function validateRoundEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
    const decoded = verificationRoundEventFromEvent(event);
    return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

/**
 * The candidate lookup for the ONE original round (open or finalized) of an
 * ended subject Run, keyed by the round's formal scope/subject-Run identity. It
 * is a candidate index only: `queryOriginalVerification` rechecks the decoded
 * canonical round's scope, subject Run/task and adopted Plan, and never guesses
 * the latest when more than one row matches.
 */
export const VERIFICATION_ROUND_ORIGINAL_LOOKUP = 'VerificationRoundBySubject' as const;
/**
 * C5 (VD-14): a subject's whole work chain shares the `VerificationRoundBySubject`
 * group, so a chain read asks for one row more than the longest chain; a next
 * page means the chain cannot be judged (`incomplete`).
 */
export const VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT = ROUND_CHAIN_MAX + 1;
/** C5 (VD-15): the gate chain is read by gate Task, without a runId. */
export const VERIFICATION_ROUND_BY_TASK_LOOKUP = 'VerificationRoundByTask' as const;
/** VR-04: Host-restart reconcile enumerates the open rounds of a workspace. */
export const VERIFICATION_ROUND_BY_STATUS_LOOKUP = 'VerificationRoundByStatus' as const;

/**
 * Slice 2A L4: the ordered reverify index (system/member rechecks by commit
 * position) on the `VerificationRound` aggregate codec.
 */
export const S2A_ROUND_REVERIFY_LOOKUP = 's2a-round-reverify';
export const S2A_ROUND_REVERIFY_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
    {
        name: S2A_ROUND_REVERIFY_LOOKUP,
        aggregateType: 'VerificationRound',
        paths: ['ref.projectId', 'ref.workspaceId', 'chain.reverify.actorClass'],
        orderBy: { path: 'since' },
    },
];

/**
 * Slice 2B L14: the two round indexes by Goal. `since` orders the calendar's
 * round starts; `finalizedAt` (L14 end) orders the finalized rounds.
 */
export const S2B_ROUND_BY_GOAL_LOOKUP = 's2b-round-by-goal';
export const S2B_ROUND_BY_GOAL_FINALIZED_LOOKUP = 's2b-round-by-goal-finalized';
export const S2B_ROUND_BY_GOAL_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
    {
        name: S2B_ROUND_BY_GOAL_LOOKUP,
        aggregateType: 'VerificationRound',
        paths: ['ref.projectId', 'ref.workspaceId', 'ref.goalId'],
        orderBy: { path: 'since' },
    },
    {
        name: S2B_ROUND_BY_GOAL_FINALIZED_LOOKUP,
        aggregateType: 'VerificationRound',
        paths: ['ref.projectId', 'ref.workspaceId', 'ref.goalId'],
        orderBy: { path: 'finalizedAt' },
    },
];

/** The ONE R3e registration. Run/Plan/policy/baseline schemas keep their owners. */
export const EVIDENCE_RECORD_SCHEMAS: RecordBackendSchemas = {
    records: [
        { schemaId: VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID, aggregateType: 'VerificationRound', validate: validateRoundRecord,
            commitCursorFields: NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS },
        { schemaId: EVIDENCE_SNAPSHOT_SCHEMA_ID, aggregateType: 'Evidence', validate: validateEvidenceRecord },
        { schemaId: TASK_EVIDENCE_INDEX_SNAPSHOT_SCHEMA_ID, aggregateType: 'TaskEvidenceIndex', validate: validateIndexRecord },
    ],
    events: VERIFICATION_ROUND_EVENT_TYPES.map(eventType => ({
        eventType, schemaVersion: EVIDENCE_EVENT_SCHEMA_VERSION, validate: validateRoundEvent,
    })),
    lookups: [
        { name: VERIFICATION_ROUND_ORIGINAL_LOOKUP, aggregateType: 'VerificationRound',
            paths: ['ref.projectId', 'ref.workspaceId', 'ref.goalId', 'ref.taskId', 'ref.runId'] },
        { name: VERIFICATION_ROUND_BY_TASK_LOOKUP, aggregateType: 'VerificationRound',
            paths: ['ref.projectId', 'ref.workspaceId', 'ref.goalId', 'ref.taskId'] },
        { name: VERIFICATION_ROUND_BY_STATUS_LOOKUP, aggregateType: 'VerificationRound',
            paths: ['ref.projectId', 'ref.workspaceId', 'status'] },
        ...S2A_ROUND_REVERIFY_LOOKUP_INDEXES,
        ...S2B_ROUND_BY_GOAL_LOOKUP_INDEXES,
    ],
};
