/**
 * R4b WorkGraph Session directory — the sole formal writer of SessionRecord,
 * SessionWorkLink, the creating CoreOperation and the Kernel mapping claim.
 *
 * Frozen review rules implemented here:
 *   - The trusted Host actor is part of the command identity, the stable
 *     operationId/sessionId and the request fingerprint. Two actors never share
 *     one operation even with the same requestId.
 *   - The persisted operation workspace is re-checked on every read/registration
 *     path; a same-project different-workspace caller is never given a workspace
 *     A operation or an old registration receipt.
 *   - Initial links are validated against the real canonical target (Goal +
 *     active accepted Plan task membership) before anything is written. Module
 *     and WorkContext targets have no canonical provider in this batch and are
 *     explicitly `unsupported` instead of writing a fabricated association.
 *   - The directory candidate stream is chosen from registered exact lookups
 *     (workspace / lifecycle / role). A target filter is resolved through the
 *     registered target link index first, so no per-Session link scan is needed.
 *     Only surviving rows read their own links to build a card.
 *   - The bounded scan never advances past an unprocessed candidate, and a
 *     Session with more links than the bounded read budget fails explicitly
 *     instead of being silently truncated.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope, WorkLinkRelation, WorkLinkTarget,
} from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { CoreError, CoreRejection, ReadResult, ReadStamp, WriteResult } from '../../../contracts/core/results.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { AggregateRef } from '../../../contracts/ledger.js';
import type {
  CommitCursorBinding, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard,
  StoreFailure, UniqueClaimChange,
} from '../../record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type {
  GraphWrite, SessionCard, SessionCreationInput, SessionCreationResult, SessionDirectoryPort,
  SessionOperationRecord, SessionPage,
} from './contracts.js';
import {
  SESSION_BY_WORKSPACE_LOOKUP, SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
  SESSION_BY_WORKSPACE_LEGACY_ROLE_LOOKUP, SESSION_BY_WORKSPACE_SPEC_ROLE_LOOKUP,
  SESSION_LINKS_BY_MODULE_LOOKUP, SESSION_LINKS_BY_TASK_LOOKUP, SESSION_LINKS_BY_WORK_LOOKUP,
  SESSION_WORK_LINK_RELATIONS, SESSION_WORK_LINKS_LOOKUP, checkArtifactRef, checkOperationRef,
  checkPlainSessionRef, checkRole, checkTarget, decodeSessionOperationRecord, decodeSessionRecord,
  decodeSessionWorkLink, encodePendingSessionWorkLink, encodeSessionCreationAdmittedEvent,
  encodeSessionCreatedEvent, encodeSessionOperationRecord, encodeSessionRecord, isPlatformCursor,
  operationRefKey, plainSessionRefToAggregate, sessionAggregateRefKey, sessionCreatedPayloadFromEvent,
  sessionOperationFromAdmittedEvent, sessionWorkLinkRefKey, type PendingSessionWorkLink,
} from './session-record-codecs.js';
import { validateWorkLinkTarget } from './session-targets.js';
import { decodeRun } from '../tasks/run-state-service.js';

/** R4b's required physical surface. WorkGraph remains the sole domain writer;
 * Store implements only mechanical guards, claims, index reads and commits. */
export type SessionDirectoryStores = {
  records: GoalRecordTransactionPort;
  lookups: RecordLookupPort;
};

// --------------------------------------------------------------------------
// Runtime guards and shared helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;
export type HostActor = { kind: 'human' | 'system'; id: string };
type TrustedContext =
  | { ok: true; scope: WorkspaceScope; actor: HostActor }
  | { ok: false; rejection: CoreRejection };
/** A read-only directory binding: the Host keeps `trustedContext`; a work_run
 * binds only its own Run workspace. `not_found` stays a ReadResult, not a
 * rejection, so an absent Run never grants a workspace read. */
