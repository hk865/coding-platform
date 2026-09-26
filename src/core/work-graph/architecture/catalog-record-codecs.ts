/**
 * A1 formal architecture catalog record/event codecs.
 *
 * This file owns the ONE registration for the immutable catalog row and its
 * adoption event. The baseline revision and the project active pointer are
 * already registered by `plan-readers.ts` (`PLAN_GOVERNANCE_RECORD_SCHEMAS`);
 * nothing here re-registers them or widens the baseline body, so the canonical
 * baseline digest computed by the real Plan governance reader keeps its meaning.
 *
 * Validation is pure and closed:
 *   - the catalog is checked for explicit fields, in-scope module refs, unique
 *     module/interface ids, existing dependency endpoints and a formal DAG;
 *   - `hasCycleInEdges` is reused from `tasks/task-index.ts` instead of copying
 *     a second graph walk;
 *   - every set membership test uses a Map/Set, so a forged `__proto__` or
 *     Unicode key is treated as an ordinary unknown field, never as a prototype.
 */
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ArchitectureBaselinePin, ArchitectureBaselineRevisionRef } from '../../../contracts/governance.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, EncodedRecordSchema, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { hasCycleInEdges } from '../tasks/task-index.js';
import type {
  AdoptedArchitecture, ArchitectureBaselineContentV1, ArchitectureBaselineRevisionSnapshot,
  ArchitectureCatalogRecord, ArchitectureCatalogRef, ArchitectureRevision, ModuleContainment,
  ModuleDefinition,
} from './catalog-contracts.js';

export const ARCHITECTURE_CATALOG_SCHEMA_ID = 'ArchitectureCatalog@1';
export const ARCHITECTURE_CATALOG_ADOPTED_EVENT = 'ArchitectureCatalogAdopted';
export const ARCHITECTURE_CATALOG_EVENT_VERSION = 1;

/** Replay payload of one ArchitectureCatalogAdopted event. */
export type ArchitectureCatalogAdoptedEventV1 = {
  eventId: string;
  eventType: typeof ARCHITECTURE_CATALOG_ADOPTED_EVENT;
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  baselineRef: ArchitectureBaselineRevisionRef;
  catalogRef: ArchitectureCatalogRef;
  baseline: ArchitectureBaselineRevisionSnapshot;
  catalog: AdoptedArchitecture;
};

export const ARCHITECTURE_CATALOG_REVISED_EVENT = 'ArchitectureCatalogRevised';

/**
 * Replay payload of one ArchitectureCatalogRevised event. It carries the full
 * command identity and the exact committed `ArchitectureRevision`, so a replay
 * restores the original values/cursor from `eventAt` and never recomputes them
 * against a later active pointer.
 */
export type ArchitectureCatalogRevisedEventV1 = {
  eventId: string;
  eventType: typeof ARCHITECTURE_CATALOG_REVISED_EVENT;
  schemaVersion: 1;
  occurredAt: string;
  identityKey: string;
  fingerprint: string;
  projectId: string;
  fromPin: ArchitectureBaselinePin;
  actor: ActorRef;
  reason: string;
  revision: ArchitectureRevision;
};

/** Domain verdict of one catalog candidate. The service maps these to the public
 * failure vocabulary; the codec maps any rejection to `invalid` for persisted rows. */
export type AdoptedArchitectureValidation =
  | { status: 'ok'; value: AdoptedArchitecture }
  | { status: 'rejected'; code: 'invalid' | 'forbidden' | 'cycle'; reason: string };

// --------------------------------------------------------------------------
// Mechanical shape helpers (pure, no I/O)
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}
function parseObject(json: string, what: string): UnknownRecord | string {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return what + ' is not valid JSON'; }
  return isRecord(parsed) ? parsed : what + ' JSON must be an object';
}
function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
function copyRecord(record: EncodedRecord): EncodedRecord {
  return { refKey: record.refKey, schemaId: record.schemaId, revision: record.revision, json: record.json };
}
function copyEvent(event: EncodedDomainEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt, json: event.json };
}
function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list: string[] = [];
  for (const entry of value) {
    if (!nonEmpty(entry)) return null;
    list.push(entry);
  }
  return list;
}

// --------------------------------------------------------------------------
// Ref readers
// --------------------------------------------------------------------------

