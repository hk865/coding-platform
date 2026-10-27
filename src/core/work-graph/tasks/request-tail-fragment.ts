/**
 * The request tail: the request side of one append, prepared without committing. The request
 * owner's two routing prepares and the attribution prepare share this one builder; it opens no
 * other entry, reads nothing and commits nothing, and the caller merges the fragment and retries.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext, HostPrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { canonicalKey as keyOf, sameJson } from '../../../contracts/fingerprint.js';
import { rejected } from '../../../contracts/core/rejections.js';
import {
  queryJobRefFor, type PendingQueryJobSnapshot, type QueryJobRef, type QueryJobSnapshot,
  type QuerySubmissionBindingV1, type RequestCommandReceiptV1,
} from '../../../contracts/query-job.js';
import type {
  EncodedDomainEvent, EncodedRecord, RecordGuard, UniqueClaimChange,
} from '../../record-store/ports.js';
import { requestTailKey } from '../model/request-contracts.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { rootOfFacts } from '../queries/request-round-claims.js';
import {
  encodeQueryJobSnapshot, encodeQueryJobSubmittedEvent, type QueryJobSubmittedEventV1,
} from '../queries/query-record-codecs.js';
import type { RequestRoundsFactsV1 } from '../queries/request-rounds-read.js';
import { newRoutingRound } from '../state/request-rounds.js';

/** The complete request facts the tail prepares from: the ordered rounds and runs, the tail and its guards, and
 *  the watermark (`W/queries/request-rounds-read.ts:50`). */
export type RequestTailFactsV1 = RequestRoundsFactsV1;
/** The attribution command: its own R2 command, never a request command. */
export type RequestTailAttributionCommandV1 = { kind: 'attribution'; goalAttribution: GoalRef };
/** The prepare's input: the full facts, the attribution command, the command identity and the two scalars the real
 *  round builder needs. It never carries a pre-built round. */
export type RequestTailPrepareInputV1 = {
  facts: RequestTailFactsV1;
  command: RequestTailAttributionCommandV1;
  identity: { commandId: string; identityKey: string; fingerprint: string };
  scope: { projectId: string; workspaceId: string };
  submittedAt: string;
};
/** The complete request side of one append; the caller merges it into its own single `records.commit`. */
export type RequestTailCommitFragmentV1 = {
  receipt: RequestCommandReceiptV1;
  records: readonly EncodedRecord[];
  events: readonly EncodedDomainEvent[];
  guards: readonly RecordGuard[];
  claims: readonly UniqueClaimChange[];
  round: QueryJobRef;
  /** The `since` cursor binding target; never null for a created round. */
  sinceRefKey: string;
  conflict: { source: 'fresh' | 'recipient' | 'none'; sessionRefKeys: readonly string[]; intakeKey: string | null };
  /** An attribution round is not an activity producer; this field stays `null` here. */
  activity: null;
};
/** The one prepare entry: it reads and builds the fragment, and commits nothing. */
export type PrepareRequestTail = (
  ctx: CoreCallContext,
  principal: HostPrincipal,
  input: RequestTailPrepareInputV1,
) => Promise<RequestTailCommitFragmentV1 | CoreRejection>;

/** Where the round's new holder came from: this decides which conflict re-picks. */
export type RequestTailAssignmentSourceV1 = 'fresh' | 'recipient' | 'none';

/** The input activity an append lands on a Session; `null` for a route away, a drop and an attribution. */
export type RequestTailActivityV1 = { session: SessionRef; at: string; source: QueryJobRef };

/** The ordinary routing round's command: the request owner's own route/assigned round. */
type RequestTailRoutingCommandV1 = {
  kind: 'routing';
  routing: NonNullable<QueryJobSnapshot['job']['routing']>;
};

/** The rejection vocabulary a request-tail prepare can answer; the same closed set the request owner uses. */
type RequestTailRejectionV1 = CoreRejection & {
  code: 'invalid' | 'forbidden' | 'unavailable' | 'busy' | 'not_found' | 'revision_conflict' | 'idempotency_conflict';
};

