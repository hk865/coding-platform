/**
 * R5a formal Project/Workspace and CompletionPolicy writers.
 *
 * Four real Host operations share one admission seam (request isolation ->
 * original identity/fingerprint receipt -> necessary exact read -> local guards
 * -> ONE RecordStore commit) and one replay restoration from the recorded event.
 * They are NOT four services and they add no second configuration database:
 * Project/Workspace reuse `GOAL_RECORD_SCHEMAS`, policy rows reuse
 * `PLAN_GOVERNANCE_RECORD_SCHEMAS`, and the identity/canonical/fingerprint/store
 * guards are the existing ones.
 *
 * `createProject` is the only operation whose scope chain starts without an
 * existing Project record; it guards exactly that Project's absence. Every
 * other operation reads the actual Project (and, for activation, the exact
 * policy row and active pointer) and CASes only the local versions it read.
 * Activation moves only that project's default pointer and never rewrites an
 * already accepted Plan's policy pin.
 */
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreError, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { completionPolicyContentDigest } from '../../../contracts/governance.js';
import type {
  CompletionPolicyContentV1,
  CompletionPolicyPin,
  CompletionPolicyRevisionRef,
  CompletionPolicyRevisionSnapshot,
  ProjectCompletionPolicyActiveRef,
  ProjectCompletionPolicyActiveSnapshot,
} from '../../../contracts/governance.js';
import type { ProjectRef, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedRecord,
  GoalRecordTransactionPort,
  PreparedCommit,
  RecordBatchRead,
  RecordGuard,
  StoreCommitReceipt,
  StoreFailure,
} from '../../record-store/ports.js';
import type { GraphWrite } from '../tasks/contracts.js';
import { decodeProjectSnapshot, decodeWorkspaceSnapshot, encodeProjectSnapshot, encodeWorkspaceSnapshot, cloneActorRef } from '../persistence/record-codecs.js';
import type { ProjectBootstrapDependencies, ProjectBootstrapServices } from './project-bootstrap-contracts.js';
import type {
  ProjectBootstrapEventFact,
  ProjectCompletionPolicyActivatedEventV1,
  ProjectCompletionPolicyInstalledEventV1,
  ProjectRegisteredEventV1,
  ProjectWorkspaceRegisteredEventV1,
} from './project-bootstrap-record-codecs.js';
import {
  PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
  PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT,
  PROJECT_COMPLETION_POLICY_INSTALLED_EVENT,
  PROJECT_REGISTERED_EVENT,
  PROJECT_WORKSPACE_REGISTERED_EVENT,
  completionPolicyContentProblem,
  decodeProjectCompletionPolicyActivatedEvent,
  decodeProjectCompletionPolicyInstalledEvent,
  decodeProjectRegisteredEvent,
  decodeProjectWorkspaceRegisteredEvent,
  encodeProjectCompletionPolicyActivatedEvent,
  encodeProjectCompletionPolicyInstalledEvent,
  encodeProjectRegisteredEvent,
  encodeProjectWorkspaceRegisteredEvent,
} from './project-bootstrap-record-codecs.js';

const CREATE_PROJECT_PREFIX = 'project-register:';
const REGISTER_WORKSPACE_PREFIX = 'project-workspace-register:';
const INSTALL_POLICY_PREFIX = 'completion-policy-install:';
const ACTIVATE_POLICY_PREFIX = 'completion-policy-activate:';
const POLICY_REVISION_SCHEMA_ID = 'CompletionPolicyRevisionSnapshot@1';
const POLICY_ACTIVE_SCHEMA_ID = 'ProjectCompletionPolicyActiveSnapshot@1';

type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
type Rejection = { status: 'rejected'; code: CoreError; reason: string; current?: VersionPin[] };
type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };

// --------------------------------------------------------------------------
// Result helpers
// --------------------------------------------------------------------------

function rejected(code: CoreError, reason: string): Rejection {
  return { status: 'rejected', code, reason };
}
function invalid(reason: string): Rejection {
  return rejected('invalid', reason);
}
function forbidden(reason: string): Rejection {
  return rejected('forbidden', reason);
}
function unavailable(reason: string): Rejection {
  return rejected('unavailable', reason);
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function refFromRefKey(refKey: string): unknown {
  try {
    return JSON.parse(refKey);
  } catch {
    return null;
  }
}
function mapStoreFailure(failure: StoreFailure): Rejection {
  switch (failure.code) {
    case 'not_found': return rejected('not_found', failure.reason);
    case 'invalid': return invalid(failure.reason);
    case 'unsupported': return unavailable(failure.reason);
    case 'corrupt': return unavailable('corrupt: ' + failure.reason);
    case 'unique_conflict':
    case 'unavailable': return unavailable(failure.reason);
    // A same-identity/different-fingerprint verdict is preserved, never flattened.
    case 'idempotency_conflict': return rejected('idempotency_conflict', failure.reason);
    case 'revision_conflict': {
      const current: VersionPin[] = [];
      for (const entry of failure.current) {
        const ref = refFromRefKey(entry.refKey);
        if (ref !== null && entry.revision !== null) current.push({ ref: ref as VersionPin['ref'], revision: entry.revision });
      }
      return { status: 'rejected', code: 'revision_conflict', reason: failure.reason, ...(current.length > 0 ? { current } : {}) };
    }
  }
}

// --------------------------------------------------------------------------
// Mechanical shape helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
/** Structural copy only, so a caller mutating the request after this call cannot change the write. */
function ownJsonInput<T>(value: T, what: string): Owned<T> {
  try {
    return { status: 'owned', value: structuredClone(value) };
  } catch (error) {
    return { status: 'invalid', reason: what + ' cannot be isolated from the caller: ' + messageOf(error) };
  }
}
function actorRefEquals(left: ActorRef, right: HostActor): boolean {
  return left.kind === right.kind && left.id === right.id;
}

// --------------------------------------------------------------------------
// Trusted Host binding (all ctx fields read before the first await)
// --------------------------------------------------------------------------

type BoundContext = {
  actor: HostActor;
  signal: AbortSignal;
  projectId: string;
  workspaceId: string | undefined;
};

function bindContext(ctx: CoreCallContext): ({ status: 'ok' } & BoundContext) | Rejection {
  if (ctx === null || typeof ctx !== 'object') return forbidden('a bound call context is required');
  const projectId = ctx.projectId;
  const workspaceId = ctx.workspaceId;
  const signal = ctx.signal;
  if (!nonEmpty(projectId)) return forbidden('the call context has no project scope');
  const principal = ctx.principal as unknown;
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return forbidden('this operation requires a trusted host call context');
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return forbidden('this operation requires a trusted human or system actor');
  }
  if (signal === null || typeof signal !== 'object' || typeof (signal as AbortSignal).aborted !== 'boolean') {
    return forbidden('the call context has no usable abort signal');
  }
  return {
    status: 'ok',
    actor: { kind: actor['kind'], id: actor['id'] },
    signal: signal as AbortSignal,
    projectId,
    workspaceId: nonEmpty(workspaceId) ? workspaceId : undefined,
  };
}