/** Validated `ModuleRef` (kind is implied by the context). */
export function readModuleRef(value: unknown): ModuleDefinition['ref'] | null {
  if (!isRecord(value) || !exactKeys(value, ['projectId', 'moduleId'])) return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['moduleId'])) return null;
  return { projectId: value['projectId'], moduleId: value['moduleId'] };
}

export function readArchitectureBaselineRef(value: unknown): ArchitectureBaselineRevisionRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ArchitectureBaselineRevision') return null;
  if (!exactKeys(value, ['aggregateType', 'projectId', 'baselineId', 'revision'])) return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['baselineId'])) return null;
  if (!isSafeRevision(value['revision']) || value['revision'] < 1) return null;
  return { aggregateType: 'ArchitectureBaselineRevision', projectId: value['projectId'], baselineId: value['baselineId'], revision: value['revision'] };
}

export function readArchitectureCatalogRef(value: unknown): ArchitectureCatalogRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ArchitectureCatalog') return null;
  if (!exactKeys(value, ['aggregateType', 'projectId', 'baselineId', 'revision'])) return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['baselineId'])) return null;
  if (!isSafeRevision(value['revision']) || value['revision'] < 1) return null;
  return { aggregateType: 'ArchitectureCatalog', projectId: value['projectId'], baselineId: value['baselineId'], revision: value['revision'] };
}

/** Complete immutable baseline pin (ref + digest). */
export function readArchitectureBaselinePin(value: unknown): ArchitectureBaselinePin | null {
  if (!isRecord(value) || !exactKeys(value, ['ref', 'digest'])) return null;
  const ref = readArchitectureBaselineRef(value['ref']);
  if (ref === null || !isSha256(value['digest'])) return null;
  return { ref, digest: value['digest'] };
}

/** The only producer of a catalog revision event is the trusted Host, so the
 * persisted actor must be a human/system actor; no agent branch is invented. */
function readHostActor(value: unknown): Extract<ActorRef, { kind: 'human' | 'system' }> | null {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'id'])) return null;
  if (value['kind'] !== 'human' && value['kind'] !== 'system') return null;
  if (!nonEmpty(value['id'])) return null;
  return { kind: value['kind'], id: value['id'] };
}

export function readConstraints(value: unknown): { name: string; scope: string }[] | null {
  if (!Array.isArray(value)) return null;
  const constraints: { name: string; scope: string }[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !exactKeys(entry, ['name', 'scope'])) return null;
    if (!nonEmpty(entry['name']) || !nonEmpty(entry['scope'])) return null;
    constraints.push({ name: entry['name'], scope: entry['scope'] });
  }
  return constraints;
}

/** Reads the frozen fixture-shaped baseline content. Additive optional fields are
 * preserved verbatim: the digest covers the whole object, so nothing is stripped. */
function readBaselineContent(value: unknown): ArchitectureBaselineContentV1 | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  if (typeof value['description'] !== 'string') return null;
  if (readConstraints(value['constraints']) === null) return null;
  return value as unknown as ArchitectureBaselineContentV1;
}

/** The ONE canonical baseline digest shared with `plan-readers.ts`'s governance
 * reader: `sha256({schemaVersion, identity:{baselineId}, revision:contentRevision, content})`.
 * Nothing catalog-specific is folded in. */
export function architectureBaselineDigest(body: {
  schemaVersion?: unknown; baselineId?: unknown; contentRevision?: unknown; content?: unknown;
}): string | null {
  try {
    return sha256Hex(canonicalJson({
      schemaVersion: body.schemaVersion,
      identity: { baselineId: body.baselineId },
      revision: body.contentRevision,
      content: body.content,
    } as unknown as JsonValue));
  } catch {
    return null;
  }
}

export function readArchitectureBaselineSnapshot(value: unknown): ArchitectureBaselineRevisionSnapshot | null {
  if (!isRecord(value) || !exactKeys(value, ['ref', 'revision', 'schemaVersion', 'baselineId', 'contentRevision', 'contentDigest', 'content'])) return null;
  const ref = readArchitectureBaselineRef(value['ref']);
  if (ref === null) return null;
  if (value['revision'] !== 1 || value['schemaVersion'] !== 1) return null;
  if (value['baselineId'] !== ref.baselineId) return null;
  if (!isSafeRevision(value['contentRevision']) || value['contentRevision'] < 1) return null;
  if (value['contentRevision'] !== ref.revision) return null;
  if (!isSha256(value['contentDigest'])) return null;
  const content = readBaselineContent(value['content']);
  if (content === null) return null;
  const digest = architectureBaselineDigest({
    schemaVersion: value['schemaVersion'], baselineId: value['baselineId'],
    contentRevision: value['contentRevision'], content: value['content'],
  });
  if (digest === null || digest !== value['contentDigest']) return null;
  return {
    ref, revision: 1, schemaVersion: 1, baselineId: ref.baselineId,
    contentRevision: value['contentRevision'], contentDigest: value['contentDigest'], content,
  };
}

