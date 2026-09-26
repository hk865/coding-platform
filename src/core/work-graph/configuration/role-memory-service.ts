/**
 * R3g WorkGraph role-spec configuration service — the FOUR formal entry points:
 * install, exact read, activate and binding resolution.
 *
 * WorkGraph is the sole role-spec writer. The RecordStore performs CAS and
 * idempotency and is the only transaction owner; all facts are read back as its
 * registered canonical records.
 *
 * Frozen rules implemented here:
 *   - every caller-owned input (command, pin, options, role binding, declared
 *     permissions) is cloned synchronously before the first await, so mutating
 *     it after invocation can never rewrite what is stored or read;
 *   - `resolveRoleBinding` validates the FULL request shape (including a required
 *     `declaredPermissions` with non-empty string arrays) before any Store read,
 *     with or without a matrix;
 *   - install is CAS@0 on the immutable `RoleSpecRevision` row (outer row
 *     revision 1) and never activates it, and has no Project gate so existing
 *     governance initialization stays compatible; activate moves only that
 *     role's `ProjectRoleSpecActive` pointer with the Project revision and the
 *     active CAS in the SAME PreparedCommit;
 *   - `now`/`eventId` are materialized only after the early idempotency lookup
 *     confirms this call is not a replay; the activate replay is restored from
 *     the recorded event before any current spec/active read;
 *   - exact replay always reconstructs the original receipt from the recorded
 *     event (scope/ref/idempotency/actor must agree), never from the retry
 *     payload or the current clock; a business retry may change commandId and
 *     correlationId and still replay;
 *   - resolution reads one stable Store watermark: the current
 *     CoordinationPolicyActive, its exact revision/content digest, the matrix pin,
 *     the pinned RoleSpecRevision and that role's active pointer. A changed
 *     watermark is retried a bounded number of times; it is never spliced.
 *   - `absent` means a verified absence of a matrix. A missing schema, a
 *     dangling active pointer, unreadable/corrupt governance are rejected.
 *   - `declaredPermissions` is a trusted request checked against the spec
 *     ceiling; it is NOT an execution or path grant. `policyRevision` records
 *     issuance provenance and never grants tools.
 */
import type { ActorRef, CommitCursor, CommandIdentity } from '../../../contracts/command-event.js';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { RoleBindingInadmissibleDetail, RoleBindingRefV1, TaskIneligibilityReason } from '../../../contracts/dispatch.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import type {
  ActivateRoleSpecRevisionCommand, ActivateRoleSpecRevisionReceipt, InstallRoleSpecRevisionCommand,
  InstallRoleSpecRevisionReceipt, ProjectRoleSpecActiveSnapshot, RoleSpecActivatedEvent,
  RoleSpecInstalledEvent, RoleSpecPinV1, RoleSpecRevisionRef, RoleSpecRevisionSnapshot,
} from '../../../contracts/role-spec.js';
import {
  ROLE_SPEC_REVISION, activateRoleSpecRevisionFingerprint, installRoleSpecRevisionFingerprint,
  projectRoleSpecActiveRefFor, roleSpecContentDigest, roleSpecRevisionFromBinding,
} from '../../../contracts/role-spec.js';
import { validateActivateRoleSpecRevisionCommand, validateInstallRoleSpecRevisionCommand } from '../../../contracts/validation/role.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBatchRead, RecordGuard, StoreCommitReceipt,
  StoreFailure,
} from '../../record-store/ports.js';
import type { RoleBindingFacts, RoleConfigurationPort, RoleBindingFactsPort } from './contracts.js';
import {
  canonicalRefKey, decodeCoordinationPolicyRevisionSnapshot, decodeProjectCoordinationPolicyActiveSnapshot,
  decodeProjectRoleSpecActiveSnapshot, decodeRoleSpecActivatedEvent, decodeRoleSpecInstalledEvent,
  decodeRoleSpecRevisionSnapshot, encodeProjectRoleSpecActiveSnapshot, encodeRoleSpecActivatedEvent,
  encodeRoleSpecInstalledEvent, encodeRoleSpecRevisionSnapshot, projectRoleSpecActiveRefFromValue,
  roleSpecRevisionRefFromValue,
} from './role-record-codecs.js';

export type RoleConfigurationDependencies = {
  records: GoalRecordTransactionPort;
  now: () => string;
  eventId: () => string;
};

type CommittedStoreReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>;
type HostActor = { kind: 'human' | 'system'; id: string };
type TrustedHost =
  | { ok: true; projectId: string; actor: HostActor }
  | { ok: false; rejection: CoreRejection };