// --------------------------------------------------------------------------
// Caller version pins
// --------------------------------------------------------------------------

type BootstrapPin =
  | { kind: 'project'; ref: ProjectRef; revision: number; key: string }
  | { kind: 'workspace'; ref: WorkspaceRef; revision: number; key: string }
  | { kind: 'policy'; ref: CompletionPolicyRevisionRef; revision: number; key: string }
  | { kind: 'active'; ref: ProjectCompletionPolicyActiveRef; revision: number; key: string };

type ExpectedScope = { projectId: string; workspaceId?: string; policyId?: string };

function parsePin(entry: unknown, scope: ExpectedScope): BootstrapPin | Rejection {
  if (!isRecord(entry)) return invalid('every version pin must be an object');
  const revision = entry['revision'];
  if (!isSafeRevision(revision)) return invalid('a version pin revision must be a safe non-negative integer');
  const ref = entry['ref'];
  if (!isRecord(ref)) return invalid('a version pin ref must be an object');
  const aggregateType = ref['aggregateType'];
  if (aggregateType === 'Project') {
    if (!exactKeys(ref, ['aggregateType', 'projectId']) || !nonEmpty(ref['projectId'])) {
      return invalid('a Project version pin must carry only aggregateType and projectId');
    }
    if (ref['projectId'] !== scope.projectId) return invalid('a version pin belongs to another project');
    const scalar: ProjectRef = { aggregateType: 'Project', projectId: ref['projectId'] };
    return { kind: 'project', ref: scalar, revision, key: canonicalJson(scalar as unknown as JsonValue) };
  }
  if (aggregateType === 'Workspace') {
    if (!exactKeys(ref, ['aggregateType', 'projectId', 'workspaceId']) || !nonEmpty(ref['projectId']) || !nonEmpty(ref['workspaceId'])) {
      return invalid('a Workspace version pin must carry aggregateType, projectId and workspaceId');
    }
    if (ref['projectId'] !== scope.projectId) return invalid('a version pin belongs to another project');
    if (scope.workspaceId !== undefined && ref['workspaceId'] !== scope.workspaceId) {
      return invalid('a Workspace version pin belongs to another workspace');
    }
    const scalar: WorkspaceRef = { aggregateType: 'Workspace', projectId: ref['projectId'], workspaceId: ref['workspaceId'] };
    return { kind: 'workspace', ref: scalar, revision, key: canonicalJson(scalar as unknown as JsonValue) };
  }
  if (aggregateType === 'CompletionPolicyRevision') {
    if (!exactKeys(ref, ['aggregateType', 'projectId', 'policyId', 'revision'])
      || !nonEmpty(ref['projectId']) || !nonEmpty(ref['policyId']) || !isPositiveInt(ref['revision'])) {
      return invalid('a CompletionPolicyRevision version pin is malformed');
    }
    if (ref['projectId'] !== scope.projectId) return invalid('a version pin belongs to another project');
    if (scope.policyId !== undefined && ref['policyId'] !== scope.policyId) {
      return invalid('a CompletionPolicyRevision version pin belongs to another policy');
    }
    const scalar: CompletionPolicyRevisionRef = {
      aggregateType: 'CompletionPolicyRevision', projectId: ref['projectId'], policyId: ref['policyId'], revision: ref['revision'],
    };
    return { kind: 'policy', ref: scalar, revision, key: canonicalJson(scalar as unknown as JsonValue) };
  }
  if (aggregateType === 'ProjectCompletionPolicyActive') {
    if (!exactKeys(ref, ['aggregateType', 'projectId']) || !nonEmpty(ref['projectId'])) {
      return invalid('a ProjectCompletionPolicyActive version pin must carry only aggregateType and projectId');
    }
    if (ref['projectId'] !== scope.projectId) return invalid('a version pin belongs to another project');
    const scalar: ProjectCompletionPolicyActiveRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId: ref['projectId'] };
    return { kind: 'active', ref: scalar, revision, key: canonicalJson(scalar as unknown as JsonValue) };
  }
  return invalid('an unrelated version pin ref is not accepted by this operation');
}

function parseExpected(expected: unknown, scope: ExpectedScope): { status: 'ok'; pins: BootstrapPin[] } | Rejection {
  if (!Array.isArray(expected)) return invalid('meta.expected must be an array of version pins');
  const pins: BootstrapPin[] = [];
  const seen = new Set<string>();
  for (const entry of expected) {
    const parsed = parsePin(entry, scope);
    if (!('kind' in parsed)) return parsed;
    if (seen.has(parsed.key)) return invalid('duplicate version pin');
    seen.add(parsed.key);
    pins.push(parsed);
  }
  return { status: 'ok', pins };
}

function requireKinds(pins: readonly BootstrapPin[], required: readonly BootstrapPin['kind'][], what: string): Rejection | null {
  if (pins.length !== required.length) {
    return invalid(`${what} requires exactly the ${required.join(' and ')} version pins`);
  }
  const present = new Set(pins.map((pin) => pin.kind));
  for (const kind of required) {
    if (!present.has(kind)) return invalid(`${what} requires the ${kind} version pin`);
  }
  return null;
}