// --------------------------------------------------------------------------
// The formal adopted architecture
// --------------------------------------------------------------------------

/**
 * Closes the adopted module graph:
 *   - explicit fields on the graph, every module, interface and dependency;
 *   - module refs in the target project (cross-project is `forbidden`);
 *   - unique module ids and per-module interface ids;
 *   - every dependency endpoint names a declared module;
 *   - unique dependency endpoints;
 *   - a formal DAG, reused from `hasCycleInEdges`.
 * `requireDag` must be the literal `true`; a caller cannot relax it.
 *
 * `containment` is a compatible additive field. When the key is absent the
 * validator returns a value with no `containment` key (it never fills in an
 * empty array); when present it must be an exact `{parentOf}` whose edges join
 * two declared, distinct modules of this project, are unique, give every child
 * at most one parent and form their own acyclic forest. Dependency and
 * containment cycles are checked separately, never over the union of edges.
 */
export function validateAdoptedArchitecture(value: unknown, projectId: string): AdoptedArchitectureValidation {
  if (!isRecord(value)) {
    return { status: 'rejected', code: 'invalid', reason: 'the adopted architecture must carry exactly modules, dependencies and requireDag' };
  }
  const declaresContainment = Object.prototype.hasOwnProperty.call(value, 'containment');
  const allowedKeys = declaresContainment
    ? ['modules', 'dependencies', 'requireDag', 'containment']
    : ['modules', 'dependencies', 'requireDag'];
  if (!exactKeys(value, allowedKeys)) {
    return { status: 'rejected', code: 'invalid', reason: declaresContainment
      ? 'the adopted architecture must carry exactly modules, dependencies, requireDag and containment'
      : 'the adopted architecture must carry exactly modules, dependencies and requireDag' };
  }
  if (value['requireDag'] !== true) {
    return { status: 'rejected', code: 'invalid', reason: 'the formal module DAG cannot be disabled (requireDag must be true)' };
  }
  const rawModules = value['modules'];
  if (!Array.isArray(rawModules)) {
    return { status: 'rejected', code: 'invalid', reason: 'adopted architecture modules must be an array' };
  }
  const modules: ModuleDefinition[] = [];
  const moduleIds = new Set<string>();
  for (const rawModule of rawModules) {
    if (!isRecord(rawModule) || !exactKeys(rawModule, ['ref', 'name', 'responsibility', 'paths', 'interfaces'])) {
      return { status: 'rejected', code: 'invalid', reason: 'every module must carry exactly ref, name, responsibility, paths and interfaces' };
    }
    const ref = readModuleRef(rawModule['ref']);
    if (ref === null) return { status: 'rejected', code: 'invalid', reason: 'a module ref is not a complete module id' };
    if (ref.projectId !== projectId) return { status: 'rejected', code: 'forbidden', reason: 'a module ref belongs to another project' };
    if (moduleIds.has(ref.moduleId)) return { status: 'rejected', code: 'invalid', reason: 'duplicate module id ' + ref.moduleId };
    if (!nonEmpty(rawModule['name']) || !nonEmpty(rawModule['responsibility'])) {
      return { status: 'rejected', code: 'invalid', reason: 'a module requires a non-empty name and responsibility' };
    }
    const paths = readStringList(rawModule['paths']);
    if (paths === null) return { status: 'rejected', code: 'invalid', reason: 'module paths must be non-empty strings' };
    if (!Array.isArray(rawModule['interfaces'])) {
      return { status: 'rejected', code: 'invalid', reason: 'module interfaces must be an array' };
    }
    const interfaceIds = new Set<string>();
    const interfaces: ModuleDefinition['interfaces'] = [];
    for (const rawInterface of rawModule['interfaces']) {
      if (!isRecord(rawInterface) || !exactKeys(rawInterface, ['id', 'description', 'paths'])) {
        return { status: 'rejected', code: 'invalid', reason: 'every interface must carry exactly id, description and paths' };
      }
      if (!nonEmpty(rawInterface['id']) || !nonEmpty(rawInterface['description'])) {
        return { status: 'rejected', code: 'invalid', reason: 'an interface requires a non-empty id and description' };
      }
      if (interfaceIds.has(rawInterface['id'])) {
        return { status: 'rejected', code: 'invalid', reason: 'duplicate interface id ' + rawInterface['id'] };
      }
      const interfacePaths = readStringList(rawInterface['paths']);
      if (interfacePaths === null) return { status: 'rejected', code: 'invalid', reason: 'interface paths must be non-empty strings' };
      interfaceIds.add(rawInterface['id']);
      interfaces.push({ id: rawInterface['id'], description: rawInterface['description'], paths: interfacePaths });
    }
    moduleIds.add(ref.moduleId);
    modules.push({ ref, name: rawModule['name'], responsibility: rawModule['responsibility'], paths, interfaces });
  }
  const rawDependencies = value['dependencies'];
  if (!Array.isArray(rawDependencies)) {
    return { status: 'rejected', code: 'invalid', reason: 'adopted architecture dependencies must be an array' };
  }
  const dependencies: AdoptedArchitecture['dependencies'] = [];
  const dependencyKeys = new Set<string>();
  const edges: { from: string; to: string }[] = [];
  for (const rawDependency of rawDependencies) {
    if (!isRecord(rawDependency) || !exactKeys(rawDependency, ['from', 'to', 'reason'])) {
      return { status: 'rejected', code: 'invalid', reason: 'every dependency must carry exactly from, to and reason' };
    }
    const from = readModuleRef(rawDependency['from']);
    const to = readModuleRef(rawDependency['to']);
    if (from === null || to === null) return { status: 'rejected', code: 'invalid', reason: 'a dependency endpoint is not a complete module id' };
    if (from.projectId !== projectId || to.projectId !== projectId) {
      return { status: 'rejected', code: 'forbidden', reason: 'a dependency endpoint belongs to another project' };
    }
    if (!nonEmpty(rawDependency['reason'])) return { status: 'rejected', code: 'invalid', reason: 'a dependency requires a non-empty reason' };
    if (!moduleIds.has(from.moduleId) || !moduleIds.has(to.moduleId)) {
      return { status: 'rejected', code: 'invalid', reason: 'a dependency endpoint names a module that is not declared' };
    }
    const dependencyKey = canonicalJson([from.moduleId, to.moduleId] as unknown as JsonValue);
    if (dependencyKeys.has(dependencyKey)) return { status: 'rejected', code: 'invalid', reason: 'duplicate dependency endpoint' };
    dependencyKeys.add(dependencyKey);
    dependencies.push({ from, to, reason: rawDependency['reason'] });
    edges.push({ from: from.moduleId, to: to.moduleId });
  }
  if (hasCycleInEdges(edges)) return { status: 'rejected', code: 'cycle', reason: 'the adopted module dependencies contain a cycle' };
  let containment: ModuleContainment | undefined;
  if (declaresContainment) {
    const rawContainment = value['containment'];
    if (!isRecord(rawContainment) || !exactKeys(rawContainment, ['parentOf'])) {
      return { status: 'rejected', code: 'invalid', reason: 'adopted architecture containment must carry exactly parentOf' };
    }
    if (!Array.isArray(rawContainment['parentOf'])) {
      return { status: 'rejected', code: 'invalid', reason: 'adopted architecture containment.parentOf must be an array' };
    }
    const parentOf: ModuleContainment['parentOf'] = [];
    const relationKeys = new Set<string>();
    const childrenWithParent = new Set<string>();
    const containmentEdges: { from: string; to: string }[] = [];
    for (const rawRelation of rawContainment['parentOf']) {
      if (!isRecord(rawRelation) || !exactKeys(rawRelation, ['parent', 'child'])) {
        return { status: 'rejected', code: 'invalid', reason: 'every containment relation must carry exactly parent and child' };
      }
      const parent: ModuleRef | null = readModuleRef(rawRelation['parent']);
      const child: ModuleRef | null = readModuleRef(rawRelation['child']);
      if (parent === null || child === null) {
        return { status: 'rejected', code: 'invalid', reason: 'a containment endpoint is not a complete module id' };
      }
      if (parent.projectId !== projectId || child.projectId !== projectId) {
        return { status: 'rejected', code: 'forbidden', reason: 'a containment endpoint belongs to another project' };
      }
      if (parent.moduleId === child.moduleId) {
        return { status: 'rejected', code: 'invalid', reason: 'a containment relation must join two different modules' };
      }
      if (!moduleIds.has(parent.moduleId) || !moduleIds.has(child.moduleId)) {
        return { status: 'rejected', code: 'invalid', reason: 'a containment endpoint names a module that is not declared' };
      }
      const relationKey = canonicalJson([parent.moduleId, child.moduleId] as unknown as JsonValue);
      if (relationKeys.has(relationKey)) {
        return { status: 'rejected', code: 'invalid', reason: 'duplicate containment relation' };
      }
      relationKeys.add(relationKey);
      if (childrenWithParent.has(child.moduleId)) {
        return { status: 'rejected', code: 'invalid', reason: 'a module child cannot have more than one declared parent' };
      }
      childrenWithParent.add(child.moduleId);
      parentOf.push({ parent, child });
      containmentEdges.push({ from: parent.moduleId, to: child.moduleId });
    }
    if (hasCycleInEdges(containmentEdges)) {
      return { status: 'rejected', code: 'cycle', reason: 'the adopted containment relations contain a cycle' };
    }
    containment = { parentOf };
  }
  const adopted: AdoptedArchitecture = { modules, dependencies, requireDag: true };
  if (containment !== undefined) adopted.containment = containment;
  return { status: 'ok', value: adopted };
}