const ROLE_INSTALL_IDENTITY_PREFIX = 'role-spec-install:';
const ROLE_ACTIVATE_IDENTITY_PREFIX = 'role-spec-activate:';
/** Bounded watermark retry budget for one resolution read. */
const MAX_RESOLUTION_ATTEMPTS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function sameHostActor(a: HostActor, b: HostActor): boolean {
  return a.kind === b.kind && a.id === b.id;
}
function actorRefEquals(a: ActorRef, b: ActorRef): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === 'agent' && b.kind === 'agent') {
    return a.runRef.projectId === b.runRef.projectId &&
      a.runRef.goalId === b.runRef.goalId && a.runRef.runId === b.runRef.runId;
  }
  return true;
}
function cloneJson<T>(value: T): { ok: true; value: T } | { ok: false; reason: string } {
  try {
    return { ok: true, value: structuredClone(value) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `input cannot be isolated from the caller: ${detail}` };
  }
}
/** Full required shape of `RoleBindingRefV1`; `policyRevision` is shape-checked
 * only and never used as an authorization grant. */
function roleBindingProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'role binding reference must be an object';
  if (value['schemaVersion'] !== 1) return 'role binding schemaVersion must be 1';
  if (!nonEmpty(value['bindingId'])) return 'role binding bindingId must be a non-empty string';
  if (!nonEmpty(value['templateId'])) return 'role binding templateId must be a non-empty string';
  if (typeof value['templateRevision'] !== 'string') return 'role binding templateRevision must be a string';
  if (!isPositiveInteger(value['bindingVersion'])) return 'role binding bindingVersion must be a positive integer';
  if (!nonEmpty(value['policyRevision'])) return 'role binding policyRevision must be a non-empty string';
  return null;
}
/** `declaredPermissions` is a REQUIRED set to be checked; it is never defaulted. */
function permissionsProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'declaredPermissions must be {tools, writeScope}';
  const tools = value['tools'];
  if (!Array.isArray(tools) || !tools.every((tool) => nonEmpty(tool))) {
    return 'declaredPermissions.tools must be an array of non-empty strings';
  }
  const writeScope = value['writeScope'];
  if (!Array.isArray(writeScope) || !writeScope.every((entry) => nonEmpty(entry))) {
    return 'declaredPermissions.writeScope must be an array of non-empty strings';
  }
  return null;
}
function roleInstallIdentityKey(identity: CommandIdentity): string {
  return ROLE_INSTALL_IDENTITY_PREFIX + commandIdentityKey(identity);
}
function roleActivateIdentityKey(identity: CommandIdentity): string {
  return ROLE_ACTIVATE_IDENTITY_PREFIX + commandIdentityKey(identity);
}

/**
 * The trusted component boundary: Host principal, matching bound material
 * reader, a real project scope and an AbortSignal. `kind` never grants
 * capabilities by itself; each operation still checks scope and versions.
 */
function trustedHost(ctx: CoreCallContext): TrustedHost {
  if (!nonEmpty(ctx.projectId)) return { ok: false, rejection: reject('forbidden', 'a role call requires a bound project scope') };
  const principal = ctx.principal;
  if (principal.kind !== 'host') return { ok: false, rejection: reject('forbidden', 'a role call requires a trusted Host principal') };
  const actor = principal.actor;
  if (!isRecord(actor) || !nonEmpty(actor['id']) || (actor['kind'] !== 'human' && actor['kind'] !== 'system')) {
    return { ok: false, rejection: reject('forbidden', 'a role call requires a trusted Host actor') };
  }
  const reader = ctx.materialReader;
  if (reader.kind !== 'host') return { ok: false, rejection: reject('forbidden', 'a role call requires a bound Host material reader') };
  if (reader.projectId !== ctx.projectId) return { ok: false, rejection: reject('forbidden', 'the material reader belongs to another project') };
  if (!sameHostActor(reader.actor, actor)) return { ok: false, rejection: reject('forbidden', 'the material reader actor differs from the Host principal') };
  const signal = ctx.signal;
  if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean') {
    return { ok: false, rejection: reject('forbidden', 'a role call requires the bound AbortSignal') };
  }
  return { ok: true, projectId: ctx.projectId, actor: { kind: actor['kind'], id: actor['id'] } };
}

function mapReadFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'not_found': return reject('not_found', failure.reason);
    case 'invalid': return reject('invalid', failure.reason);
    case 'unsupported': return reject('unsupported', failure.reason);
    case 'corrupt': return reject('unavailable', `the record store reported damage: ${failure.reason}`);
    case 'revision_conflict':
    case 'unique_conflict':
    case 'idempotency_conflict':
    case 'unavailable':
      return reject('unavailable', failure.reason);
  }
}
function mapInstallStoreFailure(failure: StoreFailure, commandId: string): InstallRoleSpecRevisionReceipt {
  switch (failure.code) {
    case 'revision_conflict': return { status: 'rejected', commandId, code: 'revision_conflict' };
    case 'idempotency_conflict': return { status: 'rejected', commandId, code: 'idempotency_conflict' };
    case 'invalid': return { status: 'rejected', commandId, code: 'invalid' };
    case 'not_found':
    case 'unique_conflict':
    case 'corrupt':
    case 'unsupported':
    case 'unavailable':
      return { status: 'rejected', commandId, code: 'unavailable' };
  }
}
function mapActivateStoreFailure(failure: StoreFailure, commandId: string): ActivateRoleSpecRevisionReceipt {
  switch (failure.code) {
    case 'revision_conflict': return { status: 'rejected', commandId, code: 'revision_conflict' };
    case 'idempotency_conflict': return { status: 'rejected', commandId, code: 'idempotency_conflict' };
    case 'invalid': return { status: 'rejected', commandId, code: 'invalid' };
    case 'not_found': return { status: 'rejected', commandId, code: 'not_found' };
    case 'unique_conflict':
    case 'corrupt':
    case 'unsupported':
    case 'unavailable':
      return { status: 'rejected', commandId, code: 'unavailable' };
  }
}
function inadmissible(roleId: string, detail: RoleBindingInadmissibleDetail, message: string): ReadResult<RoleSpecResolutionV1> {
  const reason: TaskIneligibilityReason = { code: 'role_binding_not_admissible', roleId, detail, message };
  return { status: 'ready', value: { status: 'inadmissible', roleId, reasons: [reason] } };
}