/** Sorted by the full canonical ref so the fingerprint never depends on caller order. */
function expectedProjection(pins: readonly BootstrapPin[]): { ref: unknown; revision: number }[] {
  return [...pins]
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map((pin) => ({ ref: pin.ref, revision: pin.revision }));
}

function fingerprintOf(parts: Record<string, unknown>): { status: 'ok'; value: string } | Rejection {
  try {
    return { status: 'ok', value: sha256Hex(canonicalJson(parts as unknown as JsonValue)) };
  } catch (error) {
    return invalid('the command cannot be canonicalized: ' + messageOf(error));
  }
}

// --------------------------------------------------------------------------
// Replay / commit seam shared by all four operations
// --------------------------------------------------------------------------

type ReplayBinding<T> = {
  identityKey: string;
  projectId: string;
  requestId: string;
  actor: HostActor;
  decode: (event: EncodedDomainEvent) => DecodeResult<ProjectBootstrapEventFact<T>>;
};

async function restoreOriginal<T>(
  records: GoalRecordTransactionPort,
  receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
  binding: ReplayBinding<T>,
): Promise<WriteResult<T>> {
  if (receipt.identityKey !== binding.identityKey) {
    return unavailable('the idempotency receipt belongs to another identity');
  }
  if (receipt.eventIds.length !== 1) {
    return unavailable('a bootstrap receipt must reference exactly one event');
  }
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') {
    return unavailable('the original bootstrap event is not readable: ' + located.code + ': ' + located.reason);
  }
  if (String(located.value.cursor) !== String(receipt.cursor)) {
    return unavailable('eventAt returned a different cursor');
  }
  const decoded = binding.decode(located.value.event);
  if (decoded.status !== 'decoded') {
    return unavailable('the original bootstrap event is corrupt: ' + decoded.reason);
  }
  const fact = decoded.value;
  if (fact.eventId !== receipt.eventIds[0]) return unavailable('the receipt points at another event');
  if (fact.identityKey !== binding.identityKey) return unavailable('the original event carries another identity key');
  if (fact.projectId !== binding.projectId) return unavailable('the original event belongs to another project');
  if (fact.requestId !== binding.requestId) return unavailable('the original event carries another request id');
  if (!actorRefEquals(fact.actor, binding.actor)) return unavailable('the original event carries another actor');
  return { status: 'committed', value: fact.value, replayed: true, cursor: receipt.cursor };
}

type Admission<T> = { status: 'miss' } | { status: 'result'; result: WriteResult<T> };

async function admitByIdentity<T>(
  records: GoalRecordTransactionPort,
  identityKey: string,
  fingerprint: string,
  binding: ReplayBinding<T>,
): Promise<Admission<T>> {
  const early = await records.lookupCommit({ identityKey, fingerprint });
  if (early.status === 'ready') {
    return { status: 'result', result: await restoreOriginal(records, early.value, binding) };
  }
  if (early.code === 'idempotency_conflict') {
    return { status: 'result', result: rejected('idempotency_conflict', early.reason) };
  }
  if (early.code !== 'not_found') {
    return { status: 'result', result: unavailable(early.code + ': ' + early.reason) };
  }
  return { status: 'miss' };
}

async function recoverByIdentity<T>(
  records: GoalRecordTransactionPort,
  identityKey: string,
  fingerprint: string,
  binding: ReplayBinding<T>,
  fallback: Rejection,
): Promise<WriteResult<T>> {
  const requery = await records.lookupCommit({ identityKey, fingerprint });
  if (requery.status === 'ready') return restoreOriginal(records, requery.value, binding);
  if (requery.code === 'idempotency_conflict') return rejected('idempotency_conflict', requery.reason);
  if (requery.code !== 'not_found') return unavailable(requery.code + ': ' + requery.reason);
  return fallback;
}

/**
 * A commit whose response was lost may still have committed. Re-query the SAME
 * identity+fingerprint and restore the recorded event; only a positively found
 * receipt is reported committed/replayed. A missing/undecodable receipt leaves
 * the outcome explicitly UNCONFIRMED — never "not committed" and never a safe
 * repeat. A definite same-key conflict verdict is preserved.
 */
async function confirmAfterThrow<T>(
  records: GoalRecordTransactionPort,
  identityKey: string,
  fingerprint: string,
  binding: ReplayBinding<T>,
  error: unknown,
): Promise<WriteResult<T>> {
  let requery: Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>;
  try {
    requery = await records.lookupCommit({ identityKey, fingerprint });
  } catch (lookupError) {
    return unavailable('the bootstrap commit outcome is unconfirmed (the commit response was lost: '
      + messageOf(error) + '; the receipt re-query failed: ' + messageOf(lookupError) + ')');
  }
  if (requery.status === 'ready') {
    let restored: WriteResult<T>;
    try {
      restored = await restoreOriginal(records, requery.value, binding);
    } catch (restoreError) {
      return unavailable('the bootstrap commit outcome is unconfirmed (the commit response was lost: '
        + messageOf(error) + '; the recorded event could not be restored: ' + messageOf(restoreError) + ')');
    }
    if (restored.status === 'committed') return restored;
    return unavailable('the bootstrap commit outcome is unconfirmed (the commit response was lost: '
      + messageOf(error) + '; the recorded receipt could not be resolved: ' + restored.reason + ')');
  }
  if (requery.code === 'idempotency_conflict') return rejected('idempotency_conflict', requery.reason);
  return unavailable('the bootstrap commit outcome is unconfirmed (the commit response was lost: '
    + messageOf(error) + '; the receipt re-query returned ' + requery.code + ': ' + requery.reason + ')');
}

type BootstrapCommit<T> = {
  binding: ReplayBinding<T>;
  /** The abort signal bound before the first await; checked once at the last seam. */
  signal: AbortSignal;
  fingerprint: string;
  guards: readonly RecordGuard[];
  records: readonly EncodedRecord[];
  event: EncodedDomainEvent;
  /** The freshly folded value returned only when THIS call performed the commit. */
  fresh: T;
};

