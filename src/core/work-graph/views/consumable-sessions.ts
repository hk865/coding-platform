/**
 * The all-Session consumption view: one bounded walk of the Session directory that answers, per
 * candidate, its availability, the busy reason and the offerable input kinds. It reads published facts only and
 * writes nothing: the directory scan is the Session owner's, the delivery verdict is the one `deliveryEligibility`
 * rule, and the offer order is the one `compareSessionInputCandidates`. `after`/`next` are Session keys
 * (`plainSessionRefKey`), never the opaque directory cursor that turns `source_stale` after any commit.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { queryJobRefFor } from '../../../contracts/query-job.js';
import type { SessionAvailability } from '../state/session-availability.js';
import type { SessionCard, SessionDirectoryPort, SessionPageRequest } from '../model/session-contracts.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import { consultationFacts, type SessionMessage } from '../model/communication-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { QueryJobPort } from '../queries/contracts.js';
import type { DeliveryEligibilityFactsPort } from '../model/session-facts-contracts.js';
import { deliveryEligibility } from '../state/message-machine.js';
import { plainSessionRefKey } from '../sessions/session-record-codecs.js';
import { compareSessionInputCandidates } from '../sessions/message-record-codecs.js';

/** The five kinds an offer can name; `notify` is listed but never opens a turn. */
export type ConsumableSessionKindV1 =
  | 'person_message' | 'action_request' | 'inquiry' | 'late_reply' | 'notify';
/** The busy reasons, in the order the view applies them. */
export type ConsumableSessionBusyV1 =
  | 'copy' | 'archive_request' | 'health' | 'claim_not_started' | 'run' | 'query' | 'unknown';
export type ConsumableSessionOfferV1 = {
  kind: ConsumableSessionKindV1;
  messageRef: SessionMessageRef;
};
export type ConsumableSessionV1 = {
  session: SessionRef;
  /** the Session's role; the Host matches its profile by `scope` + `sessionRole`. */
  role: RoleConfigurationRef;
  availability: SessionAvailability;
  /** non-null means no offer is acted on; `kinds`/`nextMessage` are then empty/null. */
  busy: ConsumableSessionBusyV1 | null;
  /** offerable kinds in precedence order (person first); `['notify']` is the no-turn case. */
  kinds: readonly ConsumableSessionKindV1[];
  /** the first non-`notify` offer, or null; the Host reads this one message and opens one turn. */
  nextMessage: ConsumableSessionOfferV1 | null;
};
export type ConsumableSessionsPageV1 = {
  items: ConsumableSessionV1[];
  /** the last candidate Session key returned (plainSessionRefKey); null when the walk reached the end (wrap next heartbeat). */
  next: string | null;
};
export type ConsumableSessionsDependencies = {
  directory: Pick<SessionDirectoryPort, 'findSessions'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  queries: Pick<QueryJobPort, 'readQueryJob'>;
  messages: Pick<SessionMailboxPort, 'readInbox' | 'readOutbox'>;
  /** The delivery-eligibility facts the offer rule reads (`session-facts-contracts.ts:79`). */
  eligibility: DeliveryEligibilityFactsPort;
};
export interface ConsumableSessionsPort {
  readConsumableSessions(ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; after: string | null; limit: number }):
    Promise<ReadResult<ConsumableSessionsPageV1>>;
}