// --------------------------------------------------------------------------
// Registered record/event validators
// --------------------------------------------------------------------------

function validateArchitectureCatalog(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== ARCHITECTURE_CATALOG_SCHEMA_ID) return invalid('expected schemaId ' + ARCHITECTURE_CATALOG_SCHEMA_ID + ', got ' + record.schemaId);
  const parsed = parseObject(record.json, 'ArchitectureCatalog record');
  if (typeof parsed === 'string') return invalid(parsed);
  if (!exactKeys(parsed, ['ref', 'revision', 'baselineRef', 'schemaVersion', 'catalog'])) {
    return invalid('ArchitectureCatalog record has unknown or missing keys');
  }
  const ref = readArchitectureCatalogRef(parsed['ref']);
  if (ref === null) return invalid('ArchitectureCatalog record has no complete ref');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) return invalid('ArchitectureCatalog ref is not the outer canonical ref_key');
  if (parsed['revision'] !== 1 || record.revision !== 1) return invalid('ArchitectureCatalog revision must be exactly 1');
  if (parsed['schemaVersion'] !== 1) return invalid('ArchitectureCatalog schemaVersion must be 1');
  const baselineRef = readArchitectureBaselineRef(parsed['baselineRef']);
  if (baselineRef === null) return invalid('ArchitectureCatalog baselineRef is incomplete');
  if (baselineRef.projectId !== ref.projectId || baselineRef.baselineId !== ref.baselineId || baselineRef.revision !== ref.revision) {
    return invalid('ArchitectureCatalog baselineRef does not name the same baseline revision as its ref');
  }
  const catalog = validateAdoptedArchitecture(parsed['catalog'], ref.projectId);
  if (catalog.status !== 'ok') return invalid('ArchitectureCatalog body is not a valid formal catalog: ' + catalog.reason);
  return { status: 'decoded', value: copyRecord(record) };
}

function validateArchitectureCatalogAdoptedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== ARCHITECTURE_CATALOG_ADOPTED_EVENT || event.schemaVersion !== ARCHITECTURE_CATALOG_EVENT_VERSION) {
    return invalid('expected ' + ARCHITECTURE_CATALOG_ADOPTED_EVENT + '@' + String(ARCHITECTURE_CATALOG_EVENT_VERSION));
  }
  const parsed = parseObject(event.json, 'ArchitectureCatalogAdopted event');
  if (typeof parsed === 'string') return invalid(parsed);
  for (const field of ['eventId', 'eventType', 'schemaVersion', 'occurredAt'] as const) {
    if (parsed[field] !== event[field]) return invalid('ArchitectureCatalogAdopted outer ' + field + ' disagrees with the event JSON');
  }
  if (!nonEmpty(parsed['projectId'])) return invalid('ArchitectureCatalogAdopted projectId must be a non-empty string');
  const baselineRef = readArchitectureBaselineRef(parsed['baselineRef']);
  if (baselineRef === null || baselineRef.projectId !== parsed['projectId']) return invalid('ArchitectureCatalogAdopted baselineRef is outside the event scope');
  const catalogRef = readArchitectureCatalogRef(parsed['catalogRef']);
  if (catalogRef === null || catalogRef.projectId !== baselineRef.projectId
    || catalogRef.baselineId !== baselineRef.baselineId || catalogRef.revision !== baselineRef.revision) {
    return invalid('ArchitectureCatalogAdopted catalogRef does not name the same baseline revision');
  }
  const baseline = readArchitectureBaselineSnapshot(parsed['baseline']);
  if (baseline === null) return invalid('ArchitectureCatalogAdopted baseline snapshot is not self-consistent');
  if (canonicalJson(baseline.ref as unknown as JsonValue) !== canonicalJson(baselineRef as unknown as JsonValue)) {
    return invalid('ArchitectureCatalogAdopted baseline ref disagrees with baselineRef');
  }
  const catalog = validateAdoptedArchitecture(parsed['catalog'], baselineRef.projectId);
  if (catalog.status !== 'ok') return invalid('ArchitectureCatalogAdopted catalog is not a valid formal catalog: ' + catalog.reason);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Reads the immutable catalog row embedded in a revised event and proves it
 * names exactly the baseline revision the event recorded. */
