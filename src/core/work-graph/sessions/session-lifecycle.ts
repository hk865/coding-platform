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
import type { CoreError, CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure,
} from '../../record-store/ports.js';
import type { GraphWrite } from '../model/session-contracts.js';
import type {
  ArchiveSessionInput, LinkSessionWorkInput, ReactivateSessionInput, SessionLifecyclePort,
  SessionLifecycleStores,
} from './lifecycle-contracts.js';
import {
  SESSION_WORK_LINKS_LOOKUP, checkPlainSessionRef, checkTarget, decodeSessionRecord,
  decodeSessionWorkLink, encodePendingSessionWorkLink, encodeSessionRecord,
  plainSessionRefToAggregate, sessionAggregateRefKey, sessionWorkLinkRefKey,
  type PendingSessionWorkLink,
} from './session-record-codecs.js';
import {
  SESSION_ARCHIVED_EVENT, SESSION_REACTIVATED_EVENT, SESSION_WORK_LINK_CHANGED_EVENT,
  encodeSessionLifecycleChangedEvent, encodeSessionWorkLinkChangedEvent,
  sessionLifecycleChangedPayloadFromEvent, sessionWorkLinkChangedPayloadFromEvent,
  type SessionLifecycleChangedEventV1, type SessionWorkLinkChangedEventV1,
} from './lifecycle-record-codecs.js';
import { validateWorkLinkTarget } from './session-targets.js';
import {
  archiveSessionRecord, openResponsibleLinkOf, reactivateSessionRecord, sessionMachineStateOf, transitionSession,
  type SessionDomainEventType, type SessionEffect, type SessionEvent, type SessionGuardContext, type SessionTransition,
} from '../state/session-availability.js';

type UnknownRecord = Record<string, unknown>;

// --------------------------------------------------------------------------
// Preamble helpers
// --------------------------------------------------------------------------

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function relation(value: unknown): value is WorkLinkRelation {
  return value === 'responsible' || value === 'participates' || value === 'investigated';
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'invalid': return reject('invalid', failure.reason);
    case 'not_found': return reject('not_found', failure.reason);
    case 'idempotency_conflict': return reject('idempotency_conflict', failure.reason);
    case 'revision_conflict': {
      const current: VersionPin[] = [];
      for (const entry of failure.current) {
        if (entry.revision === null) continue;
        try {
          const ref = JSON.parse(entry.refKey) as unknown;
          if (isObject(ref)) current.push({ ref: ref as VersionPin['ref'], revision: entry.revision });
        } catch { /* an unreadable ref key is not a pin */ }
      }
      return reject('revision_conflict', failure.reason, current.length > 0 ? current : undefined);
    }
    case 'unique_conflict': return reject('revision_conflict', `${failure.reason} (the unique slot is held by another owner)`);
    case 'unsupported': return reject('unsupported', failure.reason);
    case 'corrupt': return reject('unavailable', `the record store reported damage: ${failure.reason}`);
    default: return reject('unavailable', failure.reason);
  }
}

type TrustedContext =
  | { ok: true; scope: WorkspaceScope; actor: { kind: 'human' | 'system'; id: string } }
  | { ok: false; rejection: CoreRejection };

/** Same trusted Host boundary the Session directory enforces: a bound
 * project/workspace, a real AbortSignal and a Host human/system actor. */
