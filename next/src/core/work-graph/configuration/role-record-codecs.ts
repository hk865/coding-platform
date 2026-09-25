/**
 * R3g role-spec / coordination-policy record and event codecs.
 *
 * Four canonical record kinds and two domain events. The active coordination
 * policy is read-only here; installing it belongs to its own governance path.
 * A missing/invalid codec must never make role resolution look like no matrix.
 *
 * These codecs only check pure encoding, shape, identity, version and content
 * digest. They perform no I/O, no permission and no transaction. The service
 * decodes canonical governance through the same functions instead of trusting
 * whatever a physical schema happened to accept, so an already-persisted bad
 * row can never be read as a valid matrix/spec/active pointer.
 */
import type {
  DecodeResult, EncodedDomainEvent, EncodedEventSchema, EncodedRecord, EncodedRecordSchema,
  RecordBackendSchemas,
} from '../../record-store/ports.js';
import type {
  CoordinationPolicyContentV1, CoordinationPolicyRevisionRef, CoordinationPolicyRevisionSnapshot,
  ProjectCoordinationPolicyActiveRef, ProjectCoordinationPolicyActiveSnapshot,
} from '../../../contracts/human-role-collaboration.js';
import { coordinationPolicyContentDigest } from '../../../contracts/human-role-collaboration.js';
import type {
  ProjectRoleSpecActiveRef, ProjectRoleSpecActiveSnapshot, RoleSpecActivatedEvent, RoleSpecContentV1,
  RoleSpecInstalledEvent, RoleSpecRevisionRef, RoleSpecRevisionSnapshot,
} from '../../../contracts/role-spec.js';
import { roleSpecContentDigest } from '../../../contracts/role-spec.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ValidationIssue } from '../../../contracts/validation/common.js';
import { validateCoordinationRoleMatrix, validateRoleSpecContent } from '../../../contracts/validation/role.js';

export const ROLE_SPEC_REVISION_SCHEMA_ID = 'RoleSpecRevisionSnapshot@1';
export const PROJECT_ROLE_SPEC_ACTIVE_SCHEMA_ID = 'ProjectRoleSpecActiveSnapshot@1';
export const COORDINATION_POLICY_REVISION_SCHEMA_ID = 'CoordinationPolicyRevisionSnapshot@1';
export const PROJECT_COORDINATION_POLICY_ACTIVE_SCHEMA_ID = 'ProjectCoordinationPolicyActiveSnapshot@1';
export const ROLE_SPEC_INSTALLED_EVENT_TYPE = 'RoleSpecInstalled';
export const ROLE_SPEC_ACTIVATED_EVENT_TYPE = 'RoleSpecActivated';

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}
function parseJsonObject(json: string, what: string): DecodeResult<UnknownRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalid(`${what} is not valid JSON`);
  }
  if (!isRecord(parsed)) return invalid(`${what} JSON must be an object`);
  return { status: 'decoded', value: parsed };
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function isActorRef(value: unknown): boolean {
  if (!isRecord(value) || !nonEmpty(value['id'])) return false;
  const kind = value['kind'];
  if (kind === 'human' || kind === 'system') return true;
  return kind === 'agent' && isRecord(value['runRef']);
}
function roleSpecContentProblem(value: unknown): string | null {
  const issues: ValidationIssue[] = [];
  validateRoleSpecContent(value, 'content', issues);
  return issues.length === 0 ? null : issues[0]!.message;
}
function coordinationPolicyContentProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'coordination policy content must be an object';
  if (value['schemaVersion'] !== 1) return 'coordination policy content.schemaVersion must be 1';
  const budget = value['budget'];
  if (!isRecord(budget) || !isNonNegativeInt(budget['maxAutonomousReworks']) ||
    !isNonNegativeInt(budget['maxClarifications'])) {
    return 'coordination policy content.budget is invalid';
  }
  const allowed = value['allowed'];
  if (!isRecord(allowed) || typeof allowed['inScopeRework'] !== 'boolean' || allowed['inScopeTesting'] !== true) {
    return 'coordination policy content.allowed is invalid';
  }
  const scope = value['scope'];
  if (!isRecord(scope) || !Array.isArray(scope['changesRequireHumanDecision'])) {
    return 'coordination policy content.scope is invalid';
  }
  const upgrade = value['upgrade'];
  if (!isRecord(upgrade) || upgrade['path'] !== 'manual-decision' || !nonEmpty(upgrade['note'])) {
    return 'coordination policy content.upgrade is invalid';
  }
  if (value['roles'] !== undefined) {
    const issues: ValidationIssue[] = [];
    validateCoordinationRoleMatrix(value['roles'], 'content.roles', issues);
    if (issues.length > 0) return issues[0]!.message;
  }
  return null;
}

