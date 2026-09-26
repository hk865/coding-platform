/** R4b canonical Session-family schema registration. Pure validation only;
 * persistence, admission and Kernel effects belong to their respective ports. */
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedDomainEvent, EncodedRecord, RecordBackendSchemas } from '../../record-store/ports.js';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
const nullableString = (value: unknown): boolean => value === null || nonempty(value);
const fail = (reason: string) => ({ status: 'invalid' as const, reason });
const parse = (json: string): unknown => { try { return JSON.parse(json) as unknown; } catch { return null; } };

function validSessionRef(value: unknown, aggregateType: 'Session' | 'SessionWorkLink'): boolean {
  return object(value) && value.aggregateType === aggregateType && nonempty(value.projectId) && nonempty(value.sessionId);
}
function validOperationRef(value: unknown): boolean {
  return object(value) && value.aggregateType === 'CoreOperation' && nonempty(value.projectId) && nonempty(value.operationId);
}
function validRole(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.kind === 'legacy_template') return nonempty(value.templateId) && nonempty(value.templateRevision);
  if (value.kind === 'role_spec') return object(value.pin) && object(value.pin.ref) &&
    value.pin.ref.aggregateType === 'RoleSpecRevision' && nonempty(value.pin.ref.projectId) &&
    nonempty(value.pin.ref.roleId) && revision(value.pin.ref.revision) && nonempty(value.pin.digest);
  return false;
}
function validTarget(value: unknown): boolean {
  if (!object(value) || !object(value.ref) || !nonempty(value.ref.projectId)) return false;
  if (value.kind === 'module') return nonempty(value.ref.moduleId);
  if (value.kind === 'task') return nonempty(value.ref.goalId) && nonempty(value.ref.taskId);
  if (value.kind === 'work') return nonempty(value.ref.workId);
  return false;
}
const relation = (value: unknown): boolean => value === 'responsible' || value === 'participates' || value === 'investigated';

function validateRecord(record: EncodedRecord, aggregateType: 'CoreOperation' | 'Session' | 'SessionWorkLink') {
  const body = parse(record.json);
  if (!object(body) || !object(body.ref) || !revision(body.revision) || body.revision !== record.revision)
    return fail(`${aggregateType} record envelope is invalid`);
  try {
    if (canonicalJson(body.ref as JsonValue) !== record.refKey) return fail(`${aggregateType} refKey disagrees with body`);
  } catch { return fail(`${aggregateType} ref cannot be canonically encoded`); }
  if (aggregateType === 'CoreOperation') {
    if (!validOperationRef(body.ref) || !object(body.action) || body.action.kind !== 'create' ||
      !validSessionRef({ ...objectOrEmpty(body.action.plannedSessionRef), aggregateType: 'Session' }, 'Session') ||
      !object(body.action.workspace) || !nonempty(body.action.workspace.projectId) || !nonempty(body.action.workspace.workspaceId) ||
      body.ref.projectId !== body.action.workspace.projectId ||
      !object(body.action.plannedSessionRef) || body.action.plannedSessionRef.projectId !== body.action.workspace.projectId ||
      !validRole(body.action.role) || !Array.isArray(body.action.recommendedRefs) || !Array.isArray(body.action.initialLinks) ||
      !body.action.initialLinks.every(link => object(link) && validTarget(link.target) && relation(link.relation)) ||
      !['accepted', 'running', 'completed', 'failed', 'unknown'].includes(String(body.phase)) ||
      !nonempty(body.requestedAt) || !nonempty(body.updatedAt) ||
      !(body.observation === null || (object(body.observation) && nonempty(body.observation.adapterId) &&
        nonempty(body.observation.kernelSessionId) && nonempty(body.observation.observedAt))) ||
      !(body.failure === null || (object(body.failure) && nonempty(body.failure.code) && nonempty(body.failure.reason))))
      return fail('CoreOperation create payload is invalid');
  } else if (aggregateType === 'Session') {
    if (!validSessionRef(body.ref, 'Session') || !object(body.kernel) || !nonempty(body.kernel.adapterId) ||
      !nonempty(body.kernel.kernelSessionId) || !nonempty(body.workspaceId) || !validRole(body.role) ||
      !['active', 'archived'].includes(String(body.lifecycle)) ||
      !['available', 'recoverable', 'unavailable'].includes(String(body.health)) ||
      !(body.occupancy === null || (object(body.occupancy) &&
        (body.occupancy.kind === 'execution' || body.occupancy.kind === 'maintenance') && revision(body.occupancy.generation))) ||
      !nullableString(body.historyCursor) || !nonempty(body.createdAt) || !nullableString(body.archivedAt) ||
      !('lastExecutionRef' in body)) return fail('Session record payload is invalid');
  } else {
    if (!validSessionRef(body.ref, 'SessionWorkLink') || !validTarget(body.ref.target) ||
      (object(body.ref.target) && object(body.ref.target.ref) && body.ref.target.ref.projectId !== body.ref.projectId) ||
      !relation(body.ref.relation) ||
      !nonempty(body.since) || !nullableString(body.until)) return fail('SessionWorkLink record payload is invalid');
  }
  return { status: 'decoded' as const, value: record };
}
function objectOrEmpty(value: unknown): Record<string, unknown> { return object(value) ? value : {}; }

function validateEvent(event: EncodedDomainEvent, eventType: string) {
  const body = parse(event.json);
  if (!object(body) || body.eventId !== event.eventId || body.eventType !== eventType ||
    body.schemaVersion !== 1 || body.occurredAt !== event.occurredAt)
    return fail(`${eventType} event envelope is invalid`);
  return { status: 'decoded' as const, value: event };
}

export const SESSION_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { aggregateType: 'CoreOperation', schemaId: 'CoreOperation@1', validate: record => validateRecord(record, 'CoreOperation') },
    { aggregateType: 'Session', schemaId: 'SessionRecord@1', validate: record => validateRecord(record, 'Session') },
    { aggregateType: 'SessionWorkLink', schemaId: 'SessionWorkLink@1', commitCursorFields: ['since', 'until'],
      validate: record => validateRecord(record, 'SessionWorkLink') },
  ],
  events: [
    { eventType: 'SessionCreationAdmitted', schemaVersion: 1, validate: event => validateEvent(event, 'SessionCreationAdmitted') },
    { eventType: 'SessionCreated', schemaVersion: 1, validate: event => validateEvent(event, 'SessionCreated') },
  ],
  lookups: [{ name: 'session-by-workspace', aggregateType: 'Session', paths: ['ref.projectId', 'workspaceId'] }],
};