async function commitBootstrap<T>(
  records: GoalRecordTransactionPort,
  input: BootstrapCommit<T>,
): Promise<WriteResult<T>> {
  const prepared: PreparedCommit = {
    identityKey: input.binding.identityKey,
    fingerprint: input.fingerprint,
    guards: input.guards,
    records: input.records,
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: [input.event],
  };
  // The single last-seam cancellation check, using the signal bound before the
  // first await: a cancel during a necessary read commits nothing. A commit that
  // already returned committed is never overwritten by a later abort.
  if (input.signal.aborted) return rejected('cancelled', 'the bootstrap write was cancelled before commit');
  let committed: StoreCommitReceipt;
  try {
    committed = await records.commit(prepared);
  } catch (error) {
    return confirmAfterThrow(records, input.binding.identityKey, input.fingerprint, input.binding, error);
  }
  if (committed.status === 'committed') {
    if (!committed.replayed) {
      return { status: 'committed', value: input.fresh, replayed: false, cursor: committed.cursor };
    }
    // A racing request won between the early lookup and this commit: only the
    // ORIGINAL event may be reported, never this call's folded value.
    return restoreOriginal(records, committed, input.binding);
  }
  const failure = mapStoreFailure(committed);
  if (committed.code === 'revision_conflict') {
    return recoverByIdentity(records, input.binding.identityKey, input.fingerprint, input.binding, failure);
  }
  return failure;
}

// --------------------------------------------------------------------------
// Record reads
// --------------------------------------------------------------------------

type RecordLookup =
  | { status: 'found'; record: EncodedRecord }
  | { status: 'missing' }
  | { status: 'unaccounted' };

function lookupRecord(batch: RecordBatchRead, key: string): RecordLookup {
  const record = batch.records.find((entry) => entry.refKey === key);
  if (record !== undefined) return { status: 'found', record };
  if (batch.missing.includes(key)) return { status: 'missing' };
  return { status: 'unaccounted' };
}

function parseRecordBody(record: EncodedRecord): unknown {
  try {
    return JSON.parse(record.json);
  } catch {
    return null;
  }
}

type ProjectRead = { status: 'ok'; ref: ProjectRef; key: string; revision: number };

function decodeProjectRecord(record: EncodedRecord, ref: ProjectRef): ProjectRead | Rejection {
  const decoded = decodeProjectSnapshot(record);
  if (decoded.status !== 'decoded') return unavailable('the canonical project record is damaged: ' + decoded.reason);
  if (decoded.value.ref.projectId !== ref.projectId) {
    return unavailable('the canonical project record belongs to another project');
  }
  return { status: 'ok', ref, key: canonicalJson(ref as unknown as JsonValue), revision: decoded.value.revision };
}

/** The single necessary read for operations that only CAS the actual Project. */
async function readProjectRevision(records: GoalRecordTransactionPort, projectId: string): Promise<ProjectRead | Rejection> {
  const ref: ProjectRef = { aggregateType: 'Project', projectId };
  const key = canonicalJson(ref as unknown as JsonValue);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const lookup = lookupRecord(read.value, key);
  if (lookup.status === 'missing') return rejected('not_found', `project ${projectId} does not exist`);
  if (lookup.status === 'unaccounted') return unavailable('the record store neither returned nor reported missing the project');
  return decodeProjectRecord(lookup.record, ref);
}

function localPolicyRefFromValue(value: unknown, projectId: string): CompletionPolicyRevisionRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'CompletionPolicyRevision') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['policyId']) || !isPositiveInt(value['revision'])) return null;
  if (value['projectId'] !== projectId) return null;
  return {
    aggregateType: 'CompletionPolicyRevision', projectId: value['projectId'], policyId: value['policyId'], revision: value['revision'],
  };
}

function activePointerRevision(record: EncodedRecord, projectId: string): { status: 'ok'; revision: number } | Rejection {
  const parsed = parseRecordBody(record);
  if (!isRecord(parsed)) return unavailable('the active policy pointer is not valid JSON');
  if (parsed['revision'] !== record.revision) return unavailable('the active policy pointer revision disagrees with its body');
  const active = localPolicyRefFromValue(parsed['activeRevision'], projectId);
  if (active === null) return unavailable('the active policy pointer does not name a legal CompletionPolicyRevisionRef');
  if (parsed['projectId'] !== active.projectId) return unavailable('the active policy pointer projectId disagrees with its ref');
  return { status: 'ok', revision: record.revision };
}

// --------------------------------------------------------------------------
// createProject
// --------------------------------------------------------------------------