// --------------------------------------------------------------------------
// Ref parsers
// --------------------------------------------------------------------------

export function roleSpecRevisionRefFromValue(value: unknown): RoleSpecRevisionRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'RoleSpecRevision') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['roleId']) || !isPositiveRevision(value['revision'])) {
    return null;
  }
  return {
    aggregateType: 'RoleSpecRevision', projectId: value['projectId'], roleId: value['roleId'],
    revision: value['revision'],
  };
}
export function projectRoleSpecActiveRefFromValue(value: unknown): ProjectRoleSpecActiveRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ProjectRoleSpecActive') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['roleId'])) return null;
  return { aggregateType: 'ProjectRoleSpecActive', projectId: value['projectId'], roleId: value['roleId'] };
}
export function coordinationPolicyRevisionRefFromValue(value: unknown): CoordinationPolicyRevisionRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'CoordinationPolicyRevision') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['policyId']) || !isPositiveRevision(value['revision'])) {
    return null;
  }
  return {
    aggregateType: 'CoordinationPolicyRevision', projectId: value['projectId'], policyId: value['policyId'],
    revision: value['revision'],
  };
}
export function projectCoordinationPolicyActiveRefFromValue(value: unknown): ProjectCoordinationPolicyActiveRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ProjectCoordinationPolicyActive') return null;
  if (!nonEmpty(value['projectId'])) return null;
  return { aggregateType: 'ProjectCoordinationPolicyActive', projectId: value['projectId'] };
}

export function canonicalRefKey(ref: object): string {
  return canonicalJson(ref as unknown as JsonValue);
}

// --------------------------------------------------------------------------
// Snapshot parsers (canonical bodies, independent of any physical codec)
// --------------------------------------------------------------------------

export function roleSpecRevisionSnapshotFromValue(value: unknown): DecodeResult<RoleSpecRevisionSnapshot> {
  if (!isRecord(value)) return invalid('RoleSpecRevision snapshot must be an object');
  if (value['revision'] !== 1) return invalid('RoleSpecRevision snapshot row revision must be 1');
  if (value['schemaVersion'] !== 1) return invalid('RoleSpecRevision snapshot schemaVersion must be 1');
  const ref = roleSpecRevisionRefFromValue(value['ref']);
  if (ref === null) return invalid('RoleSpecRevision snapshot has no valid RoleSpecRevisionRef');
  if (value['roleId'] !== ref.roleId) return invalid('RoleSpecRevision snapshot roleId disagrees with its ref');
  const contentRevision = value['contentRevision'];
  if (!isPositiveRevision(contentRevision)) {
    return invalid('RoleSpecRevision snapshot contentRevision must be a positive integer');
  }
  if (contentRevision !== ref.revision) {
    return invalid('RoleSpecRevision snapshot contentRevision disagrees with its ref revision');
  }
  const contentDigest = value['contentDigest'];
  if (!nonEmpty(contentDigest)) return invalid('RoleSpecRevision snapshot contentDigest must be a non-empty string');
  const contentProblem = roleSpecContentProblem(value['content']);
  if (contentProblem !== null) return invalid(contentProblem);
  let expected: string;
  try {
    expected = roleSpecContentDigest(value['content'] as RoleSpecContentV1, ref.roleId, contentRevision);
  } catch {
    return invalid('RoleSpecRevision snapshot content is not canonical-JSON serializable');
  }
  if (expected !== contentDigest) {
    return invalid('RoleSpecRevision snapshot contentDigest does not match its content');
  }
  if (!nonEmpty(value['installedAt'])) return invalid('RoleSpecRevision snapshot installedAt must be a non-empty string');
  return {
    status: 'decoded',
    value: {
      ref,
      revision: 1,
      schemaVersion: 1,
      roleId: ref.roleId,
      contentRevision,
      content: value['content'] as RoleSpecContentV1,
      contentDigest,
      installedAt: value['installedAt'],
    },
  };
}

