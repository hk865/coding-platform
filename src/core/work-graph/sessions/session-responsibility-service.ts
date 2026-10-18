/**
 * Slice 1 §3.3: the Session responsibility write owner. It keeps the existing
 * `SessionWorkLink` records and binds the source `until` and destination `since`
 * to the same commit cursor. The trusted Task basis arrives through the narrow
 * `SessionResponsibilityBasisPort`; `sessions` never imports `tasks`.
 *
 * `transferSessionResponsibility` and `closeTerminalResponsibility` are public
 * GraphWrites (their `expected` stays inside the fingerprint); the archive
 * `disposeArchiveResponsibility` step derives its commit identity from the
 * immutable stored request (`deriveArchiveStepCommitIdentityV1`, §2.3), so a
 * crash that re-reads a newer revision cannot collide on idempotency.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkLinkTarget, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type {
  ArchiveTaskChoiceV1, ArchiveStepRefV1, SessionArchiveRequestV1,
} from '../../../contracts/core/session-archive.js';
import { deriveArchiveStepCommitIdentityV1 } from '../../../contracts/core/session-archive.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  CommitCursorBinding, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { GraphWrite } from '../model/session-contracts.js';
import type { SessionResponsibilityBasisPort, SessionResponsibilityBasisV1 } from '../model/session-facts-contracts.js';
import {
  checkPlainSessionRef, checkTarget, decodeSessionRecord, decodeSessionWorkLink,
  encodePendingSessionWorkLink, encodeSessionRecord, plainSessionRefToAggregate,
  sessionAggregateRefKey, sessionWorkLinkRefKey,
} from './session-record-codecs.js';
import {
  eventIdOf, fingerprintOf, identityKeyOf, ownRequest, trustedContext,
  type OwnedRequest, type TrustedContext,
} from './trusted-context.js';
import {
  SESSION_ARCHIVE_REQUESTED_EVENT, SESSION_RESPONSIBILITY_CHANGED_EVENT,
  encodeSessionResponsibilityChangedEvent, sessionArchiveChangedEventFromEvent,
  sessionResponsibilityChangedEventFromEvent, type SessionResponsibilityChangedEventV1,
} from './lifecycle-record-codecs.js';
import {
  transitionResponsibility, type PendingResponsibleLinkV1, type ResponsibilityGuardV1,
  type ResponsibilityStateV1,
} from '../state/session-responsibility.js';

export interface SessionResponsibilityPort {
  transferSessionResponsibility(ctx: CoreCallContext, request: GraphWrite<{
    from: SessionRef; to: SessionRef; target: WorkLinkTarget;
  }>): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>>;
  disposeArchiveResponsibility(ctx: CoreCallContext, step: ArchiveStepRefV1):
    Promise<WriteResult<{ closed: SessionWorkLink; opened: SessionWorkLink | null }>>;
  closeTerminalResponsibility(ctx: CoreCallContext, request: GraphWrite<{
    sessionRef: SessionRef; target: WorkLinkTarget;
  }>): Promise<WriteResult<SessionWorkLink>>;
}

export type SessionResponsibilityStores = {
  records: GoalRecordTransactionPort;
  lookups: RecordLookupPort;
  basis: SessionResponsibilityBasisPort;
  now(): string;
};

/** The shared map takes a version-pin `current`; a `unique_conflict` carries a claim slot instead. */
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  return sessionStoreFailureToRejection({
    code: failure.code,
    reason: failure.reason,
    ...(failure.code === 'revision_conflict' ? { current: failure.current } : {}),
  });
}
function mapReadFailure<T>(result: ReadResult<T>): CoreRejection {
  if (result.status === 'rejected') return result;
  if (result.status === 'not_found') return reject('not_found', 'the responsibility facts do not exist');
  return reject('unavailable', 'the responsibility facts are not ready at the requested read window');
}