async function createProject(
  deps: ProjectBootstrapDependencies,
  ctx: CoreCallContext,
  request: GraphWrite<{ projectId: string }>,
): Promise<WriteResult<ProjectSnapshot>> {
  const bound = bindContext(ctx);
  if (bound.status !== 'ok') return bound;
  const owned = ownJsonInput(request, 'createProject request');
  if (owned.status === 'invalid') return invalid(owned.reason);
  const body = owned.value as unknown as { input?: unknown; meta?: unknown };
  const rawInput = body.input;
  const rawMeta = body.meta;
  if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('createProject requires an input and meta object');
  if (!exactKeys(rawInput, ['projectId'])) return invalid('createProject.input must carry exactly projectId');
  const projectId = rawInput['projectId'];
  if (!nonEmpty(projectId)) return invalid('createProject requires a non-empty projectId');
  const requestId = rawMeta['requestId'];
  if (!nonEmpty(requestId)) return invalid('createProject requires meta.requestId');
  if (bound.projectId !== projectId) return forbidden('the call context is outside the requested project');
  if (ctx.signal.aborted) return rejected('cancelled', 'the project registration was cancelled before admission');

  const expected = parseExpected(rawMeta['expected'], { projectId });
  if (expected.status !== 'ok') return expected;
  const setProblem = requireKinds(expected.pins, ['project'], 'createProject');
  if (setProblem !== null) return setProblem;
  const projectPin = expected.pins.find((pin): pin is Extract<BootstrapPin, { kind: 'project' }> => pin.kind === 'project');
  if (projectPin === undefined) return invalid('createProject requires the target Project version pin');

  const fingerprint = fingerprintOf({
    schemaVersion: 1, commandType: 'CreateProject', projectId, actor: bound.actor, expected: expectedProjection(expected.pins),
  });
  if (fingerprint.status !== 'ok') return fingerprint;
  const identityKey = CREATE_PROJECT_PREFIX + commandIdentityKey({ projectId, actor: bound.actor, idempotencyKey: requestId });
  const binding: ReplayBinding<ProjectSnapshot> = {
    identityKey, projectId, requestId, actor: bound.actor, decode: decodeProjectRegisteredEvent,
  };

  const admission = await admitByIdentity(deps.records, identityKey, fingerprint.value, binding);
  if (admission.status === 'result') return admission.result;
  if (bound.signal.aborted) return rejected('cancelled', 'the project registration was cancelled before commit');
  // createProject's contract is exactly "the target Project is absent": a
  // structurally valid but non-zero expected revision can never be satisfied.
  if (projectPin.revision !== 0) {
    return rejected('revision_conflict', 'createProject requires the target Project to be absent');
  }

  const snapshot: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
  const event: ProjectRegisteredEventV1 = {
    eventId: deps.eventId(),
    eventType: PROJECT_REGISTERED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    occurredAt: deps.now(),
    identityKey,
    fingerprint: fingerprint.value,
    projectId,
    actor: cloneActorRef(bound.actor),
    requestId,
    payload: { value: snapshot },
  };
  const projectKey = canonicalJson(snapshot.ref as unknown as JsonValue);
  return commitBootstrap(deps.records, {
    binding, signal: bound.signal, fingerprint: fingerprint.value,
    guards: [{ refKey: projectKey, expectedRevision: null }],
    records: [encodeProjectSnapshot(snapshot)],
    event: encodeProjectRegisteredEvent(event),
    fresh: snapshot,
  });
}

// --------------------------------------------------------------------------
// registerWorkspace
// --------------------------------------------------------------------------

async function registerWorkspace(
  deps: ProjectBootstrapDependencies,
  ctx: CoreCallContext,
  request: GraphWrite<{ workspace: { projectId: string; workspaceId: string } }>,
): Promise<WriteResult<WorkspaceSnapshot>> {
  const bound = bindContext(ctx);
  if (bound.status !== 'ok') return bound;
  const owned = ownJsonInput(request, 'registerWorkspace request');
  if (owned.status === 'invalid') return invalid(owned.reason);
  const body = owned.value as unknown as { input?: unknown; meta?: unknown };
  const rawInput = body.input;
  const rawMeta = body.meta;
  if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('registerWorkspace requires an input and meta object');
  if (!exactKeys(rawInput, ['workspace'])) return invalid('registerWorkspace.input must carry exactly workspace');
  const workspace = rawInput['workspace'];
  if (!isRecord(workspace) || !exactKeys(workspace, ['projectId', 'workspaceId'])
    || !nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
    return invalid('registerWorkspace requires a workspace scope with projectId and workspaceId');
  }
  const projectId = workspace['projectId'];
  const workspaceId = workspace['workspaceId'];
  const requestId = rawMeta['requestId'];
  if (!nonEmpty(requestId)) return invalid('registerWorkspace requires meta.requestId');
  if (bound.projectId !== projectId || bound.workspaceId !== workspaceId) {
    return forbidden('the call context is outside the requested workspace scope');
  }
  if (ctx.signal.aborted) return rejected('cancelled', 'the workspace registration was cancelled before admission');

  const expected = parseExpected(rawMeta['expected'], { projectId, workspaceId });
  if (expected.status !== 'ok') return expected;
  const setProblem = requireKinds(expected.pins, ['project', 'workspace'], 'registerWorkspace');
  if (setProblem !== null) return setProblem;
  const projectPin = expected.pins.find((pin): pin is Extract<BootstrapPin, { kind: 'project' }> => pin.kind === 'project');
  const workspacePin = expected.pins.find((pin): pin is Extract<BootstrapPin, { kind: 'workspace' }> => pin.kind === 'workspace');
  if (projectPin === undefined || workspacePin === undefined) {
    return invalid('registerWorkspace requires the Project and Workspace version pins');
  }

  const fingerprint = fingerprintOf({
    schemaVersion: 1, commandType: 'RegisterWorkspace', projectId, workspaceId, actor: bound.actor,
    expected: expectedProjection(expected.pins),
  });
  if (fingerprint.status !== 'ok') return fingerprint;
  const identityKey = REGISTER_WORKSPACE_PREFIX + commandIdentityKey({ projectId, actor: bound.actor, idempotencyKey: requestId });
  const binding: ReplayBinding<WorkspaceSnapshot> = {
    identityKey, projectId, requestId, actor: bound.actor, decode: decodeProjectWorkspaceRegisteredEvent,
  };

  const admission = await admitByIdentity(deps.records, identityKey, fingerprint.value, binding);
  if (admission.status === 'result') return admission.result;
  if (bound.signal.aborted) return rejected('cancelled', 'the workspace registration was cancelled before commit');
  if (workspacePin.revision !== 0) {
    return rejected('revision_conflict', 'registerWorkspace requires the target Workspace to be absent');
  }

  // Registering a Workspace validates the REAL Project only. It neither reads
  // the future Workspace row nor opens the directory: the Workspace's absence is
  // guaranteed by the commit guard.
  const project = await readProjectRevision(deps.records, projectId);
  if (project.status !== 'ok') return project;
  if (projectPin.revision !== project.revision) {
    return recoverByIdentity(deps.records, identityKey, fingerprint.value, binding, {
      status: 'rejected', code: 'revision_conflict',
      reason: 'the supplied Project pin does not match the version read in this call',
      current: [{ ref: project.ref, revision: project.revision }],
    });
  }

  const snapshot: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
  const event: ProjectWorkspaceRegisteredEventV1 = {
    eventId: deps.eventId(),
    eventType: PROJECT_WORKSPACE_REGISTERED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    occurredAt: deps.now(),
    identityKey,
    fingerprint: fingerprint.value,
    projectId,
    actor: cloneActorRef(bound.actor),
    requestId,
    payload: { value: snapshot },
  };
  const workspaceKey = canonicalJson(snapshot.ref as unknown as JsonValue);
  return commitBootstrap(deps.records, {
    binding, signal: bound.signal, fingerprint: fingerprint.value,
    guards: [
      { refKey: project.key, expectedRevision: project.revision },
      { refKey: workspaceKey, expectedRevision: null },
    ],
    records: [encodeWorkspaceSnapshot(snapshot)],
    event: encodeProjectWorkspaceRegisteredEvent(event),
    fresh: snapshot,
  });
}