export function projectRoleSpecActiveSnapshotFromValue(value: unknown): DecodeResult<ProjectRoleSpecActiveSnapshot> {
  if (!isRecord(value)) return invalid('ProjectRoleSpecActive snapshot must be an object');
  const rowRevision = value['revision'];
  if (!isPositiveRevision(rowRevision)) {
    return invalid('ProjectRoleSpecActive snapshot revision must be a positive integer');
  }
  const ref = projectRoleSpecActiveRefFromValue(value['ref']);
  if (ref === null) return invalid('ProjectRoleSpecActive snapshot has no valid ref');
  if (value['projectId'] !== ref.projectId) return invalid('ProjectRoleSpecActive snapshot projectId disagrees with its ref');
  if (value['roleId'] !== ref.roleId) return invalid('ProjectRoleSpecActive snapshot roleId disagrees with its ref');
  const activeRevision = roleSpecRevisionRefFromValue(value['activeRevision']);
  if (activeRevision === null) return invalid('ProjectRoleSpecActive snapshot has no valid activeRevision');
  if (activeRevision.projectId !== ref.projectId || activeRevision.roleId !== ref.roleId) {
    return invalid('ProjectRoleSpecActive snapshot activeRevision belongs to another scope');
  }
  return {
    status: 'decoded',
    value: { ref, projectId: ref.projectId, roleId: ref.roleId, activeRevision, revision: rowRevision },
  };
}

export function coordinationPolicyRevisionSnapshotFromValue(
  value: unknown,
): DecodeResult<CoordinationPolicyRevisionSnapshot> {
  if (!isRecord(value)) return invalid('CoordinationPolicyRevision snapshot must be an object');
  if (value['revision'] !== 1) return invalid('CoordinationPolicyRevision snapshot row revision must be 1');
  if (value['schemaVersion'] !== 1) return invalid('CoordinationPolicyRevision snapshot schemaVersion must be 1');
  const ref = coordinationPolicyRevisionRefFromValue(value['ref']);
  if (ref === null) return invalid('CoordinationPolicyRevision snapshot has no valid ref');
  if (value['policyId'] !== ref.policyId) return invalid('CoordinationPolicyRevision snapshot policyId disagrees with its ref');
  const contentRevision = value['contentRevision'];
  if (!isPositiveRevision(contentRevision)) {
    return invalid('CoordinationPolicyRevision snapshot contentRevision must be a positive integer');
  }
  if (contentRevision !== ref.revision) {
    return invalid('CoordinationPolicyRevision snapshot contentRevision disagrees with its ref revision');
  }
  const contentDigest = value['contentDigest'];
  if (!nonEmpty(contentDigest)) return invalid('CoordinationPolicyRevision snapshot contentDigest must be a non-empty string');
  const contentProblem = coordinationPolicyContentProblem(value['content']);
  if (contentProblem !== null) return invalid(contentProblem);
  let expected: string;
  try {
    expected = coordinationPolicyContentDigest(value['content'] as CoordinationPolicyContentV1, ref.policyId, contentRevision);
  } catch {
    return invalid('CoordinationPolicyRevision snapshot content is not canonical-JSON serializable');
  }
  if (expected !== contentDigest) {
    return invalid('CoordinationPolicyRevision snapshot contentDigest does not match its content');
  }
  if (!nonEmpty(value['installedAt'])) return invalid('CoordinationPolicyRevision snapshot installedAt must be a non-empty string');
  return {
    status: 'decoded',
    value: {
      ref,
      revision: 1,
      schemaVersion: 1,
      policyId: ref.policyId,
      contentRevision,
      content: value['content'] as CoordinationPolicyContentV1,
      contentDigest,
      installedAt: value['installedAt'],
    },
  };
}