function readArchitectureCatalogRecordValue(value: unknown, baselineRef: ArchitectureBaselineRevisionRef):
  { status: 'ok'; value: ArchitectureCatalogRecord } | { status: 'rejected'; reason: string } {
  if (!isRecord(value) || !exactKeys(value, ['ref', 'revision', 'baselineRef', 'schemaVersion', 'catalog'])) {
    return { status: 'rejected', reason: 'ArchitectureCatalog record has unknown or missing keys' };
  }
  const ref = readArchitectureCatalogRef(value['ref']);
  if (ref === null) return { status: 'rejected', reason: 'ArchitectureCatalog record has no complete ref' };
  if (value['revision'] !== 1) return { status: 'rejected', reason: 'ArchitectureCatalog revision must be exactly 1' };
  if (value['schemaVersion'] !== 1) return { status: 'rejected', reason: 'ArchitectureCatalog schemaVersion must be 1' };
  const embeddedBaselineRef = readArchitectureBaselineRef(value['baselineRef']);
  if (embeddedBaselineRef === null) return { status: 'rejected', reason: 'ArchitectureCatalog baselineRef is incomplete' };
  if (canonicalJson(embeddedBaselineRef as unknown as JsonValue) !== canonicalJson(baselineRef as unknown as JsonValue)) {
    return { status: 'rejected', reason: 'ArchitectureCatalog baselineRef disagrees with the revised baseline' };
  }
  if (ref.projectId !== baselineRef.projectId || ref.baselineId !== baselineRef.baselineId || ref.revision !== baselineRef.revision) {
    return { status: 'rejected', reason: 'ArchitectureCatalog ref does not name the same baseline revision as its baselineRef' };
  }
  const catalog = validateAdoptedArchitecture(value['catalog'], ref.projectId);
  if (catalog.status !== 'ok') {
    return { status: 'rejected', reason: 'ArchitectureCatalog body is not a valid formal catalog: ' + catalog.reason };
  }
  return { status: 'ok', value: { ref, revision: 1, baselineRef, schemaVersion: 1, catalog: catalog.value } };
}

function validateArchitectureCatalogRevisedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== ARCHITECTURE_CATALOG_REVISED_EVENT || event.schemaVersion !== ARCHITECTURE_CATALOG_EVENT_VERSION) {
    return invalid('expected ' + ARCHITECTURE_CATALOG_REVISED_EVENT + '@' + String(ARCHITECTURE_CATALOG_EVENT_VERSION));
  }
  const parsed = parseObject(event.json, 'ArchitectureCatalogRevised event');
  if (typeof parsed === 'string') return invalid(parsed);
  for (const field of ['eventId', 'eventType', 'schemaVersion', 'occurredAt'] as const) {
    if (parsed[field] !== event[field]) return invalid('ArchitectureCatalogRevised outer ' + field + ' disagrees with the event JSON');
  }
  if (!nonEmpty(parsed['identityKey'])) return invalid('ArchitectureCatalogRevised identityKey must be a non-empty string');
  if (!isSha256(parsed['fingerprint'])) return invalid('ArchitectureCatalogRevised fingerprint must be a lowercase sha256 hex');
  if (!nonEmpty(parsed['projectId'])) return invalid('ArchitectureCatalogRevised projectId must be a non-empty string');
  const fromPin = readArchitectureBaselinePin(parsed['fromPin']);
  if (fromPin === null || fromPin.ref.projectId !== parsed['projectId']) {
    return invalid('ArchitectureCatalogRevised fromPin is outside the event scope');
  }
  const actor = readHostActor(parsed['actor']);
  if (actor === null) return invalid('ArchitectureCatalogRevised actor must be a trusted human or system actor');
  if (!nonEmpty(parsed['reason'])) return invalid('ArchitectureCatalogRevised reason must be a non-empty string');
  const revision = parsed['revision'];
  if (!isRecord(revision) || !exactKeys(revision, ['baseline', 'catalog'])) {
    return invalid('ArchitectureCatalogRevised revision must carry exactly baseline and catalog');
  }
  const baseline = readArchitectureBaselineSnapshot(revision['baseline']);
  if (baseline === null) return invalid('ArchitectureCatalogRevised baseline snapshot is not self-consistent');
  if (baseline.ref.projectId !== fromPin.ref.projectId
    || baseline.ref.baselineId !== fromPin.ref.baselineId
    || baseline.ref.revision !== fromPin.ref.revision + 1) {
    return invalid('ArchitectureCatalogRevised baseline is not the direct successor of its fromPin');
  }
  const catalog = readArchitectureCatalogRecordValue(revision['catalog'], baseline.ref);
  if (catalog.status !== 'ok') {
    return invalid('ArchitectureCatalogRevised catalog is not a valid formal catalog: ' + catalog.reason);
  }
  return { status: 'decoded', value: copyEvent(event) };
}

const ARCHITECTURE_CATALOG_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: ARCHITECTURE_CATALOG_SCHEMA_ID, aggregateType: 'ArchitectureCatalog', validate: validateArchitectureCatalog,
};

export const ARCHITECTURE_CATALOG_SCHEMAS: RecordBackendSchemas = {
  records: [ARCHITECTURE_CATALOG_RECORD_SCHEMA],
  events: [{
    eventType: ARCHITECTURE_CATALOG_ADOPTED_EVENT,
    schemaVersion: ARCHITECTURE_CATALOG_EVENT_VERSION,
    validate: validateArchitectureCatalogAdoptedEvent,
  }, {
    eventType: ARCHITECTURE_CATALOG_REVISED_EVENT,
    schemaVersion: ARCHITECTURE_CATALOG_EVENT_VERSION,
    validate: validateArchitectureCatalogRevisedEvent,
  }],
  lookups: [],
};

// --------------------------------------------------------------------------
// Encoders / decoders
// --------------------------------------------------------------------------

export function encodeArchitectureCatalog(record: ArchitectureCatalogRecord): EncodedRecord {
  return { refKey: canonicalJson(record.ref as unknown as JsonValue), schemaId: ARCHITECTURE_CATALOG_SCHEMA_ID, revision: record.revision, json: JSON.stringify(record) };
}

export function encodeArchitectureCatalogAdoptedEvent(event: ArchitectureCatalogAdoptedEventV1): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function encodeArchitectureCatalogRevisedEvent(event: ArchitectureCatalogRevisedEventV1): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function decodeArchitectureCatalogRecord(record: EncodedRecord): DecodeResult<ArchitectureCatalogRecord> {
  const checked = validateArchitectureCatalog(record);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(record.json) as ArchitectureCatalogRecord };
}

export function decodeArchitectureCatalogAdoptedEvent(event: EncodedDomainEvent): DecodeResult<ArchitectureCatalogAdoptedEventV1> {
  const checked = validateArchitectureCatalogAdoptedEvent(event);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(event.json) as ArchitectureCatalogAdoptedEventV1 };
}

export function decodeArchitectureCatalogRevisedEvent(event: EncodedDomainEvent): DecodeResult<ArchitectureCatalogRevisedEventV1> {
  const checked = validateArchitectureCatalogRevisedEvent(event);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(event.json) as ArchitectureCatalogRevisedEventV1 };
}
