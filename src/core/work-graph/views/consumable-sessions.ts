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
import { parseInitialPlanningResponseV2 } from '../../../contracts/initial-planning-parse.js';
import { interventionPlanningQueryRefs, queryJobRefFor } from '../../../contracts/query-job.js';
import type { SessionAvailability } from '../state/session-availability.js';
import type { SessionCard, SessionDirectoryPort, SessionPageRequest } from '../model/session-contracts.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import { consultationFacts, type SessionMessage } from '../model/communication-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { QueryJobPort } from '../queries/contracts.js';
import type { DeliveryEligibilityFactsPort } from '../model/session-facts-contracts.js';
import { deliveryEligibility, waitFactsOfRecord, waitStateOf } from '../state/message-machine.js';
import { plainSessionRefKey } from '../sessions/session-record-codecs.js';
import { compareSessionInputCandidates, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { planProposalIdFor } from '../tasks/plan-service.js';

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
  /** non-null means no queued offer; only a line's own unentered intervention planning Query keeps its source message. */
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
  queries: Pick<QueryJobPort, 'readQueryJob' | 'readQueryAnswer'>;
  messages: Pick<SessionMailboxPort, 'readInbox' | 'readOutbox' | 'readMessage'>;
  /** The one candidate read `settlementOfferOf` needs; it never writes a record. */
  plans: Pick<PlanTaskPort, 'readPlanProposal'>;
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
    // A Host system round is a real planning request; it is not an agent's released request (no `release`
    // check) and never a person's message. Occupancy, health and archive still decide through `busyReasonOf`.
    if (message.sender.kind === 'host' && message.sender.actor.kind === 'system'
      && message.intent === 'action_request') return 'action_request';
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

  /**
   * §5.5.2's recovery read: the settlement offer of one traversed inbox source. It derives that source's one
   * deterministic intervention Query, and offers the source again only while the Query is terminal and the
   * source's close-out is still missing. Both the Query and its candidate are read by identity; Session
   * occupancy is never consulted and nothing is written or re-delivered. Only an executor M whose wait is still
   * open has its candidate/questions close-out deferred (C-25); its accepted-candidate reply belongs to the adopted
   * recovery (6.1.6), so it gets no settlement offer in that class either. A consumed wait, a message that did not
   * wait, a person's message and a Host system R always get the close-out.
   */
  async function settlementOfferOf(ctx: CoreCallContext, source: SessionMessage, scope: WorkspaceScope):
    Promise<ReadResult<ConsumableSessionKindV1 | 'deferred' | null>> {
    const refs = interventionPlanningQueryRefs(source.ref);
    const read = await deps.queries.readQueryJob(ctx, refs.queryJobRef);
    if (read.status === 'not_found') return ready(null);
    if (read.status !== 'ready') return read;
    const record = read.value;
    const execution = record.job.job.intent.execution;
    if (execution.kind !== 'intervention_planning') return ready(null);
    // The commit entry admits an intervention Query only with its source and a real Goal (`query-job.ts:394`,
    // `query-job-service.ts:259`), so both are present on every stored record this read can see.
    const storedSource = execution.sourceMessageRef as SessionMessageRef;
    if (sessionMessageRefKey(storedSource) !== sessionMessageRefKey(source.ref)) return ready(null);
    const jobStatus = record.job.job.status;
    const runEnded = record.run.run.status === 'closed'
      || record.run.run.executionState?.phase === 'settled';
    if (jobStatus !== 'answered' && jobStatus !== 'closed' && !runEnded) return ready(null);
    // The source already has its one reply slot filled, or was withdrawn: the settlement is written (or another
    // writer won first). A withdrawn source is never offered again.
    if (source.response !== null || source.withdrawnAt !== null) return ready(null);
    const answerRef = record.job.job.answerRefs.at(-1);
    if (answerRef === undefined) {
      // A formally closed Query without an Answer is the `no_answer` ending; a withdrawn source is already settled.
      if (jobStatus !== 'closed' && !runEnded) return ready(null);
      return ready('action_request');
    }
    const answer = await deps.queries.readQueryAnswer(ctx, answerRef);
    if (answer.status !== 'ready') return answer;
    let terminal: 'settled' | 'candidate' | 'questions' | 'adopted' = 'settled';
    if (execution.answerShape !== 'plan_review') {
      const parsed = parseInitialPlanningResponseV2(answer.value.answer.answer);
      if (parsed.status === 'parsed' && parsed.response.kind === 'needs_decision') {
        terminal = 'questions';
      } else if (parsed.status === 'parsed' && parsed.response.kind === 'plan') {
        // The candidate's deterministic identity is the intervention's propose identity for this source.
        const goalId = record.job.job.goalId as string;
        const proposal = await deps.plans.readPlanProposal(ctx, {
          aggregateType: 'PlanProposal', projectId: scope.projectId, workspaceId: scope.workspaceId,
          proposalId: planProposalIdFor({ projectId: scope.projectId, workspaceId: scope.workspaceId, goalId,
            requestId: `intervention:${sessionMessageRefKey(source.ref)}:propose` }),
        });
        if (proposal.status !== 'ready' && proposal.status !== 'not_found') return proposal;
        // A candidate that is not written yet is the same `plan` class: the handler writes it from the same Query.
        // A stored `candidate` whose `basedOn` moved on is the same class (the handler's proposal read derives it).
        if (proposal.status === 'ready' && proposal.value.status === 'candidate') terminal = 'candidate';
        // An accepted candidate only completes R here; the executor M's one reply belongs to the adopted-candidate
        // recovery (6.1.6), exactly as §5.5.2 class 1 says.
        if (proposal.status === 'ready' && proposal.value.status === 'accepted') terminal = 'adopted';
      }
    }
    const executorSender = source.sender.kind === 'work_run' || source.sender.kind === 'secretary_round';
    const executorWait = executorSender
      && source.waitAfterSend
      && waitStateOf(source, waitFactsOfRecord(source)).state === 'open';
    // The executor M's accepted-candidate reply belongs to the adopted recovery (6.1.6); only a wait that is still
    // open defers its candidate/questions close-out. A consumed wait or a message that did not wait is offered.
    if (executorSender && terminal === 'adopted') return ready(null);
    if (executorWait && (terminal === 'candidate' || terminal === 'questions')) return ready('deferred');
    return ready('action_request');
  }

  /** The inbox and the Session's whole outbox, walked to the end; person offers first, then commit order. */
  async function offersOf(ctx: CoreCallContext, record: SessionCard['record']):
    Promise<ReadResult<OfferSet>> {
    // The mailbox ports take a plain SessionRef; the record's ref carries `aggregateType` for the store.
    const session: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
    const workspace: WorkspaceScope = { projectId: record.ref.projectId, workspaceId: record.workspaceId };
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
        if (offer.value !== null && offer.value.kind !== 'action_request') {
          offers.push(offer.value);
          continue;
        }
        // §5.5.2: a terminal Query whose source close-out is still missing is offered again from the same source;
        // the ordinary delivery rule above no longer offers a delivered message. A deferred executor M stays
        // undelivered while its wait is open, and its answered Query makes it no new input: it never heads the queue.
        const settlement = await settlementOfferOf(ctx, message, workspace);
        if (settlement.status !== 'ready') return settlement;
        if (settlement.value === 'deferred') continue;
        if (offer.value !== null) {
          offers.push(offer.value);
        } else if (settlement.value !== null) {
          offers.push({ kind: settlement.value, message, cursor: () => page.cursors[index]! });
        }
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

  /**
   * The one offer a claimed or prepared `intervention_planning` Query keeps on its own line: its recorded
   * source message, built by the ordinary `offerOf` eligibility rule, and only when that message is addressed
   * to this line. The Query has not entered a turn yet, so the Host may enter again and let the intervention
   * handler continue the same Query; entering/entered are a running turn and offer nothing. Any other Query,
   * any other line, and a paused Goal offer nothing.
   */
  async function resumeOfferOf(ctx: CoreCallContext, record: SessionCard['record']):
    Promise<ReadResult<CandidateOffer | null>> {
    const occupancy = record.occupancy;
    if (occupancy === null || occupancy.kind !== 'execution'
      || occupancy.executionRef.aggregateType !== 'QueryRun') return ready(null);
    const read = await deps.queries.readQueryJob(ctx, queryJobRefFor(
      occupancy.executionRef.projectId, occupancy.executionRef.workspaceId,
      occupancy.executionRef.queryJobId));
    if (read.status !== 'ready') return read;
    const execution = read.value.job.job.intent.execution;
    if (execution.kind !== 'intervention_planning') return ready(null);
    const state = read.value.run.run.executionState;
    if (state === undefined || (state.phase !== 'claimed' && state.phase !== 'prepared')) return ready(null);
    const source = execution.sourceMessageRef;
    if (source === undefined) return ready(null);
    // The exact recorded source, never the queue head: a newer message stays queued. One offer needs no order.
    const message = await deps.messages.readMessage(ctx, source);
    if (message.status !== 'ready') return message;
    const session: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
    // The Query was claimed on this line, but only a message addressed to this line may be resumed: a user
    // recipient (`'kind' in recipient`) is not a line, and another line's message stays with its own recipient.
    const recipient = message.value.recipient;
    if ('kind' in recipient || recipient.projectId !== session.projectId
      || recipient.sessionId !== session.sessionId) return ready(null);
    return offerOf(ctx, message.value, 'message', session, () => { throw new Error('a resume offer is never sorted'); });
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
        } else if (busyRead.value === 'query') {
          const resumed = await resumeOfferOf(ctx, card.record);
          if (resumed.status !== 'ready') return resumed;
          if (resumed.value !== null) {
            kinds = [resumed.value.kind];
            nextMessage = { kind: resumed.value.kind, messageRef: resumed.value.message.ref };
          }
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