export function projectCoordinationPolicyActiveSnapshotFromValue(
  value: unknown,
): DecodeResult<ProjectCoordinationPolicyActiveSnapshot> {
  if (!isRecord(value)) return invalid('ProjectCoordinationPolicyActive snapshot must be an object');
  const rowRevision = value['revision'];
  if (!isPositiveRevision(rowRevision)) {
    return invalid('ProjectCoordinationPolicyActive snapshot revision must be a positive integer');
  }
  const ref = projectCoordinationPolicyActiveRefFromValue(value['ref']);
  if (ref === null) return invalid('ProjectCoordinationPolicyActive snapshot has no valid ref');
  if (value['projectId'] !== ref.projectId) {
    return invalid('ProjectCoordinationPolicyActive snapshot projectId disagrees with its ref');
  }
  const activeRevision = coordinationPolicyRevisionRefFromValue(value['activeRevision']);
  if (activeRevision === null) return invalid('ProjectCoordinationPolicyActive snapshot has no valid activeRevision');
  if (activeRevision.projectId !== ref.projectId) {
    return invalid('ProjectCoordinationPolicyActive snapshot activeRevision belongs to another project');
  }
  return {
    status: 'decoded',
    value: { ref, projectId: ref.projectId, activeRevision, revision: rowRevision },
  };
}

// --------------------------------------------------------------------------
// Record decoders (schemaId + outer ref_key/revision agreement)
// --------------------------------------------------------------------------

function decodeRecord<T>(
  record: EncodedRecord,
  schemaId: string,
  what: string,
  parse: (value: unknown) => DecodeResult<T>,
  refOf: (value: T) => object,
): DecodeResult<T> {
  if (record.schemaId !== schemaId) return invalid(`${what} expected schemaId ${schemaId}, got ${record.schemaId}`);
  const parsed = parseJsonObject(record.json, what);
  if (parsed.status !== 'decoded') return parsed;
  const decoded = parse(parsed.value);
  if (decoded.status !== 'decoded') return decoded;
  const key = canonicalOf(refOf(decoded.value));
  if (key === null) return invalid(`${what} ref is not canonical-JSON serializable`);
  if (key !== record.refKey) return invalid(`${what} ref is not the outer canonical ref_key`);
  return decoded;
}

export function decodeRoleSpecRevisionSnapshot(record: EncodedRecord): DecodeResult<RoleSpecRevisionSnapshot> {
  return decodeRecord(record, ROLE_SPEC_REVISION_SCHEMA_ID, 'RoleSpecRevision snapshot',
    roleSpecRevisionSnapshotFromValue, value => value.ref);
}
export function decodeProjectRoleSpecActiveSnapshot(record: EncodedRecord): DecodeResult<ProjectRoleSpecActiveSnapshot> {
  return decodeRecord(record, PROJECT_ROLE_SPEC_ACTIVE_SCHEMA_ID, 'ProjectRoleSpecActive snapshot',
    projectRoleSpecActiveSnapshotFromValue, value => value.ref);
}
export function decodeCoordinationPolicyRevisionSnapshot(record: EncodedRecord): DecodeResult<CoordinationPolicyRevisionSnapshot> {
  return decodeRecord(record, COORDINATION_POLICY_REVISION_SCHEMA_ID, 'CoordinationPolicyRevision snapshot',
    coordinationPolicyRevisionSnapshotFromValue, value => value.ref);
}
export function decodeProjectCoordinationPolicyActiveSnapshot(
  record: EncodedRecord,
): DecodeResult<ProjectCoordinationPolicyActiveSnapshot> {
  return decodeRecord(record, PROJECT_COORDINATION_POLICY_ACTIVE_SCHEMA_ID, 'ProjectCoordinationPolicyActive snapshot',
    projectCoordinationPolicyActiveSnapshotFromValue, value => value.ref);
}

// --------------------------------------------------------------------------
// Event decoders
// --------------------------------------------------------------------------

export type RoleSpecInstalledFact = {
  projectId: string;
  roleId: string;
  idempotencyKey: string;
  actor: ActorRef;
  snapshot: RoleSpecRevisionSnapshot;
};
export type RoleSpecActivatedFact = {
  projectId: string;
  roleId: string;
  idempotencyKey: string;
  actor: ActorRef;
  activeRef: ProjectRoleSpecActiveRef;
  activeRevision: RoleSpecRevisionRef;
};