function trustedContext(ctx: CoreCallContext): TrustedContext {
  const bound = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; signal?: unknown;
  };
  if (!nonEmpty(bound.projectId) || !nonEmpty(bound.workspaceId)) {
    return { ok: false, rejection: reject('forbidden', 'a Session lifecycle call requires a bound project/workspace context') };
  }
  const signal = bound.signal;
  if (!isObject(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
    return { ok: false, rejection: reject('forbidden', 'a Session lifecycle call requires the bound AbortSignal') };
  }
  const principal = bound.principal;
  if (!isObject(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: reject('forbidden', 'a Session lifecycle call requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isObject(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: reject('forbidden', 'a Session lifecycle call requires a trusted Host actor') };
  }
  return {
    ok: true,
    scope: { projectId: bound.projectId, workspaceId: bound.workspaceId },
    actor: { kind: actor['kind'], id: actor['id'] },
  };
}

type OwnedRequest<T> = {
  ok: true;
  input: T;
  requestId: string;
  expected: readonly VersionPin[];
} | { ok: false; reason: string };

/** Isolate the whole request synchronously, before the first await, so a caller
 * mutating its input cannot change what is committed. */
function ownRequest<T>(request: GraphWrite<T>, what: string): OwnedRequest<T> {
  try {
    const clone = structuredClone(request) as GraphWrite<T>;
    const meta = clone.meta as unknown as UnknownRecord;
    if (!isObject(meta) || !nonEmpty(meta['requestId'])) return { ok: false, reason: `${what} requires meta.requestId` };
    if (!Array.isArray(meta['expected'])) return { ok: false, reason: `${what} requires meta.expected` };
    return {
      ok: true,
      input: clone.input,
      requestId: meta['requestId'],
      expected: meta['expected'] as readonly VersionPin[],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${what} request cannot be isolated from the caller: ${detail}` };
  }
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

const MAX_LINKS_PER_SESSION = 2000;
const LINK_PAGE_LIMIT = 200;

type LinkRead = { ok: true; links: SessionWorkLink[] } | { ok: false; rejection: CoreRejection };

// --------------------------------------------------------------------------
// Session machine calls
// --------------------------------------------------------------------------

/** The machine on a lifecycle or link event of `session` (null = absent), without the Session pin. */
function decide(
  session: SessionRecord | null,
  event: SessionEvent,
  facts: Partial<Pick<SessionGuardContext, 'openResponsibleLink' | 'link'>> = {},
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

export function createSessionLifecycleService(stores: SessionLifecycleStores): SessionLifecyclePort {
  const records: GoalRecordTransactionPort = stores.records;
  const lookups: RecordLookupPort = stores.lookups;

  async function readSessionLinks(projectId: string, sessionId: string): Promise<LinkRead> {
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
      for (const record of page.value.records) {
        if (links.length >= MAX_LINKS_PER_SESSION) {
          return { ok: false, rejection: reject('capacity', `Session ${sessionId} exceeds the bounded work-link read budget`) };
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
    return { ok: true, links };
  }

  function actorIdentity(actor: { kind: 'human' | 'system'; id: string }): { kind: string; id: string } {
    return { kind: actor.kind, id: actor.id };
  }

  function identityKeyOf(
    prefix: string,
    actor: { kind: 'human' | 'system'; id: string },
    scope: WorkspaceScope,
    requestId: string,
  ): string {
    return prefix + sha256Hex(canonicalJson({
      actor: actorIdentity(actor), projectId: scope.projectId, workspaceId: scope.workspaceId, requestId,
    } as unknown as JsonValue));
  }

  function fingerprintOf(
    kind: string,
    actor: { kind: 'human' | 'system'; id: string },
    scope: WorkspaceScope,
    payload: Record<string, unknown>,
    expected: readonly VersionPin[],
  ): string {
    const pins = [...expected].map((pin) => ({ ref: pin.ref, revision: pin.revision }))
      .sort((left, right) => {
        const leftKey = canonicalOf(left.ref) ?? '';
        const rightKey = canonicalOf(right.ref) ?? '';
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
    return sha256Hex(canonicalJson({
      kind, actor: actorIdentity(actor), projectId: scope.projectId, workspaceId: scope.workspaceId,
      ...payload, expected: pins,
    } as unknown as JsonValue));
  }

  function eventIdOf(identityKey: string, suffix: string): string {
    return sha256Hex(`${identityKey}|${suffix}`);
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
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the Session link was cancelled before validation');
    const owned = ownRequest(request, 'linkSessionWork');
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
    if (!verdict.ok) return reject(verdict.code, verdict.detail);
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
    const trusted = trustedContext(ctx);
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

  return {
    linkSessionWork,
    archiveSession: (ctx, request) => runLifecycleTransition(ctx, request, 'archive'),
    reactivateSession: (ctx, request) => runLifecycleTransition(ctx, request, 'reactivate'),
  };
}
