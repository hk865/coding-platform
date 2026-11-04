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
import type {
  SessionRef, SessionWorkLinkRef, VersionPin, WorkLinkTarget, WorkspaceScope,
} from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import { messageOf } from '../../../contracts/error-message.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type {
  ArchiveTaskChoiceV1, ArchiveStepRefV1, SessionArchiveRequestV1,
} from '../../../contracts/core/session-archive.js';
import { deriveArchiveStepCommitIdentityV1 } from '../../../contracts/core/session-archive.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import { canonicalKey, canonicalOf } from '../../../contracts/fingerprint.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import {
  moduleMaintainerKey, roleLineDutyOf, roleScopeClaimKey, roleScopeOfTarget,
  type RoleLineDutyV1, type RoleScopeClaimChangeV1,
} from '../../../contracts/role-lines.js';
import { isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  CommitCursorBinding, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type {
  ResponsibilityBasisV1, SessionResponsibilityBasisPort,
} from '../model/session-facts-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { readCurrentCatalogWindow } from '../architecture/catalog-service.js';
import {
  SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
  checkPlainSessionRef, checkTarget, checkWorkLinkRef, decodeSessionRecord, decodeSessionWorkLink,
  encodePendingSessionWorkLink, encodeSessionRecord, plainSessionRefToAggregate,
  sessionAggregateRefKey, sessionWorkLinkRefKey,
} from './session-record-codecs.js';
import { readSessionWorkLinks } from './session-links.js';
import { lookupAll } from '../persistence/lookup-all.js';
import {
  eventIdOf, fingerprintOf, identityKeyOf, ownRequest, trustedContext,
  type OwnedRequest, type TrustedContext,
} from './trusted-context.js';
import {
  SESSION_ARCHIVE_REQUESTED_EVENT, SESSION_RESPONSIBILITY_CHANGED_EVENT, SESSION_WORK_LINK_CHANGED_EVENT,
  encodeSessionResponsibilityChangedEvent, encodeSessionWorkLinkChangedEvent, sessionArchiveChangedEventFromEvent,
  sessionResponsibilityChangedEventFromEvent, sessionWorkLinkChangedPayloadFromEvent,
  type SessionResponsibilityChangedEventV1,
} from './lifecycle-record-codecs.js';
import {
  destinationEligible, openDestination, transitionResponsibility, type PendingResponsibleLinkV1,
  type ResponsibilityGuardV1, type ResponsibilityStateV1,
} from '../state/session-responsibility.js';
import {
  planReanchor, REANCHOR_REASONS, type ReanchorCatalogFactsV1, type ReanchorGoalFactsV1,
  type ReanchorPlanV1, type ReanchorReasonV1,
} from '../state/reanchor.js';
import { foldRoleScopeClaimChanges, responsibilityClaimChanges } from '../state/role-scope.js';
import { roleLineCommitContribution } from './role-scope-commit.js';
import { readGoalRecord } from './session-targets.js';
import { readMainWorkspace } from './role-line-operations.js';

/** The saved four numbers of one handoff transfer plus the task it moves. */
export type SavedTransferInputV1 = {
  requestId: string; from: SessionRef; to: SessionRef; target: WorkLinkTarget;
  expected: { fromSession: number; toSession: number; sourceLink: number; destinationLink: number };
};
export type ReanchorInputV1 = {
  session: SessionRef;
  close: readonly SessionWorkLinkRef[];
  open: readonly { target: WorkLinkTarget }[];
  reason: ReanchorReasonV1;
  /** O1b's change-scope step: folded into the same commit as the links and claims. */
  operation?: { record: EncodedRecord; expectedRevision: number | null };  // null = must not exist yet
  /** Lead (11-04, O1b's split link): a split's other Session — the destinations open on it, in the same commit as the
   *  source's close; only with `reason: 'split'` and never `session` itself. */
  destination?: SessionRef;
};
/** The committed Session; an open-only replay (no source link) answers the Session as read now, because link events
 *  carry no Session record (L-7). */
export type ReanchorResultV1 = {
  session: SessionRecord;
  closed: readonly SessionWorkLinkRef[];
  opened: readonly SessionWorkLinkRef[];
  owners: readonly { link: SessionWorkLinkRef; claimKey: string }[];
};
export interface SessionResponsibilityReceiptReadPort {
  /** Read only, never attempts: the committed transfer under the saved identity, or `not_found`. */
  readTransferReceipt(ctx: CoreCallContext, saved: SavedTransferInputV1):
    Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>>;
}
export interface SessionResponsibilityPort {
  transferSessionResponsibility(ctx: CoreCallContext, request: GraphWrite<{
    from: SessionRef; to: SessionRef; target: WorkLinkTarget;
  }>): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>>;
  disposeArchiveResponsibility(ctx: CoreCallContext, step: ArchiveStepRefV1,
    proof?: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[] }):
    Promise<WriteResult<{ closed: SessionWorkLink; opened: SessionWorkLink | null }>>;
  closeTerminalResponsibility(ctx: CoreCallContext, request: GraphWrite<{
    sessionRef: SessionRef; target: WorkLinkTarget;
  }>): Promise<WriteResult<SessionWorkLink>>;
  reanchorSessionResponsibility(ctx: CoreCallContext, request: GraphWrite<ReanchorInputV1>,
    proof?: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[] }):
    Promise<WriteResult<ReanchorResultV1>>;
}

export type SessionResponsibilityStores = {
  records: GoalRecordTransactionPort;
  lookups: RecordLookupPort;
  basis: SessionResponsibilityBasisPort;
  duty: SessionDutyReadPort;
  now(): string;
};

function mapReadFailure<T>(result: ReadResult<T>): CoreRejection {
  if (result.status === 'rejected') return result;
  if (result.status === 'not_found') return reject('not_found', 'the responsibility facts do not exist');
  return reject('unavailable', 'the responsibility facts are not ready at the requested read window');
}

