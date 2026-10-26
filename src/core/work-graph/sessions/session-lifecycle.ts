/**
 * A1 Session lifecycle service.
 *
 * `linkSessionWork` is the later writer of `SessionWorkLink`; the initial
 * registration in `session-directory` is an equally legitimate writer and both
 * share the same link ref, CAS and validation rules. A link change performs an
 * exact CAS on the Session record AND the link record so that a claim, archive
 * or competing link only commits once; the Session revision also advances. A new
 * link guards `expected=null` (public pin revision 0), an existing link guards
 * the current revision. `meta.expected` keeps the existing CommandMeta shape:
 * exactly one exact Session pin plus one exact link pin, or one Session pin for
 * archive/reactivate.
 *
 * A module target is validated through `readCatalogModuleFacts`; a Task target
 * through the real Goal/active Plan membership (the one shared
 * `session-targets.ts` helper); WorkContext stays `unsupported`. Closing an
 * existing link (`active=false`) does not re-require the target to be present.
 * The bound field of the link record is filled by the existing
 * `commitCursorBindings` mechanism from the real commit cursor, never guessed.
 *
 * `archiveSession` requires no occupancy and no still-effective responsible
 * Task/Work obligation; module relations are kept because they are lookup
 * history rather than unfinished work. It never modifies the Kernel or cancels
 * a running execution. `reactivateSession` only changes lifecycle/archivedAt;
 * it does not touch health/history and does not start a model.
 *
 * A repeat request restores the ORIGINAL event/receipt, never the current
 * lifecycle or a re-derived cursor. Unknown, corrupt and absent records are
 * distinguished.
 *
 * After the receipt lookup every write is decided by the pure Session machine
 * (`state/session-availability.ts`, STATE-MACHINES-SPEC §8 SES-11, SES-14,
 * SES-15, SES-16): its guards, including which open links block an archive,
 * the link field the commit cursor fills and the event; lifecycle and
 * archivedAt come only from its record constructors (§14.1). The caller's
 * Session pin is not given to the machine: it stays the commit's CAS guard, so
 * a stale pin is still the store's `revision_conflict` with `current` (§8.4).
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  SessionRef, SessionWorkLinkRef, VersionPin, WorkspaceScope, WorkLinkRelation, WorkLinkTarget,
} from '../../../contracts/core/identity.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type {
  ArchiveExecutionV1, ArchiveStepRefV1, ArchiveWaitChoiceV1,
  RequestSessionArchiveInput, SessionArchiveRequestV1,
} from '../../../contracts/core/session-archive.js';
import { deriveArchiveStepCommitIdentityV1 } from '../../../contracts/core/session-archive.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { hasOnlyKeys, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure, UniqueClaimChange,
} from '../../record-store/ports.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type {
  ConditionCheckV1, SecretaryArchiveConditionCommitV1, SecretaryArchiveConditionPort,
} from '../model/secretary-lifecycle-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type {
  ArchiveSessionInput, LinkSessionWorkInput, SessionLifecyclePort,
  SessionLifecycleStores,
} from './lifecycle-contracts.js';
import {
  checkPlainSessionRef, checkSessionArchiveRequest, checkTarget, decodeSessionRecord,
  decodeSessionWorkLink, encodePendingSessionWorkLink, encodeSessionRecord,
  plainSessionRefToAggregate, sessionAggregateRefKey, sessionWorkLinkRefKey,
  type PendingSessionWorkLink,
} from './session-record-codecs.js';
import {
  SESSION_ARCHIVED_EVENT, SESSION_ARCHIVE_REQUESTED_EVENT, SESSION_ARCHIVE_REQUEST_RELEASED_EVENT,
  SESSION_REACTIVATED_EVENT, SESSION_WORK_LINK_CHANGED_EVENT,
  encodeSessionArchiveChangedEvent, encodeSessionLifecycleChangedEvent, encodeSessionWorkLinkChangedEvent,
  sessionArchiveChangedEventFromEvent, sessionLifecycleChangedPayloadFromEvent, sessionWorkLinkChangedPayloadFromEvent,
  type SessionArchiveChangedEventV1, type SessionLifecycleChangedEventV1, type SessionWorkLinkChangedEventV1,
} from './lifecycle-record-codecs.js';
import { validateWorkLinkTarget } from './session-targets.js';
import { readSessionWorkLinks } from './session-links.js';
import {
  eventIdOf, fingerprintOf, identityKeyOf, ownRequest, trustedContext,
  type HostActor, type OwnedRequest, type TrustedContext,
} from './trusted-context.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { decodeControlIntentSnapshot } from '../persistence/control-record-codecs.js';
import {
  archiveSessionRecord, openResponsibleLinkOf, reactivateSessionRecord, releaseSessionArchiveRequestRecord,
  requestSessionArchiveRecord, sessionMachineStateOf, transitionSession,
  type SessionDomainEventType, type SessionEffect, type SessionEvent, type SessionGuardContext, type SessionTransition,
} from '../state/session-availability.js';

// --------------------------------------------------------------------------
// Preamble helpers
// --------------------------------------------------------------------------

/** The shared map takes a version-pin `current`; a `unique_conflict` carries a claim slot instead. */
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  return sessionStoreFailureToRejection({
    code: failure.code,
    reason: failure.reason,
    ...(failure.code === 'revision_conflict' ? { current: failure.current } : {}),
  });
}

/** A6: the complete RunRef the wait choice requires, before any store read. */
function waitRunRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'the wait Run ref must be a complete RunRef';
  }
  return null;
}
/**
 * A Session reference as it arrives on the archive ports. The plain
 * `SessionRef` shape and a full `SessionAggregateRef` (which additionally
 * carries `aggregateType: 'Session'`) both name the same Session; the owner
 * normalizes to the plain `{projectId,sessionId}` so the identity, fingerprint
 * and stored records never depend on which one the caller held. A ref that
 * lacks either id, or names another aggregate type, is refused.
 */
function normalizeSessionRef(value: unknown): { ok: true; ref: SessionRef } | { ok: false; reason: string } {
  if (!isObject(value)) return { ok: false, reason: 'sessionRef must be an object' };
  if (value['aggregateType'] !== undefined && value['aggregateType'] !== 'Session') {
    return { ok: false, reason: 'sessionRef aggregateType must be Session' };
  }
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return { ok: false, reason: 'sessionRef requires projectId and sessionId' };
  }
  return { ok: true, ref: { projectId: value['projectId'], sessionId: value['sessionId'] } };
}
function relation(value: unknown): value is WorkLinkRelation {
  return value === 'responsible' || value === 'participates' || value === 'investigated';
}

type ExpectedOutcome =
  | { ok: true; session: VersionPin; link?: VersionPin }
  | { ok: false; reason: string };

function normalizeExpected(
  raw: readonly VersionPin[],
  scope: WorkspaceScope,
  sessionRef: SessionRef,
  linkRef: SessionWorkLinkRef | null,
): ExpectedOutcome {
  if (raw.length !== (linkRef === null ? 1 : 2)) {
    return { ok: false, reason: linkRef === null
      ? 'meta.expected must contain exactly the Session pin'
      : 'meta.expected must contain exactly the Session and SessionWorkLink pins' };
  }
  const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
  const linkKey = linkRef === null ? null : sessionWorkLinkRefKey(linkRef);
  let session: VersionPin | undefined;
  let link: VersionPin | undefined;
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
    if (key === sessionKey) { session = { ref: ref as VersionPin['ref'], revision }; continue; }
    if (linkKey !== null && key === linkKey) { link = { ref: ref as VersionPin['ref'], revision }; continue; }
    return { ok: false, reason: 'meta.expected pins a ref that is not this Session or SessionWorkLink' };
  }
  if (session === undefined) return { ok: false, reason: 'meta.expected is missing the Session pin' };
  if (linkKey !== null && link === undefined) return { ok: false, reason: 'meta.expected is missing the SessionWorkLink pin' };
  if ((session.ref as unknown as { projectId?: unknown }).projectId !== scope.projectId) {
    return { ok: false, reason: 'the Session pin belongs to another project' };
  }
  return link === undefined ? { ok: true, session } : { ok: true, session, link };
}