// --------------------------------------------------------------------------
// installCompletionPolicy
// --------------------------------------------------------------------------

async function installCompletionPolicy(
  deps: ProjectBootstrapDependencies,
  ctx: CoreCallContext,
  request: GraphWrite<{ policyId: string; contentRevision: number; content: CompletionPolicyContentV1 }>,
): Promise<WriteResult<CompletionPolicyRevisionSnapshot>> {
  const bound = bindContext(ctx);
  if (bound.status !== 'ok') return bound;
  const owned = ownJsonInput(request, 'installCompletionPolicy request');
  if (owned.status === 'invalid') return invalid(owned.reason);
  const body = owned.value as unknown as { input?: unknown; meta?: unknown };
  const rawInput = body.input;
  const rawMeta = body.meta;
  if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('installCompletionPolicy requires an input and meta object');
  if (!exactKeys(rawInput, ['policyId', 'contentRevision', 'content'])) {
    return invalid('installCompletionPolicy.input must carry exactly policyId, contentRevision and content');
  }
  const policyId = rawInput['policyId'];
  if (!nonEmpty(policyId)) return invalid('installCompletionPolicy requires a non-empty policyId');
  const contentRevision = rawInput['contentRevision'];
  if (!isPositiveInt(contentRevision)) return invalid('installCompletionPolicy requires a positive integer contentRevision');
  const content = rawInput['content'];
  const contentProblem = completionPolicyContentProblem(content);
  if (contentProblem !== null) return invalid(contentProblem);
  const requestId = rawMeta['requestId'];
  if (!nonEmpty(requestId)) return invalid('installCompletionPolicy requires meta.requestId');
  if (ctx.signal.aborted) return rejected('cancelled', 'the policy installation was cancelled before admission');

  const projectId = bound.projectId;
  const expected = parseExpected(rawMeta['expected'], { projectId, policyId });
  if (expected.status !== 'ok') return expected;
  const setProblem = requireKinds(expected.pins, ['project', 'policy'], 'installCompletionPolicy');
  if (setProblem !== null) return setProblem;
  const projectPin = expected.pins.find((pin): pin is Extract<BootstrapPin, { kind: 'project' }> => pin.kind === 'project');
  const policyPin = expected.pins.find((pin): pin is Extract<BootstrapPin, { kind: 'policy' }> => pin.kind === 'policy');
  if (projectPin === undefined || policyPin === undefined) {
    return invalid('installCompletionPolicy requires the Project and policy revision version pins');
  }
  if (policyPin.ref.revision !== contentRevision) {
    return invalid('the expected policy revision ref must name the install input contentRevision');
  }

  let contentDigest: string;
  try {
    contentDigest = completionPolicyContentDigest({ schemaVersion: 1, policyId, contentRevision, content: content as CompletionPolicyContentV1 });
  } catch (error) {
    return invalid('the policy content cannot be canonicalized: ' + messageOf(error));
  }
  const policyRef: CompletionPolicyRevisionRef = { aggregateType: 'CompletionPolicyRevision', projectId, policyId, revision: contentRevision };
  const fingerprint = fingerprintOf({
    schemaVersion: 1, commandType: 'InstallCompletionPolicy', projectId, policyId, contentRevision, content,
    actor: bound.actor, expected: expectedProjection(expected.pins),
  });
  if (fingerprint.status !== 'ok') return fingerprint;
  const identityKey = INSTALL_POLICY_PREFIX + commandIdentityKey({ projectId, actor: bound.actor, idempotencyKey: requestId });
  const binding: ReplayBinding<CompletionPolicyRevisionSnapshot> = {
    identityKey, projectId, requestId, actor: bound.actor, decode: decodeProjectCompletionPolicyInstalledEvent,
  };

  const admission = await admitByIdentity(deps.records, identityKey, fingerprint.value, binding);
  if (admission.status === 'result') return admission.result;
  if (bound.signal.aborted) return rejected('cancelled', 'the policy installation was cancelled before commit');
  if (policyPin.revision !== 0) {
    return rejected('revision_conflict', 'installCompletionPolicy requires the target policy revision row to be absent');
  }

  const project = await readProjectRevision(deps.records, projectId);
  if (project.status !== 'ok') return project;
  if (projectPin.revision !== project.revision) {
    return recoverByIdentity(deps.records, identityKey, fingerprint.value, binding, {
      status: 'rejected', code: 'revision_conflict',
      reason: 'the supplied Project pin does not match the version read in this call',
      current: [{ ref: project.ref, revision: project.revision }],
    });
  }

  const snapshot: CompletionPolicyRevisionSnapshot = {
    ref: policyRef,
    revision: 1,
    schemaVersion: 1,
    policyId,
    contentRevision,
    contentDigest,
    content: content as CompletionPolicyContentV1,
  };
  const event: ProjectCompletionPolicyInstalledEventV1 = {
    eventId: deps.eventId(),
    eventType: PROJECT_COMPLETION_POLICY_INSTALLED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    occurredAt: deps.now(),
    identityKey,
    fingerprint: fingerprint.value,
    projectId,
    actor: cloneActorRef(bound.actor),
    requestId,
    payload: { value: snapshot },
  };
  const policyKey = canonicalJson(policyRef as unknown as JsonValue);
  return commitBootstrap(deps.records, {
    binding, signal: bound.signal, fingerprint: fingerprint.value,
    guards: [
      { refKey: project.key, expectedRevision: project.revision },
      { refKey: policyKey, expectedRevision: null },
    ],
    records: [{ refKey: policyKey, schemaId: POLICY_REVISION_SCHEMA_ID, revision: 1, json: JSON.stringify(snapshot) }],
    event: encodeProjectCompletionPolicyInstalledEvent(event),
    fresh: snapshot,
  });
}