type ReadBinding =
  | { ok: true; scope: WorkspaceScope; actorKey: string }
  | { ok: false; result: CoreRejection | { status: 'not_found' } };

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function relation(value: unknown): value is WorkLinkRelation {
  return value === 'responsible' || value === 'participates' || value === 'investigated';
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
/** A complete RunRef, the only work_run identity a read-only directory call may claim. */
function isRunRef(value: unknown): value is RunRef {
  return isObject(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function parseAggregateRef(refKey: string): AggregateRef | null {
  try {
    const parsed: unknown = JSON.parse(refKey);
    return isObject(parsed) ? (parsed as unknown as AggregateRef) : null;
  } catch {
    return null;
  }
}
function pinsFromRevisionConflict(
  current: readonly { refKey: string; revision: number | null }[],
): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const entry of current) {
    if (entry.revision === null) continue;
    const ref = parseAggregateRef(entry.refKey);
    if (ref !== null) pins.push({ ref, revision: entry.revision });
  }
  return pins;
}
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'invalid':
      return reject('invalid', failure.reason);
    case 'not_found':
      return reject('not_found', failure.reason);
    case 'idempotency_conflict':
      return reject('idempotency_conflict', failure.reason);
    case 'revision_conflict': {
      const current = pinsFromRevisionConflict(failure.current);
      return reject('revision_conflict', failure.reason, current.length > 0 ? current : undefined);
    }
    case 'unique_conflict':
      return reject('revision_conflict', `${failure.reason} (the unique slot is held by another owner)`);
    case 'unsupported':
      return reject('unsupported', failure.reason);
    case 'corrupt':
      return reject('unavailable', `the record store reported damage: ${failure.reason}`);
    default:
      return reject('unavailable', failure.reason);
  }
}
function ownRequest<T>(value: unknown, what: string): { ok: true; value: T } | { ok: false; reason: string } {
  try {
    return { ok: true, value: structuredClone(value) as T };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${what} cannot be isolated from the caller: ${detail}` };
  }
}

/**
 * The trusted component boundary. A Session entry point runs only for a Host
 * principal that carries a real AbortSignal and a bound project/workspace; an
 * unbound caller is rejected BEFORE any store or Kernel access.
 */
function trustedContext(ctx: CoreCallContext): TrustedContext {
  const bound = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; signal?: unknown;
  };
  if (!nonEmpty(bound.projectId) || !nonEmpty(bound.workspaceId)) {
    return { ok: false, rejection: reject('forbidden', 'a Session call requires a bound project/workspace context') };
  }
  const signal = bound.signal;
  if (!isObject(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
    return { ok: false, rejection: reject('forbidden', 'a Session call requires the bound AbortSignal') };
  }
  const principal = bound.principal;
  if (!isObject(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: reject('forbidden', 'a Session call requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isObject(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: reject('forbidden', 'a Session call requires a trusted Host actor') };
  }
  return {
    ok: true,
    scope: { projectId: bound.projectId, workspaceId: bound.workspaceId },
    actor: { kind: actor['kind'], id: actor['id'] },
  };
}

// --------------------------------------------------------------------------
// Actor-scoped identity and fingerprints
// --------------------------------------------------------------------------

const SESSION_CREATE_IDENTITY_PREFIX = 'session-create:';
const SESSION_REGISTER_IDENTITY_PREFIX = 'session-register:';

function actorIdentity(actor: HostActor): { kind: string; id: string } {
  return { kind: actor.kind, id: actor.id };
}
function sessionCreateIdentityKey(actor: HostActor, projectId: string, requestId: string): string {
  return SESSION_CREATE_IDENTITY_PREFIX +
    sha256Hex(canonicalJson({ actor: actorIdentity(actor), projectId, requestId } as unknown as JsonValue));
}
function sessionRegisterIdentityKey(actor: HostActor, projectId: string, requestId: string): string {
  return SESSION_REGISTER_IDENTITY_PREFIX +
    sha256Hex(canonicalJson({ actor: actorIdentity(actor), projectId, requestId } as unknown as JsonValue));
}
function stableIds(actor: HostActor, projectId: string, requestId: string): { operationId: string; sessionId: string } {
  const digest = sha256Hex(canonicalJson({ actor: actorIdentity(actor), projectId, requestId } as unknown as JsonValue));
  return { operationId: `session-operation-${digest}`, sessionId: `session-${digest}` };
}
function deriveEventId(identityKey: string, suffix: string): string {
  return sha256Hex(`${identityKey}|${suffix}`);
}
/** Exclusive Kernel mapping slot key: one storage instance plus one Kernel Session. */
export function kernelSessionClaimKey(adapterId: string, kernelSessionId: string): string {
  return 'kernel-session-mapping:' + canonicalJson({ adapterId, kernelSessionId } as unknown as JsonValue);
}

// --------------------------------------------------------------------------
// Caller version pins
// --------------------------------------------------------------------------

type CallerPins = { project?: number; workspace?: number };

/**
 * Structural/scope validity of the caller pins. This runs BEFORE the idempotency
 * lookup: a malformed, duplicate, irrelevant or cross-scope pin is rejected no
 * matter what an earlier commit with the same identity stored.
 */
function normalizeCallerPins(raw: unknown, scope: WorkspaceScope):
  { ok: true; value: CallerPins } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, value: {} };
  if (!Array.isArray(raw)) return { ok: false, reason: 'meta.expected must be an array of version pins' };
  const value: CallerPins = {};
  const seen = new Set<string>();
  for (const entry of raw as readonly unknown[]) {
    if (!isObject(entry)) return { ok: false, reason: 'version pin must be an object' };
    const revision = entry['revision'];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      return { ok: false, reason: 'version pin revision must be a safe non-negative integer' };
    }
    const ref = entry['ref'];
    if (!isObject(ref)) return { ok: false, reason: 'version pin ref must be an object' };
    const aggregateType = ref['aggregateType'];
    const key = canonicalOf(ref);
    if (key === null) return { ok: false, reason: 'version pin ref cannot be canonically encoded' };
    if (seen.has(key)) return { ok: false, reason: 'duplicate version pin' };
    if (aggregateType === 'Project') {
      if (!nonEmpty(ref['projectId'])) return { ok: false, reason: 'Project version pin must name a projectId' };
      if (ref['projectId'] !== scope.projectId) return { ok: false, reason: 'version pin belongs to another project' };
      seen.add(key);
      value.project = revision;
      continue;
    }
    if (aggregateType === 'Workspace') {
      if (!nonEmpty(ref['projectId']) || !nonEmpty(ref['workspaceId'])) {
        return { ok: false, reason: 'Workspace version pin must name projectId and workspaceId' };
      }
      if (ref['projectId'] !== scope.projectId || ref['workspaceId'] !== scope.workspaceId) {
        return { ok: false, reason: 'Workspace version pin belongs to another workspace' };
      }
      seen.add(key);
      value.workspace = revision;
      continue;
    }
    return { ok: false, reason: 'version pin ref must be this scope Project or Workspace' };
  }
  return { ok: true, value };
}

// --------------------------------------------------------------------------
// Input normalization
// --------------------------------------------------------------------------

type NormalizedCreation = {
  workspace: WorkspaceScope;
  kernelStore: { adapterId: string; storeKey: string };
  role: RoleConfigurationRef;
  recommendedRefs: ArtifactRef[];
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
};
type NormalizeOutcome<T> = { ok: true; value: T } | { ok: false; code: CoreError; reason: string };

function checkTargetScope(target: unknown, scope: WorkspaceScope): string | null {
  if (!isObject(target) || !isObject(target['ref'])) return 'work link target is invalid';
  const ref = target['ref'];
  if (ref['projectId'] !== scope.projectId) return 'work link target belongs to another project';
  if (target['kind'] === 'work' && ref['workspaceId'] !== scope.workspaceId) {
    return 'work link target belongs to another workspace';
  }
  return null;
}
function checkRoleScope(role: unknown, scope: WorkspaceScope): string | null {
  if (isObject(role) && role['kind'] === 'role_spec' && isObject(role['pin']) && isObject(role['pin']['ref'])) {
    if (role['pin']['ref']['projectId'] !== scope.projectId) return 'role_spec pin belongs to another project';
  }
  return null;
}

function normalizeCreationInput(raw: unknown, scope: WorkspaceScope): NormalizeOutcome<NormalizedCreation> {
  if (!isObject(raw)) return { ok: false, code: 'invalid', reason: 'admitSessionCreation requires an input object' };
  const workspace = raw['workspace'];
  if (!isObject(workspace) || !nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
    return { ok: false, code: 'invalid', reason: 'session workspace must be {projectId,workspaceId}' };
  }
  if (workspace['projectId'] !== scope.projectId) {
    return { ok: false, code: 'forbidden', reason: 'session workspace belongs to another project' };
  }
  if (workspace['workspaceId'] !== scope.workspaceId) {
    return { ok: false, code: 'forbidden', reason: 'session workspace does not match the bound call context' };
  }
  const roleProblem = checkRole(raw['role']);
  if (roleProblem !== null) return { ok: false, code: 'invalid', reason: `session role is invalid: ${roleProblem}` };
  const roleScope = checkRoleScope(raw['role'], scope);
  if (roleScope !== null) return { ok: false, code: 'forbidden', reason: roleScope };
  const kernelStore = raw['kernelStore'];
  if (!isObject(kernelStore) || !nonEmpty(kernelStore['adapterId']) || !nonEmpty(kernelStore['storeKey'])) {
    return { ok: false, code: 'invalid', reason: 'session kernelStore must be {adapterId,storeKey}' };
  }
  const refs = raw['recommendedRefs'];
  if (!Array.isArray(refs)) return { ok: false, code: 'invalid', reason: 'recommendedRefs must be an array' };
  for (const entry of refs as readonly unknown[]) {
    const problem = checkArtifactRef(entry);
    if (problem !== null) return { ok: false, code: 'invalid', reason: `recommendedRefs: ${problem}` };
  }
  const links = raw['initialLinks'];
  if (!Array.isArray(links)) return { ok: false, code: 'invalid', reason: 'initialLinks must be an array' };
  for (const entry of links as readonly unknown[]) {
    if (!isObject(entry) || !('target' in entry) || !('relation' in entry)) {
      return { ok: false, code: 'invalid', reason: 'every initialLink must be {target,relation}' };
    }
    const problem = checkTarget(entry['target']);
    if (problem !== null) return { ok: false, code: 'invalid', reason: `initialLink target: ${problem}` };
    if (!relation(entry['relation'])) {
      return { ok: false, code: 'invalid', reason: 'initialLink relation is not recognized' };
    }
    const scopeProblem = checkTargetScope(entry['target'], scope);
    if (scopeProblem !== null) return { ok: false, code: 'forbidden', reason: scopeProblem };
  }
  return {
    ok: true,
    value: {
      workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      kernelStore: { adapterId: kernelStore['adapterId'], storeKey: kernelStore['storeKey'] },
      role: raw['role'] as RoleConfigurationRef,
      recommendedRefs: refs as ArtifactRef[],
      initialLinks: links as { target: WorkLinkTarget; relation: WorkLinkRelation }[],
    },
  };
}

type NormalizedRegistration = {
  operationRef: OperationRef;
  sessionRef: SessionRef;
  adapterId: string;
  kernelSessionId: string;
  observedAt: string;
};

function normalizeCreationResult(raw: unknown, scope: WorkspaceScope): NormalizeOutcome<NormalizedRegistration> {
  if (!isObject(raw)) return { ok: false, code: 'invalid', reason: 'recordSessionCreated requires an input object' };
  const operationProblem = checkOperationRef(raw['operationRef']);
  if (operationProblem !== null) return { ok: false, code: 'invalid', reason: operationProblem };
  const sessionProblem = checkPlainSessionRef(raw['sessionRef']);
  if (sessionProblem !== null) return { ok: false, code: 'invalid', reason: sessionProblem };
  const operationRef = raw['operationRef'] as unknown as OperationRef;
  const sessionRef = raw['sessionRef'] as unknown as SessionRef;
  if (operationRef.projectId !== scope.projectId) {
    return { ok: false, code: 'forbidden', reason: 'the operation belongs to another project' };
  }
  if (sessionRef.projectId !== scope.projectId) {
    return { ok: false, code: 'forbidden', reason: 'the planned Session belongs to another project' };
  }
  if (!nonEmpty(raw['adapterId']) || !nonEmpty(raw['kernelSessionId'])) {
    return { ok: false, code: 'invalid', reason: 'recordSessionCreated requires adapterId and kernelSessionId' };
  }
  if (!nonEmpty(raw['observedAt'])) {
    return { ok: false, code: 'invalid', reason: 'recordSessionCreated requires observedAt' };
  }
  if (raw['historyCursor'] !== null) {
    return {
      ok: false, code: 'unsupported',
      reason: 'R4b registers only a new empty Session; historyCursor must be null',
    };
  }
  return {
    ok: true,
    value: {
      operationRef,
      sessionRef,
      adapterId: raw['adapterId'],
      kernelSessionId: raw['kernelSessionId'],
      observedAt: raw['observedAt'],
    },
  };
}

// --------------------------------------------------------------------------
// Directory page cursor (binds scope, filters, principal and water level)
// --------------------------------------------------------------------------

type DirectoryCursor = {
  v: 1;
  projectId: string;
  workspaceId: string;
  includeArchived: boolean;
  targetKey: string | null;
  roleKey: string | null;
  actorKey: string;
  after: string;
  sourceCursor: string;
};

function encodeDirectoryCursor(cursor: DirectoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeDirectoryCursor(raw: string): DirectoryCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { projectId, workspaceId, includeArchived, targetKey, roleKey, actorKey, after, sourceCursor } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || typeof includeArchived !== 'boolean') return null;
  if (!(targetKey === null || nonEmpty(targetKey)) || !(roleKey === null || nonEmpty(roleKey))) return null;
  if (!nonEmpty(actorKey) || !nonEmpty(after) || !isPlatformCursor(sourceCursor)) return null;
  return { v: 1, projectId, workspaceId, includeArchived, targetKey, roleKey, actorKey, after, sourceCursor };
}

// --------------------------------------------------------------------------
// Target-index cursor (three ordered relation streams, merged by sessionId)
// --------------------------------------------------------------------------

type TargetStreamPositions = Record<WorkLinkRelation, string | null>;
type TargetStreamExhausted = Record<WorkLinkRelation, boolean>;

/** Opaque resume token for a target query. It binds scope, actor, filters and
 * the read water level, and records the last consumed refKey of each of the
 * three (target,relation) streams. It carries no unbounded seen set. */
type TargetCursor = {
  v: 1;
  mode: 'target';
  projectId: string;
  workspaceId: string;
  includeArchived: boolean;
  targetKey: string;
  roleKey: string | null;
  actorKey: string;
  positions: TargetStreamPositions;
  exhausted: TargetStreamExhausted;
  sourceCursor: CommitCursor;
};

function encodeTargetCursor(cursor: TargetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeTargetCursor(raw: string): TargetCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1 || parsed['mode'] !== 'target') return null;
  const { projectId, workspaceId, includeArchived, targetKey, roleKey, actorKey, positions, exhausted, sourceCursor } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || typeof includeArchived !== 'boolean') return null;
  if (!nonEmpty(targetKey)) return null;
  if (!(roleKey === null || nonEmpty(roleKey))) return null;
  if (!nonEmpty(actorKey) || !isPlatformCursor(sourceCursor)) return null;
  if (!isObject(positions) || !isObject(exhausted)) return null;
  const positionValues: Partial<TargetStreamPositions> = {};
  const exhaustedValues: Partial<TargetStreamExhausted> = {};
  for (const relation of SESSION_WORK_LINK_RELATIONS) {
    const position = positions[relation];
    if (!(position === null || nonEmpty(position))) return null;
    positionValues[relation] = position;
    const done = exhausted[relation];
    if (typeof done !== 'boolean') return null;
    exhaustedValues[relation] = done;
  }
  return {
    v: 1, mode: 'target', projectId, workspaceId, includeArchived, targetKey, roleKey, actorKey,
    positions: positionValues as TargetStreamPositions,
    exhausted: exhaustedValues as TargetStreamExhausted,
    sourceCursor: sourceCursor as CommitCursor,
  };
}

/** UTF-8 byte order, identical to the RecordStore refKey ordering. */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * Within one exact (target,relation) stream the link refKey differs only by the
 * JSON-escaped sessionId, so the Store's byte order is the order of
 * `canonicalJson(sessionId)`, NOT the raw sessionId. Comparing raw ids would
 * merge legal escaped ids (e.g. `!`/newline) in the wrong order and emit one
 * twice across pages.
 */
function compareSessionIds(left: string, right: string): number {
  return compareUtf8(canonicalOf(left) ?? '', canonicalOf(right) ?? '');
}

/** The exact candidate index for one (target kind, relation) stream. */
function targetRelationPlan(scope: WorkspaceScope, target: WorkLinkTarget, relation: WorkLinkRelation): LookupPlan {
  if (target.kind === 'module') {
    return { index: SESSION_LINKS_BY_MODULE_LOOKUP,
      values: [scope.projectId, 'module', target.ref.moduleId, relation] };
  }
  if (target.kind === 'task') {
    return { index: SESSION_LINKS_BY_TASK_LOOKUP,
      values: [scope.projectId, 'task', target.ref.goalId, target.ref.taskId, relation] };
  }
  return { index: SESSION_LINKS_BY_WORK_LOOKUP,
    values: [scope.projectId, target.ref.workspaceId, 'work', target.ref.workId, relation] };
}

// --------------------------------------------------------------------------
// Bounds and lookup plans
// --------------------------------------------------------------------------

const MAX_DIRECTORY_SCAN = 1000;
const MAX_TARGET_LINKS = 2000;
const MAX_LINKS_PER_SESSION = 2000;
const LINK_PAGE_LIMIT = 200;
/** Valid non-fabricated minimum token; only used for an empty-ledger not_ready. */
const MIN_CURSOR: CommitCursor = makeCommitCursor(1);

type RestoreOutcome<T> = { ok: true; value: T } | { ok: false; rejection: CoreRejection };
type LookupPlan = { index: string; values: readonly (string | number | null)[] };
type Fetched = { ok: true; value: { records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null } } |
  { ok: false; rejection: CoreRejection };

function directoryCandidatePlan(scope: WorkspaceScope, role: RoleConfigurationRef | undefined, includeArchived: boolean): LookupPlan {
  if (role !== undefined) {
    if (role.kind === 'legacy_template') {
      return {
        index: SESSION_BY_WORKSPACE_LEGACY_ROLE_LOOKUP,
        values: [scope.projectId, scope.workspaceId, 'legacy_template', role.templateId, role.templateRevision],
      };
    }
    return {
      index: SESSION_BY_WORKSPACE_SPEC_ROLE_LOOKUP,
      values: [scope.projectId, scope.workspaceId, 'role_spec', role.pin.ref.roleId, role.pin.ref.revision, role.pin.digest],
    };
  }
  if (!includeArchived) {
    return { index: SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP, values: [scope.projectId, scope.workspaceId, 'active'] };
  }
  return { index: SESSION_BY_WORKSPACE_LOOKUP, values: [scope.projectId, scope.workspaceId] };
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createSessionDirectory(stores: SessionDirectoryStores): SessionDirectoryPort {
  const { records, lookups } = stores;

  // ------------------------------------------------------------------------
  // Replay restore
  // ------------------------------------------------------------------------

  async function readOriginalOperation(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    expectedRefKey: string,
    scope: WorkspaceScope,
    plannedRef: SessionRef,
  ): Promise<RestoreOutcome<SessionOperationRecord>> {
    if (receipt.eventIds.length !== 1) {
      return {
        ok: false,
        rejection: reject('unavailable', `an admission receipt must reference exactly one event, got ${receipt.eventIds.length}`),
      };
    }
    const located = await records.eventAt(receipt.cursor);
    if (located.status !== 'ready') {
      return {
        ok: false,
        rejection: reject('unavailable',
          `the original admission event at ${String(receipt.cursor)} is not readable: ${located.code}: ${located.reason}`),
      };
    }
    if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
      return { ok: false, rejection: reject('unavailable', 'the admission receipt disagrees with the recorded event') };
    }
    const decoded = sessionOperationFromAdmittedEvent(located.value.event);
    if (decoded.status !== 'decoded') {
      return {
        ok: false,
        rejection: reject('unavailable', `the original admission event is not a legal SessionCreationAdmitted@1: ${decoded.reason}`),
      };
    }
    const operation = decoded.value;
    if (operationRefKey(operation.ref) !== expectedRefKey) {
      return { ok: false, rejection: reject('unavailable', 'the recorded admission belongs to another operation') };
    }
    if (operation.action.workspace.projectId !== scope.projectId ||
      operation.action.workspace.workspaceId !== scope.workspaceId) {
      return { ok: false, rejection: reject('forbidden', 'the recorded admission belongs to another workspace scope') };
    }
    if (canonicalOf(operation.action.plannedSessionRef) !== canonicalOf(plannedRef)) {
      return { ok: false, rejection: reject('unavailable', 'the recorded admission planned another Session reference') };
    }
    return { ok: true, value: operation };
  }

  async function readOriginalSession(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    registration: NormalizedRegistration,
    scope: WorkspaceScope,
  ): Promise<RestoreOutcome<SessionRecord>> {
    if (receipt.eventIds.length !== 1) {
      return {
        ok: false,
        rejection: reject('unavailable', `a registration receipt must reference exactly one event, got ${receipt.eventIds.length}`),
      };
    }
    const located = await records.eventAt(receipt.cursor);
    if (located.status !== 'ready') {
      return {
        ok: false,
        rejection: reject('unavailable',
          `the original SessionCreated event at ${String(receipt.cursor)} is not readable: ${located.code}: ${located.reason}`),
      };
    }
    if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
      return { ok: false, rejection: reject('unavailable', 'the registration receipt disagrees with the recorded event') };
    }
    const decoded = sessionCreatedPayloadFromEvent(located.value.event);
    if (decoded.status !== 'decoded') {
      return {
        ok: false,
        rejection: reject('unavailable', `the original registration event is not a legal SessionCreated@1: ${decoded.reason}`),
      };
    }
    const payload = decoded.value;
    if (operationRefKey(payload.operationRef) !== operationRefKey(registration.operationRef)) {
      return { ok: false, rejection: reject('unavailable', 'the recorded registration belongs to another operation') };
    }
    const session = payload.session;
    if (session.ref.projectId !== scope.projectId || session.workspaceId !== scope.workspaceId) {
      return { ok: false, rejection: reject('forbidden', 'the recorded registration belongs to another workspace scope') };
    }
    if (session.ref.projectId !== registration.sessionRef.projectId ||
      session.ref.sessionId !== registration.sessionRef.sessionId) {
      return { ok: false, rejection: reject('unavailable', 'the recorded Session belongs to another planned reference') };
    }
    if (session.kernel.adapterId !== registration.adapterId ||
      session.kernel.kernelSessionId !== registration.kernelSessionId) {
      return { ok: false, rejection: reject('unavailable', 'the recorded Session belongs to another Kernel identity') };
    }
    return { ok: true, value: session };
  }

  // ------------------------------------------------------------------------
  // admitSessionCreation
  // ------------------------------------------------------------------------

  async function admitSessionCreation(
    ctx: CoreCallContext,
    request: GraphWrite<SessionCreationInput>,
  ): Promise<WriteResult<SessionOperationRecord>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'session admission was cancelled before validation');
    const owned = ownRequest<unknown>(request, 'admitSessionCreation request');
    if (!owned.ok) return reject('invalid', owned.reason);
    const raw = owned.value as Record<string, unknown> | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'admitSessionCreation requires a request object');
    const meta = raw['meta'];
    if (!isObject(meta) || !nonEmpty(meta['requestId'])) {
      return reject('invalid', 'admitSessionCreation requires meta.requestId');
    }
    const requestId = meta['requestId'];
    const normalized = normalizeCreationInput(raw['input'], scope);
    if (!normalized.ok) return reject(normalized.code, normalized.reason);
    const input = normalized.value;
    const pins = normalizeCallerPins(meta['expected'], scope);
    if (!pins.ok) return reject('invalid', pins.reason);

    const identityKey = sessionCreateIdentityKey(actor, scope.projectId, requestId);
    const { operationId, sessionId } = stableIds(actor, scope.projectId, requestId);
    const plannedSessionRef: SessionRef = { projectId: scope.projectId, sessionId };
    const fingerprint = sha256Hex(canonicalJson({
      kind: 'session-create-request',
      actor: actorIdentity(actor),
      projectId: scope.projectId,
      workspace: input.workspace,
      role: input.role,
      recommendedRefs: input.recommendedRefs,
      initialLinks: input.initialLinks,
    } as unknown as JsonValue));

    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') {
      const expectedRef = operationRefKey({ aggregateType: 'CoreOperation', projectId: scope.projectId, operationId });
      const restored = await readOriginalOperation(existing.value, expectedRef, scope, plannedSessionRef);
      if (!restored.ok) return restored.rejection;
      return { status: 'committed', value: restored.value, replayed: true, cursor: existing.value.cursor };
    }
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    // ONE canonical read of the formal scope. The CAS guards below are required
    // regardless of whether the caller supplied an empty `expected` list.
    const projectKey = canonicalOf({ aggregateType: 'Project', projectId: scope.projectId });
    const workspaceKey = canonicalOf({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId });
    if (projectKey === null || workspaceKey === null) return reject('invalid', 'session scope cannot be canonically encoded');
    const scopeRead = await records.readMany([projectKey, workspaceKey]);
    if (scopeRead.status !== 'ready') {
      if (scopeRead.code === 'not_found') return reject('not_found', 'the session scope does not exist');
      return mapStoreFailure(scopeRead);
    }
    const present = new Map(scopeRead.value.records.map((record) => [record.refKey, record]));
    const project = present.get(projectKey);
    const workspace = present.get(workspaceKey);
    if (project === undefined || workspace === undefined) {
      return reject('not_found', `the session scope ${scope.projectId}/${scope.workspaceId} does not exist`);
    }
    if (pins.value.project !== undefined && pins.value.project !== project.revision) {
      return reject('revision_conflict', 'the supplied Project pin does not match the version read in this call',
        [{ ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: project.revision }]);
    }
    if (pins.value.workspace !== undefined && pins.value.workspace !== workspace.revision) {
      return reject('revision_conflict', 'the supplied Workspace pin does not match the version read in this call',
        [{ ref: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId }, revision: workspace.revision }]);
    }

    const now = new Date().toISOString();
    const operation: SessionOperationRecord = {
      ref: { aggregateType: 'CoreOperation', projectId: scope.projectId, operationId },
      revision: 1,
      action: {
        kind: 'create',
        plannedSessionRef,
        workspace: input.workspace,
        kernelStore: input.kernelStore,
        role: input.role,
        recommendedRefs: input.recommendedRefs,
        initialLinks: input.initialLinks,
      },
      phase: 'accepted',
      requestedAt: now,
      updatedAt: now,
      observation: null,
      failure: null,
    };
    const event = {
      eventId: deriveEventId(identityKey, 'admitted'),
      eventType: 'SessionCreationAdmitted' as const,
      schemaVersion: 1 as const,
      occurredAt: now,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      operationRef: operation.ref,
      operation,
    };
    const guards: RecordGuard[] = [
      { refKey: projectKey, expectedRevision: project.revision },
      { refKey: workspaceKey, expectedRevision: workspace.revision },
      { refKey: operationRefKey(operation.ref), expectedRevision: null },
      { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(plannedSessionRef)), expectedRevision: null },
    ];
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards,
      records: [encodeSessionOperationRecord(operation)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionCreationAdmittedEvent(event)],
    };

    if (ctx.signal?.aborted) return reject('cancelled', 'session admission was cancelled before commit');
    const committed = await records.commit(prepared);
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (!committed.replayed) {
      return { status: 'committed', value: operation, replayed: false, cursor: committed.cursor };
    }
    const restored = await readOriginalOperation(committed, operationRefKey(operation.ref), scope, plannedSessionRef);
    if (!restored.ok) return restored.rejection;
    return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
  }

  // ------------------------------------------------------------------------
  // recordSessionCreated
  // ------------------------------------------------------------------------

  async function recordSessionCreated(
    ctx: CoreCallContext,
    request: GraphWrite<SessionCreationResult>,
  ): Promise<WriteResult<SessionRecord>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'session registration was cancelled before validation');
    const owned = ownRequest<unknown>(request, 'recordSessionCreated request');
    if (!owned.ok) return reject('invalid', owned.reason);
    const raw = owned.value as Record<string, unknown> | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'recordSessionCreated requires a request object');
    const meta = raw['meta'];
    if (!isObject(meta) || !nonEmpty(meta['requestId'])) {
      return reject('invalid', 'recordSessionCreated requires meta.requestId');
    }
    const requestId = meta['requestId'];
    const normalized = normalizeCreationResult(raw['input'], scope);
    if (!normalized.ok) return reject(normalized.code, normalized.reason);
    const registration = normalized.value;

    // The persisted operation is read BEFORE the idempotency lookup so a
    // same-project different-workspace caller can never receive an old receipt.
    const opKey = operationRefKey(registration.operationRef);
    const operationRead = await records.readMany([opKey]);
    if (operationRead.status !== 'ready') return mapStoreFailure(operationRead);
    const operationRecord = operationRead.value.records.find((record) => record.refKey === opKey);
    if (operationRecord === undefined) {
      return reject('not_found', 'the admitted Session operation does not exist');
    }
    const decodedOperation = decodeSessionOperationRecord(operationRecord);
    if (decodedOperation.status !== 'decoded') {
      return reject('unavailable', `the admitted Session operation is damaged: ${decodedOperation.reason}`);
    }
    const storedOperation = decodedOperation.value;
    if (storedOperation.action.workspace.projectId !== scope.projectId) {
      return reject('not_found', 'the admitted Session operation belongs to another project');
    }
    if (storedOperation.action.workspace.workspaceId !== scope.workspaceId) {
      return reject('forbidden', 'the admitted Session operation belongs to another workspace scope');
    }
    if (storedOperation.action.kind !== 'create' ||
      canonicalOf(storedOperation.action.plannedSessionRef) === null ||
      canonicalOf(storedOperation.action.plannedSessionRef) !== canonicalOf(registration.sessionRef)) {
      return reject('invalid', 'the admitted operation plans another Session reference');
    }
    if (registration.adapterId !== storedOperation.action.kernelStore.adapterId) {
      return reject('invalid', 'the registration adapter does not match the pinned Kernel store');
    }

    const identityKey = sessionRegisterIdentityKey(actor, scope.projectId, requestId);
    // `observedAt` is an observation timestamp, not request content: it is
    // excluded so a genuine retry with a fresh clock still replays.
    const fingerprint = sha256Hex(canonicalJson({
      kind: 'session-register-request',
      actor: actorIdentity(actor),
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      operationRef: registration.operationRef,
      sessionRef: registration.sessionRef,
      adapterId: registration.adapterId,
      kernelSessionId: registration.kernelSessionId,
      historyCursor: null,
    } as unknown as JsonValue));

    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') {
      const restored = await readOriginalSession(existing.value, registration, scope);
      if (!restored.ok) return restored.rejection;
      return { status: 'committed', value: restored.value, replayed: true, cursor: existing.value.cursor };
    }
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    if (storedOperation.revision !== 1 || storedOperation.phase !== 'accepted') {
      return reject('revision_conflict', 'the admitted Session operation is no longer awaiting registration');
    }

    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(registration.sessionRef));
    const sessionRead = await records.readMany([sessionKey]);
    if (sessionRead.status !== 'ready') return mapStoreFailure(sessionRead);
    const existingSession = sessionRead.value.records.find((record) => record.refKey === sessionKey);
    if (existingSession !== undefined) {
      const decodedExisting = decodeSessionRecord(existingSession);
      if (decodedExisting.status !== 'decoded') {
        return reject('unavailable', `the existing Session record is damaged: ${decodedExisting.reason}`);
      }
      return reject('revision_conflict', 'the planned Session reference is already registered',
        [{ ref: decodedExisting.value.ref, revision: decodedExisting.value.revision }]);
    }

    // Validate every requested initial link against its real canonical target
    // before writing anything. Module/WorkContext have no canonical provider in
    // R4b, so they fail explicitly instead of writing a fake association.
    const targetGuards = new Map<string, RecordGuard>();
    const pendingLinks: PendingSessionWorkLink[] = [];
    for (const link of storedOperation.action.initialLinks) {
      // The one shared formal target check: a Task through Goal + active Plan
      // membership, a Module through the current adopted catalog, WorkContext
      // still unsupported. Creation never writes a fabricated association.
      const checked = await validateWorkLinkTarget(records, ctx, scope, link.target);
      if (!checked.ok) return checked.rejection;
      for (const guard of checked.guards) targetGuards.set(guard.refKey, guard);
      pendingLinks.push({
        ref: {
          aggregateType: 'SessionWorkLink',
          projectId: scope.projectId,
          sessionId: registration.sessionRef.sessionId,
          target: link.target,
          relation: link.relation,
        },
        revision: 1,
        since: null,
        until: null,
      });
    }

    const createdAt = new Date().toISOString();
    const session: SessionRecord = {
      ref: plainSessionRefToAggregate(registration.sessionRef),
      revision: 1,
      kernel: { adapterId: registration.adapterId, kernelSessionId: registration.kernelSessionId },
      lifecycle: 'active',
      health: 'available',
      role: storedOperation.action.role,
      workspaceId: scope.workspaceId,
      lastExecutionRef: null,
      occupancy: null,
      historyCursor: null,
      createdAt,
      archivedAt: null,
    };
    const completedOperation: SessionOperationRecord = {
      ...storedOperation,
      revision: 2,
      phase: 'completed',
      updatedAt: createdAt,
      observation: {
        observedAt: registration.observedAt,
        adapterId: registration.adapterId,
        kernelSessionId: registration.kernelSessionId,
        beforeCursor: null,
        afterCursor: null,
        resultRef: null,
      },
      failure: null,
    };
    const recordsToWrite: EncodedRecord[] = [
      encodeSessionRecord(session),
      encodeSessionOperationRecord(completedOperation),
      ...pendingLinks.map((link) => encodePendingSessionWorkLink(link)),
    ];
    const guardByKey = new Map<string, RecordGuard>();
    guardByKey.set(opKey, { refKey: opKey, expectedRevision: 1 });
    guardByKey.set(sessionKey, { refKey: sessionKey, expectedRevision: null });
    for (const link of pendingLinks) {
      const linkKey = sessionWorkLinkRefKey(link.ref);
      guardByKey.set(linkKey, { refKey: linkKey, expectedRevision: null });
    }
    for (const guard of targetGuards.values()) guardByKey.set(guard.refKey, guard);
    const claims: UniqueClaimChange[] = [{
      claimKey: kernelSessionClaimKey(registration.adapterId, registration.kernelSessionId),
      expectedOwner: null,
      nextOwner: sessionKey,
    }];
    const bindings: CommitCursorBinding[] = pendingLinks.map((link) => ({
      refKey: sessionWorkLinkRefKey(link.ref),
      field: 'since',
    }));
    const event = {
      eventId: deriveEventId(identityKey, 'created'),
      eventType: 'SessionCreated' as const,
      schemaVersion: 1 as const,
      occurredAt: createdAt,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      operationRef: registration.operationRef,
      session,
    };
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: [...guardByKey.values()],
      records: recordsToWrite,
      claims,
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionCreatedEvent(event)],
      ...(bindings.length > 0 ? { commitCursorBindings: bindings } : {}),
    };

    if (ctx.signal?.aborted) return reject('cancelled', 'session registration was cancelled before commit');
    const committed = await records.commit(prepared);
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (!committed.replayed) {
      return { status: 'committed', value: session, replayed: false, cursor: committed.cursor };
    }
    const restored = await readOriginalSession(committed, registration, scope);
    if (!restored.ok) return restored.rejection;
    return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
  }

  // ------------------------------------------------------------------------
  // getSessionOperation
  // ------------------------------------------------------------------------

  async function getSessionOperation(
    ctx: CoreCallContext,
    ref: OperationRef,
  ): Promise<ReadResult<SessionOperationRecord>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted;
    const problem = checkOperationRef(ref);
    if (problem !== null) return reject('invalid', problem);
    if (ref.projectId !== scope.projectId) return { status: 'not_found' };
    const key = operationRefKey(ref);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeSessionOperationRecord(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the Session operation is damaged: ${decoded.reason}`);
    const operation = decoded.value;
    if (operation.action.workspace.projectId !== scope.projectId ||
      operation.action.workspace.workspaceId !== scope.workspaceId) {
      return { status: 'not_found' };
    }
    return { status: 'ready', value: operation };
  }

  // ------------------------------------------------------------------------
  // Shared reads
  // ------------------------------------------------------------------------

  function availabilityOf(record: SessionRecord): SessionCard['availability'] {
    if (record.lifecycle === 'archived' || record.health === 'unavailable') return 'unavailable';
    if (record.occupancy !== null) return 'busy';
    if (record.health === 'recoverable') return 'recoverable';
    return 'idle';
  }

  /**
   * Complete read of one Session's own links through the registered per-Session
   * index. Reaching the bounded budget is an explicit `capacity` failure; a card
   * is never built from a silently truncated link set.
   */
  async function readSessionLinks(
    projectId: string,
    sessionId: string,
    observe?: (readThrough: CommitCursor | null) => void,
  ): Promise<RestoreOutcome<SessionWorkLink[]>> {
    const links: SessionWorkLink[] = [];
    let after: string | undefined;
    for (;;) {
      const request: RecordLookupRequest = {
        index: SESSION_WORK_LINKS_LOOKUP,
        values: [projectId, sessionId],
        ...(after === undefined ? {} : { after }),
        limit: LINK_PAGE_LIMIT,
      };
      const page = await lookups.lookup(request);
      if (page.status !== 'ready') return { ok: false, rejection: mapStoreFailure(page) };
      observe?.(page.value.readThrough);
      for (const record of page.value.records) {
        if (links.length >= MAX_LINKS_PER_SESSION) {
          return {
            ok: false,
            rejection: reject('capacity', `Session ${sessionId} exceeds the bounded work-link read budget`),
          };
        }
        const decoded = decodeSessionWorkLink(record);
        if (decoded.status !== 'decoded') {
          return { ok: false, rejection: reject('unavailable', `session work link ${record.refKey} is damaged: ${decoded.reason}`) };
        }
        links.push(decoded.value);
      }
      if (page.value.next === null) break;
      after = page.value.next;
    }
    return { ok: true, value: links };
  }

  /**
   * The read-only directory binding. A trusted Host reuses the ORIGINAL
   * `trustedContext` guard and actor key, so every existing directory cursor
   * still binds to the same principal. A work_run binds only its own snapshotted
   * project/workspace and RunRef: it reads exactly ONE Run through the shared
   * `decodeRun` and checks the Run workspace. It never loads the whole execution
   * chain, never re-checks lease/Role/generation and never permits a write.
   */
  async function readContext(ctx: CoreCallContext): Promise<ReadBinding> {
    const bound = ctx as unknown as {
      projectId?: unknown; workspaceId?: unknown; principal?: unknown; signal?: unknown;
    };
    const principal = isObject(bound) ? bound['principal'] : undefined;
    if (isObject(principal) && principal['kind'] === 'host') {
      const trusted = trustedContext(ctx);
      if (!trusted.ok) return { ok: false, result: trusted.rejection };
      const actorKey = canonicalOf(actorIdentity(trusted.actor));
      if (actorKey === null) return { ok: false, result: reject('invalid', 'the Host actor cannot be canonically encoded') };
      return { ok: true, scope: trusted.scope, actorKey };
    }
    if (isObject(principal) && principal['kind'] === 'work_run') {
      return readWorkRunContext(bound, principal);
    }
    return { ok: false, result: reject('forbidden', 'a Session read requires a trusted Host or work_run principal') };
  }

  async function readWorkRunContext(
    bound: { projectId?: unknown; workspaceId?: unknown; signal?: unknown },
    principal: UnknownRecord,
  ): Promise<ReadBinding> {
    // Snapshot every scope/identity input BEFORE the first await. Only these
    // copied values are used after `readMany`; the caller's mutable objects are
    // never consulted again.
    const projectId = nonEmpty(bound.projectId) ? bound.projectId : null;
    const workspaceId = nonEmpty(bound.workspaceId) ? bound.workspaceId : null;
    if (projectId === null || workspaceId === null) {
      return { ok: false, result: reject('forbidden', 'a work_run Session read requires a bound project/workspace context') };
    }
    const signal = bound.signal;
    if (!isObject(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
      return { ok: false, result: reject('forbidden', 'a work_run Session read requires the bound AbortSignal') };
    }
    const rawRunRef = principal['runRef'];
    if (!isRunRef(rawRunRef)) {
      return { ok: false, result: reject('forbidden', 'a work_run Session read requires a complete RunRef') };
    }
    let runRef: RunRef;
    try {
      runRef = structuredClone(rawRunRef);
    } catch {
      return { ok: false, result: reject('invalid', 'the Run ref cannot be isolated from the caller') };
    }
    if (runRef.projectId !== projectId) {
      return { ok: false, result: reject('forbidden', 'the Run belongs to another project') };
    }
    const runKey = canonicalOf(runRef);
    if (runKey === null) return { ok: false, result: reject('invalid', 'the Run ref cannot be canonically encoded') };
    const actorKey = canonicalOf({ kind: 'work_run', runRef });
    if (actorKey === null) return { ok: false, result: reject('invalid', 'the work_run read identity cannot be canonically encoded') };
    const scope: WorkspaceScope = { projectId, workspaceId };
    const read = await records.readMany([runKey]);
    if (read.status !== 'ready') return { ok: false, result: mapStoreFailure(read) };
    const record = read.value.records.find((entry) => entry.refKey === runKey);
    if (record === undefined) return { ok: false, result: { status: 'not_found' } };
    const decoded = decodeRun(record);
    if (!decoded.ok) return { ok: false, result: reject('unavailable', `the Run is damaged: ${decoded.reason}`) };
    const run = decoded.value;
    if (canonicalOf(run.ref) !== runKey) {
      return { ok: false, result: reject('unavailable', 'the Run ref disagrees with the requested Run') };
    }
    if (run.workspaceSnapshot.workspaceId !== workspaceId) {
      return { ok: false, result: reject('forbidden', 'the Run workspace does not match the bound read context') };
    }
    return { ok: true, scope, actorKey };
  }

  async function readSession(ctx: CoreCallContext, ref: SessionRef): Promise<ReadResult<SessionCard>> {
    // The read binding may suspend, so freeze the caller's ref BEFORE the first
    // await; a failed isolation keeps the original synchronous `invalid` shape.
    const ownedRef = ownRequest<unknown>(ref, 'readSession reference');
    if (!ownedRef.ok) return reject('invalid', ownedRef.reason);
    const binding = await readContext(ctx);
    if (!binding.ok) return binding.result;
    const { scope } = binding;
    const owned = ownedRef.value;
    if (!isObject(owned) || !nonEmpty(owned['projectId']) || !nonEmpty(owned['sessionId'])) {
      return reject('invalid', 'readSession requires a SessionRef');
    }
    if (owned['projectId'] !== scope.projectId) return { status: 'not_found' };
    const sessionRef: SessionRef = { projectId: owned['projectId'], sessionId: owned['sessionId'] };
    const key = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
    const read = await records.readMany([key]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the Session record is damaged: ${decoded.reason}`);
    const session = decoded.value;
    if (session.ref.projectId !== scope.projectId || session.workspaceId !== scope.workspaceId) {
      return { status: 'not_found' };
    }
    const links = await readSessionLinks(scope.projectId, session.ref.sessionId);
    if (!links.ok) return links.rejection;
    return {
      status: 'ready',
      value: { record: session, availability: availabilityOf(session), links: links.value, recommendationReasons: [] },
    };
  }

  async function fetchLookup(plan: LookupPlan, after: string | undefined, want: number): Promise<Fetched> {
    const request: RecordLookupRequest = {
      index: plan.index,
      values: plan.values,
      ...(after === undefined ? {} : { after }),
      limit: want,
    };
    const page = await lookups.lookup(request);
    if (page.status !== 'ready') return { ok: false, rejection: mapStoreFailure(page) };
    return { ok: true, value: page.value };
  }

  // ------------------------------------------------------------------------
  // findSessions
  // ------------------------------------------------------------------------

  /**
   * Target discovery is index-driven. For a fixed target the registered
   * (target,relation) indexes form three streams whose refKeys sort by
   * sessionId. They are merged by sessionId, each Session is emitted once, and
   * the cursor stores only the last consumed refKey of each stream plus an
   * exhausted flag. This never enumerates the workspace and never grows an
   * unbounded seen set.
   */
  async function findSessionsByTarget(args: {
    scope: WorkspaceScope;
    actorKey: string;
    target: WorkLinkTarget;
    targetKey: string;
    roleKey: string | null;
    includeArchived: boolean;
    limit: number;
    cursor: TargetCursor | null;
    atLeast: CommitCursor | undefined;
  }): Promise<ReadResult<SessionPage<SessionCard>>> {
    const { scope, target, targetKey, roleKey, includeArchived, limit } = args;
    const positions: TargetStreamPositions = { responsible: null, participates: null, investigated: null };
    const exhausted: TargetStreamExhausted = { responsible: false, participates: false, investigated: false };
    if (args.cursor !== null) {
      for (const relation of SESSION_WORK_LINK_RELATIONS) {
        positions[relation] = args.cursor.positions[relation];
        exhausted[relation] = args.cursor.exhausted[relation];
      }
    }
    const cursorSource: CommitCursor | null = args.cursor === null ? null : args.cursor.sourceCursor;
    let sourceCursor: CommitCursor | null = cursorSource;
    let checkedWater = false;
    let stale = false;
    // Holder object: a closure assigns it, so a plain `let` would be narrowed to
    // `null` at the read site by control-flow analysis.
    const water: { failure: { observed: ReadStamp | null; required: ReadStamp } | null } = { failure: null };
    const observeWater = (readThrough: CommitCursor | null): void => {
      if (!checkedWater) {
        checkedWater = true;
        if (readThrough === null) {
          water.failure = { observed: null, required: { kind: 'platform', cursor: args.atLeast ?? MIN_CURSOR } };
          return;
        }
        if (cursorSource !== null && readThrough !== cursorSource) { stale = true; return; }
        if (args.atLeast !== undefined && seqOfCommitCursor(readThrough) < seqOfCommitCursor(args.atLeast)) {
          water.failure = {
            observed: { kind: 'platform', cursor: readThrough },
            required: { kind: 'platform', cursor: args.atLeast },
          };
          return;
        }
        sourceCursor = readThrough;
        return;
      }
      // The first read declares the water level. Every later lookup, Session
      // read and card-link read must belong to that same level; otherwise the
      // head and the assembled card could mix two revisions, which is reported
      // as an explicit source_stale rather than a silently inconsistent card.
      if (sourceCursor !== null && readThrough !== sourceCursor) stale = true;
    };

    const heads: Partial<Record<WorkLinkRelation, {
      refKey: string; sessionId: string; open: boolean; hasMore: boolean;
    }>> = {};

    const fetchHead = async (relation: WorkLinkRelation): Promise<CoreRejection | null> => {
      const plan = targetRelationPlan(scope, target, relation);
      const after = positions[relation];
      const page = await lookups.lookup({
        index: plan.index,
        values: plan.values,
        ...(after === null ? {} : { after }),
        limit: 1,
      });
      if (page.status !== 'ready') return mapStoreFailure(page);
      observeWater(page.value.readThrough);
      if (stale || water.failure !== null) return null;
      if (page.value.records.length === 0) { exhausted[relation] = true; return null; }
      const record = page.value.records[0]!;
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') {
        return reject('unavailable', `session work link ${record.refKey} is damaged: ${decoded.reason}`);
      }
      const link = decoded.value;
      if (link.ref.projectId !== scope.projectId) {
        positions[relation] = record.refKey;
        exhausted[relation] = page.value.next === null;
        return null;
      }
      heads[relation] = {
        refKey: record.refKey,
        sessionId: link.ref.sessionId,
        open: link.until === null,
        hasMore: page.value.next !== null,
      };
      return null;
    };

    const items: SessionCard[] = [];
    let scanned = 0;
    while (items.length < limit) {
      for (const relation of SESSION_WORK_LINK_RELATIONS) {
        if (!exhausted[relation] && heads[relation] === undefined) {
          const failure = await fetchHead(relation);
          if (failure !== null) return failure;
          if (stale) return reject('source_stale', 'the target cursor water level no longer matches the ledger');
          if (water.failure !== null) return { status: 'not_ready', observed: water.failure.observed, required: water.failure.required };
        }
      }
      let minSessionId: string | null = null;
      for (const relation of SESSION_WORK_LINK_RELATIONS) {
        const head = heads[relation];
        if (head === undefined) continue;
        if (minSessionId === null || compareSessionIds(head.sessionId, minSessionId) < 0) minSessionId = head.sessionId;
      }
      if (minSessionId === null) break;
      scanned += 1;
      if (scanned > MAX_TARGET_LINKS) {
        return reject('capacity', 'the target link streams exceed the bounded candidate budget');
      }
      let openLink = false;
      for (const relation of SESSION_WORK_LINK_RELATIONS) {
        const head = heads[relation];
        if (head !== undefined && head.sessionId === minSessionId && head.open) { openLink = true; break; }
      }
      // Only the related Session is read; unrelated workspace Sessions are never
      // enumerated or read.
      const sessionKey = sessionAggregateRefKey(
        plainSessionRefToAggregate({ projectId: scope.projectId, sessionId: minSessionId }));
      const read = await records.readMany([sessionKey]);
      if (read.status !== 'ready') return mapStoreFailure(read);
      observeWater(read.value.readThrough);
      if (stale) return reject('source_stale', 'the Session was read at a different water level than the target stream');
      const record = read.value.records.find((entry) => entry.refKey === sessionKey);
      if (record === undefined) {
        return reject('unavailable', `a work link names Session ${minSessionId} that does not exist`);
      }
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') {
        return reject('unavailable', `session ${sessionKey} is damaged: ${decoded.reason}`);
      }
      const session = decoded.value;
      const visible = openLink
        && session.ref.projectId === scope.projectId
        && session.workspaceId === scope.workspaceId
        && (includeArchived || session.lifecycle === 'active')
        && (roleKey === null || canonicalOf(session.role) === roleKey);
      if (visible) {
        const links = await readSessionLinks(scope.projectId, session.ref.sessionId, observeWater);
        if (!links.ok) return links.rejection;
        if (stale) return reject('source_stale', 'the card links were read at a different water level than the target stream');
        items.push({ record: session, availability: availabilityOf(session), links: links.value, recommendationReasons: [] });
      }
      // Advance every stream at this Session, including a closed/archived/role
      // filtered candidate, so it can never reappear on a later page.
      for (const relation of SESSION_WORK_LINK_RELATIONS) {
        const head = heads[relation];
        if (head !== undefined && head.sessionId === minSessionId) {
          positions[relation] = head.refKey;
          exhausted[relation] = !head.hasMore;
          delete heads[relation];
        }
      }
    }

    let hasMore = false;
    for (const relation of SESSION_WORK_LINK_RELATIONS) {
      if (heads[relation] !== undefined || !exhausted[relation]) { hasMore = true; break; }
    }
    if (sourceCursor === null) {
      return {
        status: 'not_ready',
        observed: null,
        required: { kind: 'platform', cursor: args.atLeast ?? MIN_CURSOR },
      };
    }
    const nextCursor = hasMore
      ? encodeTargetCursor({
        v: 1, mode: 'target',
        projectId: scope.projectId, workspaceId: scope.workspaceId,
        includeArchived, targetKey, roleKey, actorKey: args.actorKey,
        positions, exhausted, sourceCursor,
      })
      : null;
    return { status: 'ready', value: { items, nextCursor, sourceCursor } };
  }

  async function findSessions(
    ctx: CoreCallContext,
    input: {
      workspace: WorkspaceScope;
      target?: WorkLinkTarget;
      role?: RoleConfigurationRef;
      includeArchived: boolean;
      page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
    },
  ): Promise<ReadResult<SessionPage<SessionCard>>> {
    // The read binding may suspend, so freeze the caller's input BEFORE the
    // first await; a failed isolation keeps the original `invalid` shape.
    const ownedInput = ownRequest<unknown>(input, 'findSessions input');
    if (!ownedInput.ok) return reject('invalid', ownedInput.reason);
    const binding = await readContext(ctx);
    if (!binding.ok) return binding.result;
    const { scope, actorKey } = binding;
    const raw = ownedInput.value as Record<string, unknown> | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'findSessions requires an input object');
    const workspace = raw['workspace'];
    if (!isObject(workspace) || workspace['projectId'] !== scope.projectId || workspace['workspaceId'] !== scope.workspaceId) {
      return reject('forbidden', 'findSessions is bound to another project or workspace');
    }
    const includeArchived = raw['includeArchived'];
    if (typeof includeArchived !== 'boolean') return reject('invalid', 'findSessions requires includeArchived');
    const pageInput = raw['page'];
    if (!isObject(pageInput)) return reject('invalid', 'findSessions requires a page request');
    const limit = pageInput['limit'];
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reject('invalid', 'findSessions page.limit must be an integer between 1 and 200');
    }
    const target = raw['target'];
    let targetValue: WorkLinkTarget | undefined;
    if (target !== undefined) {
      const problem = checkTarget(target);
      if (problem !== null) return reject('invalid', `findSessions target: ${problem}`);
      const scopeProblem = checkTargetScope(target, scope);
      if (scopeProblem !== null) return reject('forbidden', scopeProblem);
      targetValue = target as unknown as WorkLinkTarget;
    }
    const role = raw['role'];
    let roleValue: RoleConfigurationRef | undefined;
    if (role !== undefined) {
      const problem = checkRole(role);
      if (problem !== null) return reject('invalid', `findSessions role: ${problem}`);
      const scopeProblem = checkRoleScope(role, scope);
      if (scopeProblem !== null) return reject('forbidden', scopeProblem);
      roleValue = role as unknown as RoleConfigurationRef;
    }
    const targetKey = targetValue === undefined ? null : canonicalOf(targetValue);
    const roleKey = roleValue === undefined ? null : canonicalOf(roleValue);
    if (targetValue !== undefined && targetKey === null) return reject('invalid', 'findSessions target cannot be canonically encoded');
    if (roleValue !== undefined && roleKey === null) return reject('invalid', 'findSessions role cannot be canonically encoded');

    const rawAtLeast = pageInput['atLeastCursor'];
    let atLeast: CommitCursor | undefined;
    if (rawAtLeast !== undefined) {
      if (!isPlatformCursor(rawAtLeast)) return reject('invalid', 'findSessions atLeastCursor is not a ledger cursor');
      atLeast = rawAtLeast as CommitCursor;
    }
    const rawCursor = pageInput['cursor'];

    if (targetValue !== undefined && targetKey !== null) {
      let targetCursor: TargetCursor | null = null;
      if (rawCursor !== undefined) {
        if (!nonEmpty(rawCursor)) return reject('invalid', 'findSessions cursor must be a non-empty string');
        targetCursor = decodeTargetCursor(rawCursor);
        if (targetCursor === null) return reject('invalid', 'findSessions cursor is not a valid target cursor');
        if (targetCursor.projectId !== scope.projectId || targetCursor.workspaceId !== scope.workspaceId ||
          targetCursor.includeArchived !== includeArchived || targetCursor.targetKey !== targetKey ||
          targetCursor.roleKey !== roleKey || targetCursor.actorKey !== actorKey) {
          return reject('invalid', 'findSessions cursor is bound to another scope, filter or principal');
        }
      }
      return findSessionsByTarget({
        scope, actorKey, target: targetValue, targetKey, roleKey, includeArchived, limit,
        cursor: targetCursor, atLeast,
      });
    }

    // Non-target directory query keeps its existing workspace/lifecycle/role
    // candidate scan and directory cursor semantics unchanged.
    let after: string | undefined;
    let cursorSource: CommitCursor | null = null;
    if (rawCursor !== undefined) {
      if (!nonEmpty(rawCursor)) return reject('invalid', 'findSessions cursor must be a non-empty string');
      const decodedCursor = decodeDirectoryCursor(rawCursor);
      if (decodedCursor === null) return reject('invalid', 'findSessions cursor is not a valid directory cursor');
      if (decodedCursor.projectId !== scope.projectId || decodedCursor.workspaceId !== scope.workspaceId ||
        decodedCursor.includeArchived !== includeArchived || decodedCursor.targetKey !== targetKey ||
        decodedCursor.roleKey !== roleKey || decodedCursor.actorKey !== actorKey) {
        return reject('invalid', 'findSessions cursor is bound to another scope, filter or principal');
      }
      after = decodedCursor.after;
      cursorSource = decodedCursor.sourceCursor as CommitCursor;
    }

    const candidatePlan = directoryCandidatePlan(scope, roleValue, includeArchived);
    let sourceCursor: CommitCursor | null = null;
    let firstPage = true;
    let scanned = 0;
    let hasMore = false;
    let lastReturnedKey: string | null = null;
    let lastProcessedKey: string | null = after ?? null;
    let cursorAfter = after;
    const items: SessionCard[] = [];

    while (items.length < limit) {
      const budget = MAX_DIRECTORY_SCAN - scanned;
      if (budget <= 0) {
        hasMore = true;
        break;
      }
      const want = Math.max(1, Math.min(LINK_PAGE_LIMIT, budget));
      const fetched = await fetchLookup(candidatePlan, cursorAfter, want);
      if (!fetched.ok) return fetched.rejection;
      const page = fetched.value;
      if (firstPage) {
        firstPage = false;
        sourceCursor = page.readThrough;
        if (sourceCursor === null) {
          const required: ReadStamp = { kind: 'platform', cursor: atLeast ?? MIN_CURSOR };
          return { status: 'not_ready', observed: null, required };
        }
        if (cursorSource !== null && sourceCursor !== cursorSource) {
          return reject('source_stale', 'the directory cursor water level no longer matches the ledger');
        }
        if (atLeast !== undefined && seqOfCommitCursor(sourceCursor) < seqOfCommitCursor(atLeast)) {
          return { status: 'not_ready', observed: { kind: 'platform', cursor: sourceCursor }, required: { kind: 'platform', cursor: atLeast } };
        }
      }
      let overflow = false;
      for (const record of page.records) {
        scanned += 1;
        lastProcessedKey = record.refKey;
        const decoded = decodeSessionRecord(record);
        if (decoded.status !== 'decoded') {
          return reject('unavailable', `session ${record.refKey} is damaged: ${decoded.reason}`);
        }
        const session = decoded.value;
        if (session.ref.projectId !== scope.projectId || session.workspaceId !== scope.workspaceId) continue;
        if (!includeArchived && session.lifecycle === 'archived') continue;
        if (roleKey !== null && canonicalOf(session.role) !== roleKey) continue;
        if (items.length >= limit) {
          overflow = true;
          continue;
        }
        const links = await readSessionLinks(scope.projectId, session.ref.sessionId);
        if (!links.ok) return links.rejection;
        items.push({ record: session, availability: availabilityOf(session), links: links.value, recommendationReasons: [] });
        lastReturnedKey = record.refKey;
      }
      if (items.length >= limit) {
        hasMore = overflow || page.next !== null;
        break;
      }
      if (page.next === null) {
        hasMore = false;
        break;
      }
      cursorAfter = page.next;
    }

    if (sourceCursor === null) {
      return { status: 'not_ready', observed: null, required: { kind: 'platform', cursor: atLeast ?? MIN_CURSOR } };
    }
    const nextAnchor = items.length > 0 ? lastReturnedKey : lastProcessedKey;
    const nextCursor = hasMore && nextAnchor !== null
      ? encodeDirectoryCursor({
        v: 1,
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        includeArchived,
        targetKey,
        roleKey,
        actorKey,
        after: nextAnchor,
        sourceCursor,
      })
      : null;
    return { status: 'ready', value: { items, nextCursor, sourceCursor } };
  }

  return { admitSessionCreation, recordSessionCreated, getSessionOperation, readSession, findSessions };
}