// --------------------------------------------------------------------------
// Link reading (archive guard)
// --------------------------------------------------------------------------

type LinkRead = { ok: true; links: SessionWorkLink[] } | { ok: false; rejection: CoreRejection };

// --------------------------------------------------------------------------
// Session machine calls
// --------------------------------------------------------------------------

/** The machine on a lifecycle or link event of `session` (null = absent), without the Session pin. */
function decide(
  session: SessionRecord | null,
  event: SessionEvent,
  facts: Partial<Pick<SessionGuardContext, 'openResponsibleLink' | 'link' | 'archive' | 'dispatch'>> = {},
): SessionTransition {
  return transitionSession(sessionMachineStateOf(session), event, {
    caller: 'service', hostLease: null, pin: null, holder: null, probe: null, kernelHeader: null,
    openResponsibleLink: null, creation: null, link: null, ...facts,
  });
}

/** The read target Session; absent is the machine's §8.4 `not_found`, damaged or another scope is refused here. */
function targetSession(found: EncodedRecord | undefined, scope: WorkspaceScope, event: SessionEvent): SessionRecord | CoreRejection {
  if (found === undefined) {
    const absent = decide(null, event);
    if (absent.ok) throw new Error(`the Session machine accepted ${event.kind} on an absent Session`);
    return reject(absent.code, absent.detail);
  }
  const decoded = decodeSessionRecord(found);
  if (decoded.status !== 'decoded') return reject('unavailable', `the target Session is damaged: ${decoded.reason}`);
  if (decoded.value.ref.projectId !== scope.projectId || decoded.value.workspaceId !== scope.workspaceId) {
    return reject('not_found', 'the target Session belongs to another project or workspace');
  }
  return decoded.value;
}

/**
 * The one translation of accepted effects (§8.2): the next Session record from
 * its state/ constructor (a link change only bumps the revision) and the link
 * field the commit cursor fills; the machine must name this write's event.
 */
