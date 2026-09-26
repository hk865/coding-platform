/**
 * R3e.1 round/Evidence/index/event codecs (implementation).
 *
 * This is the ONE owner of:
 *  - the immutable persisted `VerificationRoundSnapshot@1`;
 *  - the immutable `EvidenceSnapshot@1` (created once at revision 1);
 *  - the per-task `TaskEvidenceIndexSnapshot@1` (revision == evidence count);
 *  - the five discriminated round/Evidence replay events, each carrying the
 *    ORIGINAL returned value of its operation so a receipt replay restores the
 *    original value/cursor instead of re-deriving it from the current Round.
 *
 * Existing Evidence/Index or TaskReduction owners are NOT re-registered here.
 * The validators are pure and closed: they never start I/O, never fake
 * `decoded`, and never accept arbitrary JSON.
 */
import type {
    DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { EvidenceSnapshot, TaskEvidenceIndexSnapshot } from '../../../contracts/evidence.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
    CheckExecutionTicket, CheckProcessObservation, RoundSnapshot, VerificationRoundRef,
} from '../../../contracts/verification.js';
import type { FinalizedChecks } from './contracts.js';

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
export const EVIDENCE_ADMITTED_EVENT_TYPE = 'EvidenceAdmitted' as const;
export const EVIDENCE_EVENT_SCHEMA_VERSION = 1 as const;

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
    | (EvidenceEventBase & { eventType: typeof EVIDENCE_ADMITTED_EVENT_TYPE; result: EvidenceSnapshot });

export const VERIFICATION_ROUND_EVENT_TYPES: readonly VerificationRoundEvent['eventType'][] = [
    VERIFICATION_ROUND_OPENED_EVENT_TYPE,
    VERIFICATION_CHECK_BEGUN_EVENT_TYPE,
    VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE,
    VERIFICATION_ROUND_FINALIZED_EVENT_TYPE,
    EVIDENCE_ADMITTED_EVENT_TYPE,
];

// -------------------------------------------------------------------------- //
// Pure shape helpers                                                         //
// -------------------------------------------------------------------------- //

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
function isSafeInteger(value: unknown, minimum = 0): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function invalid<T>(reason: string): DecodeResult<T> {
    return { status: 'invalid', reason };
}
function parseObject(json: string): UnknownRecord | null {
    try {
        const parsed: unknown = JSON.parse(json);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}
function canonicalOf(value: unknown): string | null {
    try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
    return Object.keys(value).every(key => allowed.includes(key));
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
    return null;
}
function roundSnapshotProblem(value: unknown): string | null {
    if (!isRecord(value)) return 'VerificationRoundSnapshot must be an object';
    if (!hasOnlyKeys(value, ['ref', 'revision', 'schemaVersion', 'subject', 'subjectRunRef', 'adoptedPlanRef',
        'taskBasisRef', 'executor', 'configuration', 'configurationDigest', 'identity', 'sourceProof',
        'verificationPlan', 'checks', 'status', 'outcome', 'gaps', 'evidenceRefs'])) {
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
    return null;
}

function roundRecordProblem(record: EncodedRecord): string | null {
    if (record.schemaId !== VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID) {
        return `expected schemaId ${VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`;
    }
    const body = parseObject(record.json);
    if (body === null) return 'VerificationRoundSnapshot is not a JSON object';
    const problem = roundSnapshotProblem(body);
    if (problem !== null) return problem;
    if (canonicalOf(body['ref']) !== record.refKey) return 'VerificationRound ref is not the outer canonical ref_key';
    if (body['revision'] !== record.revision) return 'VerificationRound revision disagrees with the encoded record';
    return null;
}

/** Encode a round snapshot into its immutable RecordStore record. */
export function encodeVerificationRoundSnapshot(snapshot: RoundSnapshot): EncodedRecord {
    const refKey = canonicalOf(snapshot.ref);
    if (refKey === null) throw new Error('VerificationRound ref is not canonical JSON');
    return { refKey, schemaId: VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID, revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

/** Decode and validate one `VerificationRoundSnapshot@1` record. */
export function decodeVerificationRoundSnapshot(record: EncodedRecord): DecodeResult<RoundSnapshot> {
    const problem = roundRecordProblem(record);
    if (problem !== null) return invalid(problem);
    return { status: 'decoded', value: parseObject(record.json) as unknown as RoundSnapshot };
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
    if (!isSafeInteger(body['revision']) || body['revision'] !== body['evidenceIds'].length) {
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
    return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
        occurredAt: event.occurredAt, json: JSON.stringify(event) };
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
    return { status: 'decoded', value: body as unknown as VerificationRoundEvent };
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

/** The ONE R3e registration. Run/Plan/policy/baseline schemas keep their owners. */
export const EVIDENCE_RECORD_SCHEMAS: RecordBackendSchemas = {
    records: [
        { schemaId: VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID, aggregateType: 'VerificationRound', validate: validateRoundRecord },
        { schemaId: EVIDENCE_SNAPSHOT_SCHEMA_ID, aggregateType: 'Evidence', validate: validateEvidenceRecord },
        { schemaId: TASK_EVIDENCE_INDEX_SNAPSHOT_SCHEMA_ID, aggregateType: 'TaskEvidenceIndex', validate: validateIndexRecord },
    ],
    events: VERIFICATION_ROUND_EVENT_TYPES.map(eventType => ({
        eventType, schemaVersion: EVIDENCE_EVENT_SCHEMA_VERSION, validate: validateRoundEvent,
    })),
    lookups: [],
};