// --------------------------------------------------------------------------
// activateCompletionPolicy
// --------------------------------------------------------------------------

async function activateCompletionPolicy(
  deps: ProjectBootstrapDependencies,
  ctx: CoreCallContext,
  request: GraphWrite<{ target: CompletionPolicyPin }>,
): Promise<WriteResult<ProjectCompletionPolicyActiveSnapshot>> {
  const bound = bindContext(ctx);
  if (bound.status !== 'ok') return bound;
  const owned = ownJsonInput(request, 'activateCompletionPolicy request');
  if (owned.status === 'invalid') return invalid(owned.reason);
  const body = owned.value as unknown as { input?: unknown; meta?: unknown };
  const rawInput = body.input;
  const rawMeta = body.meta;
  if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('activateCompletionPolicy requires an input and meta object');
  if (!exactKeys(rawInput, ['target'])) return invalid('activateCompletionPolicy.input must carry exactly target');
  const target = rawInput['target'];
  if (!isRecord(target) || !exactKeys(target, ['ref', 'digest'])) {
    return invalid('activateCompletionPolicy requires a target with ref and digest');
  }
  const targetRef = target['ref'];
  const targetDigest = target['digest'];
  if (!isRecord(targetRef) || !nonEmpty(targetRef['policyId']) || !isPositiveInt(targetRef['revision'])
    || !nonEmpty(targetRef['projectId']) || targetRef['aggregateType'] !== 'CompletionPolicyRevision') {
    return invalid('activateCompletionPolicy requires a complete CompletionPolicyRevisionRef');
  }
  if (!isSha256(targetDigest)) return invalid('activateCompletionPolicy requires a lowercase sha256 target digest');
  const requestId = rawMeta['requestId'];
  if (!nonEmpty(requestId)) return invalid('activateCompletionPolicy requires meta.requestId');
  const projectId = bound.projectId;
  // A target whose ref names another project violates the bound scope; a foreign
  // EXPECTED pin below is a different, purely structural input error.
  if (targetRef['projectId'] !== projectId) {
    return forbidden('the activation target belongs to another project');
  }
  if (ctx.signal.aborted) return rejected('cancelled', 'the policy activation was cancelled before admission');

  const expected = parseExpected(rawMeta['expected'], { projectId });
  if (expected.status !== 'ok') return expected;
  const setProblem = requireKinds(expected.pins, ['project', 'active'], 'activateCompletionPolicy');
  if (setProblem !== null) return setProblem;
  const projectPin = expected.pins.find((pin): pin is Extract<BootstrapPin, { kind: 'project' }> => pin.kind === 'project');
  const activePin = expected.pins.find((pin): pin is Extract<BootstrapPin, { kind: 'active' }> => pin.kind === 'active');
  if (projectPin === undefined || activePin === undefined) {
    return invalid('activateCompletionPolicy requires the Project and active pointer version pins');
  }

  const pinnedRef: CompletionPolicyRevisionRef = {
    aggregateType: 'CompletionPolicyRevision', projectId, policyId: targetRef['policyId'], revision: targetRef['revision'],
  };
  const fingerprint = fingerprintOf({
    schemaVersion: 1, commandType: 'ActivateCompletionPolicy', projectId,
    target: { ref: pinnedRef, digest: targetDigest }, actor: bound.actor, expected: expectedProjection(expected.pins),
  });
  if (fingerprint.status !== 'ok') return fingerprint;
  const identityKey = ACTIVATE_POLICY_PREFIX + commandIdentityKey({ projectId, actor: bound.actor, idempotencyKey: requestId });
  const binding: ReplayBinding<ProjectCompletionPolicyActiveSnapshot> = {
    identityKey, projectId, requestId, actor: bound.actor, decode: decodeProjectCompletionPolicyActivatedEvent,
  };

  const admission = await admitByIdentity(deps.records, identityKey, fingerprint.value, binding);
  if (admission.status === 'result') return admission.result;
  if (bound.signal.aborted) return rejected('cancelled', 'the policy activation was cancelled before commit');

  const projectRef: ProjectRef = { aggregateType: 'Project', projectId };
  const activeRef: ProjectCompletionPolicyActiveRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId };
  const projectKey = canonicalJson(projectRef as unknown as JsonValue);
  const targetKey = canonicalJson(pinnedRef as unknown as JsonValue);
  const activeKey = canonicalJson(activeRef as unknown as JsonValue);
  const read = await deps.records.readMany([projectKey, targetKey, activeKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const projectLookup = lookupRecord(read.value, projectKey);
  if (projectLookup.status === 'missing') return rejected('not_found', `project ${projectId} does not exist`);
  if (projectLookup.status === 'unaccounted') return unavailable('the record store neither returned nor reported missing the project');
  const project = decodeProjectRecord(projectLookup.record, projectRef);
  if (project.status !== 'ok') return project;
  const targetLookup = lookupRecord(read.value, targetKey);
  if (targetLookup.status === 'missing') {
    return rejected('not_found', `the target CompletionPolicy ${pinnedRef.policyId} revision ${String(pinnedRef.revision)} is not installed`);
  }
  if (targetLookup.status === 'unaccounted') return unavailable('the record store neither returned nor reported missing the target policy revision');
  const targetBody = parseRecordBody(targetLookup.record);
  if (!isRecord(targetBody)) return unavailable('the installed target policy revision is not a JSON object');
  if (targetBody['policyId'] !== pinnedRef.policyId || targetBody['contentRevision'] !== pinnedRef.revision) {
    return rejected('source_stale', 'the installed target policy revision disagrees with the requested ref');
  }
  if (targetBody['contentDigest'] !== targetDigest) {
    return rejected('source_stale', 'the installed target policy digest does not match the requested pin');
  }
  if (targetBody['revision'] !== targetLookup.record.revision) {
    return unavailable('the installed target policy row revision disagrees with its body');
  }
  const activeLookup = lookupRecord(read.value, activeKey);
  let activeRevision: number | null = null;
  if (activeLookup.status === 'found') {
    const decodedActive = activePointerRevision(activeLookup.record, projectId);
    if (decodedActive.status !== 'ok') return decodedActive;
    activeRevision = decodedActive.revision;
  } else if (activeLookup.status === 'unaccounted') {
    return unavailable('the record store neither returned nor reported missing the active policy pointer');
  }
  if (projectPin.revision !== project.revision) {
    return recoverByIdentity(deps.records, identityKey, fingerprint.value, binding, {
      status: 'rejected', code: 'revision_conflict',
      reason: 'the supplied Project pin does not match the version read in this call',
      current: [{ ref: project.ref, revision: project.revision }],
    });
  }
  if (activePin.revision !== (activeRevision ?? 0)) {
    return recoverByIdentity(deps.records, identityKey, fingerprint.value, binding, {
      status: 'rejected', code: 'revision_conflict',
      reason: 'the supplied active pointer pin does not match the version read in this call',
      current: [{ ref: activeRef, revision: activeRevision ?? 0 }],
    });
  }

  const snapshot: ProjectCompletionPolicyActiveSnapshot = {
    ref: activeRef,
    projectId,
    activeRevision: pinnedRef,
    revision: (activeRevision ?? 0) + 1,
  };
  const event: ProjectCompletionPolicyActivatedEventV1 = {
    eventId: deps.eventId(),
    eventType: PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    occurredAt: deps.now(),
    identityKey,
    fingerprint: fingerprint.value,
    projectId,
    actor: cloneActorRef(bound.actor),
    requestId,
    payload: { value: snapshot },
  };
  return commitBootstrap(deps.records, {
    binding, signal: bound.signal, fingerprint: fingerprint.value,
    guards: [
      { refKey: project.key, expectedRevision: project.revision },
      { refKey: targetKey, expectedRevision: targetLookup.record.revision },
      { refKey: activeKey, expectedRevision: activeRevision },
    ],
    records: [{ refKey: activeKey, schemaId: POLICY_ACTIVE_SCHEMA_ID, revision: snapshot.revision, json: JSON.stringify(snapshot) }],
    event: encodeProjectCompletionPolicyActivatedEvent(event),
    fresh: snapshot,
  });
}

// --------------------------------------------------------------------------
// readWorkspaceRegistration
// --------------------------------------------------------------------------

/**
 * R6 execution entry: one exact read of the already-registered Project and
 * Workspace records. It writes nothing, opens no CAS/event and assumes no
 * revision: the two ledger keys are read in ONE `readMany`, decoded through the
 * shared record codecs, re-checked against the requested scope and returned
 * with their real row revisions. Missing and unaccounted records stay distinct.
 */
async function readWorkspaceRegistration(
  deps: ProjectBootstrapDependencies,
  ctx: CoreCallContext,
  scope: WorkspaceScope,
): Promise<ReadResult<{ project: ProjectSnapshot; workspace: WorkspaceSnapshot }>> {
  const bound = bindContext(ctx);
  if (bound.status !== 'ok') return bound;
  if (!isRecord(scope) || !nonEmpty(scope.projectId) || !nonEmpty(scope.workspaceId)) {
    return invalid('readWorkspaceRegistration requires a project/workspace scope');
  }
  if (bound.projectId !== scope.projectId || bound.workspaceId !== scope.workspaceId) {
    return forbidden('the call context is outside the requested workspace scope');
  }
  if (ctx.signal.aborted) return rejected('cancelled', 'the registration read was cancelled before the read');
  const projectRef: ProjectRef = { aggregateType: 'Project', projectId: scope.projectId };
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
  const projectKey = canonicalJson(projectRef as unknown as JsonValue);
  const workspaceKey = canonicalJson(workspaceRef as unknown as JsonValue);
  const read = await deps.records.readMany([projectKey, workspaceKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const projectLookup = lookupRecord(read.value, projectKey);
  if (projectLookup.status === 'missing') return rejected('not_found', `project ${scope.projectId} does not exist`);
  if (projectLookup.status === 'unaccounted') return unavailable('the record store neither returned nor reported missing the project');
  const project = decodeProjectSnapshot(projectLookup.record);
  if (project.status !== 'decoded') return unavailable('the canonical project record is damaged: ' + project.reason);
  if (project.value.ref.projectId !== scope.projectId) return unavailable('the canonical project record belongs to another project');
  const workspaceLookup = lookupRecord(read.value, workspaceKey);
  if (workspaceLookup.status === 'missing') return rejected('not_found', `workspace ${scope.workspaceId} does not exist`);
  if (workspaceLookup.status === 'unaccounted') return unavailable('the record store neither returned nor reported missing the workspace');
  const workspace = decodeWorkspaceSnapshot(workspaceLookup.record);
  if (workspace.status !== 'decoded') return unavailable('the canonical workspace record is damaged: ' + workspace.reason);
  if (workspace.value.ref.projectId !== scope.projectId || workspace.value.ref.workspaceId !== scope.workspaceId) {
    return unavailable('the canonical workspace record belongs to another scope');
  }
  return { status: 'ready', value: { project: project.value, workspace: workspace.value } };
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createProjectBootstrapServices(deps: ProjectBootstrapDependencies): ProjectBootstrapServices {
  const bootstrapDeps: ProjectBootstrapDependencies = deps;
  return {
    projects: {
      createProject: (ctx, request) => createProject(bootstrapDeps, ctx, request),
      registerWorkspace: (ctx, request) => registerWorkspace(bootstrapDeps, ctx, request),
      // R6 execution-entry registration read: one exact Project/Workspace read
      // for the trusted Host; it writes nothing and returns the real revisions.
      readWorkspaceRegistration: (ctx, scope) => readWorkspaceRegistration(bootstrapDeps, ctx, scope),
    },
    completionPolicies: {
      installCompletionPolicy: (ctx, request) => installCompletionPolicy(bootstrapDeps, ctx, request),
      activateCompletionPolicy: (ctx, request) => activateCompletionPolicy(bootstrapDeps, ctx, request),
    },
  };
}