function responsibleLinkRef(session: SessionRef, target: WorkLinkTarget) {
  return { ...session, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
}

function targetProblem(target: unknown, scope: WorkspaceScope): string | null {
  const problem = checkTarget(target);
  if (problem !== null) return problem;
  const value = target as WorkLinkTarget;
  if (value.ref.projectId !== scope.projectId) return 'the responsibility target belongs to another project';
  if (value.kind === 'work' && (value.ref as { workspaceId?: unknown }).workspaceId !== scope.workspaceId) {
    return 'the Work responsibility target belongs to another workspace';
  }
  return null;
}

/** §3.2 S1-LINK-01: the destination may not be retired, archived, archiving or a readonly copy. */
function destinationEligible(session: SessionRecord): boolean {
  if (session.lifecycle !== 'active') return false;
  if (session.health !== 'available') return false;
  if (session.archiveRequest !== undefined && session.archiveRequest !== null) return false;
  const provenance = session.provenance ?? null;
  return !(provenance !== null && provenance.kind === 'readonly_copy');
}

export function createSessionResponsibilityService(stores: SessionResponsibilityStores): SessionResponsibilityPort {
  const { records, basis, now } = stores;

  function linkAt(recordsIn: readonly { refKey: string; json: string }[], key: string): SessionWorkLink | null | CoreRejection {
    const found = recordsIn.find((entry) => entry.refKey === key);
    if (found === undefined) return null;
    const decoded = decodeSessionWorkLink(found as never);
    if (decoded.status !== 'decoded') return reject('unavailable', `the responsibility link is damaged: ${decoded.reason}`);
    return decoded.value;
  }

  function buildEvent(args: {
    scope: WorkspaceScope;
    mode: SessionResponsibilityChangedEventV1['mode'];
    source: SessionRecord;
    destination: SessionRecord | null;
    closed: PendingResponsibleLinkV1;
    opened: PendingResponsibleLinkV1 | null;
    openedBound: 'since' | null;
    archiveStep: ArchiveStepRefV1 | null;
    basis: SessionResponsibilityBasisV1;
    eventId: string;
  }): SessionResponsibilityChangedEventV1 {
    return {
      eventId: args.eventId,
      eventType: SESSION_RESPONSIBILITY_CHANGED_EVENT,
      schemaVersion: 1,
      occurredAt: now(),
      projectId: args.scope.projectId,
      workspaceId: args.scope.workspaceId,
      mode: args.mode,
      source: args.source,
      destination: args.destination,
      closed: args.closed,
      opened: args.opened,
      openedBound: args.openedBound,
      archiveStep: args.archiveStep,
      taskBasis: {
        task: args.basis.task,
        planRef: args.basis.planRef,
        terminalCause: args.basis.terminalCause,
        finishedAt: args.basis.finishedAt,
      },
    };
  }

  function writePrepared(args: {
    identityKey: string; fingerprint: string; eventId: string; event: SessionResponsibilityChangedEventV1;
    source: SessionRecord; destination: SessionRecord | null;
    closed: PendingResponsibleLinkV1; opened: PendingResponsibleLinkV1 | null; openedBound: 'since' | null;
    sourceKey: string; destinationKey: string | null; sourceLinkKey: string; destinationLinkKey: string | null;
    basisGuards: readonly RecordGuard[];
    expectedSource: number; expectedDestination: number | null;
    expectedSourceLink: number | null; expectedDestinationLink: number | null;
  }): PreparedCommit {
    const guards = new Map<string, RecordGuard>();
    for (const guard of args.basisGuards) guards.set(guard.refKey, guard);
    // A `0` pin means the caller read an absent link; the store's CAS spells
    // that `null`, never a revision the row never had.
    const cas = (revision: number | null): number | null => revision === null || revision === 0 ? null : revision;
    guards.set(args.sourceKey, { refKey: args.sourceKey, expectedRevision: cas(args.expectedSource) });
    guards.set(args.sourceLinkKey, { refKey: args.sourceLinkKey, expectedRevision: cas(args.expectedSourceLink) });
    if (args.destinationKey !== null) {
      guards.set(args.destinationKey, { refKey: args.destinationKey, expectedRevision: cas(args.expectedDestination) });
    }
    if (args.destinationLinkKey !== null) {
      guards.set(args.destinationLinkKey, { refKey: args.destinationLinkKey, expectedRevision: cas(args.expectedDestinationLink) });
    }
    const recordsToWrite: EncodedRecord[] = [encodeSessionRecord(args.source)];
    if (args.destination !== null) recordsToWrite.push(encodeSessionRecord(args.destination));
    recordsToWrite.push(encodePendingSessionWorkLink(args.closed));
    const bindings: CommitCursorBinding[] = [{ refKey: args.sourceLinkKey, field: 'until' }];
    if (args.opened !== null && args.openedBound === 'since' && args.destinationLinkKey !== null) {
      recordsToWrite.push(encodePendingSessionWorkLink(args.opened));
      bindings.push({ refKey: args.destinationLinkKey, field: 'since' });
    }
    return {
      identityKey: args.identityKey,
      fingerprint: args.fingerprint,
      guards: [...guards.values()],
      records: recordsToWrite,
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionResponsibilityChangedEvent(args.event)],
      commitCursorBindings: bindings,
    };
  }

  function boundClosed(closed: PendingResponsibleLinkV1, cursor: string): SessionWorkLink {
    return { ...closed, until: cursor } as SessionWorkLink;
  }
  function boundOpened(opened: PendingResponsibleLinkV1, openedBound: 'since' | null, cursor: string): SessionWorkLink {
    return (openedBound === 'since' ? { ...opened, since: cursor } : opened) as SessionWorkLink;
  }

  async function readEventResult(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    scope: WorkspaceScope,
    sourceKey: string,
  ): Promise<WriteResult<{ closed: SessionWorkLink; opened: SessionWorkLink | null }>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return reject('unavailable', 'the recorded responsibility receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(receipt.cursor)) {
      return reject('unavailable', 'the recorded responsibility cursor disagrees with the receipt');
    }
    const decoded = sessionResponsibilityChangedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the recorded responsibility event is not decodable: ${decoded.reason}`);
    }
    const event: SessionResponsibilityChangedEventV1 = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return reject('unavailable', 'the recorded responsibility event id disagrees with the receipt');
    if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
      return reject('unavailable', 'the recorded responsibility event belongs to another scope');
    }
    if (canonicalOf(event.source.ref) !== sourceKey) {
      return reject('unavailable', 'the recorded responsibility event belongs to another source Session');
    }
    const version = receipt.versions.find((entry) => entry.refKey === sourceKey);
    if (version === undefined || version.revision !== event.source.revision) {
      return reject('unavailable', 'the recorded responsibility event disagrees with the receipt source version');
    }
    return {
      status: 'committed', replayed: true, cursor: receipt.cursor,
      value: {
        closed: boundClosed(event.closed, receipt.cursor),
        opened: event.opened === null ? null : boundOpened(event.opened, event.openedBound, receipt.cursor),
      },
    };
  }

  // ------------------------------------------------------------------------
  // transferSessionResponsibility (public GraphWrite)
  // ------------------------------------------------------------------------

  async function readTransferResult(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    scope: WorkspaceScope,
    sourceKey: string,
  ): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>> {
    const restored = await readEventResult(receipt, scope, sourceKey);
    if (restored.status !== 'committed') return restored;
    if (restored.value.opened === null) {
      return reject('unavailable', 'the recorded transfer did not open a destination link');
    }
    return {
      status: 'committed', replayed: true, cursor: receipt.cursor,
      value: { from: restored.value.closed, to: restored.value.opened },
    };
  }

  async function transferSessionResponsibility(
    ctx: CoreCallContext,
    request: GraphWrite<{ from: SessionRef; to: SessionRef; target: WorkLinkTarget }>,
  ): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session responsibility call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the responsibility transfer was cancelled before validation');
    const owned: OwnedRequest<{ from: SessionRef; to: SessionRef; target: WorkLinkTarget }> =
      ownRequest(request, 'transferSessionResponsibility');
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', 'transferSessionResponsibility requires an input object');
    const fromProblem = checkPlainSessionRef(input.from);
    if (fromProblem !== null) return reject('invalid', `transfer from: ${fromProblem}`);
    const toProblem = checkPlainSessionRef(input.to);
    if (toProblem !== null) return reject('invalid', `transfer to: ${toProblem}`);
    if (input.from.projectId !== scope.projectId || input.to.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the transfer Sessions belong to another project');
    }
    const targetIssue = targetProblem(input.target, scope);
    if (targetIssue !== null) return reject('invalid', targetIssue);
    const fromKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.from));
    const toKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.to));
    const sourceLinkKey = sessionWorkLinkRefKey(responsibleLinkRef(input.from, input.target));
    const destinationLinkKey = sessionWorkLinkRefKey(responsibleLinkRef(input.to, input.target));
    const expected = normalizeFourPins(owned.expected, scope, {
      fromKey, toKey, sourceLinkKey, destinationLinkKey, from: input.from, to: input.to, target: input.target,
    });
    if (!expected.ok) return reject('invalid', expected.reason);
    const identityKey = identityKeyOf('session-responsibility-transfer:', actor, scope, owned.requestId);
    const fingerprint = fingerprintOf('session-responsibility-transfer-request', actor, scope, {
      from: input.from, to: input.to, target: input.target,
    }, owned.expected);
    if (ctx.signal?.aborted) return reject('cancelled', 'the responsibility transfer was cancelled before lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return readTransferResult(existing.value, scope, fromKey);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    const attempt = await runTransferAttempt({
      ctx, scope, input, expected, fromKey, toKey, sourceLinkKey, destinationLinkKey, identityKey, fingerprint,
    });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') return readTransferResult(again.value, scope, fromKey);
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return attempt;
  }

  type FourPins = {
    fromKey: string; toKey: string; sourceLinkKey: string; destinationLinkKey: string;
    from: SessionRef; to: SessionRef; target: WorkLinkTarget;
  };
  type ExpectedPins = {
    fromSession: VersionPin; toSession: VersionPin; sourceLink: VersionPin; destinationLink: VersionPin;
  };

  function normalizeFourPins(
    raw: readonly VersionPin[], scope: WorkspaceScope, refs: FourPins,
  ): { ok: true; value: ExpectedPins } | { ok: false; reason: string } {
    if (raw.length !== 4) {
      return { ok: false, reason: 'meta.expected must contain exactly the two Session and two SessionWorkLink pins' };
    }
    let fromSession: VersionPin | undefined;
    let toSession: VersionPin | undefined;
    let sourceLink: VersionPin | undefined;
    let destinationLink: VersionPin | undefined;
    const seen = new Set<string>();
    for (const entry of raw as readonly unknown[]) {
      if (!isObject(entry)) return { ok: false, reason: 'version pin must be an object' };
      const revision = entry['revision'];
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
        return { ok: false, reason: 'version pin revision must be a safe non-negative integer' };
      }
      const ref = entry['ref'];
      if (!isObject(ref)) return { ok: false, reason: 'version pin ref must be an object' };
      const key = canonicalOf(ref);
      if (key === null) return { ok: false, reason: 'version pin ref cannot be canonically encoded' };
      if (seen.has(key)) return { ok: false, reason: 'duplicate version pin' };
      seen.add(key);
      if (key === refs.fromKey) { fromSession = { ref: ref as VersionPin['ref'], revision }; continue; }
      if (key === refs.toKey) { toSession = { ref: ref as VersionPin['ref'], revision }; continue; }
      if (key === refs.sourceLinkKey) { sourceLink = { ref: ref as VersionPin['ref'], revision }; continue; }
      if (key === refs.destinationLinkKey) { destinationLink = { ref: ref as VersionPin['ref'], revision }; continue; }
      return { ok: false, reason: 'meta.expected pins a ref that is not one of the transfer records' };
    }
    if (fromSession === undefined || toSession === undefined || sourceLink === undefined || destinationLink === undefined) {
      return { ok: false, reason: 'meta.expected is missing a Session or SessionWorkLink pin' };
    }
    if (fromSession.ref.projectId !== scope.projectId || toSession.ref.projectId !== scope.projectId) {
      return { ok: false, reason: 'a Session pin belongs to another project' };
    }
    return { ok: true, value: { fromSession, toSession, sourceLink, destinationLink } };
  }

  async function runTransferAttempt(args: {
    ctx: CoreCallContext; scope: WorkspaceScope;
    input: { from: SessionRef; to: SessionRef; target: WorkLinkTarget };
    expected: { ok: true; value: ExpectedPins };
    fromKey: string; toKey: string; sourceLinkKey: string; destinationLinkKey: string;
    identityKey: string; fingerprint: string;
  }): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>> {
    const { ctx, scope, input, expected, fromKey, toKey, sourceLinkKey, destinationLinkKey, identityKey, fingerprint } = args;
    const pins = expected.value;
    const read = await records.readMany([fromKey, toKey, sourceLinkKey, destinationLinkKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const source = await sessionFromRead(read.value.records, fromKey, scope);
    if ('status' in source) return source;
    if (source.workspaceId !== scope.workspaceId) {
      return reject('forbidden', 'archive_scope: the source Session belongs to another workspace');
    }
    const destination = await sessionFromRead(read.value.records, toKey, scope);
    if ('status' in destination) return destination;
    const sourceLink = linkAt(read.value.records, sourceLinkKey);
    if (sourceLink !== null && 'status' in sourceLink) return sourceLink;
    const destinationLink = linkAt(read.value.records, destinationLinkKey);
    if (destinationLink !== null && 'status' in destinationLink) return destinationLink;
    const pinsMatch = source.revision === pins.fromSession.revision
      && destination.revision === pins.toSession.revision
      && (sourceLink?.revision ?? 0) === pins.sourceLink.revision
      && (destinationLink?.revision ?? 0) === pins.destinationLink.revision;
    // §3.4: a pin mismatch is `revision_conflict` whose `current` names the real
    // conflicting records, not the caller's stale expectation.
    const conflictingPins: VersionPin[] = [];
    if (source.revision !== pins.fromSession.revision) {
      conflictingPins.push({ ref: source.ref, revision: source.revision });
    }
    if (destination.revision !== pins.toSession.revision) {
      conflictingPins.push({ ref: destination.ref, revision: destination.revision });
    }
    if ((sourceLink?.revision ?? 0) !== pins.sourceLink.revision) {
      conflictingPins.push({ ref: sourceLink?.ref ?? pins.sourceLink.ref, revision: sourceLink?.revision ?? 0 });
    }
    if ((destinationLink?.revision ?? 0) !== pins.destinationLink.revision) {
      conflictingPins.push({ ref: destinationLink?.ref ?? pins.destinationLink.ref, revision: destinationLink?.revision ?? 0 });
    }
    const state: ResponsibilityStateV1 = {
      source, destination, sourceLink: sourceLink ?? null, destinationLink: destinationLink ?? null,
    };
    // §3.4 S:612: both Sessions' scope/lifecycle precede the open link and its
    // pin; the destination's eligibility (retired/archived/archiving/copy) is
    // part of that check, so it must be decided before the Task basis read.
    // `writerStopped` is the only fact still assumed at this pre-check (the Task
    // proof and the stopped writer are read together below); a pin mismatch is
    // `revision_conflict` even while the old writer still runs.
    const preGuard: ResponsibilityGuardV1 = {
      sameScope: destination.workspaceId === scope.workspaceId,
      targetValid: true, taskTerminal: false, writerStopped: true,
      destinationEligible: destinationEligible(destination), pinsMatch,
    };
    const preVerdict = transitionResponsibility(state, { kind: 'responsibility_transferred', to: input.to }, preGuard);
    if (!preVerdict.ok) {
      if (preVerdict.code === 'revision_conflict' && conflictingPins.length > 0) {
        return reject('revision_conflict', preVerdict.detail, conflictingPins);
      }
      return reject(preVerdict.code, preVerdict.detail);
    }
    const basisResult = await basis.readResponsibilityBasis(ctx, { sessionRef: input.from, target: input.target });
    if (basisResult.status !== 'ready') return mapReadFailure(basisResult);
    const proof = basisResult.value;
    if (proof.task.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the responsibility Task belongs to another project');
    }
    const guard: ResponsibilityGuardV1 = {
      sameScope: destination.workspaceId === scope.workspaceId,
      targetValid: true,
      taskTerminal: proof.terminal,
      writerStopped: proof.writerStopped,
      destinationEligible: destinationEligible(destination),
      pinsMatch,
    };
    const verdict = transitionResponsibility(state, { kind: 'responsibility_transferred', to: input.to }, guard);
    if (!verdict.ok) {
      if (verdict.code === 'revision_conflict' && conflictingPins.length > 0) {
        return reject('revision_conflict', verdict.detail, conflictingPins);
      }
      return reject(verdict.code, verdict.detail);
    }
    const effect = verdict.effects.find((entry) => entry.kind === 'write_responsibility');
    if (effect === undefined || effect.kind !== 'write_responsibility') {
      throw new Error('a transfer must write the responsibility links');
    }
    const event = buildEvent({
      scope, mode: 'transfer', source: effect.source, destination: effect.destination,
      closed: effect.closed, opened: effect.opened, openedBound: effect.openedBound,
      archiveStep: null, basis: proof, eventId: eventIdOf(identityKey, 'responsibility'),
    });
    const prepared = writePrepared({
      identityKey, fingerprint, eventId: event.eventId, event,
      source: effect.source, destination: effect.destination, closed: effect.closed,
      opened: effect.opened, openedBound: effect.openedBound,
      sourceKey: fromKey, destinationKey: toKey, sourceLinkKey, destinationLinkKey,
      basisGuards: proof.guards,
      expectedSource: pins.fromSession.revision, expectedDestination: pins.toSession.revision,
      expectedSourceLink: pins.sourceLink.revision, expectedDestinationLink: pins.destinationLink.revision,
    });
    if (ctx.signal?.aborted) return reject('cancelled', 'the responsibility transfer was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', 'the responsibility transfer commit failed before completing');
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) return readTransferResult(committed, scope, fromKey);
    return {
      status: 'committed', replayed: false, cursor: committed.cursor,
      value: {
        from: boundClosed(effect.closed, committed.cursor),
        to: boundOpened(effect.opened as PendingResponsibleLinkV1, effect.openedBound, committed.cursor),
      },
    };
  }

  async function sessionFromRead(
    entries: readonly { refKey: string; json: string }[], key: string, scope: WorkspaceScope,
  ): Promise<SessionRecord | CoreRejection> {
    const record = entries.find((entry) => entry.refKey === key);
    if (record === undefined) return reject('not_found', 'the Session does not exist');
    const decoded = decodeSessionRecord(record as never);
    if (decoded.status !== 'decoded') return reject('unavailable', `the Session is damaged: ${decoded.reason}`);
    // The project is always the bound one; a different workspace is not refused
    // here. A transfer destination in another workspace must reach the machine's
    // `sameScope` guard so the refusal is `forbidden` / `archive_scope:` (SV47).
    if (decoded.value.ref.projectId !== scope.projectId) {
      return reject('not_found', 'the Session belongs to another project');
    }
    return decoded.value;
  }

  // ------------------------------------------------------------------------
  // disposeArchiveResponsibility (internal archive step)
  // ------------------------------------------------------------------------

  async function loadArchiveRequest(step: ArchiveStepRefV1, scope: WorkspaceScope):
  Promise<SessionArchiveRequestV1 | CoreRejection> {
    const found = await records.lookupCommit({
      identityKey: step.requestReceipt.identityKey, fingerprint: step.requestReceipt.fingerprint,
    });
    if (found.status !== 'ready') {
      if (found.code === 'not_found') return reject('not_found', 'the archive request receipt was not found');
      return mapStoreFailure(found);
    }
    const at = await records.eventAt(found.value.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(found.value.cursor)) {
      return reject('unavailable', 'the archive request cursor disagrees with its receipt');
    }
    const decoded = sessionArchiveChangedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') return reject('unavailable', `the archive request event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.eventType !== SESSION_ARCHIVE_REQUESTED_EVENT) return reject('unavailable', 'the recorded archive event is not a request');
    if (event.archiveRequestId !== step.archiveRequestId) return reject('unavailable', 'the archive step names another request');
    if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
      return reject('unavailable', 'the archive request event belongs to another scope');
    }
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(step.sessionRef));
    if (canonicalOf(event.session.ref) !== sessionKey) {
      return reject('unavailable', 'the archive request event belongs to another Session');
    }
    const request = event.session.archiveRequest;
    if (request === null || request === undefined) return reject('unavailable', 'the archive request event carries no request');
    if (canonicalOf(request.receipt) !== canonicalOf(step.requestReceipt)) {
      return reject('unavailable', 'the archive step receipt disagrees with the stored request');
    }
    return request;
  }

  async function disposeArchiveResponsibility(
    ctx: CoreCallContext,
    step: ArchiveStepRefV1,
  ): Promise<WriteResult<{ closed: SessionWorkLink; opened: SessionWorkLink | null }>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session responsibility call');
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the responsibility disposal was cancelled before validation');
    let ownedStep: ArchiveStepRefV1;
    try {
      ownedStep = structuredClone(step);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return reject('invalid', `the archive step cannot be isolated from the caller: ${detail}`);
    }
    if (!isObject(ownedStep)) return reject('invalid', 'disposeArchiveResponsibility requires an ArchiveStepRefV1');
    const refProblem = checkPlainSessionRef(ownedStep.sessionRef);
    if (refProblem !== null) return reject('invalid', refProblem);
    if (ownedStep.sessionRef.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the Session belongs to another project');
    }
    if (!nonEmpty(ownedStep.archiveRequestId) || !nonEmpty(ownedStep.subjectKey)) {
      return reject('invalid', 'disposeArchiveResponsibility requires archiveRequestId and subjectKey');
    }
    if (ownedStep.step !== 'responsibility') {
      return reject('unsupported', `the responsibility owner does not perform the ${String(ownedStep.step)} archive step`);
    }
    const request = await loadArchiveRequest(ownedStep, scope);
    if ('status' in request) return request;
    const choice = request.tasks.find((entry) => canonicalOf(entry.target) === ownedStep.subjectKey);
    if (choice === undefined) {
      return reject('invalid', 'archive_disposal_required: the archive request has no choice for this responsibility target');
    }
    let identity: { identityKey: string; fingerprint: string; eventId: string };
    try {
      identity = deriveArchiveStepCommitIdentityV1(scope, request, ownedStep);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return reject('invalid', `the archive step does not belong to its request: ${detail}`);
    }
    const existing = await records.lookupCommit({ identityKey: identity.identityKey, fingerprint: identity.fingerprint });
    if (existing.status === 'ready') return readEventResult(existing.value, scope, sessionAggregateRefKey(plainSessionRefToAggregate(ownedStep.sessionRef)));
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    const attempt = await runDisposeAttempt({ ctx, scope, step: ownedStep, request, choice, identity });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const again = await records.lookupCommit({ identityKey: identity.identityKey, fingerprint: identity.fingerprint });
    if (again.status === 'ready') return readEventResult(again.value, scope, sessionAggregateRefKey(plainSessionRefToAggregate(ownedStep.sessionRef)));
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return attempt;
  }

  async function runDisposeAttempt(args: {
    ctx: CoreCallContext; scope: WorkspaceScope; step: ArchiveStepRefV1; request: SessionArchiveRequestV1;
    choice: ArchiveTaskChoiceV1; identity: { identityKey: string; fingerprint: string; eventId: string };
  }): Promise<WriteResult<{ closed: SessionWorkLink; opened: SessionWorkLink | null }>> {
    const { ctx, scope, step, choice, request, identity } = args;
    const target = choice.target;
    const fromKey = sessionAggregateRefKey(plainSessionRefToAggregate(step.sessionRef));
    const sourceLinkKey = sessionWorkLinkRefKey(responsibleLinkRef(step.sessionRef, target));
    const transfer = choice.disposition.kind === 'transfer' ? choice.disposition.to : null;
    const toKey = transfer === null ? null : sessionAggregateRefKey(plainSessionRefToAggregate(transfer));
    const destinationLinkKey = transfer === null ? null : sessionWorkLinkRefKey(responsibleLinkRef(transfer, target));
    const refs = [fromKey, sourceLinkKey, ...(toKey === null ? [] : [toKey]), ...(destinationLinkKey === null ? [] : [destinationLinkKey])];
    const read = await records.readMany(refs);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const source = await sessionFromRead(read.value.records, fromKey, scope);
    if ('status' in source) return source;
    // §4.1 step 8 / D10: a receipt replay is handled above; a NEW commit is only
    // legal while the Session still holds this exact immutable request. A
    // released or replaced R refuses the step without writing anything.
    const currentRequest = source.archiveRequest ?? null;
    if (currentRequest === null || currentRequest.requestId !== request.requestId
      || canonicalOf(currentRequest.receipt) !== canonicalOf(request.receipt)) {
      return reject('invalid',
        'archive_disposal_required: the current Session no longer holds the archive request this step belongs to');
    }
    const sourceLink = linkAt(read.value.records, sourceLinkKey);
    if (sourceLink !== null && 'status' in sourceLink) return sourceLink;
    let destination: SessionRecord | null = null;
    let destinationLink: SessionWorkLink | null = null;
    if (toKey !== null && destinationLinkKey !== null) {
      const to = await sessionFromRead(read.value.records, toKey, scope);
      if ('status' in to) return to;
      destination = to;
      const link = linkAt(read.value.records, destinationLinkKey);
      if (link !== null && 'status' in link) return link;
      destinationLink = link;
    }
    const basisResult = await basis.readResponsibilityBasis(ctx, { sessionRef: step.sessionRef, target });
    if (basisResult.status !== 'ready') return mapReadFailure(basisResult);
    const proof = basisResult.value;
    if (proof.task.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the responsibility Task belongs to another project');
    }
    const guard: ResponsibilityGuardV1 = {
      sameScope: destination === null || destination.workspaceId === scope.workspaceId,
      targetValid: true,
      taskTerminal: proof.terminal,
      writerStopped: proof.writerStopped,
      destinationEligible: destination === null || destinationEligible(destination),
      pinsMatch: true,
    };
    const state: ResponsibilityStateV1 = { source, destination, sourceLink, destinationLink };
    const event = transfer === null
      ? { kind: 'responsibility_released' as const, mode: 'drop' as const }
      : { kind: 'responsibility_transferred' as const, to: transfer };
    const verdict = transitionResponsibility(state, event, guard);
    if (!verdict.ok) return reject(verdict.code, verdict.detail);
    const effect = verdict.effects.find((entry) => entry.kind === 'write_responsibility');
    if (effect === undefined || effect.kind !== 'write_responsibility') {
      throw new Error('a responsibility disposal must write the responsibility links');
    }
    const mode: SessionResponsibilityChangedEventV1['mode'] = transfer === null ? 'drop' : 'transfer';
    const responsibilityEvent = buildEvent({
      scope, mode, source: effect.source, destination: effect.destination,
      closed: effect.closed, opened: effect.opened, openedBound: effect.openedBound,
      archiveStep: step, basis: proof, eventId: identity.eventId,
    });
    const prepared = writePrepared({
      identityKey: identity.identityKey, fingerprint: identity.fingerprint, eventId: identity.eventId,
      event: responsibilityEvent, source: effect.source, destination: effect.destination,
      closed: effect.closed, opened: effect.opened, openedBound: effect.openedBound,
      sourceKey: fromKey, destinationKey: toKey, sourceLinkKey, destinationLinkKey,
      basisGuards: proof.guards,
      expectedSource: source.revision, expectedDestination: destination?.revision ?? null,
      expectedSourceLink: sourceLink?.revision ?? null, expectedDestinationLink: destinationLink?.revision ?? null,
    });
    if (ctx.signal?.aborted) return reject('cancelled', 'the responsibility disposal was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', 'the responsibility disposal commit failed before completing');
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) return readEventResult(committed, scope, fromKey);
    return {
      status: 'committed', replayed: false, cursor: committed.cursor,
      value: {
        closed: boundClosed(effect.closed, committed.cursor),
        opened: effect.opened === null ? null : boundOpened(effect.opened, effect.openedBound, committed.cursor),
      },
    };
  }

  // ------------------------------------------------------------------------
  // closeTerminalResponsibility (public GraphWrite)
  // ------------------------------------------------------------------------

  async function closeTerminalResponsibility(
    ctx: CoreCallContext,
    request: GraphWrite<{ sessionRef: SessionRef; target: WorkLinkTarget }>,
  ): Promise<WriteResult<SessionWorkLink>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session responsibility call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the terminal responsibility close was cancelled before validation');
    const owned = ownRequest(request, 'closeTerminalResponsibility');
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', 'closeTerminalResponsibility requires an input object');
    const refProblem = checkPlainSessionRef(input.sessionRef);
    if (refProblem !== null) return reject('invalid', refProblem);
    if (input.sessionRef.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the Session belongs to another project');
    }
    const targetIssue = targetProblem(input.target, scope);
    if (targetIssue !== null) return reject('invalid', targetIssue);
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const linkKey = sessionWorkLinkRefKey(responsibleLinkRef(input.sessionRef, input.target));
    const expected = normalizeClosePins(owned.expected, sessionKey, linkKey);
    if (!expected.ok) return reject('invalid', expected.reason);
    const identityKey = identityKeyOf('session-responsibility-terminal:', actor, scope, owned.requestId);
    const fingerprint = fingerprintOf('session-responsibility-terminal-request', actor, scope, {
      sessionRef: input.sessionRef, target: input.target,
    }, owned.expected);
    if (ctx.signal?.aborted) return reject('cancelled', 'the terminal responsibility close was cancelled before lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') {
      const restored = await readEventResult(existing.value, scope, sessionKey);
      if (restored.status !== 'committed') return restored;
      return { status: 'committed', value: restored.value.closed, replayed: true, cursor: existing.value.cursor };
    }
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    const attempt = await runTerminalAttempt({ ctx, scope, input, sessionKey, linkKey, expected, identityKey, fingerprint });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') {
      const restored = await readEventResult(again.value, scope, sessionKey);
      if (restored.status !== 'committed') return restored;
      return { status: 'committed', value: restored.value.closed, replayed: true, cursor: again.value.cursor };
    }
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return attempt;
  }

  function normalizeClosePins(
    raw: readonly VersionPin[], sessionKey: string, linkKey: string,
  ): { ok: true; session: VersionPin; link: VersionPin } | { ok: false; reason: string } {
    if (!Array.isArray(raw)) return { ok: false, reason: 'meta.expected must be an array of version pins' };
    let session: VersionPin | undefined;
    let link: VersionPin | undefined;
    for (const entry of raw as readonly unknown[]) {
      if (!isObject(entry)) return { ok: false, reason: 'version pin must be an object' };
      const revision = entry['revision'];
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
        return { ok: false, reason: 'version pin revision must be a safe non-negative integer' };
      }
      const ref = entry['ref'];
      if (!isObject(ref)) return { ok: false, reason: 'version pin ref must be an object' };
      const key = canonicalOf(ref);
      if (key === sessionKey) session = { ref: ref as VersionPin['ref'], revision };
      else if (key === linkKey) link = { ref: ref as VersionPin['ref'], revision };
    }
    if (session === undefined) return { ok: false, reason: 'meta.expected is missing the Session pin' };
    if (link === undefined) return { ok: false, reason: 'meta.expected is missing the SessionWorkLink pin' };
    return { ok: true, session, link };
  }

  async function runTerminalAttempt(args: {
    ctx: CoreCallContext; scope: WorkspaceScope; input: { sessionRef: SessionRef; target: WorkLinkTarget };
    sessionKey: string; linkKey: string;
    expected: { ok: true; session: VersionPin; link: VersionPin };
    identityKey: string; fingerprint: string;
  }): Promise<WriteResult<SessionWorkLink>> {
    const { ctx, scope, input, sessionKey, linkKey, expected, identityKey, fingerprint } = args;
    const read = await records.readMany([sessionKey, linkKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const source = await sessionFromRead(read.value.records, sessionKey, scope);
    if ('status' in source) return source;
    // A9/§3.4 S:612: the source Session's workspace is part of the leading
    // scope/lifecycle check. `sessionFromRead` deliberately checks only the
    // project, so the terminal close makes the workspace explicit here instead
    // of passing `sameScope: true` unconditionally.
    if (source.workspaceId !== scope.workspaceId) {
      return reject('forbidden', 'archive_scope: the source Session belongs to another workspace');
    }
    const sourceLink = linkAt(read.value.records, linkKey);
    if (sourceLink !== null && 'status' in sourceLink) return sourceLink;
    const pinsMatch = source.revision === expected.session.revision
      && (sourceLink?.revision ?? 0) === expected.link.revision;
    const conflictingPins: VersionPin[] = [];
    if (source.revision !== expected.session.revision) {
      conflictingPins.push({ ref: source.ref, revision: source.revision });
    }
    if ((sourceLink?.revision ?? 0) !== expected.link.revision) {
      conflictingPins.push({ ref: sourceLink?.ref ?? expected.link.ref, revision: sourceLink?.revision ?? 0 });
    }
    const state: ResponsibilityStateV1 = { source, destination: null, sourceLink, destinationLink: null };
    // §3.4 S:612: the open link and its pin precede the Task/terminal proof and
    // the writer-stopped read; a pin mismatch is `revision_conflict` even while
    // the old writer still runs (the proofs are assumed only for this pre-check).
    const preGuard: ResponsibilityGuardV1 = {
      sameScope: source.workspaceId === scope.workspaceId, targetValid: true, taskTerminal: true,
      writerStopped: true, destinationEligible: true, pinsMatch,
    };
    const preVerdict = transitionResponsibility(state, { kind: 'responsibility_released', mode: 'terminal' }, preGuard);
    if (!preVerdict.ok) {
      if (preVerdict.code === 'revision_conflict' && conflictingPins.length > 0) {
        return reject('revision_conflict', preVerdict.detail, conflictingPins);
      }
      return reject(preVerdict.code, preVerdict.detail);
    }
    const basisResult = await basis.readResponsibilityBasis(ctx, { sessionRef: input.sessionRef, target: input.target });
    if (basisResult.status !== 'ready') return mapReadFailure(basisResult);
    const proof = basisResult.value;
    if (proof.task.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the responsibility Task belongs to another project');
    }
    const guard: ResponsibilityGuardV1 = {
      sameScope: source.workspaceId === scope.workspaceId, targetValid: true,
      taskTerminal: proof.terminal, writerStopped: proof.writerStopped,
      destinationEligible: true,
      pinsMatch,
    };
    const verdict = transitionResponsibility(state, { kind: 'responsibility_released', mode: 'terminal' }, guard);
    if (!verdict.ok) {
      if (verdict.code === 'revision_conflict' && conflictingPins.length > 0) {
        return reject('revision_conflict', verdict.detail, conflictingPins);
      }
      return reject(verdict.code, verdict.detail);
    }
    const effect = verdict.effects.find((entry) => entry.kind === 'write_responsibility');
    if (effect === undefined || effect.kind !== 'write_responsibility') {
      throw new Error('a terminal close must write the responsibility link');
    }
    const event = buildEvent({
      scope, mode: 'terminal', source: effect.source, destination: null,
      closed: effect.closed, opened: null, openedBound: null, archiveStep: null, basis: proof,
      eventId: eventIdOf(identityKey, 'responsibility'),
    });
    const prepared = writePrepared({
      identityKey, fingerprint, eventId: event.eventId, event,
      source: effect.source, destination: null, closed: effect.closed, opened: null, openedBound: null,
      sourceKey: sessionKey, destinationKey: null, sourceLinkKey: linkKey, destinationLinkKey: null,
      basisGuards: proof.guards,
      expectedSource: expected.session.revision, expectedDestination: null,
      expectedSourceLink: expected.link.revision, expectedDestinationLink: null,
    });
    if (ctx.signal?.aborted) return reject('cancelled', 'the terminal responsibility close was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', 'the terminal responsibility close commit failed before completing');
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) {
      const restored = await readEventResult(committed, scope, sessionKey);
      if (restored.status !== 'committed') return restored;
      return { status: 'committed', value: restored.value.closed, replayed: true, cursor: committed.cursor };
    }
    return { status: 'committed', value: boundClosed(effect.closed, committed.cursor), replayed: false, cursor: committed.cursor };
  }

  return {
    transferSessionResponsibility,
    disposeArchiveResponsibility,
    closeTerminalResponsibility,
  };
}