/** One routing append's fragment: the frozen request side of an append with the caller's activity. */
type RoutingTailInputV1 = {
  facts: RequestTailFactsV1;
  command: RequestTailAttributionCommandV1 | RequestTailRoutingCommandV1;
  identity: { commandId: string; identityKey: string; fingerprint: string };
  scope: WorkspaceScope;
  submittedAt: string;
  roundRef: QueryJobRef;
  eventId: string;
  claims: UniqueClaimChange[];
  records: EncodedRecord[];
  /** Records written after the routing round: the drain writes its intake record after the new round. */
  recordsAfterRound?: EncodedRecord[];
  guards: readonly (readonly RecordGuard[])[];
  conflict: RequestTailCommitFragmentV1['conflict'];
  activity: RequestTailActivityV1 | null;
};

type RoutingTailOutcomeV1<A extends RequestTailActivityV1 | null = RequestTailActivityV1 | null> =
  | { status: 'ready'; value: Omit<RequestTailCommitFragmentV1, 'activity'> & { activity: A } }
  | { status: 'retry' }
  | RequestTailRejectionV1;

/** A duplicate guard disagreement means the read window moved: re-read it, never pick a winner. */
const RETRY_WINDOW = { status: 'retry' } as const;

/** The one guard merge (`execution-entry-service.ts`); a conflicting duplicate rebuilds the read window. */
export function guardList(groups: readonly (readonly RecordGuard[])[]):
  { status: 'ready'; guards: RecordGuard[] } | { status: 'retry' } {
  const merged = mergeGuards(groups.flat());
  if (!merged.ok) return RETRY_WINDOW;
  return { status: 'ready', guards: merged.guards };
}

/**
 * A conflict on the target Session, classified by where the target came from:
 * a fresh pick answers `revision_conflict`, so Workflow re-picks without it; a
 * target the person or the drain named answers `busy`, because re-picking would
 * override that choice.
 */
export function targetConflict(source: RequestTailAssignmentSourceV1, reason: string): RequestTailRejectionV1 {
  return rejected(source === 'fresh' ? 'revision_conflict' : 'busy', reason);
}

/**
 * The guard merge of one prepared commit. A target Session read twice at two
 * revisions (once among the request facts, once by the admission check) changed
 * under this command and is classified by its source; any other disagreement
 * only means the request window moved, and the window is re-read.
 */
export function preparedGuards(
  groups: readonly (readonly RecordGuard[])[],
  target: { source: RequestTailAssignmentSourceV1; sessionRefKeys: readonly string[] },
): { status: 'ready'; guards: RecordGuard[] } | { status: 'retry' } | RequestTailRejectionV1 {
  if (target.source !== 'none') {
    const all = groups.flat();
    for (const refKey of target.sessionRefKeys) {
      const revisions = new Set(all.filter((guard) => guard.refKey === refKey).map((guard) => guard.expectedRevision));
      if (revisions.size > 1) return targetConflict(target.source, 'the target Session changed while the request was read');
    }
  }
  return guardList(groups);
}

export function nullGuard(refKey: string): RecordGuard {
  return { refKey, expectedRevision: null };
}

export function moveTailClaim(facts: RequestRoundsFactsV1 | null, requestRoot: QueryJobRef,
  next: QueryJobRef): UniqueClaimChange {
  const expected = facts === null ? null : keyOf(facts.tail.ref);
  return { claimKey: requestTailKey(requestRoot), expectedOwner: expected, nextOwner: keyOf(next) };
}

export function submittedEvent(input: {
  principal: HostPrincipal; job: PendingQueryJobSnapshot; eventId: string; identityKey: string; fingerprint: string;
  commandId: string; occurredAt: string;
}): QueryJobSubmittedEventV1 {
  const actor = input.principal.actor;
  return {
    eventId: input.eventId,
    eventType: 'QueryJobSubmitted',
    schemaVersion: 1,
    projectId: input.job.ref.projectId,
    workspaceId: input.job.ref.workspaceId,
    aggregateType: 'QueryJob',
    aggregateId: input.job.ref.queryJobId,
    aggregateRevision: 1,
    causationId: input.identityKey,
    correlationId: input.job.job.intent.correlationId,
    idempotencyKey: input.commandId,
    actor: { kind: actor.kind, id: actor.id } as ActorRef,
    occurredAt: input.occurredAt,
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    payload: { job: structuredClone(input.job.job) },
  };
}