export function createRoleConfigurationService(deps: RoleConfigurationDependencies): RoleConfigurationPort & RoleBindingFactsPort {
  const { records } = deps;

  // ------------------------------------------------------------------------
  // Shared record reads
  // ------------------------------------------------------------------------

  function lookupRecord(batch: RecordBatchRead, key: string):
    | { kind: 'found'; record: EncodedRecord }
    | { kind: 'missing' }
    | { kind: 'unaccounted' } {
    const record = batch.records.find((entry) => entry.refKey === key);
    if (record !== undefined) return { kind: 'found', record };
    if (batch.missing.includes(key)) return { kind: 'missing' };
    return { kind: 'unaccounted' };
  }

  // ------------------------------------------------------------------------
  // Replay reconstruction from the recorded event
  // ------------------------------------------------------------------------

  async function replayInstall(
    receipt: CommittedStoreReceipt,
    command: InstallRoleSpecRevisionCommand,
    projectId: string,
    roleId: string,
    revision: number,
    expectedDigest: string,
  ): Promise<InstallRoleSpecRevisionReceipt> {
    const unavailable: InstallRoleSpecRevisionReceipt = { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    if (receipt.eventIds.length !== 1) return unavailable;
    const located = await records.eventAt(receipt.cursor);
    if (located.status !== 'ready') return unavailable;
    if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
      return unavailable;
    }
    const decoded = decodeRoleSpecInstalledEvent(located.value.event);
    if (decoded.status !== 'decoded') return unavailable;
    const fact = decoded.value;
    if (fact.projectId !== projectId || fact.roleId !== roleId ||
      fact.idempotencyKey !== command.identity.idempotencyKey) {
      return unavailable;
    }
    // The recorded event must belong to the same actor; a corrupt event must
    // never restore a receipt under another identity. commandId/correlationId
    // are NOT compared: a legitimate idempotent retry may change them.
    if (!actorRefEquals(fact.actor, command.identity.actor)) return unavailable;
    if (fact.snapshot.ref.revision !== revision || fact.snapshot.contentRevision !== revision ||
      fact.snapshot.contentDigest !== expectedDigest) {
      return unavailable;
    }
    return {
      status: 'committed',
      commandId: command.commandId,
      replayed: true,
      revisionRef: fact.snapshot.ref,
      contentDigest: fact.snapshot.contentDigest,
      eventIds: [...receipt.eventIds],
      commitCursor: receipt.cursor,
    };
  }

  async function replayActivate(
    receipt: CommittedStoreReceipt,
    command: ActivateRoleSpecRevisionCommand,
    projectId: string,
    roleId: string,
  ): Promise<ActivateRoleSpecRevisionReceipt> {
    const unavailable: ActivateRoleSpecRevisionReceipt = { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    if (receipt.eventIds.length !== 1) return unavailable;
    const located = await records.eventAt(receipt.cursor);
    if (located.status !== 'ready') return unavailable;
    if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
      return unavailable;
    }
    const decoded = decodeRoleSpecActivatedEvent(located.value.event);
    if (decoded.status !== 'decoded') return unavailable;
    const fact = decoded.value;
    if (fact.projectId !== projectId || fact.roleId !== roleId ||
      fact.idempotencyKey !== command.identity.idempotencyKey) {
      return unavailable;
    }
    if (!actorRefEquals(fact.actor, command.identity.actor)) return unavailable;
    if (canonicalRefKey(fact.activeRevision) !== canonicalRefKey(command.payload.target.ref)) return unavailable;
    return {
      status: 'committed',
      commandId: command.commandId,
      replayed: true,
      activeRef: fact.activeRef,
      activeRevision: fact.activeRevision,
      eventIds: [...receipt.eventIds],
      commitCursor: receipt.cursor,
    };
  }

  // ------------------------------------------------------------------------
  // install
  // ------------------------------------------------------------------------

  async function installRoleSpec(ctx: CoreCallContext, rawCommand: InstallRoleSpecRevisionCommand): Promise<InstallRoleSpecRevisionReceipt> {
    const cloned = cloneJson(rawCommand);
    if (!cloned.ok) return { status: 'rejected', commandId: rawCommand.commandId, code: 'invalid' };
    const command = cloned.value;
    const trusted = trustedHost(ctx);
    if (!trusted.ok) return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    if (ctx.signal.aborted) return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };

    const issues = validateInstallRoleSpecRevisionCommand(command);
    if (issues.length > 0) return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    if (command.identity.projectId !== trusted.projectId || !sameHostActor(command.identity.actor as HostActor, trusted.actor)) {
      return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    }

    const roleId = command.payload.roleId;
    const revision = command.payload.revision ?? ROLE_SPEC_REVISION;
    let expectedDigest: string;
    try {
      expectedDigest = roleSpecContentDigest(command.payload.content, roleId, revision);
    } catch {
      return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    }
    if (command.payload.contentDigest !== expectedDigest) {
      return { status: 'rejected', commandId: command.commandId, code: 'digest_mismatch' };
    }

    const ref = { aggregateType: 'RoleSpecRevision' as const, projectId: trusted.projectId, roleId, revision };
    const identityKey = roleInstallIdentityKey(command.identity);
    const fingerprint = installRoleSpecRevisionFingerprint(command);

    // Early replay lookup before any now/eventId is materialized: a replay must
    // not consume event ids or fabricate a new snapshot/installedAt.
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') {
      return replayInstall(existing.value, command, trusted.projectId, roleId, revision, expectedDigest);
    }
    if (existing.code !== 'not_found') return mapInstallStoreFailure(existing, command.commandId);

    const occurredAt = deps.now();
    const snapshot: RoleSpecRevisionSnapshot = {
      ref,
      revision: 1,
      schemaVersion: 1,
      roleId,
      contentRevision: revision,
      content: command.payload.content,
      contentDigest: expectedDigest,
      installedAt: occurredAt,
    };
    const event: RoleSpecInstalledEvent = {
      eventId: deps.eventId(),
      eventType: 'RoleSpecInstalled',
      schemaVersion: 1,
      projectId: trusted.projectId,
      workspaceId: '',
      aggregateType: 'RoleSpecRevision',
      aggregateId: roleId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: command.identity.actor,
      occurredAt,
      payload: { revision: snapshot },
    };
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: [{ refKey: canonicalRefKey(ref), expectedRevision: null }],
      records: [encodeRoleSpecRevisionSnapshot(snapshot)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeRoleSpecInstalledEvent(event)],
    };

    if (ctx.signal.aborted) return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    const committed = await records.commit(prepared);
    if (committed.status !== 'committed') return mapInstallStoreFailure(committed, command.commandId);
    if (!committed.replayed) {
      return {
        status: 'committed',
        commandId: command.commandId,
        replayed: false,
        revisionRef: ref,
        contentDigest: expectedDigest,
        eventIds: [...committed.eventIds],
        commitCursor: committed.cursor,
      };
    }
    return replayInstall(committed, command, trusted.projectId, roleId, revision, expectedDigest);
  }

  // ------------------------------------------------------------------------
  // activate
  // ------------------------------------------------------------------------

  async function activateRoleSpec(ctx: CoreCallContext, rawCommand: ActivateRoleSpecRevisionCommand): Promise<ActivateRoleSpecRevisionReceipt> {
    const cloned = cloneJson(rawCommand);
    if (!cloned.ok) return { status: 'rejected', commandId: rawCommand.commandId, code: 'invalid' };
    const command = cloned.value;
    const trusted = trustedHost(ctx);
    if (!trusted.ok) return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    if (ctx.signal.aborted) return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };

    const issues = validateActivateRoleSpecRevisionCommand(command);
    if (issues.length > 0) return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    if (command.identity.projectId !== trusted.projectId || !sameHostActor(command.identity.actor as HostActor, trusted.actor)) {
      return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    }
    const target = command.payload.target;
    if (target.ref.projectId !== trusted.projectId || target.ref.aggregateType !== 'RoleSpecRevision') {
      return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    }
    const roleId = target.ref.roleId;
    if (command.aggregateId !== roleId) {
      return { status: 'rejected', commandId: command.commandId, code: 'invalid' };
    }
    const identityKey = roleActivateIdentityKey(command.identity);
    const fingerprint = activateRoleSpecRevisionFingerprint(command);

    // The original receipt is restored BEFORE any current spec/active read, so a
    // replay does not depend on (or re-validate against) the present state.
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') {
      return replayActivate(existing.value, command, trusted.projectId, roleId);
    }
    if (existing.code !== 'not_found') return mapActivateStoreFailure(existing, command.commandId);

    // The exact pin must really exist and its digest must match the command.
    const specKey = canonicalRefKey(target.ref);
    const specRead = await records.readMany([specKey]);
    if (specRead.status !== 'ready') return mapActivateStoreFailure(specRead, command.commandId);
    const specLookup = lookupRecord(specRead.value, specKey);
    if (specLookup.kind === 'missing') return { status: 'rejected', commandId: command.commandId, code: 'not_found' };
    if (specLookup.kind === 'unaccounted') return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    const decodedSpec = decodeRoleSpecRevisionSnapshot(specLookup.record);
    if (decodedSpec.status !== 'decoded') return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    if (decodedSpec.value.ref.revision !== target.ref.revision || decodedSpec.value.contentDigest !== target.digest) {
      return { status: 'rejected', commandId: command.commandId, code: 'digest_mismatch' };
    }

    // The active pointer is a per-(project, role) aggregate; missing means 0.
    const activeRef = projectRoleSpecActiveRefFor(trusted.projectId, roleId);
    const activeKey = canonicalRefKey(activeRef);
    const activeRead = await records.readMany([activeKey]);
    if (activeRead.status !== 'ready') return mapActivateStoreFailure(activeRead, command.commandId);
    const activeLookup = lookupRecord(activeRead.value, activeKey);
    let activeExpected: number | null = null;
    if (activeLookup.kind === 'found') {
      const decodedActive = decodeProjectRoleSpecActiveSnapshot(activeLookup.record);
      if (decodedActive.status !== 'decoded') return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
      if (decodedActive.value.projectId !== trusted.projectId || decodedActive.value.roleId !== roleId) {
        return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
      }
      activeExpected = decodedActive.value.revision;
    } else if (activeLookup.kind === 'unaccounted') {
      return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    }
    const newRevision = (activeExpected ?? 0) + 1;
    const occurredAt = deps.now();
    const activeSnapshot: ProjectRoleSpecActiveSnapshot = {
      ref: activeRef,
      projectId: trusted.projectId,
      roleId,
      activeRevision: target.ref,
      revision: newRevision,
    };
    const event: RoleSpecActivatedEvent = {
      eventId: deps.eventId(),
      eventType: 'RoleSpecActivated',
      schemaVersion: 1,
      projectId: trusted.projectId,
      workspaceId: '',
      aggregateType: 'ProjectRoleSpecActive',
      aggregateId: roleId,
      aggregateRevision: newRevision,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: command.identity.actor,
      occurredAt,
      payload: { activeRef, activeRevision: target.ref },
    };
    const projectKey = canonicalRefKey({ aggregateType: 'Project', projectId: trusted.projectId });
    const guards: RecordGuard[] = [
      { refKey: projectKey, expectedRevision: command.expectedRevision },
      { refKey: specKey, expectedRevision: decodedSpec.value.revision },
      { refKey: activeKey, expectedRevision: activeExpected },
    ];
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards,
      records: [encodeProjectRoleSpecActiveSnapshot(activeSnapshot)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeRoleSpecActivatedEvent(event)],
    };

    if (ctx.signal.aborted) return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    const committed = await records.commit(prepared);
    if (committed.status !== 'committed') return mapActivateStoreFailure(committed, command.commandId);
    if (!committed.replayed) {
      return {
        status: 'committed',
        commandId: command.commandId,
        replayed: false,
        activeRef,
        activeRevision: target.ref,
        eventIds: [...committed.eventIds],
        commitCursor: committed.cursor,
      };
    }
    return replayActivate(committed, command, trusted.projectId, roleId);
  }

  // ------------------------------------------------------------------------
  // readRoleSpec (exact historical read; does not require the role be active)
  // ------------------------------------------------------------------------

  async function readRoleSpec(
    ctx: CoreCallContext,
    input: { pin: RoleSpecPinV1 },
    options?: { atLeastCursor?: CommitCursor },
  ): Promise<ReadResult<RoleSpecRevisionSnapshot>> {
    // Input AND options are snapshotted together before the first await.
    const clonedInput = cloneJson(input);
    const clonedOptions = cloneJson(options);
    if (!clonedInput.ok || !clonedOptions.ok) return reject('invalid', 'role spec read input cannot be isolated from the caller');
    const pin = isRecord(clonedInput.value) ? clonedInput.value['pin'] : undefined;
    const optionValue = isRecord(clonedOptions.value) ? clonedOptions.value : undefined;
    const atLeastCursor = optionValue === undefined ? undefined : optionValue['atLeastCursor'];

    const trusted = trustedHost(ctx);
    if (!trusted.ok) return trusted.rejection;
    if (ctx.signal.aborted) return reject('cancelled', 'role spec read was cancelled');
    if (!isRecord(pin)) return reject('invalid', 'role spec pin must be a RoleSpecPin');
    const ref = roleSpecRevisionRefFromValue(pin['ref']);
    if (ref === null || !nonEmpty(pin['digest'])) return reject('invalid', 'role spec pin is not a RoleSpecPin');
    if (ref.projectId !== trusted.projectId) return reject('forbidden', 'the role spec pin belongs to another project');
    const digest = pin['digest'];

    const specKey = canonicalRefKey(ref);
    const read = await records.readMany([specKey]);
    if (read.status !== 'ready') return mapReadFailure(read);
    // A read below the requested horizon cannot establish that a pin is absent.
    if (atLeastCursor !== undefined) {
      const readThrough = read.value.readThrough;
      let current: number | null = null;
      try {
        current = readThrough === null ? null : seqOfCommitCursor(readThrough);
      } catch {
        current = null;
      }
      let required: number;
      try {
        required = seqOfCommitCursor(atLeastCursor as CommitCursor);
      } catch {
        return reject('invalid', 'the requested atLeastCursor is not a ledger cursor');
      }
      if (current === null || current < required) {
        return {
          status: 'not_ready',
          observed: readThrough === null ? null : { kind: 'platform', cursor: readThrough },
          required: { kind: 'platform', cursor: atLeastCursor as CommitCursor },
        };
      }
    }
    const lookup = lookupRecord(read.value, specKey);
    if (lookup.kind === 'missing') return { status: 'not_found' };
    if (lookup.kind === 'unaccounted') return reject('unavailable', 'the record store neither returned nor reported missing the role spec');
    const decoded = decodeRoleSpecRevisionSnapshot(lookup.record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the pinned role spec is not decodable: ${decoded.reason}`);
    if (decoded.value.ref.revision !== ref.revision) return reject('unavailable', 'the pinned role spec revision is not the stored revision');
    if (decoded.value.contentDigest !== digest) return reject('invalid', 'the pinned role spec digest does not match the stored content');

    return { status: 'ready', value: decoded.value };
  }

  // ------------------------------------------------------------------------
  // resolveRoleBinding
  // ------------------------------------------------------------------------

  type ResolutionAttempt =
    | { kind: 'stable'; result: ReadResult<RoleSpecResolutionV1>; guards: RecordGuard[] }
    | { kind: 'failed'; rejection: CoreRejection }
    | { kind: 'retry' };

  /**
   * One stable read window: the same resolution the public entry returns, plus
   * the exact versions/absences actually read. Retries discard the previous
   * read set, so the returned guards always describe the window the result came
   * from. This is the SAME resolver, not a second policy implementation.
   */
  async function resolveRoleBindingFacts(
    ctx: CoreCallContext,
    input: { roleBinding: RoleBindingRefV1; declaredPermissions: { tools: string[]; writeScope: string[] } },
  ): Promise<RoleBindingFacts> {
    // Validate the complete request shape before any Store read, independent of
    // whether this project has a matrix. `declaredPermissions` is required and
    // is never silently defaulted to the empty set.
    const source = input as unknown;
    const clonedBinding = cloneJson(isRecord(source) ? source['roleBinding'] : undefined);
    const clonedPermissions = cloneJson(isRecord(source) ? source['declaredPermissions'] : undefined);
    if (!clonedBinding.ok || !clonedPermissions.ok) {
      return { result: reject('invalid', 'role resolution input cannot be isolated from the caller'), guards: [] };
    }
    const bindingProblem = roleBindingProblem(clonedBinding.value);
    if (bindingProblem !== null) return { result: reject('invalid', bindingProblem), guards: [] };
    const permissionsIssue = permissionsProblem(clonedPermissions.value);
    if (permissionsIssue !== null) return { result: reject('invalid', permissionsIssue), guards: [] };
    const roleBinding = clonedBinding.value as RoleBindingRefV1;
    const permissions = clonedPermissions.value as { tools: string[]; writeScope: string[] };
    const declaredTools: string[] = permissions.tools;
    const declaredWriteScope: string[] = permissions.writeScope;
    const roleId = roleBinding.templateId;
    const templateRevision = roleBinding.templateRevision;

    const trusted = trustedHost(ctx);
    if (!trusted.ok) return { result: trusted.rejection, guards: [] };
    if (ctx.signal.aborted) return { result: reject('cancelled', 'role binding resolution was cancelled'), guards: [] };
    const trustedProjectId = trusted.projectId;

    const activePolicyKey = canonicalRefKey({ aggregateType: 'ProjectCoordinationPolicyActive', projectId: trustedProjectId });
    const roleActiveKey = canonicalRefKey(projectRoleSpecActiveRefFor(trustedProjectId, roleId));

    async function readBatch(keys: readonly string[]):
      Promise<{ ok: true; batch: RecordBatchRead } | { ok: false; rejection: CoreRejection }> {
      const read = await records.readMany(keys);
      if (read.status === 'ready') return { ok: true, batch: read.value };
      return { ok: false, rejection: mapReadFailure(read) };
    }
    function guardOf(key: string, batch: RecordBatchRead): RecordGuard {
      const record = lookupRecord(batch, key);
      return { refKey: key, expectedRevision: record.kind === 'found' ? record.record.revision : null };
    }

    async function attempt(): Promise<ResolutionAttempt> {
      // Phase A: current active coordination policy + this role's active pointer.
      const phaseA = await readBatch([activePolicyKey, roleActiveKey]);
      if (!phaseA.ok) return { kind: 'failed', rejection: phaseA.rejection };
      const phaseACursor = phaseA.batch.readThrough;
      const policyActiveLookup = lookupRecord(phaseA.batch, activePolicyKey);
      const roleActiveLookup = lookupRecord(phaseA.batch, roleActiveKey);
      // `unaccounted` is unknown, not absent. Reject before any guard can encode
      // a default absence for a pointer that was not actually read as missing.
      if (policyActiveLookup.kind === 'unaccounted') {
        return { kind: 'failed', rejection: reject('unavailable', 'the active coordination policy pointer is unaccounted for') };
      }
      if (roleActiveLookup.kind === 'unaccounted') {
        return { kind: 'failed', rejection: reject('unavailable', 'the role active pointer is unaccounted for') };
      }
      const phaseAGuards: RecordGuard[] = [
        guardOf(activePolicyKey, phaseA.batch),
        guardOf(roleActiveKey, phaseA.batch),
      ];
      if (policyActiveLookup.kind === 'missing') {
        return { kind: 'stable', guards: phaseAGuards, result: { status: 'ready', value: { status: 'absent', roleId,
          reason: 'the project has no active coordination policy, so there is no role matrix' } } };
      }
      const decodedPolicyActive = decodeProjectCoordinationPolicyActiveSnapshot(policyActiveLookup.record);
      if (decodedPolicyActive.status !== 'decoded') {
        return { kind: 'failed', rejection: reject('unavailable', `the active coordination policy pointer is not decodable: ${decodedPolicyActive.reason}`) };
      }
      const policyRevisionRef = decodedPolicyActive.value.activeRevision;

      // Phase B: the exact active policy revision.
      const policyRevisionKey = canonicalRefKey(policyRevisionRef);
      const phaseB = await readBatch([policyRevisionKey]);
      if (!phaseB.ok) return { kind: 'failed', rejection: phaseB.rejection };
      if (String(phaseB.batch.readThrough) !== String(phaseACursor)) return { kind: 'retry' };
      const policyLookup = lookupRecord(phaseB.batch, policyRevisionKey);
      if (policyLookup.kind === 'missing') {
        return { kind: 'failed', rejection: reject('unavailable', 'the active coordination policy revision is missing') };
      }
      if (policyLookup.kind === 'unaccounted') {
        return { kind: 'failed', rejection: reject('unavailable', 'the active coordination policy revision is unaccounted for') };
      }
      const decodedPolicy = decodeCoordinationPolicyRevisionSnapshot(policyLookup.record);
      if (decodedPolicy.status !== 'decoded') {
        return { kind: 'failed', rejection: reject('unavailable', `the active coordination policy is not decodable: ${decodedPolicy.reason}`) };
      }
      if (decodedPolicy.value.policyId !== policyRevisionRef.policyId ||
        decodedPolicy.value.contentRevision !== policyRevisionRef.revision) {
        return { kind: 'failed', rejection: reject('unavailable', 'the active coordination policy pointer does not match the stored revision') };
      }
      const policyGuards: RecordGuard[] = [...phaseAGuards,
        { refKey: policyRevisionKey, expectedRevision: policyLookup.record.revision }];

      const matrix = decodedPolicy.value.content.roles ?? null;
      if (matrix === null) {
        return { kind: 'stable', guards: policyGuards, result: { status: 'ready', value: { status: 'absent', roleId,
          reason: 'the active coordination policy has no role matrix' } } };
      }
      if (!Object.prototype.hasOwnProperty.call(matrix.catalog, roleId)) {
        return { kind: 'stable', guards: policyGuards, result: inadmissible(roleId, 'role_not_registered',
          `role ${roleId} is not registered in the active role matrix`) };
      }
      const pin = matrix.catalog[roleId]!;
      const declaredRevision = roleSpecRevisionFromBinding(templateRevision);
      if (declaredRevision === null || declaredRevision !== pin.ref.revision) {
        return { kind: 'stable', guards: policyGuards, result: inadmissible(roleId, 'role_spec_stale',
          `the binding revision is not the matrix pin revision ${pin.ref.revision}`) };
      }

      // Phase C: the exact pinned RoleSpecRevision.
      const specKey = canonicalRefKey(pin.ref);
      const phaseC = await readBatch([specKey]);
      if (!phaseC.ok) return { kind: 'failed', rejection: phaseC.rejection };
      if (String(phaseC.batch.readThrough) !== String(phaseACursor)) return { kind: 'retry' };
      const specLookup = lookupRecord(phaseC.batch, specKey);
      if (specLookup.kind === 'unaccounted') {
        return { kind: 'failed', rejection: reject('unavailable', 'the matrix-pinned RoleSpecRevision is unaccounted for') };
      }
      if (specLookup.kind === 'missing') {
        return { kind: 'stable', guards: [...policyGuards, { refKey: specKey, expectedRevision: null }],
          result: inadmissible(roleId, 'role_spec_not_installed',
            'the matrix pin points at a RoleSpecRevision that is not installed') };
      }
      const specGuards: RecordGuard[] = [...policyGuards,
        { refKey: specKey, expectedRevision: specLookup.record.revision }];
      const decodedSpec = decodeRoleSpecRevisionSnapshot(specLookup.record);
      if (decodedSpec.status !== 'decoded') {
        return { kind: 'failed', rejection: reject('unavailable', `the matrix-pinned RoleSpecRevision is not decodable: ${decodedSpec.reason}`) };
      }
      if (decodedSpec.value.ref.projectId !== trustedProjectId || decodedSpec.value.ref.roleId !== roleId ||
        decodedSpec.value.contentRevision !== pin.ref.revision || decodedSpec.value.contentDigest !== pin.digest) {
        return { kind: 'stable', guards: specGuards, result: inadmissible(roleId, 'role_spec_stale',
          'the installed RoleSpecRevision disagrees with the matrix pin revision or digest') };
      }

      // The role active pointer was read in the same Phase A batch.
      let activeRevision: RoleSpecRevisionRef | null = null;
      if (roleActiveLookup.kind === 'found') {
        const decodedRoleActive = decodeProjectRoleSpecActiveSnapshot(roleActiveLookup.record);
        if (decodedRoleActive.status !== 'decoded') {
          return { kind: 'failed', rejection: reject('unavailable', `the role active pointer is not decodable: ${decodedRoleActive.reason}`) };
        }
        if (decodedRoleActive.value.projectId !== trustedProjectId || decodedRoleActive.value.roleId !== roleId) {
          return { kind: 'failed', rejection: reject('unavailable', 'the role active pointer belongs to another scope') };
        }
        activeRevision = decodedRoleActive.value.activeRevision;
      }
      // phaseA already rejected an unaccounted pointer; a confirmed missing one
      // simply leaves activeRevision null and is inadmissible below.
      if (activeRevision === null || canonicalRefKey(activeRevision) !== canonicalRefKey(pin.ref)) {
        return { kind: 'stable', guards: specGuards, result: inadmissible(roleId, 'role_spec_stale',
          'the role active pointer is not the matrix pin; the matrix and active facts disagree') };
      }

      const spec = decodedSpec.value.content;
      const allowedTools = new Set(spec.permissions.tools);
      if (declaredTools.some((tool) => !allowedTools.has(tool))) {
        return { kind: 'stable', guards: specGuards, result: inadmissible(roleId, 'permissions_exceed_spec',
          'the declared tools exceed the role spec ceiling') };
      }
      if (spec.permissions.writeScope === 'none' && declaredWriteScope.length > 0) {
        return { kind: 'stable', guards: specGuards, result: inadmissible(roleId, 'permissions_exceed_spec',
          'the role spec is read-only but write scope was declared') };
      }
      return {
        kind: 'stable',
        guards: specGuards,
        result: { status: 'ready', value: { status: 'resolved', roleId, revision: pin.ref, spec } },
      };
    }

    for (let attemptIndex = 0; attemptIndex < MAX_RESOLUTION_ATTEMPTS; attemptIndex += 1) {
      const outcome = await attempt();
      if (outcome.kind === 'stable') return { result: outcome.result, guards: outcome.guards };
      if (outcome.kind === 'failed') return { result: outcome.rejection, guards: [] };
    }
    return { result: reject('unavailable', 'role governance did not stabilize within the bounded read retry budget'), guards: [] };
  }

  async function resolveRoleBinding(
    ctx: CoreCallContext,
    input: { roleBinding: RoleBindingRefV1; declaredPermissions: { tools: string[]; writeScope: string[] } },
  ): Promise<ReadResult<RoleSpecResolutionV1>> {
    return (await resolveRoleBindingFacts(ctx, input)).result;
  }

  return {
    installRoleSpec,
    readRoleSpec,
    activateRoleSpec,
    resolveRoleBinding,
    resolveRoleBindingFacts,
  } satisfies RoleConfigurationPort & RoleBindingFactsPort;
}