/** The four pins in the order the transfer child's `meta.expected` uses; a `0` is the legal absent revision. */
export function transferPinsOf(saved: SavedTransferInputV1): VersionPin[] {
  return [
    { ref: plainSessionRefToAggregate(saved.from), revision: saved.expected.fromSession },
    { ref: plainSessionRefToAggregate(saved.to), revision: saved.expected.toSession },
    { ref: responsibleLinkRef(saved.from, saved.target), revision: saved.expected.sourceLink },
    { ref: responsibleLinkRef(saved.to, saved.target), revision: saved.expected.destinationLink },
  ];
}

/** The one `responsible` link ref of a transfer's source or destination Session. */
export function responsibleLinkRef(session: SessionRef, target: WorkLinkTarget) {
  return { ...session, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
}

/** The shared claim adapter: only a `responsible` link naming a role scope takes part in a claim. */
export async function scopeClaimChangesOf(
  ctx: CoreCallContext, duty: SessionDutyReadPort, session: SessionRecord,
  close: readonly SessionWorkLinkRef[], open: readonly SessionWorkLinkRef[],
): Promise<{ ok: true; duty: PlatformDutyV1 | null; changes: readonly RoleScopeClaimChangeV1[] }
  | { ok: false; rejection: CoreRejection }> {
  const closeScopes = close.filter((link) => link.relation === 'responsible' && roleScopeOfTarget(link.target) !== null);
  const openScopes = open.filter((link) => link.relation === 'responsible' && roleScopeOfTarget(link.target) !== null);
  if (closeScopes.length === 0 && openScopes.length === 0) return { ok: true, duty: null, changes: [] };
  const resolved = await duty(session.role, ctx);
  if (resolved.status !== 'ready') {
    return {
      ok: false,
      rejection: reject('unavailable',
        resolved.status === 'rejected' ? resolved.reason : 'the Session duty is not ready'),
    };
  }
  const counted = roleLineDutyOf(resolved.value);
  if (resolved.value === 'unknown' || counted === null) {
    return { ok: false, rejection: reject('unavailable', 'the Session duty is unknown') };
  }
  // O1b (lead 5): a reviewer counts as executor but takes no claim, like the secretary.
  if (resolved.value === 'reviewer') return { ok: true, duty: 'reviewer', changes: [] };
  return {
    ok: true,
    duty: resolved.value,
    changes: responsibilityClaimChanges({
      projectRef: { projectId: session.ref.projectId },
      close: closeScopes.map((link) => ({ link, duty: counted })),
      open: openScopes.map((link) => ({ link, duty: counted })),
    }),
  };
}

/** A `0` pin means the caller read an absent link; the store's CAS spells that `null`, never a revision the row never had. */
function cas(revision: number | null): number | null {
  return revision === null || revision === 0 ? null : revision;
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

/**
 * b12: the proof is built from the commit's real pins and the card answer; a plain call passes no options. The one
 * copy for the archive event and the two responsibility writers.
 */
export const proofOfAnswer = (options: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[] } | undefined,
  changed: readonly { before: VersionPin; after: VersionPin }[]): DecisionChangeProofV1 | undefined =>
  options === undefined ? undefined : {
    acknowledgementRef: structuredClone(options.answerRef),
    capturedPins: options.capturedPins.map((pin) => structuredClone(pin)),
    changes: changed.map(({ before, after }) => ({ before: structuredClone(before), after: structuredClone(after) })),
    basisRebases: [],
  };

export type ProjectScopeMoveV1 = {
  destination: SessionRef;
  open: PendingResponsibleLinkV1;                 // the destination's project link
  claimChange: RoleScopeClaimChangeV1;            // null → the destination link
  destinationGuard: RecordGuard; destinationSessionGuard: RecordGuard;
};

/**
 * L38 (book :708-:712): one adviser and one scribe line hold the project scope. When that line is archived its
 * project link moves, in the archive's own commit, to the active same-duty line of the project's main workspace
 * (v4 :2931; the call's workspace when the project has none, as every role-line operation reads it) with the fewest
 * open responsible goal/module links, tie by the smaller `sessionId`. With no other line the answer is `null`: the link is
 * released and the next line opened for the duty receives it. A secretary's project link is a filter and takes no
 * claim (book :710-:711), so it never moves.
 */
export async function moveProjectScope(
  ctx: CoreCallContext,
  stores: { records: GoalRecordTransactionPort; lookups: RecordLookupPort; duty: SessionDutyReadPort },
  input: { source: SessionRef; duty: PlatformDutyV1; links: readonly SessionWorkLink[] },
): Promise<ReadResult<ProjectScopeMoveV1 | null>> {
  if (input.duty !== 'adviser' && input.duty !== 'scribe') return { status: 'ready', value: null };
  const held = input.links.find((link) => link.until === null && link.ref.relation === 'responsible'
    && link.ref.target.kind === 'project');
  if (held === undefined) return { status: 'ready', value: null };
  const main = await readMainWorkspace(stores.records, input.source.projectId);
  if (main.status !== 'ready') return main;
  let active: readonly EncodedRecord[];
  try {
    active = (await lookupAll(stores.lookups, SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
      [input.source.projectId, main.value ?? ctx.workspaceId ?? '', 'active'])).items;
  } catch (error) {
    return reject('unavailable', `the project's active Sessions cannot be read: ${messageOf(error)}`);
  }
  // A role's duty is read once per workspace and role; every line of the main workspace is a candidate.
  const duties = new Map<string, PlatformDutyV1 | 'unknown'>();
  let best: { session: SessionRecord; links: readonly SessionWorkLink[]; load: number } | null = null;
  for (const record of active) {
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `a project Session is damaged: ${decoded.reason}`);
    const session = decoded.value;
    if (session.ref.sessionId === input.source.sessionId || !destinationEligible(session)) continue;
    const roleKey = `${session.workspaceId}:${canonicalOf(session.role) ?? ''}`;
    let sessionDuty = duties.get(roleKey);
    if (sessionDuty === undefined) {
      const read = await stores.duty(session.role, { ...ctx, workspaceId: session.workspaceId });
      if (read.status !== 'ready') {
        return read.status === 'rejected' ? read : reject('unavailable', 'a same-project Session duty is not ready');
      }
      sessionDuty = read.value;
      duties.set(roleKey, sessionDuty);
    }
    if (sessionDuty !== input.duty) continue;
    const links = await readSessionWorkLinks(stores.lookups, session.ref.projectId, session.ref.sessionId);
    if (!links.ok) return links.rejection;
    const load = links.links.filter((link) => link.until === null && link.ref.relation === 'responsible'
      && (link.ref.target.kind === 'goal' || link.ref.target.kind === 'module')).length;
    if (best === null || load < best.load
      || (load === best.load && session.ref.sessionId < best.session.ref.sessionId)) {
      best = { session, links: links.links, load };
    }
  }
  if (best === null) return { status: 'ready', value: null };
  const destination: SessionRef = { projectId: best.session.ref.projectId, sessionId: best.session.ref.sessionId };
  const existing = best.links.find((link) => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'project') ?? null;
  const { opened } = openDestination(existing, destination, held.ref.target);
  const [claimChange] = responsibilityClaimChanges({ projectRef: { projectId: input.source.projectId }, close: [],
    open: [{ link: opened.ref, duty: input.duty }] });
  return { status: 'ready', value: {
    destination, open: opened, claimChange: claimChange!,
    destinationGuard: { refKey: sessionWorkLinkRefKey(opened.ref), expectedRevision: existing?.revision ?? null },
    destinationSessionGuard: { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(destination)),
      expectedRevision: best.session.revision },
  } };
}