function eventBody(event: EncodedDomainEvent, what: string): DecodeResult<UnknownRecord> {
  const parsed = parseJsonObject(event.json, what);
  if (parsed.status !== 'decoded') return parsed;
  if (parsed.value['eventId'] !== event.eventId) return invalid(`${what} eventId disagrees with the encoded event`);
  if (parsed.value['eventType'] !== event.eventType) return invalid(`${what} eventType disagrees with the encoded event`);
  if (parsed.value['schemaVersion'] !== event.schemaVersion) return invalid(`${what} schemaVersion disagrees with the encoded event`);
  if (parsed.value['occurredAt'] !== event.occurredAt) return invalid(`${what} occurredAt disagrees with the encoded event`);
  return parsed;
}

export function decodeRoleSpecInstalledEvent(event: EncodedDomainEvent): DecodeResult<RoleSpecInstalledFact> {
  if (event.eventType !== ROLE_SPEC_INSTALLED_EVENT_TYPE || event.schemaVersion !== 1) {
    return invalid(`expected event type ${ROLE_SPEC_INSTALLED_EVENT_TYPE}@1`);
  }
  const parsed = eventBody(event, 'RoleSpecInstalled event');
  if (parsed.status !== 'decoded') return parsed;
  const body = parsed.value;
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['aggregateId']) || !nonEmpty(body['idempotencyKey'])) {
    return invalid('RoleSpecInstalled event is missing project/role/idempotency identity');
  }
  if (body['aggregateType'] !== 'RoleSpecRevision') return invalid('RoleSpecInstalled aggregateType must be RoleSpecRevision');
  if (body['aggregateRevision'] !== 1) return invalid('RoleSpecInstalled aggregateRevision must be 1');
  if (!nonEmpty(body['causationId']) || !nonEmpty(body['correlationId'])) {
    return invalid('RoleSpecInstalled event is missing causation/correlation identity');
  }
  if (!isActorRef(body['actor'])) return invalid('RoleSpecInstalled event actor is not a valid ActorRef');
  const payload = body['payload'];
  if (!isRecord(payload)) return invalid('RoleSpecInstalled payload must be an object');
  const snapshot = roleSpecRevisionSnapshotFromValue(payload['revision']);
  if (snapshot.status !== 'decoded') return snapshot;
  if (snapshot.value.ref.projectId !== body['projectId'] || snapshot.value.ref.roleId !== body['aggregateId']) {
    return invalid('RoleSpecInstalled snapshot belongs to another project/role identity');
  }
  return {
    status: 'decoded',
    value: {
      projectId: body['projectId'],
      roleId: body['aggregateId'],
      idempotencyKey: body['idempotencyKey'],
      actor: body['actor'] as ActorRef,
      snapshot: snapshot.value,
    },
  };
}

export function decodeRoleSpecActivatedEvent(event: EncodedDomainEvent): DecodeResult<RoleSpecActivatedFact> {
  if (event.eventType !== ROLE_SPEC_ACTIVATED_EVENT_TYPE || event.schemaVersion !== 1) {
    return invalid(`expected event type ${ROLE_SPEC_ACTIVATED_EVENT_TYPE}@1`);
  }
  const parsed = eventBody(event, 'RoleSpecActivated event');
  if (parsed.status !== 'decoded') return parsed;
  const body = parsed.value;
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['aggregateId']) || !nonEmpty(body['idempotencyKey'])) {
    return invalid('RoleSpecActivated event is missing project/role/idempotency identity');
  }
  if (body['aggregateType'] !== 'ProjectRoleSpecActive') return invalid('RoleSpecActivated aggregateType must be ProjectRoleSpecActive');
  if (!isPositiveRevision(body['aggregateRevision'])) {
    return invalid('RoleSpecActivated aggregateRevision must be a positive integer');
  }
  if (!isActorRef(body['actor'])) return invalid('RoleSpecActivated event actor is not a valid ActorRef');
  const payload = body['payload'];
  if (!isRecord(payload)) return invalid('RoleSpecActivated payload must be an object');
  const activeRef = projectRoleSpecActiveRefFromValue(payload['activeRef']);
  if (activeRef === null) return invalid('RoleSpecActivated activeRef is not a valid ProjectRoleSpecActiveRef');
  const activeRevision = roleSpecRevisionRefFromValue(payload['activeRevision']);
  if (activeRevision === null) return invalid('RoleSpecActivated activeRevision is not a valid RoleSpecRevisionRef');
  if (activeRef.projectId !== body['projectId'] || activeRef.roleId !== body['aggregateId']) {
    return invalid('RoleSpecActivated activeRef belongs to another project/role identity');
  }
  if (activeRevision.projectId !== body['projectId'] || activeRevision.roleId !== body['aggregateId']) {
    return invalid('RoleSpecActivated activeRevision belongs to another project/role identity');
  }
  return {
    status: 'decoded',
    value: {
      projectId: body['projectId'],
      roleId: body['aggregateId'],
      idempotencyKey: body['idempotencyKey'],
      actor: body['actor'] as ActorRef,
      activeRef,
      activeRevision,
    },
  };
}