export function requestTailSubmissionOf(identityKey: string, fingerprint: string, eventId: string): QuerySubmissionBindingV1 {
  return { schemaVersion: 1, identityKey, fingerprint, eventId };
}

function buildRequestTail<A extends RequestTailActivityV1 | null>(
  input: RoutingTailInputV1 & { principal: HostPrincipal; activity: A },
): RoutingTailOutcomeV1<A> {
  // `rootOfFacts` throws when the facts name no root round, so this find always matches it.
  const root = input.facts.rounds.find((round) => sameJson(round.ref, rootOfFacts(input.facts)))!;
  const receipt: RequestCommandReceiptV1 = { kind: 'route', routingRound: { ...input.roundRef } };
  const routingJob = newRoutingRound({
    queryJobId: input.roundRef.queryJobId,
    scope: input.scope,
    root,
    receipt,
    submission: requestTailSubmissionOf(input.identity.identityKey, input.identity.fingerprint, input.eventId),
    submittedAt: input.submittedAt,
    ...(input.command.kind === 'attribution'
      ? { routing: null, goalAttribution: input.command.goalAttribution }
      : { routing: input.command.routing }),
  });
  const guards = preparedGuards([...input.guards, [nullGuard(keyOf(routingJob.ref))]], input.conflict);
  if (guards.status !== 'ready') return guards;
  return {
    status: 'ready',
    value: {
      receipt,
      records: [...input.records, encodeQueryJobSnapshot(routingJob), ...(input.recordsAfterRound ?? [])],
      events: [encodeQueryJobSubmittedEvent(submittedEvent({
        principal: input.principal, job: routingJob, eventId: input.eventId,
        identityKey: input.identity.identityKey, fingerprint: input.identity.fingerprint,
        commandId: input.identity.commandId, occurredAt: input.submittedAt,
      }))],
      guards: guards.guards,
      claims: input.claims,
      round: { ...input.roundRef },
      sinceRefKey: keyOf(routingJob.ref),
      conflict: input.conflict,
      activity: input.activity,
    },
  };
}

/**
 * The request owner's own routing prepares (`prepareRoute`, `prepareAssigned`):
 * the same builder the attribution entry uses, with the caller's pre-work and activity.
 */
export const prepareRoutingRequestTail = (principal: HostPrincipal, input: RoutingTailInputV1): RoutingTailOutcomeV1 =>
  buildRequestTail({ ...input, principal });

/**
 * The attribution prepare: one `routing: null` round carrying the new Goal, its tail claim and no activity. The round
 * and event ids derive from the command's replay identity, never the raw command id, so two people's equal command
 * ids make two rounds and a retried prepare makes the same one.
 */
export function createRequestTailFragment(): PrepareRequestTail {
  return async (_ctx, principal, input) => {
    const roundRef = queryJobRefFor(input.scope.projectId, input.scope.workspaceId,
      `${input.identity.identityKey}:attribution`);
    // The facts' guards are already unique (the request read appends first-wins), so the one guard set cannot retry.
    const outcome = buildRequestTail({
      ...input,
      principal,
      roundRef,
      eventId: `${input.identity.identityKey}:attribution:submitted`,
      claims: [moveTailClaim(input.facts, rootOfFacts(input.facts), roundRef)],
      records: [],
      guards: [input.facts.guards],
      conflict: { source: 'none', sessionRefKeys: [], intakeKey: null },
      activity: null,
    }) as Exclude<RoutingTailOutcomeV1<null>, { status: 'retry' }>;
    return outcome.status === 'ready' ? outcome.value : outcome;
  };
}