export function createConsumableSessions(deps: ConsumableSessionsDependencies):
  Pick<ConsumableSessionsPort, 'readConsumableSessions'> {
  type CandidateOffer = {
    kind: ConsumableSessionKindV1;
    message: SessionMessage;
    cursor: () => CommitCursor;
  };
  type OfferSet = {
    kinds: ConsumableSessionKindV1[];
    nextMessage: ConsumableSessionOfferV1 | null;
  };

  const ready = <T>(value: T): ReadResult<T> => ({ status: 'ready', value });

  /** The first matching kind of an inbox message; a `notify` is a `notify` whoever sent it. */
  function offerKindOf(message: SessionMessage): ConsumableSessionKindV1 | null {
    if (message.intent === 'notify') return 'notify';
    if (message.intent === 'inquiry') return 'inquiry';
    if (message.intent === 'decision_request') return null;
    if (message.sender.kind === 'host' && message.sender.actor.kind === 'human') return 'person_message';
    if ((message.sender.kind === 'work_run' || message.sender.kind === 'secretary_round')
      && message.intent === 'action_request' && message.release === 'released') return 'action_request';
    return null;
  }

  /**
   * The busy reasons, in the order they apply. A non-ready execution/query read is returned
   * unchanged, never guessed into a busy kind.
   */
  async function busyReasonOf(ctx: CoreCallContext, record: SessionCard['record']):
    Promise<ReadResult<ConsumableSessionBusyV1 | null>> {
    if (record.provenance.kind === 'readonly_copy') return ready('copy');
    if (record.archiveRequest != null) return ready('archive_request');
    if (record.health !== 'available' || record.lifecycle === 'archived') return ready('health');
    const occupancy = record.occupancy;
    if (occupancy === null) return ready(null);
    if (occupancy.kind === 'maintenance') return ready('archive_request');
    const executionRef = occupancy.executionRef;
    if (executionRef.aggregateType === 'Run') {
      const read = await deps.executions.readExecution(ctx, executionRef);
      if (read.status !== 'ready') return read;
      const run = read.value.run;
      if (run.status === 'starting') return ready('claim_not_started');
      if (run.outcome === 'outcome_unknown') return ready('unknown');
      return ready('run');
    }
    const read = await deps.queries.readQueryJob(ctx,
      queryJobRefFor(executionRef.projectId, executionRef.workspaceId, executionRef.queryJobId));
    if (read.status !== 'ready') return read;
    const phase = read.value.run.run.executionState?.phase;
    if (phase === 'claimed' || phase === 'prepared' || phase === 'entering' || phase === 'entered') {
      return ready('query');
    }
    return ready(phase === 'unknown' ? 'unknown' : null);
  }

  /** One message as an offer, through the one eligibility rule and the one `consultationFacts` conversion. */
  async function offerOf(ctx: CoreCallContext, message: SessionMessage, part: 'message' | 'response',
    target: SessionRef, cursor: () => CommitCursor): Promise<ReadResult<CandidateOffer | null>> {
    const extra = await deps.eligibility.readDeliveryEligibilityFacts(ctx, { messageRef: message.ref });
    if (extra.status !== 'ready') return extra;
    const facts = consultationFacts(message, part, extra.value, target);
    if (!deliveryEligibility(facts).offerable) return ready(null);
    if (facts.part === 'response') {
      // A reply is a late reply only when its wait is consumed or it answers no wait; an unconsumed bound
      // wait is the goal's wake, and an accepted/delivered one is no input at all.
      if (facts.wait.kind !== 'consumed' && facts.wait.kind !== 'none') return ready(null);
      return ready({ kind: 'late_reply', message, cursor });
    }
    const kind = offerKindOf(message);
    return ready(kind === null ? null : { kind, message, cursor });
  }

  /** The inbox and the Session's whole outbox, walked to the end; person offers first, then commit order. */
  async function offersOf(ctx: CoreCallContext, record: SessionCard['record']):
    Promise<ReadResult<OfferSet>> {
    // The mailbox ports take a plain SessionRef; the record's ref carries `aggregateType` for the store.
    const session: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
    const offers: CandidateOffer[] = [];
    let inboxCursor: string | undefined;
    for (;;) {
      // The mailbox page bound the existing supply loops use.
      const read = await deps.messages.readInbox(ctx, { recipient: session, page: {
        limit: 100, ...(inboxCursor === undefined ? {} : { cursor: inboxCursor }) } });
      if (read.status !== 'ready') return read;
      const page = read.value;
      for (const [index, message] of page.items.entries()) {
        if (message.intent === 'inquiry' && message.status === 'responded') continue;
        const offer = await offerOf(ctx, message, 'message', session, () => page.cursors[index]!);
        if (offer.status !== 'ready') return offer;
        if (offer.value !== null) offers.push(offer.value);
      }
      const next = page.nextCursor ?? undefined;
      if (next === undefined) break;
      inboxCursor = next;
    }
    let outboxCursor: string | undefined;
    for (;;) {
      const read = await deps.messages.readOutbox!(ctx, { senderSession: session, page: {
        limit: 100, ...(outboxCursor === undefined ? {} : { cursor: outboxCursor }) } });
      if (read.status !== 'ready') return read;
      const page = read.value;
      for (const message of page.items) {
        if (message.status !== 'responded' || message.response === null) continue;
        const cursor = (): CommitCursor => message.responseSince!;
        const offer = await offerOf(ctx, message, 'response', session, cursor);
        if (offer.status !== 'ready') return offer;
        if (offer.value !== null) offers.push(offer.value);
      }
      const next = page.nextCursor ?? undefined;
      if (next === undefined) break;
      outboxCursor = next;
    }
    const person = offers.filter(offer => offer.kind === 'person_message')
      .sort(compareSessionInputCandidates);
    const rest = offers.filter(offer => offer.kind !== 'person_message')
      .sort(compareSessionInputCandidates);
    const ordered: CandidateOffer[] = [...person, ...rest];
    const kinds: ConsumableSessionKindV1[] = [];
    for (const offer of ordered) if (!kinds.includes(offer.kind)) kinds.push(offer.kind);
    const first = ordered.find(offer => offer.kind !== 'notify');
    return ready({
      kinds,
      nextMessage: first === undefined ? null : { kind: first.kind, messageRef: first.message.ref },
    });
  }

  async function readConsumableSessions(ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; after: string | null; limit: number }):
    Promise<ReadResult<ConsumableSessionsPageV1>> {
    // `limit` counts candidate Sessions only: a busy card is returned with its reason but does not use the quota,
    // so the directory is walked page by page until the quota or the directory's end.
    const items: ConsumableSessionV1[] = [];
    let candidates = 0;
    let next: string | null = null;
    let after = input.after;
    for (;;) {
      const found = await deps.directory.findSessions(ctx, {
        workspace: input.workspace,
        includeArchived: false,
        page: { limit: 50,
          ...(after === null ? {} : { afterSessionKey: after }) },
      });
      if (found.status !== 'ready') return found;
      for (const card of found.value.items) {
        if (candidates >= input.limit) return ready({ items, next });
        const busyRead = await busyReasonOf(ctx, card.record);
        if (busyRead.status !== 'ready') return busyRead;
        let kinds: ConsumableSessionKindV1[] = [];
        let nextMessage: ConsumableSessionOfferV1 | null = null;
        if (busyRead.value === null) {
          const offers = await offersOf(ctx, card.record);
          if (offers.status !== 'ready') return offers;
          kinds = offers.value.kinds;
          nextMessage = offers.value.nextMessage;
        }
        items.push({
          session: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId },
          role: card.record.role,
          availability: card.availability,
          busy: busyRead.value,
          kinds,
          nextMessage,
        });
        next = plainSessionRefKey(card.record.ref);
        if (busyRead.value === null) candidates += 1;
      }
      if (found.value.nextCursor === null) return ready({ items, next: null });
      if (candidates >= input.limit) return ready({ items, next });
      after = next;
    }
  }

  return { readConsumableSessions };
}