export function createSessionResponsibilityService(stores: SessionResponsibilityStores):
  SessionResponsibilityPort & SessionResponsibilityReceiptReadPort {
  const { records, basis, duty, now } = stores;

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
    basis: ResponsibilityBasisV1;
    eventId: string;
    /** b12: a card-applied change's proof; absent on a plain call. */
    proof?: DecisionChangeProofV1;
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
      basis: args.basis,
      ...(args.proof === undefined ? {} : { proof: args.proof }),
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
    claimChanges: readonly RoleScopeClaimChangeV1[];
  }): { ok: true; prepared: PreparedCommit } | { ok: false; rejection: CoreRejection } {
    const guards = new Map<string, RecordGuard>();
    for (const guard of args.basisGuards) guards.set(guard.refKey, guard);
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
    const contribution = roleLineCommitContribution({
      projectRef: { projectId: args.source.ref.projectId },
      records: recordsToWrite,
      guards: [...guards.values()],
      links: [],
      claimChanges: args.claimChanges,
      bindings: [],
      events: [encodeSessionResponsibilityChangedEvent(args.event)],
      allocation: null,
    }, null);
    if (!contribution.ok) return { ok: false, rejection: contribution.rejection };
    return {
      ok: true,
      prepared: {
        identityKey: args.identityKey,
        fingerprint: args.fingerprint,
        indexGuards: [],
        indexChanges: [],
        ...contribution.fragment,
        commitCursorBindings: bindings,
      },
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
    if (at.status !== 'ready') return sessionStoreFailureToRejection(at);
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
    if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);

    const attempt = await runTransferAttempt({
      ctx, scope, input, expected, fromKey, toKey, sourceLinkKey, destinationLinkKey, identityKey, fingerprint,
    });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') return readTransferResult(again.value, scope, fromKey);
    if (again.code !== 'not_found') return sessionStoreFailureToRejection(again);
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
    if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
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
    const taskBasis = proof.basis.kind === 'task' ? proof.basis : null;
    if (taskBasis !== null && taskBasis.task.projectId !== scope.projectId) {
      return reject('forbidden', 'archive_scope: the responsibility Task belongs to another project');
    }
    const guard: ResponsibilityGuardV1 = {
      sameScope: destination.workspaceId === scope.workspaceId,
      targetValid: true,
      taskTerminal: taskBasis === null ? false : proof.terminal,
      writerStopped: taskBasis === null ? true : proof.writerStopped,
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
    // The claim hand-over: the source duty releases the closed claim, the
    // destination duty takes the opened one, and one fold covers both lists.
    const closeChanges = await scopeClaimChangesOf(ctx, duty, effect.source, [effect.closed.ref], []);
    if (!closeChanges.ok) return closeChanges.rejection;
    const openChanges = effect.opened !== null && effect.openedBound !== null
      ? await scopeClaimChangesOf(ctx, duty, destination, [], [effect.opened.ref]) : null;
    if (openChanges !== null && !openChanges.ok) return openChanges.rejection;
    const claimChanges = foldRoleScopeClaimChanges({ projectId: scope.projectId },
      [...closeChanges.changes, ...(openChanges?.changes ?? [])]);
    const event = buildEvent({
      scope, mode: 'transfer', source: effect.source, destination: effect.destination,
      closed: effect.closed, opened: effect.opened, openedBound: effect.openedBound,
      archiveStep: null, basis: proof.basis, eventId: eventIdOf(identityKey, 'responsibility'),
    });
    const prepared = writePrepared({
      identityKey, fingerprint, eventId: event.eventId, event,
      source: effect.source, destination: effect.destination, closed: effect.closed,
      opened: effect.opened, openedBound: effect.openedBound,
      sourceKey: fromKey, destinationKey: toKey, sourceLinkKey, destinationLinkKey,
      basisGuards: proof.guards,
      expectedSource: pins.fromSession.revision, expectedDestination: pins.toSession.revision,
      expectedSourceLink: pins.sourceLink.revision, expectedDestinationLink: pins.destinationLink.revision,
      claimChanges,
    });
    if (!prepared.ok) return prepared.rejection;
    if (ctx.signal?.aborted) return reject('cancelled', 'the responsibility transfer was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared.prepared);
    } catch {
      return reject('unavailable', 'the responsibility transfer commit failed before completing');
    }
    if (committed.status !== 'committed') return sessionStoreFailureToRejection(committed);
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
      return sessionStoreFailureToRejection(found);
    }
    const at = await records.eventAt(found.value.cursor);
    if (at.status !== 'ready') return sessionStoreFailureToRejection(at);
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
    cardProof?: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[] },
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
    if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
    const attempt = await runDisposeAttempt({ ctx, scope, step: ownedStep, request, choice, identity,
      ...(cardProof === undefined ? {} : { cardProof }) });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const again = await records.lookupCommit({ identityKey: identity.identityKey, fingerprint: identity.fingerprint });
    if (again.status === 'ready') return readEventResult(again.value, scope, sessionAggregateRefKey(plainSessionRefToAggregate(ownedStep.sessionRef)));
    if (again.code !== 'not_found') return sessionStoreFailureToRejection(again);
    return attempt;
  }

  async function runDisposeAttempt(args: {
    ctx: CoreCallContext; scope: WorkspaceScope; step: ArchiveStepRefV1; request: SessionArchiveRequestV1;
    choice: ArchiveTaskChoiceV1; identity: { identityKey: string; fingerprint: string; eventId: string };
    cardProof?: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[] };
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
    if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
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
    // A module hand-over's destination must be an active executor line; `destinationEligible` checks only the
    // Session's lifecycle, health, archive request and readonly-copy provenance, never the line duty. The read is
    // this choice's one destination-duty read and also supplies the destination claim change below.
    let destinationDuty: RoleLineDutyV1 | null = null;
    if (transfer !== null && target.kind === 'module' && destination !== null) {
      const resolved = await duty(destination.role, ctx);
      if (resolved.status !== 'ready') {
        return resolved.status === 'rejected' ? resolved
          : reject('unavailable', `the destination Session duty is ${resolved.status}`);
      }
      const counted = roleLineDutyOf(resolved.value);
      if (counted !== 'executor') {
        return reject('unavailable', 'the destination Session is not an active executor line');
      }
      destinationDuty = counted;
    }
    const basisResult = await basis.readResponsibilityBasis(ctx, { sessionRef: step.sessionRef, target });
    if (basisResult.status !== 'ready') return mapReadFailure(basisResult);
    const proof = basisResult.value;
    const taskBasis = proof.basis.kind === 'task' ? proof.basis : null;
    const guard: ResponsibilityGuardV1 = {
      sameScope: destination === null || destination.workspaceId === scope.workspaceId,
      targetValid: true,
      taskTerminal: taskBasis === null ? false : proof.terminal,
      writerStopped: taskBasis === null ? true : proof.writerStopped,
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
    // b12: the disposal's real before/after pins (the effect's records), only when a card answer is supplied.
    const eventProof = proofOfAnswer(args.cardProof, [
      { before: { ref: source.ref, revision: source.revision },
        after: { ref: effect.source.ref, revision: effect.source.revision } },
      { before: { ref: effect.closed.ref, revision: sourceLink?.revision ?? 0 },
        after: { ref: effect.closed.ref, revision: effect.closed.revision } },
      ...(destination === null || effect.destination === null ? [] : [{
        before: { ref: destination.ref, revision: destination.revision },
        after: { ref: effect.destination.ref, revision: effect.destination.revision } }]),
      ...(effect.opened === null || effect.openedBound === null ? [] : [{
        before: { ref: effect.opened.ref, revision: destinationLink?.revision ?? 0 },
        after: { ref: effect.opened.ref, revision: effect.opened.revision } }]),
    ]);
    const responsibilityEvent = buildEvent({
      scope, mode, source: effect.source, destination: effect.destination,
      closed: effect.closed, opened: effect.opened, openedBound: effect.openedBound,
      archiveStep: step, basis: proof.basis, eventId: identity.eventId,
      ...(eventProof === undefined ? {} : { proof: eventProof }),
    });
    // §5.2: a drop releases only the source claim; a module hand-over releases the source and takes the
    // destination's claim, and the one fold covers both lists. No second duty read: the destination duty came
    // from the hand-over check above.
    const closeChanges = await scopeClaimChangesOf(ctx, duty, effect.source, [effect.closed.ref], []);
    if (!closeChanges.ok) return closeChanges.rejection;
    const openChanges = destinationDuty !== null && effect.opened !== null && effect.openedBound !== null
      ? responsibilityClaimChanges({ projectRef: { projectId: scope.projectId }, close: [],
        open: [{ link: effect.opened.ref, duty: destinationDuty }] })
      : [];
    const claimChanges = foldRoleScopeClaimChanges({ projectId: scope.projectId },
      [...closeChanges.changes, ...openChanges]);
    const prepared = writePrepared({
      identityKey: identity.identityKey, fingerprint: identity.fingerprint, eventId: identity.eventId,
      event: responsibilityEvent, source: effect.source, destination: effect.destination,
      closed: effect.closed, opened: effect.opened, openedBound: effect.openedBound,
      sourceKey: fromKey, destinationKey: toKey, sourceLinkKey, destinationLinkKey,
      basisGuards: proof.guards,
      expectedSource: source.revision, expectedDestination: destination?.revision ?? null,
      expectedSourceLink: sourceLink?.revision ?? null, expectedDestinationLink: destinationLink?.revision ?? null,
      claimChanges,
    });
    if (!prepared.ok) return prepared.rejection;
    if (ctx.signal?.aborted) return reject('cancelled', 'the responsibility disposal was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared.prepared);
    } catch {
      return reject('unavailable', 'the responsibility disposal commit failed before completing');
    }
    if (committed.status !== 'committed') return sessionStoreFailureToRejection(committed);
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
    if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
    const attempt = await runTerminalAttempt({ ctx, scope, input, sessionKey, linkKey, expected, identityKey, fingerprint });
    if (attempt.status !== 'rejected' || attempt.code === 'cancelled') return attempt;
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') {
      const restored = await readEventResult(again.value, scope, sessionKey);
      if (restored.status !== 'committed') return restored;
      return { status: 'committed', value: restored.value.closed, replayed: true, cursor: again.value.cursor };
    }
    if (again.code !== 'not_found') return sessionStoreFailureToRejection(again);
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
    if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
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
    const taskBasis = proof.basis.kind === 'task' ? proof.basis : null;
    const guard: ResponsibilityGuardV1 = {
      sameScope: source.workspaceId === scope.workspaceId, targetValid: true,
      taskTerminal: taskBasis === null ? false : proof.terminal,
      writerStopped: taskBasis === null ? true : proof.writerStopped,
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
      closed: effect.closed, opened: null, openedBound: null, archiveStep: null, basis: proof.basis,
      eventId: eventIdOf(identityKey, 'responsibility'),
    });
    const prepared = writePrepared({
      identityKey, fingerprint, eventId: event.eventId, event,
      source: effect.source, destination: null, closed: effect.closed, opened: null, openedBound: null,
      sourceKey: sessionKey, destinationKey: null, sourceLinkKey: linkKey, destinationLinkKey: null,
      basisGuards: proof.guards,
      expectedSource: expected.session.revision, expectedDestination: null,
      expectedSourceLink: expected.link.revision, expectedDestinationLink: null,
      claimChanges: [],
    });
    if (!prepared.ok) return prepared.rejection;
    if (ctx.signal?.aborted) return reject('cancelled', 'the terminal responsibility close was cancelled before commit');
    let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
    try {
      committed = await records.commit(prepared.prepared);
    } catch {
      return reject('unavailable', 'the terminal responsibility close commit failed before completing');
    }
    if (committed.status !== 'committed') return sessionStoreFailureToRejection(committed);
    if (committed.replayed) {
      const restored = await readEventResult(committed, scope, sessionKey);
      if (restored.status !== 'committed') return restored;
      return { status: 'committed', value: restored.value.closed, replayed: true, cursor: committed.cursor };
    }
    return { status: 'committed', value: boundClosed(effect.closed, committed.cursor), replayed: false, cursor: committed.cursor };
  }

  // ------------------------------------------------------------------------
  // reanchorSessionResponsibility (public GraphWrite)
  // ------------------------------------------------------------------------

  type ReanchorFactReadV1 = {
    duty: RoleLineDutyV1;
    /** O1b-02 (lead 5): a reviewer counts as executor but takes no claim. */
    reviewer: boolean;
    goals: ReadonlyMap<string, ReanchorGoalFactsV1>;
    catalog: ReanchorCatalogFactsV1;
    guards: readonly RecordGuard[];
  };

  async function readReanchorFacts(
    ctx: CoreCallContext, scope: WorkspaceScope, session: SessionRecord,
    close: readonly WorkLinkTarget[], open: readonly WorkLinkTarget[],
  ): Promise<ReanchorFactReadV1 | CoreRejection> {
    const resolved = await duty(session.role, ctx);
    if (resolved.status !== 'ready') {
      return reject('unavailable',
        resolved.status === 'rejected' ? resolved.reason : 'the Session duty is not ready');
    }
    const counted = roleLineDutyOf(resolved.value);
    if (counted === null) return reject('unavailable', 'the Session duty is unknown');
    const goals = new Map<string, ReanchorGoalFactsV1>();
    const guards: RecordGuard[] = [];
    // One Goal read per named goal, close sources and open destinations included.
    for (const target of [...close, ...open]) {
      if (target.kind !== 'goal') continue;
      if (goals.has(target.ref.goalId)) continue;
      const read = await readGoalRecord(records, target.ref);
      if (read.status === 'ready') {
        goals.set(target.ref.goalId, {
          state: 'present', ref: target.ref, snapshot: read.goal,
          version: { ref: target.ref, revision: read.goal.revision },
        });
        guards.push({ refKey: canonicalKey(target.ref), expectedRevision: read.goal.revision });
      } else if (read.code === 'not_found') {
        goals.set(target.ref.goalId, { state: 'absent', ref: target.ref });
      } else {
        return mapReadFailure(read);
      }
    }
    // The catalog is read only for a module destination; every other move
    // passes the explicit none arm (L3.12).
    let catalog: ReanchorCatalogFactsV1 = { state: 'none', revision: 0 };
    if (open.some((target) => target.kind === 'module')) {
      const window = await readCurrentCatalogWindow(records, scope.projectId);
      if (window.status === 'not_found') {
        catalog = { state: 'none', revision: 0 };
      } else if (window.status !== 'ready') {
        return window;
      } else {
        catalog = { state: 'present', revision: window.activeRevision, catalog: window.catalog.catalog };
        guards.push(...window.guards);
      }
    }
    return { duty: counted, reviewer: resolved.value === 'reviewer', goals, catalog, guards };
  }

  function resultOf(plan: ReanchorPlanV1, scope: WorkspaceScope, sessionRef: SessionRef): ReanchorResultV1 {
    const projectId = scope.projectId;
    return {
      // Every committed plan folds its own Session (the commit needs an event; each comes from a move or an opened link).
      session: plan.sessions.find((entry) => entry.ref.sessionId === sessionRef.sessionId)!,
      closed: plan.events.map((event) => event.closed),
      opened: [...plan.events.flatMap((event) => event.opened === null ? [] : [event.opened]),
        ...(plan.events.length > 0 ? [] : plan.links.flatMap((entry) => entry.next === null ? [] : [entry.link]))],
      // The public projection uses the same key mapping as the commit contribution: an
      // executor's region target is the module-maintainer claim, every other change the
      // role-scope claim. An old reanchor replay keeps its stored `owners: []`.
      owners: plan.claimChanges.filter((change) => change.nextOwner !== null).map((change) => ({
        link: change.nextOwner!,
        claimKey: change.duty === 'executor' && change.target.kind === 'region'
          ? moduleMaintainerKey(change.target.moduleRef)
          : roleScopeClaimKey({ projectRef: { projectId }, duty: change.duty, target: change.target }),
      })),
    };
  }

  async function readReanchorResult(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
    scope: WorkspaceScope,
    sessionRef: SessionRef,
  ): Promise<WriteResult<ReanchorResultV1>> {
    if (receipt.eventIds.length === 0) return reject('unavailable', 'the recorded reanchor receipt names no event');
    let lastSequence: number;
    try {
      lastSequence = seqOfCommitCursor(receipt.cursor);
    } catch (error) {
      return reject('unavailable', `the recorded reanchor cursor is not a ledger cursor: ${String(error)}`);
    }
    const firstSequence = lastSequence - (receipt.eventIds.length - 1);
    if (firstSequence < 1) return reject('unavailable', 'the recorded reanchor receipt has no room for its events');
    const closed: SessionWorkLinkRef[] = [];
    const opened: SessionWorkLinkRef[] = [];
    let session: SessionRecord | null = null;
    for (const [index, eventId] of receipt.eventIds.entries()) {
      const cursor = makeCommitCursor(firstSequence + index);
      const at = await records.eventAt(cursor);
      if (at.status !== 'ready') return sessionStoreFailureToRejection(at);
      if (String(at.value.cursor) !== String(cursor) || at.value.event.eventId !== eventId) {
        return reject('unavailable', 'the recorded reanchor receipt disagrees with its events');
      }
      // D-3: an open-only reanchor's receipt names link events only.
      if (at.value.event.eventType === SESSION_WORK_LINK_CHANGED_EVENT) {
        const linked = sessionWorkLinkChangedPayloadFromEvent(at.value.event);
        if (linked.status !== 'decoded') {
          return reject('unavailable', `the recorded reanchor event is not decodable: ${linked.reason}`);
        }
        if (linked.value.projectId !== scope.projectId || linked.value.workspaceId !== scope.workspaceId) {
          return reject('unavailable', 'the recorded reanchor event belongs to another scope');
        }
        if (linked.value.sessionRef.sessionId !== sessionRef.sessionId) {
          return reject('unavailable', 'the recorded reanchor event belongs to another Session');
        }
        opened.push(linked.value.link.ref);
        continue;
      }
      const decoded = sessionResponsibilityChangedEventFromEvent(at.value.event);
      if (decoded.status !== 'decoded') {
        return reject('unavailable', `the recorded reanchor event is not decodable: ${decoded.reason}`);
      }
      const event = decoded.value;
      if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
        return reject('unavailable', 'the recorded reanchor event belongs to another scope');
      }
      if (event.source.ref.projectId !== scope.projectId || event.source.ref.sessionId !== sessionRef.sessionId) {
        return reject('unavailable', 'the recorded reanchor event belongs to another Session');
      }
      if (session === null) session = event.source;
      else if (session.revision !== event.source.revision || canonicalOf(session.ref) !== canonicalOf(event.source.ref)) {
        return reject('unavailable', 'the recorded reanchor events disagree on the committed Session');
      }
      closed.push(event.closed.ref);
      if (event.opened !== null) opened.push(event.opened.ref);
    }
    if (session === null) {
      // D-3: link events carry no Session record; the open-only replay answers the Session as read now (L-7).
      const key = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
      const read = await records.readMany([key]);
      if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
      const current = await sessionFromRead(read.value.records, key, scope);
      if ('status' in current) return current;
      session = current;
    }
    return {
      status: 'committed', replayed: true, cursor: receipt.cursor,
      value: { session, closed, opened, owners: [] },
    };
  }

  async function reanchorSessionResponsibility(
    ctx: CoreCallContext, request: GraphWrite<ReanchorInputV1>,
    cardProof?: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[] },
  ): Promise<WriteResult<ReanchorResultV1>> {
    const trusted = trustedContext(ctx, 'a Session responsibility call');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the scope reanchor was cancelled before validation');
    const owned = ownRequest(request, 'reanchorSessionResponsibility');
    if (!owned.ok) return reject('invalid', owned.reason);
    const input = owned.input;
    if (!isObject(input)) return reject('invalid', 'reanchorSessionResponsibility requires an input object');
    const sessionProblem = checkPlainSessionRef(input.session);
    if (sessionProblem !== null) return reject('invalid', `reanchor session: ${sessionProblem}`);
    if (input.session.projectId !== scope.projectId) {
      return reject('forbidden', 'the reanchor Session belongs to another project');
    }
    if (!(REANCHOR_REASONS as readonly unknown[]).includes(input.reason)) {
      return reject('invalid', 'reanchorSessionResponsibility requires a recognized reason');
    }
    if (input.destination !== undefined) {
      const destinationProblem = checkPlainSessionRef(input.destination);
      if (destinationProblem !== null) return reject('invalid', `reanchor destination: ${destinationProblem}`);
      if (input.reason !== 'split' || input.destination.projectId !== scope.projectId
        || input.destination.sessionId === input.session.sessionId) {
        return reject('invalid', 'a reanchor destination is only the other Session of a split');
      }
    }
    if (!Array.isArray(input.close) || !Array.isArray(input.open)) {
      return reject('invalid', 'reanchorSessionResponsibility requires close and open arrays');
    }
    for (const source of input.close) {
      const problem = checkWorkLinkRef(source);
      if (problem !== null) return reject('invalid', `reanchor close: ${problem}`);
      if (source.projectId !== scope.projectId) {
        return reject('forbidden', 'the reanchor close link belongs to another project');
      }
      if (source.sessionId !== input.session.sessionId) {
        return reject('invalid', 'the reanchor close link belongs to another Session');
      }
      if (source.relation !== 'responsible') return reject('invalid', 'the reanchor close link is not a responsible link');
      if (roleScopeOfTarget(source.target) === null) return reject('invalid', 'the reanchor close target is not a role scope');
    }
    for (const entry of input.open) {
      if (!isObject(entry)) return reject('invalid', 'reanchorSessionResponsibility requires an open entry object');
      const problem = checkTarget(entry.target);
      if (problem !== null) return reject('invalid', `reanchor open: ${problem}`);
      if ((entry.target as WorkLinkTarget).ref.projectId !== scope.projectId) {
        return reject('forbidden', 'the reanchor open target belongs to another project');
      }
    }
    const sources = input.close;
    const sourceKeys = sources.map(sessionWorkLinkRefKey);
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.session));
    // Lead (split link): the destinations open on the split's other Session when one is named.
    const destinationKey = input.destination === undefined ? null
      : sessionAggregateRefKey(plainSessionRefToAggregate(input.destination));
    const destinationRefs: SessionWorkLinkRef[] = input.open.map((entry) => ({
      ...(input.destination ?? input.session), aggregateType: 'SessionWorkLink' as const, target: entry.target,
      relation: 'responsible' as const,
    }));
    const identityKey = identityKeyOf('session-responsibility-reanchor:', actor, scope, owned.requestId);
    // D-5 (book :329): a role-line command replays by its public command; the re-read close and pins stay guards only.
    // The split's link commit replays the same way (lead 11-04, q-o1b-split-pins: its pins are read fresh).
    const publicCommand = input.reason === 'human_scope_change' || input.reason === 'reuse' || input.reason === 'split';
    const named = input.destination === undefined ? {} : { destination: input.destination };
    const fingerprint = fingerprintOf('session-responsibility-reanchor-request', actor, scope,
      publicCommand ? { session: input.session, open: input.open, reason: input.reason, ...named }
        : { session: input.session, close: input.close, open: input.open, reason: input.reason, ...named },
      publicCommand ? [] : owned.expected);
    if (ctx.signal?.aborted) return reject('cancelled', 'the scope reanchor was cancelled before lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return readReanchorResult(existing.value, scope, input.session);
    if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
    const reanchorAttempt = async (): Promise<WriteResult<ReanchorResultV1>> => {
      const read = await records.readMany([sessionKey, ...(destinationKey === null ? [] : [destinationKey]),
        ...sourceKeys, ...destinationRefs.map(sessionWorkLinkRefKey)]);
      if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
      const session = await sessionFromRead(read.value.records, sessionKey, scope);
      if ('status' in session) return session;
      const destination = destinationKey === null ? null : await sessionFromRead(read.value.records, destinationKey, scope);
      if (destination !== null && 'status' in destination) return destination;
      const factsLinks = new Map<string, SessionWorkLink>();
      for (const [index, source] of sources.entries()) {
        const key = sourceKeys[index]!;
        const link = linkAt(read.value.records, key);
        if (link !== null && 'status' in link) return link;
        if (link === null || link.until !== null) return reject('not_found', 'the reanchor source link is not open');
        factsLinks.set(key, link);
      }
      for (const key of destinationRefs.map(sessionWorkLinkRefKey)) {
        const link = linkAt(read.value.records, key);
        if (link !== null && 'status' in link) return link;
        if (link !== null) factsLinks.set(key, link);
      }
      const destinationGuards = destinationRefs.map((ref) => {
        const key = sessionWorkLinkRefKey(ref);
        return {
          refKey: key,
          expectedRevision: cas(read.value.records.find((entry) => entry.refKey === key)?.revision ?? null),
        };
      });
      const facts = await readReanchorFacts(ctx, scope, session,
        sources.map((ref) => ref.target), input.open.map((entry) => entry.target));
      if ('status' in facts) return facts;
      const plan = planReanchor({
        projectRef: { projectId: scope.projectId }, duty: facts.duty,
        moves: sources.map((source) => ({
          duty: facts.duty, source,
          // Lead (split link): a split pairs each close only with the open of the same target.
          destinations: input.open.flatMap((entry, i) => input.reason === 'split'
            && canonicalKey(entry.target) !== canonicalKey(source.target) ? []
            : [{ link: destinationRefs[i]!, target: entry.target }]),
        })),
        // D-3: no source link -> the destinations open on their own (a standby line's reuse / scope change).
        open: sources.length > 0 ? []
          : input.open.map((entry, i) => ({ link: destinationRefs[i]!, target: entry.target })),
        facts: {
          sessions: new Map([[input.session.sessionId, session],
            ...(destination === null ? [] : [[destination.ref.sessionId, destination] as const])]), links: factsLinks,
          goals: facts.goals, catalog: facts.catalog,
        },
        authorization: { actor, scope: [{ kind: 'project' }] },
        proposed: null,
      });
      if (!plan.ok) return plan.refusals[0]!;
      const committedSession = (ref: SessionRef) => plan.plan.sessions.find((entry) => entry.ref.sessionId === ref.sessionId)!;
      // O1b-02 (lead 5): a reviewer's plan contributes no claim, and its result names no owner.
      const planned = facts.reviewer ? { ...plan.plan, claimChanges: [] } : plan.plan;
      const basisBySource = new Map<string, ResponsibilityBasisV1>();
      for (const source of sources) {
        const proof = await basis.readResponsibilityBasis(ctx, { sessionRef: input.session, target: source.target });
        if (proof.status !== 'ready') return mapReadFailure(proof);
        basisBySource.set(sessionWorkLinkRefKey(source), proof.value.basis);
      }
      // D-3: an open-only plan has no responsibility event; each link it writes gets the event `sessions/link` writes.
      const openedEvents = sources.length > 0 ? [] : plan.plan.links.flatMap((entry, index) => entry.next === null ? []
        : [encodeSessionWorkLinkChangedEvent({
          eventId: eventIdOf(identityKey, `link:${index}`), eventType: SESSION_WORK_LINK_CHANGED_EVENT,
          schemaVersion: 1, occurredAt: now(), projectId: scope.projectId, workspaceId: scope.workspaceId,
          sessionRef: input.session, sessionRevision: session.revision + 1,   // rememberSession's one bump
          active: true, link: entry.next, boundField: 'since' })]);
      // b12: the plan's real before/after pins (its Sessions and links), only when a card answer is supplied.
      const readSessions = [session, ...(destination === null ? [] : [destination])];
      const eventProof = proofOfAnswer(cardProof, [
        ...plan.plan.sessions.map((next) => ({
          before: { ref: next.ref, revision: readSessions.find((read) => read.ref.sessionId === next.ref.sessionId)
            ?.revision ?? 0 },
          after: { ref: next.ref, revision: next.revision } })),
        ...plan.plan.links.flatMap((entry) => entry.next === null ? [] : [{
          before: { ref: entry.link, revision: factsLinks.get(sessionWorkLinkRefKey(entry.link))?.revision ?? 0 },
          after: { ref: entry.link, revision: entry.next.revision } }]),
      ]);
      const contribution = roleLineCommitContribution({
        projectRef: { projectId: scope.projectId },
        records: [...plan.plan.sessions.map(encodeSessionRecord),
          ...(input.operation === undefined ? [] : [input.operation.record])],
        guards: [...owned.expected.map((pin) => ({
          refKey: canonicalKey(pin.ref), expectedRevision: cas(pin.revision),
        })), ...destinationGuards, ...facts.guards,
          ...(input.operation === undefined ? [] : [{ refKey: input.operation.record.refKey,
            expectedRevision: input.operation.expectedRevision }])],
        links: plan.plan.links, claimChanges: planned.claimChanges, bindings: plan.plan.bindings,
        events: [...plan.plan.events.map((event, index) => encodeSessionResponsibilityChangedEvent(buildEvent({
          scope, mode: event.opened === null ? 'drop' : 'transfer',
          source: committedSession(input.session), destination: committedSession(input.destination ?? input.session),
          closed: plan.plan.links.find((entry) => canonicalKey(entry.link) === canonicalKey(event.closed))!.next!,
          opened: event.opened === null ? null
            : plan.plan.links.find((entry) => canonicalKey(entry.link) === canonicalKey(event.opened))?.next
              ?? factsLinks.get(sessionWorkLinkRefKey(event.opened)) ?? null,
          openedBound: event.openedBound, archiveStep: null,
          basis: basisBySource.get(sessionWorkLinkRefKey(event.closed))!,
          eventId: eventIdOf(identityKey, `responsibility:${index}`),
          ...(eventProof === undefined ? {} : { proof: eventProof }),
        }))), ...openedEvents],
        allocation: null,
      }, null);
      if (!contribution.ok) return contribution.rejection;
      let committed: Awaited<ReturnType<GoalRecordTransactionPort['commit']>>;
      try {
        committed = await records.commit({ identityKey, fingerprint, indexGuards: [], indexChanges: [], ...contribution.fragment });
      } catch {
        return reject('unavailable', 'the scope reanchor commit failed before completing');
      }
      if (committed.status !== 'committed') return sessionStoreFailureToRejection(committed);
      if (committed.replayed) return readReanchorResult(committed, scope, input.session);
      return {
        status: 'committed', replayed: false, cursor: committed.cursor,
        value: resultOf(planned, scope, input.session),
      };
    };
    const refused = await reanchorAttempt();
    if (refused.status !== 'rejected' || refused.code === 'cancelled') return refused;
    // One same-identity/fingerprint receipt recheck for the whole post-lookup refusal path: a commit that
    // landed but lost its answer is restored here; a true miss keeps the attempt's own refusal.
    const again = await records.lookupCommit({ identityKey, fingerprint });
    if (again.status === 'ready') return readReanchorResult(again.value, scope, input.session);
    if (again.code !== 'not_found') return sessionStoreFailureToRejection(again);
    return refused;
  }

  async function readTransferReceipt(
    ctx: CoreCallContext, saved: SavedTransferInputV1,
  ): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>> {
    const trusted: TrustedContext = trustedContext(ctx, 'a Session responsibility read');
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted;
    if (ctx.signal?.aborted) return reject('cancelled', 'the transfer receipt read was cancelled');
    const fromKey = sessionAggregateRefKey(plainSessionRefToAggregate(saved.from));
    const toKey = sessionAggregateRefKey(plainSessionRefToAggregate(saved.to));
    const sourceLinkKey = sessionWorkLinkRefKey(responsibleLinkRef(saved.from, saved.target));
    const destinationLinkKey = sessionWorkLinkRefKey(responsibleLinkRef(saved.to, saved.target));
    const expected: VersionPin[] = transferPinsOf(saved);
    const pins = normalizeFourPins(expected, scope, {
      fromKey, toKey, sourceLinkKey, destinationLinkKey, from: saved.from, to: saved.to, target: saved.target,
    });
    if (!pins.ok) return reject('invalid', pins.reason);
    const identityKey = identityKeyOf('session-responsibility-transfer:', actor, scope, saved.requestId);
    const fingerprint = fingerprintOf('session-responsibility-transfer-request', actor, scope, {
      from: saved.from, to: saved.to, target: saved.target,
    }, expected);
    const found = await records.lookupCommit({ identityKey, fingerprint });
    if (found.status === 'ready') return readTransferResult(found.value, scope, fromKey);
    if (found.code === 'not_found') return reject('not_found', 'the transfer receipt has not been committed');
    return sessionStoreFailureToRejection(found);
  }

  return {
    transferSessionResponsibility,
    readTransferReceipt,
    disposeArchiveResponsibility,
    closeTerminalResponsibility,
    reanchorSessionResponsibility,
  };
}