// --------------------------------------------------------------------------
// Encoders
// --------------------------------------------------------------------------

export function encodeRoleSpecRevisionSnapshot(snapshot: RoleSpecRevisionSnapshot): EncodedRecord {
  return {
    refKey: canonicalRefKey(snapshot.ref),
    schemaId: ROLE_SPEC_REVISION_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}
export function encodeProjectRoleSpecActiveSnapshot(snapshot: ProjectRoleSpecActiveSnapshot): EncodedRecord {
  return {
    refKey: canonicalRefKey(snapshot.ref),
    schemaId: PROJECT_ROLE_SPEC_ACTIVE_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}
export function encodeRoleSpecInstalledEvent(event: RoleSpecInstalledEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}
export function encodeRoleSpecActivatedEvent(event: RoleSpecActivatedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

function decodeAsEncoded<T>(record: EncodedRecord, decode: (value: EncodedRecord) => DecodeResult<T>): DecodeResult<EncodedRecord> {
  const decoded = decode(record);
  return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
}

const roleSpecRevisionRecordSchema: EncodedRecordSchema = {
  schemaId: ROLE_SPEC_REVISION_SCHEMA_ID,
  aggregateType: 'RoleSpecRevision',
  validate: record => decodeAsEncoded(record, decodeRoleSpecRevisionSnapshot),
};
const projectRoleSpecActiveRecordSchema: EncodedRecordSchema = {
  schemaId: PROJECT_ROLE_SPEC_ACTIVE_SCHEMA_ID,
  aggregateType: 'ProjectRoleSpecActive',
  validate: record => decodeAsEncoded(record, decodeProjectRoleSpecActiveSnapshot),
};
const coordinationPolicyRevisionRecordSchema: EncodedRecordSchema = {
  schemaId: COORDINATION_POLICY_REVISION_SCHEMA_ID,
  aggregateType: 'CoordinationPolicyRevision',
  validate: record => decodeAsEncoded(record, decodeCoordinationPolicyRevisionSnapshot),
};
const projectCoordinationPolicyActiveRecordSchema: EncodedRecordSchema = {
  schemaId: PROJECT_COORDINATION_POLICY_ACTIVE_SCHEMA_ID,
  aggregateType: 'ProjectCoordinationPolicyActive',
  validate: record => decodeAsEncoded(record, decodeProjectCoordinationPolicyActiveSnapshot),
};

const roleSpecInstalledEventSchema: EncodedEventSchema = {
  eventType: ROLE_SPEC_INSTALLED_EVENT_TYPE,
  schemaVersion: 1,
  validate: (event: EncodedDomainEvent) => {
    const decoded = decodeRoleSpecInstalledEvent(event);
    return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
  },
};
const roleSpecActivatedEventSchema: EncodedEventSchema = {
  eventType: ROLE_SPEC_ACTIVATED_EVENT_TYPE,
  schemaVersion: 1,
  validate: (event: EncodedDomainEvent) => {
    const decoded = decodeRoleSpecActivatedEvent(event);
    return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
  },
};

export const ROLE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    roleSpecRevisionRecordSchema,
    projectRoleSpecActiveRecordSchema,
    coordinationPolicyRevisionRecordSchema,
    projectCoordinationPolicyActiveRecordSchema,
  ],
  events: [roleSpecInstalledEventSchema, roleSpecActivatedEventSchema],
  lookups: [],
};