function sessionWrite(
  session: SessionRecord,
  effects: readonly SessionEffect[],
  eventType: SessionDomainEventType,
): { session: SessionRecord; bound: 'since' | 'until' | null } {
  let next: SessionRecord | null = null;
  let bound: 'since' | 'until' | null = null;
  let emits = false;
  for (const effect of effects) {
    switch (effect.kind) {
      case 'archive_session':
        next = archiveSessionRecord(session, new Date().toISOString());
        break;
      case 'reactivate_session':
        next = reactivateSessionRecord(session);
        break;
      case 'bump_session_revision':
        next = { ...session, revision: session.revision + 1 };
        break;
      case 'write_work_link':
        bound = effect.bound;
        break;
      case 'emit_event':
        emits = effect.eventType === eventType;
        break;
      default:
        throw new Error(`a Session lifecycle or link write has no ${effect.kind} effect`);
    }
  }
  if (next === null || !emits) throw new Error(`an accepted Session write writes the Session and emits ${eventType}`);
  return { session: next, bound };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

/**
 * The archive condition port is optional in the factory's type: a composition that archives no conditioned line
 * may leave it out, and a conditioned archive then fails `unavailable` instead of committing without its
 * condition. The composition root passes the handoff facts' `checkArchiveCondition` straight in.
 */
export type SessionLifecycleServiceStores = SessionLifecycleStores & {
  archiveCondition?: SecretaryArchiveConditionPort | null;
};

export function createSessionLifecycleService(stores: SessionLifecycleServiceStores): SessionLifecyclePort {
  const records: GoalRecordTransactionPort = stores.records;
  const lookups: RecordLookupPort = stores.lookups;
  // Slice 1 §3.3: the injected Session facts port the archive entries use.
  const sessionFacts = stores.sessionFacts;

  async function readSessionLinks(projectId: string, sessionId: string): Promise<LinkRead> {
    const read = await readSessionWorkLinks(lookups, projectId, sessionId);
    return read.ok ? { ok: true, links: read.links } : read;
  }

  // ------------------------------------------------------------------------
  // linkSessionWork
  // ------------------------------------------------------------------------

  async function readLinkReplay(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    scope: WorkspaceScope,
    input: LinkSessionWorkInput,
    linkRef: SessionWorkLinkRef,
  ): Promise<WriteResult<SessionWorkLink>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return reject('unavailable', 'the recorded link receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(receipt.cursor)) {
      return reject('unavailable', 'the recorded link event cursor disagrees with the receipt');
    }
    const decoded = sessionWorkLinkChangedPayloadFromEvent(at.value.event);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the recorded link event is not decodable: ${decoded.reason}`);
    }
    const event: SessionWorkLinkChangedEventV1 = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return reject('unavailable', 'the recorded link event id disagrees with the receipt');
    if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
      return reject('unavailable', 'the recorded link event belongs to another scope');
    }
    if (canonicalOf(event.sessionRef) !== canonicalOf(input.sessionRef)) {
      return reject('unavailable', 'the recorded link event belongs to another Session');
    }
    if (canonicalOf(event.link.ref) !== canonicalOf(linkRef)) {
      return reject('unavailable', 'the recorded link event belongs to another target or relation');
    }
    if (event.active !== input.active) {
      return reject('unavailable', 'the recorded link event disagrees with the requested transition');
    }
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const version = receipt.versions.find((entry) => entry.refKey === sessionKey);
    if (version === undefined || version.revision !== event.sessionRevision) {
      return reject('unavailable', 'the recorded link event disagrees with the receipt Session version');
    }
    const restored: SessionWorkLink = event.boundField === 'since'
      ? { ref: event.link.ref, revision: event.link.revision, since: receipt.cursor, until: event.link.until }
      : { ref: event.link.ref, revision: event.link.revision, since: event.link.since as CommitCursor, until: receipt.cursor };
    return { status: 'committed', value: restored, replayed: true, cursor: receipt.cursor };
  }

  /**
   * The ONLY receipt-miss recovery. Every post-lookup attempt whose result is a
   * rejection (except cancellation) is routed here exactly once: a same
   * fingerprint restores the original receipt/event, a different fingerprint is
   * an idempotency_conflict, and a real absence returns null so the caller keeps
   * its original rejection. No branch maintains this invariant separately.
   */
  async function recheckLinkAfterMiss(
    identityKey: string,
    fingerprint: string,
    scope: WorkspaceScope,
    input: LinkSessionWorkInput,
    linkRef: SessionWorkLinkRef,
  ): Promise<WriteResult<SessionWorkLink> | null> {
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') return readLinkReplay(again.value, scope, input, linkRef);
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return null;
  }

  /**
   * The post-lookup attempt: current-state reads, validation, compile and the
   * single commit. It performs no identity lookup of its own, so the
   * receipt-miss recovery invariant is maintained in exactly one place.
   */
  async function runLinkAttempt(args: {
    ctx: CoreCallContext;
    scope: WorkspaceScope;
    input: LinkSessionWorkInput;
    linkRef: SessionWorkLinkRef;
    expectedSession: VersionPin;
    expectedLink: VersionPin | undefined;
    identityKey: string;
    fingerprint: string;
  }): Promise<WriteResult<SessionWorkLink>> {
    const { ctx, scope, input, linkRef, expectedSession, expectedLink, identityKey, fingerprint } = args;
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const linkKey = sessionWorkLinkRefKey(linkRef);
    const read = await records.readMany([sessionKey, linkKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const linked: SessionEvent = { kind: 'work_linked', active: input.active };
    const session = targetSession(read.value.records.find((record) => record.refKey === sessionKey), scope, linked);
    if ('status' in session) return session;
    const linkRecord = read.value.records.find((record) => record.refKey === linkKey);
    let currentLink: SessionWorkLink | null = null;
    if (linkRecord !== undefined) {
      const decodedLink = decodeSessionWorkLink(linkRecord);
      if (decodedLink.status !== 'decoded') {
        return reject('unavailable', `the existing work link is damaged: ${decodedLink.reason}`);
      }
      currentLink = decodedLink.value;
    }

    // SES-15/SES-16. A new link's target is checked only once the machine has
    // accepted, with the target check's own codes, where it always was (§8.6:
    // the machine's `not_found` for an invalid target is its backstop). The link
    // pin stays the link record's guard in the commit.
    const linkPin = expectedLink === undefined || expectedLink.revision === 0 ? null : expectedLink.revision;
    const verdict = decide(session, linked, { link: {
      exists: currentLink !== null, open: currentLink !== null && currentLink.until === null, targetValid: true, pin: linkPin,
    } });
    if (!verdict.ok) return reject(verdict.code, verdict.detail);
    const targetGuards: RecordGuard[] = [];
    if (input.active) {
      const checked = await validateWorkLinkTarget(records, ctx, scope, input.target);
      if (!checked.ok) return checked.rejection;
      for (const guard of checked.guards) targetGuards.push(guard);
    }

    // The machine's bound field: opening (or reopening) starts an unbound
    // interval at the commit cursor; closing keeps `since`.
    const { session: nextSession, bound: boundField } = sessionWrite(session, verdict.effects, SESSION_WORK_LINK_CHANGED_EVENT);
    if (boundField === null) throw new Error('work_linked always writes the work link');
    const nextLink: PendingSessionWorkLink = {
      ref: linkRef,
      revision: (currentLink?.revision ?? 0) + 1,
      since: boundField === 'since' ? null : currentLink?.since ?? null,
      until: null,
    };
    const event: SessionWorkLinkChangedEventV1 = {
      eventId: eventIdOf(identityKey, 'link'),
      eventType: SESSION_WORK_LINK_CHANGED_EVENT,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      sessionRef: input.sessionRef,
      sessionRevision: nextSession.revision,
      active: input.active,
      link: nextLink,
      boundField,
    };
    const guardMap = new Map<string, number | null>();
    guardMap.set(sessionKey, expectedSession.revision);
    guardMap.set(linkKey, linkPin);
    for (const guard of targetGuards) guardMap.set(guard.refKey, guard.expectedRevision);
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: [...guardMap].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision })),
      records: [encodeSessionRecord(nextSession), encodePendingSessionWorkLink(nextLink)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionWorkLinkChangedEvent(event)],
      commitCursorBindings: [{ refKey: linkKey, field: boundField }],
    };

    if (ctx.signal?.aborted) return reject('cancelled', 'the Session link was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', 'the Session link commit failed before completing');
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) return readLinkReplay(committed, scope, input, linkRef);
    const result: SessionWorkLink = boundField === 'since'
      ? { ref: linkRef, revision: nextLink.revision, since: committed.cursor, until: null }
      : { ref: linkRef, revision: nextLink.revision, since: nextLink.since as CommitCursor, until: committed.cursor };
    return { status: 'committed', value: result, replayed: false, cursor: committed.cursor };
  }

  async function linkSessionWork(
    ctx: CoreCallContext,
    request: GraphWrite<LinkSessionWorkInput>,
  ): Promise<WriteResult<SessionWorkLink>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session lifecycle call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session link was cancelled before validation');
    const owned: OwnedRequest<LinkSessionWorkInput> = ownRequest(request, 'linkSessionWork');
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', 'linkSessionWork requires an input object');
    const refProblem = checkPlainSessionRef(input.sessionRef);
    if (refProblem !== null) return reject('invalid', refProblem);
    if (input.sessionRef.projectId !== scope.projectId) return reject('forbidden', 'the Session belongs to another project');
    if (typeof input.active !== 'boolean') return reject('invalid', 'linkSessionWork requires active');
    if (!relation(input.relation)) return reject('invalid', 'linkSessionWork relation is not recognized');
    const targetProblem = checkTarget(input.target);
    if (targetProblem !== null) return reject('invalid', `linkSessionWork target: ${targetProblem}`);
    if (input.target.ref.projectId !== scope.projectId) return reject('forbidden', 'the work link target belongs to another project');
    if (input.target.kind === 'work' && input.target.ref.workspaceId !== scope.workspaceId) {
      return reject('forbidden', 'the work link target belongs to another workspace');
    }
    const linkRef: SessionWorkLinkRef = {
      aggregateType: 'SessionWorkLink', projectId: scope.projectId, sessionId: input.sessionRef.sessionId,
      target: input.target as WorkLinkTarget, relation: input.relation as WorkLinkRelation,
    };
    const expected = normalizeExpected(owned.expected, scope, input.sessionRef, linkRef);
    if (!expected.ok) return reject('invalid', expected.reason);
    const identityKey = identityKeyOf('session-link:', actor, scope, owned.requestId);
    const fingerprint = fingerprintOf('session-link-request', actor, scope, {
      sessionRef: input.sessionRef, target: input.target, relation: input.relation, active: input.active,
    }, owned.expected);
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session link was cancelled before lookup');

    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return readLinkReplay(existing.value, scope, input, linkRef);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session link was cancelled during lookup');

    const attempt = await runLinkAttempt({
      ctx, scope, input, linkRef,
      expectedSession: expected.session, expectedLink: expected.link,
      identityKey, fingerprint,
    });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const restored = await recheckLinkAfterMiss(identityKey, fingerprint, scope, input, linkRef);
    return restored ?? attempt;
  }

  // ------------------------------------------------------------------------
  // archiveSession / reactivateSession
  // ------------------------------------------------------------------------

  async function readLifecycleReplay(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    scope: WorkspaceScope,
    sessionRef: SessionRef,
    expectedEvent: string,
  ): Promise<WriteResult<SessionRecord>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return reject('unavailable', 'the recorded lifecycle receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(receipt.cursor)) {
      return reject('unavailable', 'the recorded lifecycle event cursor disagrees with the receipt');
    }
    const decoded = sessionLifecycleChangedPayloadFromEvent(at.value.event);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the recorded lifecycle event is not decodable: ${decoded.reason}`);
    }
    const event: SessionLifecycleChangedEventV1 = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return reject('unavailable', 'the recorded lifecycle event id disagrees with the receipt');
    if (event.eventType !== expectedEvent) return reject('unavailable', 'the recorded lifecycle event is the wrong transition');
    if (event.projectId !== scope.projectId) return reject('unavailable', 'the recorded lifecycle event belongs to another project');
    if (event.session.workspaceId !== scope.workspaceId) return reject('unavailable', 'the recorded lifecycle event belongs to another workspace');
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
    if (canonicalOf(event.session.ref) !== sessionKey) {
      return reject('unavailable', 'the recorded lifecycle event belongs to another Session');
    }
    const version = receipt.versions.find((entry) => entry.refKey === sessionKey);
    if (version === undefined || version.revision !== event.session.revision) {
      return reject('unavailable', 'the recorded lifecycle event disagrees with the receipt Session version');
    }
    return { status: 'committed', value: event.session, replayed: true, cursor: receipt.cursor };
  }

  /** Archive/reactivate share the same single receipt-miss recovery. */
  async function recheckLifecycleAfterMiss(
    identityKey: string,
    fingerprint: string,
    scope: WorkspaceScope,
    sessionRef: SessionRef,
    expectedEvent: string,
  ): Promise<WriteResult<SessionRecord> | null> {
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') return readLifecycleReplay(again.value, scope, sessionRef, expectedEvent);
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return null;
  }

  /** The post-lookup archive/reactivate attempt; no identity lookup of its own. */
  async function runTransitionAttempt(args: {
    ctx: CoreCallContext;
    scope: WorkspaceScope;
    input: ArchiveSessionInput;
    kind: 'archive' | 'reactivate';
    expectedEvent: SessionLifecycleChangedEventV1['eventType'];
    expectedSession: VersionPin;
    identityKey: string;
    fingerprint: string;
  }): Promise<WriteResult<SessionRecord>> {
    const { ctx, scope, input, kind, expectedEvent, expectedSession, identityKey, fingerprint } = args;
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const read = await records.readMany([sessionKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const lifecycleEvent: SessionEvent = kind === 'archive' ? { kind: 'session_archived' } : { kind: 'session_reactivated' };
    const session = targetSession(read.value.records.find((record) => record.refKey === sessionKey), scope, lifecycleEvent);
    if ('status' in session) return session;

    // SES-11/SES-14. The machine first judges the Session itself (links not
    // read yet); only an archive it accepts reads the responsible links, so a
    // link-read failure never hides `invalid`/`busy`, as before. The machine
    // then judges the archive again with them.
    let verdict = decide(session, lifecycleEvent, { openResponsibleLink: false });
    if (verdict.ok && kind === 'archive') {
      const links = await readSessionLinks(scope.projectId, session.ref.sessionId);
      if (!links.ok) return links.rejection;
      verdict = decide(session, lifecycleEvent, { openResponsibleLink: openResponsibleLinkOf(links.links) });
    }
    if (!verdict.ok) {
      // Slice 1 SV20 / §5.3: the final archive of a Session whose responsible
      // Task obligation is still open is the archive's own `busy`. The pure
      // machine keeps its generic `dependency_blocked` (STATE-MACHINES-SPEC
      // §8.3, locked by tests/state/session-availability.test.ts); the archive
      // owner translates it to the slice-1 refusal the archive table names.
      if (kind === 'archive' && verdict.code === 'dependency_blocked') {
        return reject('busy', verdict.detail);
      }
      return reject(verdict.code, verdict.detail);
    }
    const { session: nextSession } = sessionWrite(session, verdict.effects, expectedEvent);

    const event: SessionLifecycleChangedEventV1 = {
      eventId: eventIdOf(identityKey, kind),
      eventType: expectedEvent,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      projectId: scope.projectId,
      session: nextSession,
      reason: input.reason,
    };
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: [{ refKey: sessionKey, expectedRevision: expectedSession.revision }],
      records: [encodeSessionRecord(nextSession)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionLifecycleChangedEvent(event)],
    };

    if (ctx.signal?.aborted) return reject('cancelled', `the Session ${kind} was cancelled before commit`);
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', `the Session ${kind} commit failed before completing`);
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) return readLifecycleReplay(committed, scope, input.sessionRef, expectedEvent);
    return { status: 'committed', value: nextSession, replayed: false, cursor: committed.cursor };
  }

  /** The archive/reactivate flow (named apart from the state/ machine's `transitionSession`, §8.6). */
  async function runLifecycleTransition(
    ctx: CoreCallContext,
    request: GraphWrite<ArchiveSessionInput>,
    kind: 'archive' | 'reactivate',
  ): Promise<WriteResult<SessionRecord>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session lifecycle call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', `the Session ${kind} was cancelled before validation`);
    const owned = ownRequest<ArchiveSessionInput>(request, `${kind}Session`);
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', `${kind}Session requires an input object`);
    const refProblem = checkPlainSessionRef(input.sessionRef);
    if (refProblem !== null) return reject('invalid', refProblem);
    if (input.sessionRef.projectId !== scope.projectId) return reject('forbidden', 'the Session belongs to another project');
    if (!nonEmpty(input.reason)) return reject('invalid', `${kind}Session requires a reason`);
    const expected = normalizeExpected(owned.expected, scope, input.sessionRef, null);
    if (!expected.ok) return reject('invalid', expected.reason);
    const prefix = kind === 'archive' ? 'session-archive:' : 'session-reactivate:';
    const fingerprintKind = kind === 'archive' ? 'session-archive-request' : 'session-reactivate-request';
    const identityKey = identityKeyOf(prefix, actor, scope, owned.requestId);
    const fingerprint = fingerprintOf(fingerprintKind, actor, scope, {
      sessionRef: input.sessionRef, reason: input.reason,
    }, owned.expected);
    if (ctx.signal?.aborted) return reject('cancelled', `the Session ${kind} was cancelled before lookup`);

    // The replay check needs the event type before the machine is asked; the
    // machine's `emit_event` must name the same one (`sessionWrite`).
    const expectedEvent = kind === 'archive' ? SESSION_ARCHIVED_EVENT : SESSION_REACTIVATED_EVENT;
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return readLifecycleReplay(existing.value, scope, input.sessionRef, expectedEvent);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    const attempt = await runTransitionAttempt({
      ctx, scope, input, kind, expectedEvent, expectedSession: expected.session, identityKey, fingerprint,
    });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const restored = await recheckLifecycleAfterMiss(identityKey, fingerprint, scope, input.sessionRef, expectedEvent);
    return restored ?? attempt;
  }

  // ------------------------------------------------------------------------
  // Slice 1 §2.3/§3.3: archive request, internal archive step and release
  // ------------------------------------------------------------------------

  type ArchiveChoiceProblem = { code: CoreError; reason: string };

  const ARCHIVE_MODES: readonly SessionArchiveRequestV1['mode'][] =
    ['operator', 'executor_idle', 'retired', 'answered_copy', 'handoff_complete', 'secretary_handoff'];

  /** Structural Task/wait choice checks only; the Task state itself is the Workflow's. */
  function checkArchiveChoices(
    input: RequestSessionArchiveInput, scope: WorkspaceScope, mode: SessionArchiveRequestV1['mode'],
  ): ArchiveChoiceProblem | null {
    if (typeof input.reason !== 'string' || input.reason.length === 0 || input.reason.length > 2000) {
      return { code: 'invalid', reason: 'archive_input_invalid: the archive reason must be 1..2000 UTF-16 code units' };
    }
    if (input.confirmUnknownStopped !== undefined && typeof input.confirmUnknownStopped !== 'boolean') {
      return { code: 'invalid', reason: 'archive_input_invalid: confirmUnknownStopped must be a boolean' };
    }
    if (!ARCHIVE_MODES.includes(mode)) {
      return { code: 'invalid', reason: 'archive_input_invalid: the archive mode is not recognized' };
    }
    if (!Array.isArray(input.tasks)) {
      return { code: 'invalid', reason: 'archive_input_invalid: archive tasks must be an array' };
    }
    if (input.tasks.length > 100) {
      return { code: 'invalid', reason: 'archive_input_invalid: at most 100 Task choices are supported' };
    }
    const seen = new Set<string>();
    for (const choice of input.tasks) {
      if (!isObject(choice) || !isObject(choice['target'])) {
        return { code: 'invalid', reason: 'archive_input_invalid: every Task choice needs a target' };
      }
      const target = choice['target'] as WorkLinkTarget;
      const targetProblem = checkTarget(target);
      if (targetProblem !== null) return { code: 'invalid', reason: `archive_input_invalid: ${targetProblem}` };
      if (target.kind !== 'task' && target.kind !== 'work') {
        return { code: 'invalid', reason: 'archive_input_invalid: an archive Task choice must be a Task or Work target' };
      }
      const key = canonicalOf(target);
      if (key === null) return { code: 'invalid', reason: 'archive_input_invalid: the target cannot be canonically encoded' };
      if (seen.has(key)) return { code: 'invalid', reason: 'archive_input_invalid: duplicate Task choice target' };
      seen.add(key);
      const targetRef = target.ref as unknown as { projectId?: unknown; workspaceId?: unknown };
      if (targetRef.projectId !== scope.projectId) {
        return { code: 'forbidden', reason: 'archive_scope: a Task choice target belongs to another project' };
      }
      if (target.kind === 'work' && targetRef.workspaceId !== scope.workspaceId) {
        return { code: 'forbidden', reason: 'archive_scope: a Work choice target belongs to another workspace' };
      }
      const disposition = choice['disposition'];
      if (!isObject(disposition)) {
        return { code: 'invalid', reason: 'archive_input_invalid: every Task choice needs a disposition' };
      }
      if (disposition['kind'] === 'drop') continue;
      if (disposition['kind'] !== 'transfer') {
        return { code: 'invalid', reason: 'archive_input_invalid: the disposition kind is not recognized' };
      }
      const to = disposition['to'];
      const toProblem = checkPlainSessionRef(to);
      if (toProblem !== null) return { code: 'invalid', reason: `archive_input_invalid: transfer disposition to: ${toProblem}` };
      if ((to as SessionRef).projectId !== scope.projectId) {
        return { code: 'forbidden', reason: 'archive_scope: a transfer disposition belongs to another project' };
      }
      if ((to as SessionRef).sessionId === input.sessionRef.sessionId) {
        return { code: 'invalid', reason: 'archive_input_invalid: a transfer cannot name the archived Session' };
      }
    }
    if (input.wait !== null) {
      if (!isObject(input.wait)) {
        return { code: 'invalid', reason: 'archive_input_invalid: the wait choice must be an object or null' };
      }
      const wait = input.wait as ArchiveWaitChoiceV1;
      if (wait.kind !== 'cancel' && wait.kind !== 'transfer') {
        return { code: 'invalid', reason: 'archive_input_invalid: the wait choice kind is not recognized' };
      }
      const runRefProblem = waitRunRefProblem(wait.runRef);
      if (runRefProblem !== null) {
        return { code: 'invalid', reason: `archive_input_invalid: ${runRefProblem}` };
      }
      if (canonicalOf(wait.runRef) === null || wait.runRef.projectId !== scope.projectId) {
        return { code: 'forbidden', reason: 'archive_scope: the wait Run belongs to another project' };
      }
      if (!isObject(wait.messageRef)) {
        return { code: 'invalid', reason: 'archive_input_invalid: the wait message ref must be an object' };
      }
      if (wait.messageRef.projectId !== scope.projectId || wait.messageRef.workspaceId !== scope.workspaceId) {
        return { code: 'forbidden', reason: 'archive_scope: the wait message belongs to another scope' };
      }
      if (wait.kind === 'transfer') {
        const to = wait.to as SessionRef;
        const toProblem = checkPlainSessionRef(to);
        if (toProblem !== null) return { code: 'invalid', reason: `archive_input_invalid: wait transfer to: ${toProblem}` };
        if (to.projectId !== scope.projectId) {
          return { code: 'forbidden', reason: 'archive_scope: a wait transfer belongs to another project' };
        }
        if (to.sessionId === input.sessionRef.sessionId) {
          return { code: 'invalid', reason: 'archive_input_invalid: a wait transfer cannot name the archived Session' };
        }
      }
    }
    return null;
  }

  function mapReadFailure<T>(result: ReadResult<T>): CoreRejection {
    if (result.status === 'rejected') return result;
    if (result.status === 'not_found') return reject('not_found', 'the Session facts do not exist');
    return reject('unavailable', 'the Session facts are not ready at the requested read window');
  }

  /**
   * §2.3: never fabricate a pin. A missing or unreadable Run/QueryRun is the
   * owner's `not_found`/`unavailable`, never `revision: 0` in a persisted R.
   */
  async function readPin(ref: VersionPin['ref']): Promise<VersionPin | CoreRejection> {
    const key = canonicalOf(ref);
    if (key === null) return reject('invalid', 'the archive execution reference cannot be canonically encoded');
    const read = await records.readMany([key]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record === undefined) return reject('not_found', `the archive execution record ${key} does not exist`);
    return { ref, revision: record.revision };
  }

  /**
   * `stopQueued` is a durable fact, not a constant. A cancel
   * intent on the request's execution Run that the Run has not terminally
   * observed (the intent is still `queued`) keeps the release `busy`. A Query is
   * never cancelled by an archive, and a missing/undecodable intent means the
   * cancel cannot be proven observed, so it counts as queued.
   */
  async function deriveStopQueued(execution: ArchiveExecutionV1): Promise<boolean | CoreRejection> {
    if (execution.kind !== 'work') return false;
    const runKey = canonicalOf(execution.runRef);
    if (runKey === null) return false;
    let runRead: Awaited<ReturnType<GoalRecordTransactionPort['readMany']>>;
    try {
      runRead = await records.readMany([runKey]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return reject('unavailable', `the archive execution Run cannot be read: ${detail}`);
    }
    // A4/S1-SES-06: an unreadable, missing or undecodable Run cannot be proven
    // free of a queued stop, so the read failure is propagated and R is kept
    // instead of releasing on a default `stopQueued: false`.
    if (runRead.status !== 'ready') return mapStoreFailure(runRead);
    const runRecord = runRead.value.records.find((entry) => entry.refKey === runKey);
    if (runRecord === undefined) return reject('not_found', `the archive execution Run ${runKey} does not exist`);
    const run = decodeRun(runRecord);
    if (!run.ok) return reject('unavailable', `the archive execution Run is damaged: ${run.reason}`);
    const control = run.value.controlState;
    if (control === undefined || control.desiredState !== 'cancelled') return false;
    const intentKey = canonicalOf(control.intentRef);
    if (intentKey === null) return true;
    let intentRead: Awaited<ReturnType<GoalRecordTransactionPort['readMany']>>;
    try {
      intentRead = await records.readMany([intentKey]);
    } catch {
      return true;
    }
    if (intentRead.status !== 'ready') return true;
    const intentRecord = intentRead.value.records.find((entry) => entry.refKey === intentKey);
    if (intentRecord === undefined) return true;
    const intent = decodeControlIntentSnapshot(intentRecord);
    if (intent.status !== 'decoded') return true;
    return intent.value.kind === 'cancel' && intent.value.status === 'queued';
  }

  /**
   * §3.4 `requestSessionArchive`: the execution being archived and the full
   * VersionPins of every Run/QueryRun involved (at most two, canonical order).
   * Every read that the decision rests on (the exact Work claim and each pin)
   * is returned as a guard for the same R commit.
   */
  async function deriveExecutionAndPins(
    ctx: CoreCallContext, session: SessionRecord, input: RequestSessionArchiveInput,
  ): Promise<{ execution: ArchiveExecutionV1; pins: VersionPin[]; guards: RecordGuard[] } | CoreRejection> {
    if (sessionFacts === undefined) return reject('unsupported', 'the Session facts reader is not injected');
    const factsResult = await sessionFacts.readSessionFacts(ctx, input.sessionRef);
    if (factsResult.status !== 'ready') return mapReadFailure(factsResult);
    const facts = factsResult.value;
    let execution: ArchiveExecutionV1 = { kind: 'none' };
    const pins = new Map<string, VersionPin>();
    const guards = new Map<string, RecordGuard>();
    const occupancy = session.occupancy;
    if (occupancy !== null && occupancy.kind === 'execution') {
      const holder = occupancy.executionRef;
      const holderKey = canonicalOf(holder);
      if (holder.aggregateType === 'Run') {
        const claim = facts.latestWork;
        // §3.4 S1-SES-03/SV: an occupying Work Run that is not the latest Work
        // claim is a contradiction, not an `execution:none` fact plus an orphan pin.
        if (claim === null || canonicalOf(claim.runRef) !== holderKey) {
          return reject('incomplete',
            'work_responsibility_unresolved: the occupying Work Run does not match the latest Work claim');
        }
        execution = { kind: 'work', runRef: holder, attemptRef: claim.attemptRef };
        const claimKey = canonicalOf(claim.outboxRef);
        if (claimKey !== null) {
          const claimRead = await records.readMany([claimKey]);
          if (claimRead.status !== 'ready') return mapStoreFailure(claimRead);
          const claimRecord = claimRead.value.records.find((entry) => entry.refKey === claimKey);
          if (claimRecord === undefined) {
            return reject('incomplete', 'session_facts_page_limit: the latest Work claim record is missing');
          }
          guards.set(claimKey, { refKey: claimKey, expectedRevision: claimRecord.revision });
        }
      } else {
        execution = { kind: 'query', queryRunRef: holder };
      }
      if (holderKey !== null) {
        const pin = await readPin(holder);
        if ('status' in pin) return pin;
        pins.set(holderKey, pin);
        guards.set(holderKey, { refKey: holderKey, expectedRevision: pin.revision });
      }
    }
    if (input.wait !== null) {
      const waitKey = canonicalOf(input.wait.runRef);
      if (waitKey !== null && !pins.has(waitKey)) {
        const pin = await readPin(input.wait.runRef);
        if ('status' in pin) return pin;
        pins.set(waitKey, pin);
        guards.set(waitKey, { refKey: waitKey, expectedRevision: pin.revision });
      }
    }
    const ordered = [...pins.entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([, pin]) => pin)
      .slice(0, 2);
    return { execution, pins: ordered, guards: [...guards.values()] };
  }

  async function readArchiveChangedReplay(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    scope: WorkspaceScope,
    sessionRef: SessionRef,
    expectedEvent: SessionArchiveChangedEventV1['eventType'],
  ): Promise<WriteResult<SessionRecord>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return reject('unavailable', 'the recorded archive event receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(receipt.cursor)) {
      return reject('unavailable', 'the recorded archive event cursor disagrees with the receipt');
    }
    const decoded = sessionArchiveChangedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the recorded archive event is not decodable: ${decoded.reason}`);
    }
    const event: SessionArchiveChangedEventV1 = decoded.value;
    if (event.eventType !== expectedEvent) return reject('unavailable', 'the recorded archive event is the wrong transition');
    if (event.eventId !== receipt.eventIds[0]) return reject('unavailable', 'the recorded archive event id disagrees with the receipt');
    if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
      return reject('unavailable', 'the recorded archive event belongs to another scope');
    }
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
    if (canonicalOf(event.session.ref) !== sessionKey) {
      return reject('unavailable', 'the recorded archive event belongs to another Session');
    }
    const version = receipt.versions.find((entry) => entry.refKey === sessionKey);
    if (version === undefined || version.revision !== event.session.revision) {
      return reject('unavailable', 'the recorded archive event disagrees with the receipt Session version');
    }
    return { status: 'committed', value: event.session, replayed: true, cursor: receipt.cursor };
  }

  async function recheckArchiveRequestAfterMiss(
    identityKey: string, fingerprint: string, scope: WorkspaceScope, sessionRef: SessionRef,
  ): Promise<WriteResult<SessionRecord> | null> {
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') return readArchiveChangedReplay(again.value, scope, sessionRef, SESSION_ARCHIVE_REQUESTED_EVENT);
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return null;
  }

  async function runArchiveRequestAttempt(args: {
    ctx: CoreCallContext; scope: WorkspaceScope; actor: HostActor;
    input: RequestSessionArchiveInput; mode: SessionArchiveRequestV1['mode']; requestId: string;
    identityKey: string; fingerprint: string; expectedSession: VersionPin;
  }): Promise<WriteResult<SessionRecord>> {
    const { ctx, scope, actor, input, mode, requestId, identityKey, fingerprint, expectedSession } = args;
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const read = await records.readMany([sessionKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const session = targetSession(read.value.records.find((record) => record.refKey === sessionKey), scope, { kind: 'session_archived' });
    if ('status' in session) return session;
    const derived = await deriveExecutionAndPins(ctx, session, input);
    if ('status' in derived) return derived;
    const now = new Date().toISOString();
    const archive: SessionArchiveRequestV1 = {
      schemaVersion: 1,
      requestId,
      requestedBy: { kind: actor.kind, id: actor.id },
      requestedAt: now,
      reason: input.reason,
      mode,
      // The trusted condition rides the request unchanged; absent input is the request's explicit `null`, and
      // the codec refuses a non-null one on a mode that takes none.
      condition: input.condition ?? null,
      tasks: input.tasks,
      wait: input.wait,
      execution: derived.execution,
      executionPins: derived.pins,
      confirmUnknownStopped: input.confirmUnknownStopped === true,
      receipt: { identityKey, fingerprint },
    };
    const requestProblem = checkSessionArchiveRequest(archive, scope.projectId);
    if (requestProblem !== null) return reject('invalid', `archive_input_invalid: ${requestProblem}`);
    const verdict = decide(session, { kind: 'archive_requested', archive }, {
      archive: {
        requestMatches: true, choicesValid: true, authorityValid: true, wait: 'not_read', retired: false,
        sourceExecutionStopped: true, stopQueued: false, failedDisposal: false,
      },
    });
    if (!verdict.ok) return reject(verdict.code, verdict.detail);
    const nextSession = requestSessionArchiveRecord(session, archive);
    const event: SessionArchiveChangedEventV1 = {
      eventId: eventIdOf(identityKey, 'archive-request'),
      eventType: SESSION_ARCHIVE_REQUESTED_EVENT,
      schemaVersion: 1,
      occurredAt: now,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      session: nextSession,
      archiveRequestId: archive.requestId,
      reason: archive.reason,
    };
    const requestGuards = new Map<string, RecordGuard>();
    requestGuards.set(sessionKey, { refKey: sessionKey, expectedRevision: expectedSession.revision });
    for (const guard of derived.guards) requestGuards.set(guard.refKey, guard);
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: [...requestGuards.values()],
      records: [encodeSessionRecord(nextSession)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionArchiveChangedEvent(event)],
    };
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session archive request was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', 'the Session archive request commit failed before completing');
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) return readArchiveChangedReplay(committed, scope, input.sessionRef, SESSION_ARCHIVE_REQUESTED_EVENT);
    return { status: 'committed', value: nextSession, replayed: false, cursor: committed.cursor };
  }

  async function requestSessionArchive(
    ctx: CoreCallContext,
    request: GraphWrite<RequestSessionArchiveInput>,
  ): Promise<WriteResult<SessionRecord>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session lifecycle call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (sessionFacts === undefined) {
      return reject('unsupported', 'the Session archive request entry needs the injected Session facts reader');
    }
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session archive request was cancelled before validation');
    const owned = ownRequest<RequestSessionArchiveInput>(request, 'requestSessionArchive');
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', 'requestSessionArchive requires an input object');
    const refOutcome = normalizeSessionRef(input.sessionRef);
    if (!refOutcome.ok) return reject('invalid', refOutcome.reason);
    input.sessionRef = refOutcome.ref;
    if (input.sessionRef.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the Session belongs to another project');
    }
    const mode = (input.mode ?? 'operator') as SessionArchiveRequestV1['mode'];
    if (mode !== 'operator' && !isAutomationActor(actor)) {
      return reject('forbidden', 'archive_host_only: only the platform automation may request a non-operator archive');
    }
    const choiceProblem = checkArchiveChoices(input, scope, mode);
    if (choiceProblem !== null) return reject(choiceProblem.code, choiceProblem.reason);
    const expected = normalizeExpected(owned.expected, scope, input.sessionRef, null);
    if (!expected.ok) return reject('invalid', expected.reason);
    const identityKey = identityKeyOf('session-archive:', actor, scope, owned.requestId);
    const fingerprint = fingerprintOf('session-archive-request', actor, scope, {
      sessionRef: input.sessionRef, reason: input.reason, tasks: input.tasks, wait: input.wait,
      confirmUnknownStopped: input.confirmUnknownStopped === true, mode,
      // The condition is part of the request's identity: a retry that changed it is a different request,
      // and a recovered archive re-checks the condition it was registered with.
      condition: input.condition ?? null,
    }, owned.expected);
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session archive request was cancelled before lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return readArchiveChangedReplay(existing.value, scope, input.sessionRef, SESSION_ARCHIVE_REQUESTED_EVENT);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    const attempt = await runArchiveRequestAttempt({
      ctx, scope, actor, input, mode, requestId: owned.requestId, identityKey, fingerprint,
      expectedSession: expected.session,
    });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const restored = await recheckArchiveRequestAfterMiss(identityKey, fingerprint, scope, input.sessionRef);
    return restored ?? attempt;
  }

  async function readSessionArchiveRequestReceipt(
    ctx: CoreCallContext,
    request: GraphWrite<RequestSessionArchiveInput>,
  ): Promise<ReadResult<{ session: SessionRecord; cursor: CommitCursor }>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session lifecycle call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the archive request receipt read was cancelled before validation');
    const owned = ownRequest<RequestSessionArchiveInput>(request, 'readSessionArchiveRequestReceipt');
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', 'readSessionArchiveRequestReceipt requires an input object');
    const refOutcome = normalizeSessionRef(input.sessionRef);
    if (!refOutcome.ok) return reject('invalid', refOutcome.reason);
    input.sessionRef = refOutcome.ref;
    if (input.sessionRef.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the Session belongs to another project');
    }
    const mode = (input.mode ?? 'operator') as SessionArchiveRequestV1['mode'];
    const expected = normalizeExpected(owned.expected, scope, input.sessionRef, null);
    if (!expected.ok) return reject('invalid', expected.reason);
    const identityKey = identityKeyOf('session-archive:', actor, scope, owned.requestId);
    const fingerprint = fingerprintOf('session-archive-request', actor, scope, {
      sessionRef: input.sessionRef, reason: input.reason, tasks: input.tasks, wait: input.wait,
      confirmUnknownStopped: input.confirmUnknownStopped === true, mode,
      // The condition is part of the request's identity: a retry that changed it is a different request,
      // and a recovered archive re-checks the condition it was registered with.
      condition: input.condition ?? null,
    }, owned.expected);
    const found = await records.lookupCommit({ identityKey, fingerprint });
    if (found.status !== 'ready') {
      if (found.code !== 'not_found') return mapStoreFailure(found);
      return reject('not_found', 'archive_request_receipt_not_found: no archive request was committed under this identity');
    }
    const replay = await readArchiveChangedReplay(found.value, scope, input.sessionRef, SESSION_ARCHIVE_REQUESTED_EVENT);
    if (replay.status !== 'committed') return replay;
    return { status: 'ready', value: { session: replay.value, cursor: replay.cursor } };
  }

  /** §2.3: recover the immutable request through its stored receipt, even after the final cleared it. */
  async function loadArchiveRequest(
    step: ArchiveStepRefV1, scope: WorkspaceScope,
  ): Promise<SessionArchiveRequestV1 | CoreRejection> {
    const found = await records.lookupCommit({
      identityKey: step.requestReceipt.identityKey,
      fingerprint: step.requestReceipt.fingerprint,
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
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the archive request event is not decodable: ${decoded.reason}`);
    }
    const event: SessionArchiveChangedEventV1 = decoded.value;
    if (event.eventType !== SESSION_ARCHIVE_REQUESTED_EVENT) {
      return reject('unavailable', 'the recorded archive event is not a request');
    }
    if (!found.value.eventIds.includes(event.eventId)) {
      return reject('unavailable', 'the archive request event id disagrees with its receipt');
    }
    if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
      return reject('unavailable', 'the archive request event belongs to another scope');
    }
    if (event.archiveRequestId !== step.archiveRequestId) {
      return reject('unavailable', 'the archive step names another request');
    }
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(step.sessionRef));
    if (canonicalOf(event.session.ref) !== sessionKey) {
      return reject('unavailable', 'the archive request event belongs to another Session');
    }
    const request = event.session.archiveRequest;
    if (request === null || request === undefined) {
      return reject('unavailable', 'the archive request event carries no request');
    }
    if (canonicalOf(request.receipt) !== canonicalOf(step.requestReceipt)) {
      return reject('unavailable', 'the archive step receipt disagrees with the stored request');
    }
    return request;
  }

  /**
   * The final archive's condition re-check (`C/core/session-archive.ts`): the stored request carries the trusted
   * condition (a condition is part of its identity), so every final commit — the first attempt and the recovery
   * after a crashed one alike — calls the injected condition port and merges the one fragment it returns. A conditioned
   * request without the injected port is `unavailable`: never a silent success and never an archive without its
   * condition. The check's failure is the archive's conflict; the caller re-reads and retries.
   */
  async function readArchiveConditionCheck(
    ctx: CoreCallContext, session: SessionRef, condition: NonNullable<SessionArchiveRequestV1['condition']>,
  ): Promise<ConditionCheckV1 | CoreRejection> {
    const port = stores.archiveCondition ?? null;
    if (port === null) {
      return reject('unavailable',
        'the archive condition port is not installed, so a conditioned archive cannot be finalised');
    }
    let checked: Awaited<ReturnType<SecretaryArchiveConditionPort['check']>>;
    try {
      checked = await port.check(ctx, { condition, session });
    } catch (error) {
      return reject('unavailable', `the archive condition check failed: ${messageOf(error)}`);
    }
    if (checked.status !== 'ready') return mapReadFailure(checked);
    return checked.value;
  }

  async function runArchiveStepAttempt(args: {
    ctx: CoreCallContext; scope: WorkspaceScope; step: ArchiveStepRefV1; request: SessionArchiveRequestV1;
    identity: { identityKey: string; fingerprint: string; eventId: string };
  }): Promise<WriteResult<SessionRecord>> {
    const { ctx, scope, step, request, identity } = args;
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(step.sessionRef));
    const read = await records.readMany([sessionKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const session = targetSession(read.value.records.find((record) => record.refKey === sessionKey), scope, { kind: 'session_archived' });
    if ('status' in session) return session;
    const links = await readSessionLinks(scope.projectId, session.ref.sessionId);
    if (!links.ok) return links.rejection;
    if (sessionFacts === undefined) return reject('unsupported', 'the Session facts reader is not injected');
    const factsResult = await sessionFacts.readSessionFacts(ctx, step.sessionRef);
    if (factsResult.status !== 'ready') return mapReadFailure(factsResult);
    const wait = factsResult.value.wait === null ? 'not_waiting' : 'waiting';
    const retired = session.health === 'unavailable';
    const verdict = decide(session, { kind: 'session_archived' }, {
      openResponsibleLink: openResponsibleLinkOf(links.links),
      archive: {
        requestMatches: true, choicesValid: true, authorityValid: true, wait, retired,
        sourceExecutionStopped: true, stopQueued: false, failedDisposal: false,
      },
    });
    if (!verdict.ok) return reject(verdict.code, verdict.detail);
    // `archiveSessionRecord` (S1-SES-04) clears a present archiveRequest in the
    // same revision+1 record; the `clear_archive_request` effect is that clear.
    const nextSession = archiveSessionRecord(session, new Date().toISOString());
    const occurredAt = new Date().toISOString();
    // Final archive condition: the stored condition is re-checked on the final commit and contributes exactly one
    // fragment — its guards (the source and the `SessionActivity` revision), its
    // fence claim and its first read horizon as `ledgerHorizon`, never as a guard.
    const condition = request.condition ?? null;
    let conditionCommit: SecretaryArchiveConditionCommitV1 | null = null;
    if (condition !== null) {
      const checked = await readArchiveConditionCheck(ctx, step.sessionRef, condition);
      if ('status' in checked) return checked;
      if (!checked.ok) return reject('revision_conflict', `archive_condition_failed: ${checked.reason}`);
      conditionCommit = checked.commit;
    }
    const merged = mergeGuards([
      { refKey: sessionKey, expectedRevision: session.revision },
      ...(conditionCommit === null ? [] : conditionCommit.guards),
    ]);
    if (!merged.ok) return merged.rejection;
    const claims: UniqueClaimChange[] = conditionCommit === null || conditionCommit.fence === null
      ? [] : [conditionCommit.fence];
    const event: SessionLifecycleChangedEventV1 = {
      eventId: identity.eventId,
      eventType: SESSION_ARCHIVED_EVENT,
      schemaVersion: 1,
      occurredAt,
      projectId: scope.projectId,
      session: nextSession,
      reason: request.reason,
    };
    const prepared: PreparedCommit = {
      identityKey: identity.identityKey,
      fingerprint: identity.fingerprint,
      guards: merged.guards,
      records: [encodeSessionRecord(nextSession)],
      claims,
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionLifecycleChangedEvent(event)],
      ...(conditionCommit === null ? {} : { ledgerHorizon: conditionCommit.ledgerHorizon }),
    };
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session archive step was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', 'the Session archive step commit failed before completing');
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) return readLifecycleReplay(committed, scope, step.sessionRef, SESSION_ARCHIVED_EVENT);
    return { status: 'committed', value: nextSession, replayed: false, cursor: committed.cursor };
  }

  async function finishSessionArchive(
    ctx: CoreCallContext,
    step: ArchiveStepRefV1,
  ): Promise<WriteResult<SessionRecord>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session lifecycle call');
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted;
    if (sessionFacts === undefined) {
      return reject('unsupported', 'the Session archive step entry needs the injected Session facts reader');
    }
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session archive step was cancelled before validation');
    let ownedStep: ArchiveStepRefV1;
    try {
      ownedStep = structuredClone(step);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return reject('invalid', `the archive step cannot be isolated from the caller: ${detail}`);
    }
    if (!isObject(ownedStep)) return reject('invalid', 'finishSessionArchive requires an ArchiveStepRefV1');
    const refOutcome = normalizeSessionRef(ownedStep.sessionRef);
    if (!refOutcome.ok) return reject('invalid', refOutcome.reason);
    ownedStep.sessionRef = refOutcome.ref;
    if (ownedStep.sessionRef.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the Session belongs to another project');
    }
    if (!nonEmpty(ownedStep.archiveRequestId) || !nonEmpty(ownedStep.subjectKey)) {
      return reject('invalid', 'finishSessionArchive requires archiveRequestId and subjectKey');
    }
    if (!isObject(ownedStep.requestReceipt) || !nonEmpty(ownedStep.requestReceipt.identityKey)
      || !nonEmpty(ownedStep.requestReceipt.fingerprint)) {
      return reject('invalid', 'finishSessionArchive requires the original request receipt');
    }
    if (ownedStep.step !== 'archive') {
      return reject('unsupported', `the Session lifecycle owner does not perform the ${String(ownedStep.step)} archive step`);
    }
    const request = await loadArchiveRequest(ownedStep, scope);
    if ('status' in request) return request;
    let identity: { identityKey: string; fingerprint: string; eventId: string };
    try {
      identity = deriveArchiveStepCommitIdentityV1(scope, request, ownedStep);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return reject('invalid', `the archive step does not belong to its request: ${detail}`);
    }
    const existing = await records.lookupCommit({ identityKey: identity.identityKey, fingerprint: identity.fingerprint });
    if (existing.status === 'ready') return readLifecycleReplay(existing.value, scope, ownedStep.sessionRef, SESSION_ARCHIVED_EVENT);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    const attempt = await runArchiveStepAttempt({ ctx, scope, step: ownedStep, request, identity });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const again = await records.lookupCommit({ identityKey: identity.identityKey, fingerprint: identity.fingerprint });
    if (again.status === 'ready') return readLifecycleReplay(again.value, scope, ownedStep.sessionRef, SESSION_ARCHIVED_EVENT);
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return attempt;
  }

  async function releaseSessionArchiveRequest(
    ctx: CoreCallContext,
    request: GraphWrite<{ sessionRef: SessionRef; archiveRequestId: string; reason: string }>,
  ): Promise<WriteResult<SessionRecord>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session lifecycle call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (sessionFacts === undefined) {
      return reject('unsupported', 'the archive request release entry needs the injected Session facts reader');
    }
    if (ctx.signal?.aborted) return reject('cancelled', 'the archive request release was cancelled before validation');
    const owned = ownRequest<{ sessionRef: SessionRef; archiveRequestId: string; reason: string }>(request, 'releaseSessionArchiveRequest');
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', 'releaseSessionArchiveRequest requires an input object');
    const refOutcome = normalizeSessionRef(input.sessionRef);
    if (!refOutcome.ok) return reject('invalid', refOutcome.reason);
    input.sessionRef = refOutcome.ref;
    if (input.sessionRef.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the Session belongs to another project');
    }
    if (!nonEmpty(input.archiveRequestId)) return reject('invalid', 'releaseSessionArchiveRequest requires archiveRequestId');
    if (!nonEmpty(input.reason)) return reject('invalid', 'archive_input_invalid: releaseSessionArchiveRequest requires a reason');
    const expected = normalizeExpected(owned.expected, scope, input.sessionRef, null);
    if (!expected.ok) return reject('invalid', expected.reason);
    const identityKey = identityKeyOf('session-archive-release:', actor, scope, owned.requestId);
    const fingerprint = fingerprintOf('session-archive-release-request', actor, scope, {
      sessionRef: input.sessionRef, archiveRequestId: input.archiveRequestId, reason: input.reason,
    }, owned.expected);
    if (ctx.signal?.aborted) return reject('cancelled', 'the archive request release was cancelled before lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') {
      return readArchiveChangedReplay(existing.value, scope, input.sessionRef, SESSION_ARCHIVE_REQUEST_RELEASED_EVENT);
    }
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const read = await records.readMany([sessionKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const session = targetSession(read.value.records.find((record) => record.refKey === sessionKey), scope, { kind: 'session_archived' });
    if ('status' in session) return session;
    const pending = session.archiveRequest;
    if (pending === null || pending === undefined || pending.requestId !== input.archiveRequestId) {
      return reject('revision_conflict', 'there is no matching pending archive request');
    }
    const active = session.occupancy;
    let sourceExecutionStopped = true;
    if (pending.execution.kind === 'work' || pending.execution.kind === 'query') {
      const holder = pending.execution.kind === 'work' ? pending.execution.runRef : pending.execution.queryRunRef;
      const holderKey = canonicalOf(holder);
      sourceExecutionStopped = active === null || active.kind !== 'execution'
        || canonicalOf(active.executionRef) !== holderKey;
    } else {
      sourceExecutionStopped = active === null;
    }
    const stopQueued = await deriveStopQueued(pending.execution);
    // A4/S1-SES-06: an unreadable Run is not "no queued stop"; the read failure
    // is returned with zero commits, so R stays exactly as it was.
    if (typeof stopQueued !== 'boolean') return stopQueued;
    const verdict = decide(session, { kind: 'archive_request_released', archiveRequestId: input.archiveRequestId }, {
      archive: {
        requestMatches: true, choicesValid: true, authorityValid: true, wait: 'not_read', retired: false,
        sourceExecutionStopped, stopQueued, failedDisposal: true,
      },
    });
    if (!verdict.ok) return reject(verdict.code, verdict.detail);
    const nextSession = releaseSessionArchiveRequestRecord(session);
    const occurredAt = new Date().toISOString();
    const event: SessionArchiveChangedEventV1 = {
      eventId: eventIdOf(identityKey, 'archive-release'),
      eventType: SESSION_ARCHIVE_REQUEST_RELEASED_EVENT,
      schemaVersion: 1,
      occurredAt,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      session: nextSession,
      archiveRequestId: input.archiveRequestId,
      reason: input.reason,
    };
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: [{ refKey: sessionKey, expectedRevision: expected.session.revision }],
      records: [encodeSessionRecord(nextSession)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeSessionArchiveChangedEvent(event)],
    };
    if (ctx.signal?.aborted) return reject('cancelled', 'the archive request release was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared);
    } catch {
      return reject('unavailable', 'the archive request release commit failed before completing');
    }
    if (committed.status !== 'committed') return mapStoreFailure(committed);
    if (committed.replayed) {
      return readArchiveChangedReplay(committed, scope, input.sessionRef, SESSION_ARCHIVE_REQUEST_RELEASED_EVENT);
    }
    return { status: 'committed', value: nextSession, replayed: false, cursor: committed.cursor };
  }

  return {
    linkSessionWork,
    archiveSession: (ctx, request) => runLifecycleTransition(ctx, request, 'archive'),
    reactivateSession: (ctx, request) => runLifecycleTransition(ctx, request, 'reactivate'),
    requestSessionArchive,
    readSessionArchiveRequestReceipt,
    finishSessionArchive,
    releaseSessionArchiveRequest,
  };
}
